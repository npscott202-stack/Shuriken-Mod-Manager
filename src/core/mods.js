// Mod staging, installation (incl. FOMOD), profiles, conflict detection and hardlink deployment.
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./store');
const { GAMES } = require('./games');
const archives = require('./archives');
const fomod = require('./fomod');
const plugins = require('./plugins');
const library = require('./library');

const DATA_HINTS = new Set([
  'meshes', 'textures', 'scripts', 'interface', 'sound', 'music', 'seq', 'strings', 'materials', 'lodsettings',
  'skse', 'f4se', 'sfse', 'mcm', 'shadersfx', 'grass', 'video', 'facegen', 'tools', 'vis', 'geometries',
  'calientetools', 'nemesis_engine', 'dyndolod', 'shaders', 'source', 'platform', 'lightplacer', 'distantlod',
]);
const DATA_FILE_RE = /\.(esp|esm|esl|bsa|ba2|ini)$/i;
const ROOT_FILE_RE = /(_loader\.exe|^d3d11\.dll|^dxgi\.dll|^d3dcompiler_46e\.dll|^enbseries\.ini|^enblocal\.ini|^reshade\.ini|^winhttp\.dll|^version\.dll)$/i;

// ---------- state ----------
function defaults(gameId) {
  return {
    installDir: null,
    stagingDir: null,
    mcVersion: '',
    loader: 'fabric',
    mods: {},
    profiles: { Default: { order: [], enabled: {}, plugins: null } },
    activeProfile: 'Default',
    deployment: { files: {}, deployedAt: null, dirty: false },
    tools: [],
  };
}

// ---------- instances (MO2-style: fully separate mod setups per game) ----------
const DEFAULT_INSTANCE = 'Default';

function instanceDb() {
  return store.load('instances', {});
}

function instances(gameId) {
  const db = instanceDb();
  if (!db[gameId]) db[gameId] = { active: DEFAULT_INSTANCE, list: [DEFAULT_INSTANCE] };
  return db[gameId];
}

function instanceSuffix(gameId, name = instances(gameId).active) {
  return name === DEFAULT_INSTANCE ? '' : `~${slug(name)}`;
}

function state(gameId) {
  return store.load(`game-${gameId}${instanceSuffix(gameId)}`, defaults(gameId));
}

function save(gameId) {
  store.save(`game-${gameId}${instanceSuffix(gameId)}`, state(gameId));
}

function createInstance(gameId, name, copyFrom) {
  const inst = instances(gameId);
  name = String(name || '').trim();
  if (!name) throw new Error('Name the instance first.');
  if (inst.list.some((x) => x.toLowerCase() === name.toLowerCase())) throw new Error('An instance with that name already exists.');
  const cur = state(gameId);
  const fresh = defaults(gameId);
  // A new instance points at the same game folder and tools, but has its own mods and profiles.
  Object.assign(fresh, { installDir: cur.installDir, mcVersion: cur.mcVersion, loader: cur.loader, tools: structuredClone(cur.tools || []), deployMode: cur.deployMode || 'hardlink' });
  if (copyFrom) {
    // Copy the mod list setup (not the files): mods are re-linked from the source instance's staging folder.
    fresh.profiles = structuredClone(cur.profiles);
    fresh.activeProfile = cur.activeProfile;
  }
  store.save(`game-${gameId}${instanceSuffix(gameId, name)}`, fresh);
  inst.list.push(name);
  store.save('instances', instanceDb());
  if (copyFrom) {
    // Copy staged mod folders so the two instances stay independent.
    const fromDir = stagingDir(gameId);
    const prevActive = inst.active;
    inst.active = name;
    const toDir = stagingDir(gameId);
    for (const [id, mod] of Object.entries(cur.mods)) {
      const src = path.join(fromDir, id);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(toDir, id), { recursive: true });
      state(gameId).mods[id] = structuredClone(mod);
    }
    save(gameId);
    inst.active = prevActive;
    store.save('instances', instanceDb());
  }
  return instances(gameId);
}

function switchInstance(gameId, name) {
  const inst = instances(gameId);
  if (!inst.list.includes(name)) throw new Error('No such instance.');
  if (inst.active === name) return inst;
  // Hardlinked files from the old instance must leave the game folder first.
  const cur = state(gameId);
  if ((cur.deployMode || 'hardlink') === 'hardlink' && Object.keys(cur.deployment.files || {}).length) purge(gameId);
  inst.active = name;
  store.save('instances', instanceDb());
  const next = state(gameId);
  if ((next.deployMode || 'hardlink') === 'hardlink') next.deployment.dirty = true;
  save(gameId);
  return inst;
}

