// Crash logs, INI files, Minecraft jar metadata and a quick health check.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mods = require('./mods');
const plugins = require('./plugins');
const library = require('./library');

function crashLogDirs(g) {
  if (g.kind === 'generic') return (g.logs || []).map((p) => library.expand(p, g.installDir));
  if (g.kind === 'minecraft') return g.installDir ? g.crashLogDirs(g.installDir) : [];
  const dirs = [...g.crashLogDirs()];
  if (g.installDir) dirs.push(path.join(g.installDir, 'Data', 'NetScriptFramework', 'Crash'));
  return dirs;
}

function listCrashLogs(gameId, limit = 15) {
  const g = mods.game(gameId);
  const out = [];
  const pattern = g.kind === 'generic' ? g.logPattern || /\.(log|txt|dmp)$/i : /(crash|latest|debug).*\.(log|txt)$/i;
  for (const entry of crashLogDirs(g)) {
    let dir = entry;
    let names = [];
    try {
      if (fs.statSync(entry).isFile()) {
        dir = path.dirname(entry);
        names = [path.basename(entry)];
      } else {
        names = fs.readdirSync(entry);
      }
    } catch {
      continue;
    }
    for (const name of names) {
      if (!pattern.test(name)) continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isFile()) out.push({ name, path: full, size: st.size, date: st.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

function readText(file, maxChars = 60000) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.length <= maxChars) return text;
  // Crash logs put the important part at the top (exception + probable callstack), so keep the head
  // and a slice of the tail.
  return `${text.slice(0, maxChars * 0.75)}\n\n...[${text.length - maxChars} characters omitted]...\n\n${text.slice(-maxChars * 0.25)}`;
}

// --- INI ---
function iniPath(gameId, fileName) {
  const g = mods.game(gameId);
  if (g.kind !== 'bethesda') throw new Error('INI files only apply to Bethesda games');
  // Virtual mode with profile-specific INIs: edit the profile's copy (the game sees it through the VFS).
  if (g.deployMode === 'virtual' && mods.profile(gameId).localInis) {
    const own = path.join(mods.profileDir(gameId), 'ini', fileName);
    if (fs.existsSync(own) || !fs.existsSync(path.join(g.myGames(), fileName))) return own;
  }
  const candidates = [path.join(g.myGames(), fileName), g.installDir && path.join(g.installDir, fileName)].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function setIniValue(file, section, key, value) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
    fs.copyFileSync(file, `${file}.shuriken.bak`);
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const lines = text.split(/\r?\n/);
  let inSection = false;
  let sectionFound = false;
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const sm = lines[i].match(/^\s*\[(.+?)\]\s*$/);
    if (sm) {
      if (inSection && insertAt === -1) insertAt = i;
      inSection = sm[1].toLowerCase() === section.toLowerCase();
      if (inSection) sectionFound = true;
      continue;
    }
    if (inSection) {
      const km = lines[i].match(/^\s*([^=;#]+?)\s*=/);
      if (km && km[1].toLowerCase() === key.toLowerCase()) {
        const old = lines[i];
        lines[i] = `${key}=${value}`;
        fs.writeFileSync(file, lines.join('\r\n'));
        return { file, changed: true, previous: old };
      }
    }
  }
  if (!sectionFound) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push('', `[${section}]`, `${key}=${value}`, '');
  } else {
    let idx = insertAt === -1 ? lines.length : insertAt;
    while (idx > 0 && lines[idx - 1].trim() === '') idx--;
    lines.splice(idx, 0, `${key}=${value}`);
  }
  fs.writeFileSync(file, lines.join('\r\n'));
  return { file, changed: true, previous: null };
}

// --- Minecraft jar metadata (fabric.mod.json / mods.toml) ---
function readFromZip(zipFile, inner) {
  const exe = require('7zip-bin').path7za.replace('app.asar', 'app.asar.unpacked');
  return new Promise((resolve) => {
    const child = spawn(exe, ['e', '-so', zipFile, inner], { windowsHide: true });
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(chunks.length ? Buffer.concat(chunks).toString('utf8') : null));
  });
}

async function jarInfo(file) {
  const fabric = await readFromZip(file, 'fabric.mod.json');
  if (fabric) {
    try {
      const j = JSON.parse(fabric.replace(/[\u0000-\u0019]+/g, ' '));
      return { file: path.basename(file), loader: 'fabric', id: j.id, name: j.name, version: j.version, depends: Object.keys(j.depends || {}), mcRange: j.depends?.minecraft };
    } catch {
      return { file: path.basename(file), loader: 'fabric', parseError: true };
    }
  }
  const quilt = await readFromZip(file, 'quilt.mod.json');
  if (quilt) return { file: path.basename(file), loader: 'quilt' };
  for (const [inner, loader] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', 'forge']]) {
    const toml = await readFromZip(file, inner);
    if (!toml) continue;
    const id = toml.match(/modId\s*=\s*"([^"]+)"/)?.[1];
    const deps = [...toml.matchAll(/\[\[dependencies\.[^\]]+\]\][^[]*?modId\s*=\s*"([^"]+)"[^[]*?(?:mandatory\s*=\s*(true|false)|type\s*=\s*"(\w+)")/g)]
      .filter((m) => m[2] === 'true' || m[3] === 'required')
      .map((m) => m[1]);
    return { file: path.basename(file), loader, id, depends: deps };
  }
  return { file: path.basename(file), loader: 'unknown' };
}

async function minecraftScan(gameId) {
  const g = mods.game(gameId);
  const s = mods.state(gameId);
  const modsDir = path.join(g.installDir, 'mods');
  let jars = [];
  try {
    jars = fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar')).map((f) => path.join(modsDir, f));
  } catch {
    return { jars: [], issues: [{ severity: 'info', message: 'No mods folder yet. Deploy some mods first.' }] };
  }
  const infos = [];
  for (let i = 0; i < jars.length; i += 8) infos.push(...(await Promise.all(jars.slice(i, i + 8).map(jarInfo))));
  const issues = [];
  const loader = s.loader;
  const ids = new Map();
  const builtin = new Set(['minecraft', 'java', 'fabricloader', 'fabric', 'forge', 'neoforge', 'quilt_loader', 'quilted_fabric_api']);
  for (const info of infos) {
    if (info.loader !== 'unknown' && loader && info.loader !== loader && !(loader === 'quilt' && info.loader === 'fabric')) {
      issues.push({ severity: 'error', message: `${info.file} is a ${info.loader} mod but this profile uses ${loader}.` });
    }
    if (info.id) {
      if (ids.has(info.id)) issues.push({ severity: 'error', message: `Duplicate mod id "${info.id}": ${ids.get(info.id)} and ${info.file}.` });
      ids.set(info.id, info.file);
    }
  }
  for (const info of infos) {
    for (const dep of info.depends || []) {
      if (builtin.has(dep) || ids.has(dep) || (dep === 'fabric-api' && ids.has('fabric-api'))) continue;
      issues.push({ severity: 'error', message: `${info.file} requires "${dep}", which is not installed.` });
    }
  }
  return { jars: infos, issues };
}

async function healthCheck(gameId) {
  const g = mods.game(gameId);
  const s = mods.state(gameId);
  const issues = [];
  if (!g.installDir) return { issues: [{ severity: 'error', message: `${g.name} folder not set.` }] };
  if (s.deployment.dirty && Object.keys(s.mods).length) issues.push({ severity: 'warning', message: mods.deployMode(gameId) === 'virtual' ? 'Loader/ENB files changed: click Deploy (or just press Play).' : 'Mod changes are not deployed yet. Click Deploy.' });
  const unsure = Object.values(s.mods).filter((m) => m.uncertain);
  for (const m of unsure) issues.push({ severity: 'warning', message: `"${m.name}" has an unusual folder layout; check it installed to the right place.` });

  if (g.kind === 'generic') {
    if (g.requires) issues.push({ severity: 'info', message: `Most ${g.short} mods need: ${g.requires}.` });
    const base = library.expand(g.base, g.installDir);
    if (g.strategy !== 'tool' && !fs.existsSync(base)) issues.push({ severity: 'info', message: `The mod folder (${base}) will be created on first deploy.` });
  } else if (g.kind === 'bethesda') {
    if (!fs.existsSync(path.join(g.installDir, g.loader))) {
      issues.push({ severity: 'info', message: `${g.scriptExtender} is not installed. Many mods need it.` });
    }
    const pluginsDir = path.join(g.installDir, 'Data', g.scriptExtender === 'SKSE64' ? 'SKSE' : g.scriptExtender, 'Plugins');
    if (fs.existsSync(pluginsDir) && ['skyrimse', 'fallout4', 'skyrimvr', 'fallout4vr'].includes(g.id)) {
      const dlls = fs.readdirSync(pluginsDir).filter((f) => f.endsWith('.dll'));
      const addressLib = fs.readdirSync(pluginsDir).some((f) => /^version(lib)?-.*\.(bin|csv)$/i.test(f));
      if (dlls.length && !addressLib) issues.push({ severity: 'warning', message: 'Script extender plugins found but Address Library is missing. Most DLL mods need it.' });
    }
    const scan = plugins.scan(g);
    issues.push(...plugins.analyze(g, scan).issues);
    const conflicts = mods.computeConflicts(gameId);
    const losing = Object.values(conflicts).reduce((n, c) => n + (c.files || 0), 0);
    if (losing) issues.push({ severity: 'info', message: `${losing} file conflicts between mods (later mods win). Review on the Mods page.` });
  } else {
    if (!s.mcVersion) issues.push({ severity: 'warning', message: 'Pick a Minecraft version and loader on the Mods page.' });
    issues.push(...(await minecraftScan(gameId)).issues);
  }
  const logs = listCrashLogs(gameId, 3).filter((l) => /crash/i.test(l.name));
  const recent = logs.length && Date.now() - new Date(logs[0].date).getTime() < 3 * 24 * 3600 * 1000;
  if (logs.length && (s.deployment.deployedAt ? logs[0].date > s.deployment.deployedAt : recent)) {
    issues.push({ severity: 'warning', message: `New crash log: ${logs[0].name}. Ask the AI assistant to analyze it.`, crashLog: logs[0].path });
  }
  return { issues };
}

module.exports = { listCrashLogs, readText, iniPath, setIniValue, minecraftScan, healthCheck, crashLogDirs };