function deleteInstance(gameId, name) {
  const inst = instances(gameId);
  if (name === DEFAULT_INSTANCE) throw new Error('The Default instance cannot be deleted.');
  if (!inst.list.includes(name)) throw new Error('No such instance.');
  if (inst.active === name) switchInstance(gameId, DEFAULT_INSTANCE);
  const prev = inst.active;
  inst.active = name;
  const dir = stagingDir(gameId);
  const st = state(gameId);
  if (Object.keys(st.deployment.files || {}).length) purge(gameId);
  inst.active = prev;
  fs.rmSync(dir, { recursive: true, force: true });
  store.remove(`game-${gameId}${instanceSuffix(gameId, name)}`);
  inst.list = inst.list.filter((x) => x !== name);
  store.save('instances', instanceDb());
  return inst;
}

// ---------- deployment mode + per-profile folders ----------
function deployMode(gameId) {
  const g = GAMES[gameId];
  if (g.kind === 'minecraft') return 'hardlink';
  return state(gameId).deployMode || 'hardlink';
}

function safeFolder(name) {
  return String(name).replace(/[<>:"/\\|?*]/g, '_').trim() || 'Profile';
}

function profileDir(gameId, name = state(gameId).activeProfile) {
  const dir = path.join(stagingDir(gameId), '_profiles', safeFolder(name));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function overwriteDir(gameId) {
  const dir = path.join(stagingDir(gameId), '_overwrite');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Seeds a profile's own plugins.txt / loadorder.txt from the real ones the first time.
function seedProfilePlugins(gameId) {
  const def = GAMES[gameId];
  if (def.kind !== 'bethesda') return;
  const dir = profileDir(gameId);
  for (const f of ['plugins.txt', 'loadorder.txt']) {
    const real = path.join(def.pluginsDir(), f);
    const mine = path.join(dir, f);
    if (!fs.existsSync(mine) && fs.existsSync(real)) fs.copyFileSync(real, mine);
  }
}

function setDeployMode(gameId, mode) {
  if (!['hardlink', 'virtual'].includes(mode)) throw new Error('Unknown mode');
  if (GAMES[gameId].kind === 'minecraft' && mode === 'virtual') throw new Error('Minecraft uses hardlink mode (use instances in your launcher instead).');
  const s = state(gameId);
  const from = s.deployMode || 'hardlink';
  if (from === mode) return mode;
  if (mode === 'virtual') {
    // Clean the game folder: in virtual mode nothing is ever written there.
    if (Object.keys(s.deployment.files || {}).length) purge(gameId);
    seedProfilePlugins(gameId);
    s.deployMode = 'virtual';
    s.deployment.dirty = true;
  } else {
    s.deployMode = 'hardlink';
    s.deployment.dirty = true;
  }
  save(gameId);
  return mode;
}

function setProfileOptions(gameId, name, opts) {
  const s = state(gameId);
  const p = s.profiles[name];
  if (!p) throw new Error('No such profile');
  const def = GAMES[gameId];
  const dir = profileDir(gameId, name);
  if ('localInis' in opts) {
    p.localInis = !!opts.localInis;
    if (p.localInis && def.kind === 'bethesda') {
      // Start the profile's INIs as copies of the current ones.
      const iniDir = path.join(dir, 'ini');
      fs.mkdirSync(iniDir, { recursive: true });
      for (const f of def.iniFiles || []) {
        const src = path.join(def.myGames(), f);
        if (fs.existsSync(src) && !fs.existsSync(path.join(iniDir, f))) fs.copyFileSync(src, path.join(iniDir, f));
      }
    }
  }
  if ('localSaves' in opts) {
    p.localSaves = !!opts.localSaves;
    if (p.localSaves) fs.mkdirSync(path.join(dir, 'saves'), { recursive: true });
  }
  save(gameId);
  return p;
}

function renameProfile(gameId, from, to) {
  const s = state(gameId);
  to = String(to || '').trim();
  if (!to) throw new Error('Name the profile first.');
  if (!s.profiles[from]) throw new Error('No such profile');
  if (s.profiles[to]) throw new Error('A profile with that name already exists.');
  const oldDir = path.join(stagingDir(gameId), '_profiles', safeFolder(from));
  s.profiles[to] = s.profiles[from];
  delete s.profiles[from];
  if (s.activeProfile === from) s.activeProfile = to;
  save(gameId);
  if (fs.existsSync(oldDir)) fs.renameSync(oldDir, path.join(stagingDir(gameId), '_profiles', safeFolder(to)));
}

// Plugin files the game would see in virtual mode: real Data plus every enabled mod (later wins).
function virtualPluginFiles(gameId) {
  const g = GAMES[gameId];
  const s = state(gameId);
  const p = profile(gameId);
  const map = new Map();
  const data = path.join(s.installDir, 'Data');
  try {
    for (const f of fs.readdirSync(data)) if (plugins.PLUGIN_RE.test(f)) map.set(f.toLowerCase(), { name: f, path: path.join(data, f) });
  } catch {
    // no Data folder
  }
  for (const id of p.order) {
    const mod = s.mods[id];
    if (!p.enabled[id] || !mod || mod.type !== 'data') continue;
    const dir = modDir(gameId, id);
    try {
      for (const f of fs.readdirSync(dir)) if (plugins.PLUGIN_RE.test(f)) map.set(f.toLowerCase(), { name: f, path: path.join(dir, f) });
    } catch {
      // empty mod
    }
  }
  const ow = path.join(stagingDir(gameId), '_overwrite');
  try {
    for (const f of fs.readdirSync(ow)) if (plugins.PLUGIN_RE.test(f)) map.set(f.toLowerCase(), { name: f, path: path.join(ow, f) });
  } catch {
    // no overwrite yet
  }
  void g;
  return map;
}

// Game definition merged with this user's paths.
function game(gameId) {
  const def = GAMES[gameId];
  if (!def) throw new Error(`Unknown game ${gameId}`);
  const s = state(gameId);
  const g = { ...def, installDir: s.installDir, stagingDir: stagingDir(gameId), deployMode: deployMode(gameId), instance: instances(gameId).active };
  if (s.pluginsDirOverride) g.pluginsDir = () => s.pluginsDirOverride;
  else if (g.deployMode === 'virtual' && def.kind === 'bethesda' && s.installDir) {
    g.realPluginsDir = def.pluginsDir;
    g.pluginsDir = () => profileDir(gameId);
    g.pluginFiles = () => virtualPluginFiles(gameId);
  }
  return g;
}

function stagingDir(gameId) {
  const s = state(gameId);
  if (s.stagingDir) return s.stagingDir;
  const name = `${gameId}${instanceSuffix(gameId)}`;
  if (!s.installDir) return store.dataDir('staging', name);
  // Hardlinks only work on the same drive as the game, so stage there when the game is elsewhere.
  const gameRoot = path.parse(s.installDir).root.toLowerCase();
  const userRoot = path.parse(store.dataDir()).root.toLowerCase();
  const dir = gameRoot === userRoot ? store.dataDir('staging', name) : path.join(gameRoot, 'ModForge', 'Staging', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function profile(gameId) {
  const s = state(gameId);
  if (!s.profiles[s.activeProfile]) s.profiles[s.activeProfile] = { order: [], enabled: {}, plugins: null };
  return s.profiles[s.activeProfile];
}

function setGamePath(gameId, installDir) {
  const s = state(gameId);
  s.installDir = installDir;
  s.stagingDir = null;
  save(gameId);
}

// ---------- listing ----------
function walk(dir, base = dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

function modDir(gameId, modId) {
  return path.join(stagingDir(gameId), modId);
}

function listMods(gameId) {
  const s = state(gameId);
  const p = profile(gameId);
  // Make sure every installed mod is in this profile's order.
  for (const id of Object.keys(s.mods)) if (!p.order.includes(id)) p.order.push(id);
  p.order = p.order.filter((id) => s.mods[id]);
  const conflicts = computeConflicts(gameId);
  return p.order.map((id, index) => ({
    ...s.mods[id],
    priority: index,
    enabled: !!p.enabled[id],
    conflicts: conflicts[id] || { wins: [], loses: [] },
  }));
}

function targetRoot(g, mod) {
  if (g.kind === 'generic') return library.expand(g.base, g.installDir);
  if (g.kind === 'minecraft') {
    if (mod.type === 'mc-root') return g.installDir;
    const sub = { 'mc-resourcepack': 'resourcepacks', 'mc-shaderpack': 'shaderpacks', 'mc-datapack': 'datapacks' }[mod.type] || 'mods';
    return path.join(g.installDir, sub);
  }
  return mod.type === 'root' ? g.installDir : path.join(g.installDir, 'Data');
}

// Map of absolute target path -> { mod, source } for the active profile (later mods win).
// Files that must be real even in virtual mode: usvfs can't start a program that only exists
// virtually, and DLL proxies (ENB/ReShade/loaders) are loaded before hooks are in place.
function needsRealFile(g, mod, rel) {
  if (mod.type === 'root') return true;
  if (g.kind === 'generic' && library.expand(g.base, g.installDir) === g.installDir) {
    return !/[\\/]/.test(rel) && /\.(exe|dll|asi|ini)$/i.test(rel);
  }
  return false;
}

function desiredFiles(gameId) {
  const g = game(gameId);
  const s = state(gameId);
  const p = profile(gameId);
  const map = new Map();
  const virtual = g.deployMode === 'virtual';
  for (const id of p.order) {
    if (!p.enabled[id] || !s.mods[id]) continue;
    const mod = s.mods[id];
    const root = targetRoot(g, mod);
    const src = modDir(gameId, id);
    for (const rel of walk(src)) {
      if (/^fomod[\\/]/i.test(rel) || /^(readme|changelog)[^\\/]*\.(txt|md|pdf)$/i.test(rel)) continue;
      if (virtual && !needsRealFile(g, mod, rel)) continue;
      map.set(path.join(root, rel).toLowerCase(), { target: path.join(root, rel), source: path.join(src, rel), mod: id });
    }
  }
  return map;
}

function computeConflicts(gameId) {
  const s = state(gameId);
  const p = profile(gameId);
  const owners = new Map();
  for (const id of p.order) {
    if (!p.enabled[id] || !s.mods[id]) continue;
    for (const rel of walk(modDir(gameId, id))) {
      const key = `${s.mods[id].type}|${rel.toLowerCase()}`;
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key).push(id);
    }
  }
  const result = {};
  const add = (id, field, other) => {
    result[id] = result[id] || { wins: [], loses: [], files: 0 };
    if (!result[id][field].includes(other)) result[id][field].push(other);
  };
  for (const list of owners.values()) {
    if (list.length < 2) continue;
    const winner = list[list.length - 1];
    for (const loser of list.slice(0, -1)) {
      add(winner, 'wins', loser);
      add(loser, 'loses', winner);
      result[loser].files++;
    }
  }
  return result;
}

// ---------- install ----------
function slug(name) {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mod';
}

function cleanName(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/-\d+(-[\d-]+)?-\d{9,}$/, '') // Nexus "-1234-1-0-1700000000" suffix
    .replace(/[_]+/g, ' ')
    .trim();
}

function findDataRoot(dir, depth = 0) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const names = entries.map((e) => e.name.toLowerCase());
  const dataFolder = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === 'data');
  const hasRootFiles = entries.some((e) => e.isFile() && ROOT_FILE_RE.test(e.name));
  if (hasRootFiles) return { root: dir, type: 'root' };
  if (dataFolder) return { root: path.join(dir, dataFolder.name), type: 'data' };
  const dataish = entries.some(
    (e) => (e.isDirectory() && DATA_HINTS.has(e.name.toLowerCase())) || (e.isFile() && DATA_FILE_RE.test(e.name)),
  );
  if (dataish) return { root: dir, type: 'data' };
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1 && depth < 4 && !names.includes('fomod')) return findDataRoot(path.join(dir, dirs[0].name), depth + 1);
  return { root: dir, type: 'data', uncertain: true };
}

function moveDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch {
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

function registerMod(gameId, info) {
  const s = state(gameId);
  const p = profile(gameId);
  s.mods[info.id] = { installedAt: new Date().toISOString(), ...info };
  if (!p.order.includes(info.id)) p.order.push(info.id);
  p.enabled[info.id] = true;
  s.deployment.dirty = true;
  save(gameId);
  return s.mods[info.id];
}

function findExisting(gameId, meta) {
  const s = state(gameId);
  if (!meta.sourceId) return null;
  return Object.values(s.mods).find((m) => m.source === meta.source && String(m.sourceId) === String(meta.sourceId)) || null;
}

const pendingFomod = new Map();

// Installs an archive or a single file. Returns { mod } or { fomod } when the installer wizard is needed.
async function installFile(gameId, filePath, meta = {}) {
  const g = game(gameId);
  const name = meta.name || cleanName(filePath);
  const existing = findExisting(gameId, meta);
  const id = existing ? existing.id : `${slug(name)}-${Date.now().toString(36)}`;
  const dest = modDir(gameId, id);
  if (existing) fs.rmSync(dest, { recursive: true, force: true });

  if (g.kind === 'minecraft') {
    const lower = filePath.toLowerCase();
    let type = meta.type || (lower.endsWith('.jar') ? 'mc-mod' : 'mc-resourcepack');
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(filePath, path.join(dest, path.basename(filePath)));
    return { mod: registerMod(gameId, { id, name, type, version: meta.version || '', source: meta.source || 'local', sourceId: meta.sourceId, sourceUrl: meta.sourceUrl, fileName: path.basename(filePath) }) };
  }

  if (g.kind === 'generic') return installGeneric(gameId, g, filePath, { id, name, meta, dest });

  if (/\.(esp|esm|esl)$/i.test(filePath)) {
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(filePath, path.join(dest, path.basename(filePath)));
    return { mod: registerMod(gameId, { id, name, type: 'data', version: meta.version || '', source: meta.source || 'local', sourceId: meta.sourceId, sourceUrl: meta.sourceUrl }) };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shuriken-'));
  await archives.extract(filePath, tmp);

  const fomodConfig = fomod.find(tmp);
  if (fomodConfig) {
    const token = `${id}`;
    const parsed = fomod.parse(fomodConfig.configPath);
    pendingFomod.set(token, { gameId, id, name, meta, tmp, fomodRoot: fomodConfig.root, parsed });
    return { fomod: { token, name: parsed.moduleName || name, steps: fomod.publicSteps(parsed, fomodConfig.root) } };
  }

  const { root, type, uncertain } = findDataRoot(tmp);
  moveDir(root, dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  const mod = registerMod(gameId, {
    id, name, type, uncertain: !!uncertain, version: meta.version || '', source: meta.source || 'local',
    sourceId: meta.sourceId, sourceUrl: meta.sourceUrl, fileId: meta.fileId,
  });
  return { mod };
}

// ---------- generic games (see library.js for the strategies) ----------
function copyInto(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function findManifestDirs(root, g, depth = 0, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  const hit = (g.manifest && fs.existsSync(path.join(root, g.manifest))) ||
    (g.manifestExt && entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith(g.manifestExt)));
  if (hit && depth > 0) {
    out.push(root);
    return out;
  }
  if (depth < 5) for (const e of entries) if (e.isDirectory()) findManifestDirs(path.join(root, e.name), g, depth + 1, out);
  return out;
}

function genericRoot(dir, g, depth = 0) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const lower = entries.map((e) => e.name.toLowerCase());
  const markers = (g.markers || []).map((m) => m.toLowerCase());
  const ruled = entries.some((e) => e.isFile() && g.rules?.[path.extname(e.name).toLowerCase()]);
  const prefixed = g.prefixDirs && entries.some((e) => e.isDirectory() && Object.keys(g.prefixDirs).some((p) => e.name.toLowerCase().startsWith(p)));
  if (lower.some((n) => markers.includes(n)) || ruled || prefixed || depth >= 4) return dir;
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1 && entries.length === 1) return genericRoot(path.join(dir, dirs[0].name), g, depth + 1);
  return dir;
}

async function installGeneric(gameId, g, filePath, { id, name, meta, dest }) {
  if (g.strategy === 'tool') throw new Error(`${g.name} mods are installed with ${g.tools[0]}. Add it on the Tools page and launch it from there.`);
  const info = { id, name, type: 'generic', version: meta.version || '', source: meta.source || 'local', sourceId: meta.sourceId, sourceUrl: meta.sourceUrl, fileId: meta.fileId };
  fs.mkdirSync(dest, { recursive: true });
  const ext = path.extname(filePath).toLowerCase();
  const isArchive = /\.(zip|7z|rar)$/i.test(filePath);

  // Single-file mods (.pak, .dll, .package, Factorio zips...) are copied as-is.
  if (g.strategy === 'copy' || !isArchive) {
    let sub = '';
    if (g.strategy !== 'copy') sub = g.rules?.[ext] || (g.keepTopFolder ? name : '');
    const target = path.join(dest, sub, path.basename(filePath));
    copyInto(filePath, target);
    return { mod: registerMod(gameId, { ...info, fileName: path.basename(filePath) }) };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shuriken-'));
  await archives.extract(filePath, tmp);
  const fomodConfig = fomod.find(tmp);
  if (fomodConfig) {
    const parsed = fomod.parse(fomodConfig.configPath);
    pendingFomod.set(id, { gameId, id, name, meta, tmp, fomodRoot: fomodConfig.root, parsed });
    return { fomod: { token: id, name: parsed.moduleName || name, steps: fomod.publicSteps(parsed, fomodConfig.root) } };
  }

  let uncertain = false;
  if (g.strategy === 'folder') {
    const hits = g.keepTopFolder ? [] : findManifestDirs(tmp, g).concat(g.manifest && fs.existsSync(path.join(tmp, g.manifest)) ? [tmp] : []);
    if (hits.length) {
      for (const h of hits) copyInto(h, path.join(dest, h === tmp ? mods_safeName(name) : path.basename(h)));
    } else {
      const entries = fs.readdirSync(tmp, { withFileTypes: true });
      const single = entries.length === 1 && entries[0].isDirectory();
      copyInto(single ? path.join(tmp, entries[0].name) : tmp, path.join(dest, single ? entries[0].name : mods_safeName(name)));
      uncertain = !g.keepTopFolder;
    }
  } else if (g.strategy === 'files') {
    const markers = (g.markers || []).map((m) => m.toLowerCase());
    for (const rel of walk(tmp)) {
      const e = path.extname(rel).toLowerCase();
      const parts = rel.split(/[\\/]/);
      const mi = parts.findIndex((p) => markers.includes(p.toLowerCase()));
      let target;
      if (mi >= 0) target = path.join(dest, ...parts.slice(mi));
      else if (g.rules?.[e]) target = path.join(dest, g.rules[e], parts[parts.length - 1]);
      else if (/\.(txt|md|pdf|png|jpg|url)$/i.test(rel)) continue;
      else { target = path.join(dest, rel); uncertain = true; }
      copyInto(path.join(tmp, rel), target);
    }
  } else {
    // root: the archive mirrors the game folder.
    const root = genericRoot(tmp, g);
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const src = path.join(root, e.name);
      const ruleDir = e.isFile() ? g.rules?.[path.extname(e.name).toLowerCase()] : null;
      const prefix = e.isDirectory() && g.prefixDirs && Object.entries(g.prefixDirs).find(([p, d]) => e.name.toLowerCase().startsWith(p) && e.name.toLowerCase() !== d.toLowerCase());
      if (ruleDir) copyInto(src, path.join(dest, ruleDir, e.name));
      else if (prefix) copyInto(src, path.join(dest, prefix[1], e.name));
      else copyInto(src, path.join(dest, e.name));
    }
    const markers = (g.markers || []).map((m) => m.toLowerCase());
    uncertain = !fs.readdirSync(dest).some((n) => markers.includes(n.toLowerCase())) && !Object.values(g.rules || {}).length;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!walk(dest).length) throw new Error('Nothing was installed: the archive layout was not recognised.');
  return { mod: registerMod(gameId, { ...info, uncertain }) };
}

function mods_safeName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Mod';
}

function fomodVisibleStep(token, fromIndex, selections) {
  const p = pendingFomod.get(token);
  if (!p) throw new Error('Installer session expired');
  const g = game(p.gameId);
  const dataDir = g.installDir ? path.join(g.installDir, 'Data') : null;
  return fomod.nextVisibleStep(p.parsed, fromIndex, selections, dataDir);
}

function fomodComplete(token, selections) {
  const p = pendingFomod.get(token);
  if (!p) throw new Error('Installer session expired');
  const g = game(p.gameId);
  const dataDir = g.installDir ? path.join(g.installDir, 'Data') : null;
  const dest = modDir(p.gameId, p.id);
  fs.rmSync(dest, { recursive: true, force: true });
  const ops = fomod.resolveFiles(p.parsed, selections, dataDir);
  for (const op of ops) {
    const src = path.join(p.fomodRoot, op.source.replace(/\//g, '\\'));
    const target = path.join(dest, (op.destination || '').replace(/\//g, '\\'));
    if (!fs.existsSync(src)) continue;
    if (fs.statSync(src).isDirectory()) fs.cpSync(src, target, { recursive: true, force: true });
    else {
      let finalTarget = target;
      if (op.destination === undefined || op.destination === null) finalTarget = path.join(dest, op.source);
      else if (op.destination === '' || /[\\/]$/.test(op.destination)) finalTarget = path.join(target, path.basename(src));
      fs.mkdirSync(path.dirname(finalTarget), { recursive: true });
      fs.copyFileSync(src, finalTarget);
    }
  }
  fs.rmSync(p.tmp, { recursive: true, force: true });
  pendingFomod.delete(token);
  return registerMod(p.gameId, {
    id: p.id, name: p.name, type: g.kind === 'generic' ? 'generic' : 'data', version: p.meta.version || '', source: p.meta.source || 'local',
    sourceId: p.meta.sourceId, sourceUrl: p.meta.sourceUrl, fileId: p.meta.fileId, fomod: true, fomodChoices: selections,
  });
}

function fomodCancel(token) {
  const p = pendingFomod.get(token);
  if (p) fs.rmSync(p.tmp, { recursive: true, force: true });
  pendingFomod.delete(token);
}

function removeMod(gameId, modId) {
  const s = state(gameId);
  delete s.mods[modId];
  for (const p of Object.values(s.profiles)) {
    p.order = p.order.filter((x) => x !== modId);
    delete p.enabled[modId];
  }
  fs.rmSync(modDir(gameId, modId), { recursive: true, force: true });
  s.deployment.dirty = true;
  save(gameId);
}

function setEnabled(gameId, modId, enabled) {
  const s = state(gameId);
  if (!s.mods[modId]) throw new Error(`No mod with id ${modId}`);
  profile(gameId).enabled[modId] = !!enabled;
  s.deployment.dirty = true;
  save(gameId);
}

function setOrder(gameId, order) {
  const s = state(gameId);
  profile(gameId).order = order.filter((id) => s.mods[id]);
  s.deployment.dirty = true;
  save(gameId);
}

function renameMod(gameId, modId, name) {
  state(gameId).mods[modId].name = name;
  save(gameId);
}

// ---------- profiles ----------
function profiles(gameId) {
  const s = state(gameId);
  return { active: s.activeProfile, names: Object.keys(s.profiles) };
}

function createProfile(gameId, name, copyFrom) {
  const s = state(gameId);
  if (s.profiles[name]) throw new Error('Profile already exists');
  s.profiles[name] = copyFrom && s.profiles[copyFrom] ? structuredClone(s.profiles[copyFrom]) : { order: Object.keys(s.mods), enabled: {}, plugins: null };
  save(gameId);
}

function switchProfile(gameId, name) {
  const s = state(gameId);
  const g = game(gameId);
  if (!s.profiles[name]) throw new Error('No such profile');
  if (g.kind === 'bethesda' && g.installDir) profile(gameId).plugins = plugins.readPluginsTxt(g);
  s.activeProfile = name;
  s.deployment.dirty = deployMode(gameId) !== 'virtual';
  save(gameId);
  if (deployMode(gameId) === 'virtual') seedProfilePlugins(gameId);
}

function deleteProfile(gameId, name) {
  const s = state(gameId);
  if (Object.keys(s.profiles).length < 2) throw new Error('Cannot delete the last profile');
  delete s.profiles[name];
  if (s.activeProfile === name) s.activeProfile = Object.keys(s.profiles)[0];
  save(gameId);
}

// ---------- deployment ----------
function sameFile(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return (sa.ino && sa.ino === sb.ino && sa.dev === sb.dev) || (sa.size === sb.size && Math.abs(sa.mtimeMs - sb.mtimeMs) < 2);
  } catch {
    return false;
  }
}

function removeEmptyParents(file, stopAt) {
  let dir = path.dirname(file);
  const stop = path.resolve(stopAt).toLowerCase();
  while (dir.toLowerCase().startsWith(stop) && dir.toLowerCase() !== stop) {
    try {
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

const deploying = new Set();

// Only one deploy/purge per game at a time.
async function deploy(gameId, onProgress = () => {}) {
  if (deploying.has(gameId)) throw new Error('A deploy is already running for this game.');
  deploying.add(gameId);
  try {
    return await deployUnlocked(gameId, onProgress);
  } finally {
    deploying.delete(gameId);
  }
}

async function deployUnlocked(gameId, onProgress) {
  const g = game(gameId);
  if (!g.installDir) throw new Error(`Set the ${g.name} folder first.`);
  const s = state(gameId);
  const backupRoot = path.join(stagingDir(gameId), '_backup');
  const desired = desiredFiles(gameId);
  const old = s.deployment.files || {};
  const next = {};
  let linked = 0;
  let copied = 0;
  let removed = 0;

  // 1. remove stale links and restore originals
  for (const [key, rec] of Object.entries(old)) {
    const want = desired.get(key);
    if (want && want.source === rec.source) {
      next[key] = rec;
      desired.delete(key);
      continue;
    }
    if (fs.existsSync(rec.target) && sameFile(rec.target, rec.source)) fs.rmSync(rec.target, { force: true });
    if (rec.backup && fs.existsSync(rec.backup)) {
      if (want) {
        next[key] = { ...rec };
      } else {
        fs.mkdirSync(path.dirname(rec.target), { recursive: true });
        fs.renameSync(rec.backup, rec.target);
      }
    }
    if (!want) removeEmptyParents(rec.target, g.installDir);
    removed++;
  }

  // 2. link new files
  const total = desired.size;
  let done = 0;
  for (const [key, want] of desired) {
    let backup = next[key]?.backup || null;
    if (fs.existsSync(want.target) && !backup) {
      // An original game file (or a file another tool placed): keep it safe.
      backup = path.join(backupRoot, want.target.replace(/^([A-Za-z]):/, '$1'));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.renameSync(want.target, backup);
    } else if (fs.existsSync(want.target)) {
      fs.rmSync(want.target, { force: true });
    }
    fs.mkdirSync(path.dirname(want.target), { recursive: true });
    let method = 'hardlink';
    try {
      fs.linkSync(want.source, want.target);
      linked++;
    } catch {
      fs.copyFileSync(want.source, want.target);
      method = 'copy';
      copied++;
    }
    next[key] = { target: want.target, source: want.source, mod: want.mod, backup, method };
    if (++done % 200 === 0) {
      onProgress({ done, total });
      // Let the window repaint and other requests run during big deployments.
      await new Promise((r) => setImmediate(r));
    }
  }

  s.deployment = { files: next, deployedAt: new Date().toISOString(), dirty: false };
  save(gameId);

  // 3. plugin load order for this profile
  if (g.kind === 'bethesda') syncPlugins(gameId);
  if (g.deployMode === 'virtual') {
    // Everything else is served virtually at launch.
    return { virtual: true, linked, copied, removed, rootFiles: Object.keys(next).length, total: Object.values(profile(gameId).enabled).filter(Boolean).length };
  }
  return { linked, copied, removed, total: Object.keys(next).length };
}

function purge(gameId) {
  if (deploying.has(gameId)) throw new Error('A deploy is running for this game; try again in a moment.');
  const g = game(gameId);
  const s = state(gameId);
  let removed = 0;
  for (const rec of Object.values(s.deployment.files || {})) {
    if (fs.existsSync(rec.target) && sameFile(rec.target, rec.source)) {
      fs.rmSync(rec.target, { force: true });
      removed++;
    }
    if (rec.backup && fs.existsSync(rec.backup)) {
      fs.mkdirSync(path.dirname(rec.target), { recursive: true });
      fs.renameSync(rec.backup, rec.target);
    }
    removeEmptyParents(rec.target, g.installDir);
  }
  s.deployment = { files: {}, deployedAt: null, dirty: true };
  save(gameId);
  return { removed };
}

// Restores the profile's saved plugin order (if any), merged with what is in Data now.
function syncPlugins(gameId) {
  const g = game(gameId);
  const p = profile(gameId);
  const scanned = plugins.scan(g).plugins;
  if (p.plugins && p.plugins.length) {
    const saved = new Map(p.plugins.map((x, i) => [x.name.toLowerCase(), { ...x, i }]));
    const known = scanned.filter((x) => saved.has(x.name.toLowerCase())).sort((a, b) => saved.get(a.name.toLowerCase()).i - saved.get(b.name.toLowerCase()).i);
    const fresh = scanned.filter((x) => !saved.has(x.name.toLowerCase()));
    const list = [...known.map((x) => ({ name: x.name, enabled: saved.get(x.name.toLowerCase()).enabled })), ...fresh.map((x) => ({ name: x.name, enabled: true }))];
    plugins.writePluginsTxt(g, list);
  } else {
    plugins.writePluginsTxt(g, scanned.map((x) => ({ name: x.name, enabled: x.enabled })));
  }
}

function savePluginOrder(gameId, list) {
  const g = game(gameId);
  plugins.writePluginsTxt(g, list);
  profile(gameId).plugins = list;
  save(gameId);
}

// Which mod provides a given Data-relative file (loose or inside a BSA/BA2)?
function findFile(gameId, fragment, limit = 50) {
  const needle = fragment.toLowerCase().replace(/\//g, '\\');
  const s = state(gameId);
  const hits = [];
  for (const id of profile(gameId).order) {
    const mod = s.mods[id];
    if (!mod) continue;
    const dir = modDir(gameId, id);
    for (const rel of walk(dir)) {
      if (rel.toLowerCase().includes(needle)) hits.push({ mod: mod.name, modId: id, file: rel, where: 'loose' });
      if (archives.ARCHIVE_RE.test(rel)) {
        try {
          for (const f of archives.listArchive(path.join(dir, rel)).files) {
            if (f.toLowerCase().includes(needle)) hits.push({ mod: mod.name, modId: id, file: f, where: rel });
            if (hits.length >= limit) return hits;
          }
        } catch {
          // unreadable archive
        }
      }
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

module.exports = {
  state, save, game, stagingDir, setGamePath, listMods, installFile, fomodVisibleStep, fomodComplete, fomodCancel,
  removeMod, setEnabled, setOrder, renameMod, profiles, createProfile, switchProfile, deleteProfile, deploy, purge,
  savePluginOrder, computeConflicts, findFile, modDir, walk, profile, registerMod, slug,
  instances, createInstance, switchInstance, deleteInstance, deployMode, setDeployMode, profileDir, overwriteDir,
  setProfileOptions, renameProfile, targetRoot, syncPlugins, DEFAULT_INSTANCE,
};
