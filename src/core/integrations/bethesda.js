// Automation for Bethesda modding tools: Papyrus, archives (BSArch/Archive2), Creation Kit
// precombines/previs, LOOT masterlist, BodySlide, NIF texture checks, Fallout 4 BA2 checks.
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../store');
const mods = require('../mods');
const tools = require('../tools');
const archives = require('../archives');
const proc = require('../proc');

// ---------- Papyrus ----------
const PAPYRUS = {
  skyrimse: { sources: ['Data\\Source\\Scripts', 'Data\\Scripts\\Source'], projectSource: 'Source\\Scripts', zips: ['Data\\Scripts.zip'] },
  fallout4: { sources: ['Data\\Scripts\\Source\\User', 'Data\\Scripts\\Source\\Base'], projectSource: 'Scripts\\Source\\User', zips: ['Data\\Scripts\\Source\\Base\\Base.zip'] },
  starfield: { sources: ['Data\\Scripts\\Source\\User', 'Data\\Scripts\\Source\\Base'], projectSource: 'Scripts\\Source\\User', zips: ['Data\\Scripts\\Source\\Base\\Base.zip', 'Tools\\ContentResources.zip'] },
};

function papyrusInfo(gameId) {
  const g = mods.game(gameId);
  const cfg = PAPYRUS[gameId];
  const compiler = tools.find(gameId, 'papyrus')?.path ||
    ['Papyrus Compiler\\PapyrusCompiler.exe', 'Tools\\Papyrus Compiler\\PapyrusCompiler.exe'].map((p) => path.join(g.installDir, p)).find((p) => fs.existsSync(p)) || null;
  const sources = cfg.sources.map((s) => path.join(g.installDir, s)).filter((p) => fs.existsSync(p));
  let flags = null;
  for (const dir of sources) {
    const f = fs.readdirSync(dir).find((n) => n.toLowerCase().endsWith('.flg'));
    if (f) { flags = path.join(dir, f); break; }
  }
  const hasPsc = sources.some((dir) => fs.readdirSync(dir).some((n) => n.toLowerCase().endsWith('.psc')));
  const zips = cfg.zips.map((z) => path.join(g.installDir, z)).filter((p) => fs.existsSync(p));
  return { compiler, sources, flags, baseSourcesExtracted: hasPsc, zipsToExtract: hasPsc ? [] : zips, projectSourceFolder: cfg.projectSource };
}

async function preparePapyrusSources(gameId) {
  const g = mods.game(gameId);
  const info = papyrusInfo(gameId);
  if (info.baseSourcesExtracted) return { already: true, sources: info.sources };
  if (!info.zipsToExtract.length) throw new Error('No Papyrus source archive found. Install the Creation Kit from Steam/Bethesda.net first.');
  for (const zip of info.zipsToExtract) {
    const dest = gameId === 'skyrimse' ? path.join(g.installDir, 'Data') : path.dirname(zip);
    await archives.extract(zip, dest);
  }
  return papyrusInfo(gameId);
}

// Compiles .psc files of a workshop project (all, or the named ones) into its Scripts folder.
async function compilePapyrus(gameId, projectDir, scripts) {
  const info = papyrusInfo(gameId);
  if (!info.compiler) throw new Error('Papyrus Compiler not found. Install the Creation Kit for this game.');
  if (!info.flags) throw new Error('Papyrus flags file not found. Run prepare_papyrus_sources first (extracts the base game script sources).');
  const srcDir = path.join(projectDir, info.projectSourceFolder);
  if (!fs.existsSync(srcDir)) throw new Error(`Put .psc files in "${info.projectSourceFolder}" inside the project first.`);
  const outDir = path.join(projectDir, 'Scripts');
  fs.mkdirSync(outDir, { recursive: true });
  const all = mods.walk(srcDir).filter((f) => f.toLowerCase().endsWith('.psc'));
  const targets = scripts?.length ? all.filter((f) => scripts.some((s) => f.toLowerCase().endsWith(s.toLowerCase().replace(/\.psc$/, '') + '.psc'))) : all;
  if (!targets.length) throw new Error('No matching .psc files in the project.');
  const imports = [srcDir, ...info.sources].join(';');
  const results = [];
  for (const rel of targets) {
    const args = [path.join(srcDir, rel), `-f=${path.basename(info.flags)}`, `-i=${imports}`, `-o=${outDir}`];
    if (gameId !== 'skyrimse') args.push('-op');
    const r = await proc.run(info.compiler, args, { cwd: srcDir, timeoutMs: 5 * 60000 });
    results.push({ script: rel, ok: r.code === 0, output: proc.tail(r.output, 40) });
  }
  return { compiled: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

// ---------- Archives ----------
function bsarchPath(gameId) {
  const t = tools.find(gameId, 'bsarch');
  if (t) return t.path;
  const xedit = tools.find(gameId, 'xedit');
  if (xedit) {
    const p = ['BSArch.exe', 'BSArch64.exe'].map((n) => path.join(path.dirname(xedit.path), n)).find((x) => fs.existsSync(x));
    if (p) return p;
  }
  return null;
}

function archive2Path(gameId) {
  return tools.find(gameId, 'archive2')?.path || null;
}

const ASSET_DIRS = new Set(['meshes', 'textures', 'sound', 'music', 'interface', 'materials', 'scripts', 'seq', 'strings', 'vis', 'lodsettings', 'geometries', 'particles', 'planetdata', 'terrain', 'misc', 'shadersfx', 'grass']);

// Packs a project's loose assets into an archive inside the project. Returns the archive paths.
async function packArchive(gameId, projectDir, archiveBase, { removeLoose = false } = {}) {
  const ext = gameId === 'skyrimse' ? '.bsa' : '.ba2';
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'shuriken-pack-'));
  const top = fs.readdirSync(projectDir, { withFileTypes: true }).filter((e) => e.isDirectory() && ASSET_DIRS.has(e.name.toLowerCase()));
  if (!top.length) throw new Error('No asset folders (meshes, textures, sound, scripts, ...) in the project to pack.');
  const split = gameId !== 'skyrimse';
  const groups = split
    ? { main: top.filter((e) => e.name.toLowerCase() !== 'textures'), textures: top.filter((e) => e.name.toLowerCase() === 'textures') }
    : { main: top };
  const made = [];
  for (const [group, dirs] of Object.entries(groups)) {
    if (!dirs.length) continue;
    const src = path.join(stage, group);
    for (const d of dirs) fs.cpSync(path.join(projectDir, d.name), path.join(src, d.name), { recursive: true });
    const name = split ? `${archiveBase} - ${group === 'main' ? 'Main' : 'Textures'}${ext}` : `${archiveBase}${ext}`;
    const out = path.join(projectDir, name);
    const bsarch = bsarchPath(gameId);
    let r;
    if (bsarch) {
      const fmt = { skyrimse: '-sse', fallout4: group === 'textures' ? '-fo4dds' : '-fo4', starfield: group === 'textures' ? '-sf1dds' : '-sf1' }[gameId];
      r = await proc.run(bsarch, ['pack', src, out, fmt, '-z', '-mt'], { timeoutMs: 30 * 60000 });
    } else if (archive2Path(gameId)) {
      r = await proc.run(archive2Path(gameId), [src, `-create=${out}`, `-format=${group === 'textures' ? 'DDS' : 'General'}`, `-root=${src}`, '-quiet'], { timeoutMs: 30 * 60000 });
    } else {
      throw new Error('No archive packer found. Add BSArch (ships with xEdit) or Archive2 (Creation Kit) on the Tools page.');
    }
    if (r.code !== 0 || !fs.existsSync(out)) throw new Error(`Packing failed: ${proc.tail(r.output, 30)}`);
    made.push(name);
    if (removeLoose) for (const d of dirs) fs.rmSync(path.join(projectDir, d.name), { recursive: true, force: true });
  }
  fs.rmSync(stage, { recursive: true, force: true });
  return { archives: made, note: gameId === 'skyrimse' ? 'Skyrim loads a BSA only when a plugin with the same name is active.' : 'Archives load when a plugin with the matching base name is active.' };
}

async function unpackArchive(gameId, archivePath) {
  const out = path.join(store.dataDir('extracted'), `${path.basename(archivePath).replace(/\W+/g, '_')}_${Date.now().toString(36)}`);
  fs.mkdirSync(out, { recursive: true });
  const bsarch = bsarchPath(gameId);
  let r;
  if (bsarch) r = await proc.run(bsarch, ['unpack', archivePath, out, '-mt'], { timeoutMs: 30 * 60000 });
  else if (archive2Path(gameId) && /\.ba2$/i.test(archivePath)) r = await proc.run(archive2Path(gameId), [archivePath, `-extract=${out}`, '-quiet'], { timeoutMs: 30 * 60000 });
  else throw new Error('No archive tool found. Add BSArch (ships with xEdit) on the Tools page.');
  return { exitCode: r.code, extractedTo: out, files: mods.walk(out).slice(0, 300) };
}

// ---------- Creation Kit precombines / previs (Fallout 4) ----------
async function generatePrevis(gameId, plugin) {
  if (gameId !== 'fallout4') throw new Error('Command-line precombine/previs generation is a Fallout 4 Creation Kit feature.');
  const ck = tools.find(gameId, 'creationkit');
  if (!ck) throw new Error('Creation Kit not found. Install it from Steam (Fallout 4: Creation Kit).');
  const g = mods.game(gameId);
  const steps = [
    [`-GeneratePrecombined:${plugin}`, 'clean', 'all'],
    [`-CompressPSG:${plugin}`],
    [`-BuildCDX:${plugin}`],
    [`-GeneratePreVisData:${plugin}`, 'clean', 'all'],
  ];
  const log = [];
  for (const step of steps) {
    const r = await proc.run(ck.path, step, { cwd: g.installDir, timeoutMs: 3 * 3600 * 1000, hidden: false });
    log.push({ step: step[0].split(':')[0], exitCode: r.code });
  }
  const data = path.join(g.installDir, 'Data');
  const outputs = ['CombinedObjects.esp', 'Previs.esp'].filter((f) => fs.existsSync(path.join(data, f)));
  const base = plugin.replace(/\.(esp|esm|esl)$/i, '');
  for (const f of [`${base} - Geometry.csg`, `${base}.cdx`]) if (fs.existsSync(path.join(data, f))) outputs.push(f);
  return {
    steps: log,
    outputs,
    nextSteps: 'Merge CombinedObjects.esp and Previs.esp records into the plugin with an xEdit script, then capture meshes\\precombined and vis\\ into the workshop project and pack them into a BA2.',
  };
}

// ---------- LOOT masterlist ----------
const LOOT_FOLDER = { skyrimse: 'Skyrim Special Edition', fallout4: 'Fallout4', starfield: 'Starfield' };

function lootInfo(gameId, plugin) {
  const base = path.join(process.env.LOCALAPPDATA || '', 'LOOT', 'games', LOOT_FOLDER[gameId]);
  const out = {};
  for (const file of ['masterlist.yaml', 'userlist.yaml']) {
    const p = path.join(base, file);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
      if (file === 'masterlist.yaml') out.note = 'LOOT\'s masterlist for this game is empty or missing. Open LOOT once (it downloads the masterlist), then ask again.';
      continue;
    }
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    const esc = plugin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^(\\s*)-\\s*name:\\s*['"]?${esc}['"]?\\s*$`, 'i');
    const idx = lines.findIndex((l) => re.test(l));
    if (idx < 0) continue;
    const indent = lines[idx].match(/^(\s*)/)[1].length;
    const block = [lines[idx]];
    for (let i = idx + 1; i < lines.length && block.length < 120; i++) {
      const m = lines[i].match(/^(\s*)-\s/);
      if (m && m[1].length <= indent) break;
      block.push(lines[i]);
    }
    out[file] = block.join('\n');
  }
  if (out.note && Object.keys(out).length === 1) return out.note;
  if (!Object.keys(out).length) return fs.existsSync(base) ? `LOOT has no entry for ${plugin}.` : 'LOOT has not been run for this game yet (no masterlist found).';
  return out;
}

// ---------- BodySlide ----------
function bodyslideDir(gameId) {
  const t = tools.find(gameId, 'bodyslide');
  return t ? path.dirname(t.path) : null;
}

function bodyslideInfo(gameId) {
  const dir = bodyslideDir(gameId);
  if (!dir) throw new Error('BodySlide not found. Install BodySlide and Outfit Studio, deploy, then add it on the Tools page.');
  const names = (sub, re) => {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) return [];
    const set = new Set();
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.xml'))) {
      for (const m of fs.readFileSync(path.join(d, f), 'utf8').matchAll(re)) set.add(m[1]);
    }
    return [...set].sort();
  };
  return { presets: names('SliderPresets', /<Preset\s+name="([^"]+)"/g), groups: names('SliderGroups', /<Group\s+name="([^"]+)"/g) };
}

async function bodyslideBuild(gameId, groups, preset) {
  const t = tools.find(gameId, 'bodyslide');
  if (!t) throw new Error('BodySlide not found.');
  const s = mods.state(gameId);
  let out = Object.values(s.mods).find((m) => m.bodyslideOutput);
  if (!out) {
    const id = `bodyslide-output-${Date.now().toString(36)}`;
    fs.mkdirSync(mods.modDir(gameId, id), { recursive: true });
    out = mods.registerMod(gameId, { id, name: 'BodySlide Output', type: 'data', source: 'tool', bodyslideOutput: true });
  }
  const target = mods.modDir(gameId, out.id);
  const r = await proc.run(t.path, ['--groupbuild', groups.join(','), '--targetdir', target, '--preset', preset], { cwd: path.dirname(t.path), timeoutMs: 60 * 60000, hidden: false });
  return { exitCode: r.code, outputMod: out.name, files: mods.walk(target).length, note: 'Deploy to apply. Put "BodySlide Output" low in the mod list so it wins conflicts.' };
}

// ---------- NIF texture check ----------
function nifTextures(file) {
  const text = fs.readFileSync(file).toString('latin1');
  const set = new Set();
  for (const m of text.matchAll(/((?:data[\\/])?textures[\\/][\x20-\x7e]{1,200}?\.(?:dds|bgsm|bgem|mat))/gi)) set.add(m[1].replace(/\//g, '\\').replace(/^data\\/i, '').toLowerCase());
  for (const m of text.matchAll(/(materials[\\/][\x20-\x7e]{1,200}?\.(?:bgsm|bgem|mat))/gi)) set.add(m[1].replace(/\//g, '\\').toLowerCase());
  return [...set];
}

let assetIndex = null;
function buildAssetIndex(gameId) {
  const g = mods.game(gameId);
  const data = path.join(g.installDir, 'Data');
  const set = new Set();
  for (const rel of mods.walk(data)) set.add(rel.toLowerCase());
  for (const f of fs.readdirSync(data).filter((n) => archives.ARCHIVE_RE.test(n))) {
    try {
      for (const x of archives.listArchive(path.join(data, f)).files) set.add(x.toLowerCase().replace(/\//g, '\\'));
    } catch {
      // unreadable archive
    }
  }
  assetIndex = { gameId, set, at: Date.now() };
  return set;
}

function checkAssets(gameId, paths) {
  const set = assetIndex && assetIndex.gameId === gameId && Date.now() - assetIndex.at < 10 * 60000 ? assetIndex.set : buildAssetIndex(gameId);
  return paths.map((p) => ({ path: p, found: set.has(p.toLowerCase().replace(/\//g, '\\').replace(/^data\\/i, '')) }));
}

function checkNif(gameId, nifPath) {
  const refs = nifTextures(nifPath);
  const results = checkAssets(gameId, refs);
  return { nif: nifPath, referenced: refs.length, missing: results.filter((r) => !r.found).map((r) => r.path), found: results.filter((r) => r.found).map((r) => r.path) };
}

// ---------- Fallout 4 archive checks (CM Toolkit style) ----------
async function exeVersion(file) {
  const r = await proc.run('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${file.replace(/'/g, "''")}').VersionInfo.FileVersion`], { timeoutMs: 20000 });
  return r.output.trim();
}

function ba2Header(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(12);
    fs.readSync(fd, b, 0, 12, 0);
    if (b.toString('latin1', 0, 4) !== 'BTDX') return null;
    return { version: b.readUInt32LE(4), type: b.toString('latin1', 8, 12) };
  } finally {
    fs.closeSync(fd);
  }
}

async function fo4ArchiveCheck(gameId) {
  const g = mods.game(gameId);
  const data = path.join(g.installDir, 'Data');
  const version = await exeVersion(path.join(g.installDir, g.exe)).catch(() => '');
  const nextGen = /^1\.10\.(9[0-9]{2}|[1-9][0-9]{3})/.test(version) || /^1\.1[1-9]/.test(version);
  const list = fs.readdirSync(data).filter((f) => /\.ba2$/i.test(f)).map((f) => ({ file: f, ...(ba2Header(path.join(data, f)) || {}) }));
  const general = list.filter((a) => a.type === 'GNRL');
  const textures = list.filter((a) => a.type === 'DX10');
  const ngOnly = list.filter((a) => a.version === 7 || a.version === 8);
  const issues = [];
  const pluginsDir = path.join(data, 'F4SE', 'Plugins');
  const backport = fs.existsSync(pluginsDir) && fs.readdirSync(pluginsDir).some((f) => /^BackportedBA2Support\.dll$/i.test(f));
  if (!nextGen && ngOnly.length && !backport) issues.push(`${ngOnly.length} archives use the Next-Gen BA2 format (v7/v8), which the Old-Gen game (${version}) cannot read without Backported BA2 Support. Install that F4SE plugin or patch them to v1.`);
  if (general.length > 240) issues.push(`${general.length} General BA2 archives are loaded; Fallout 4 becomes unstable around 255. Extract or merge some.`);
  if (textures.length > 240) issues.push(`${textures.length} texture BA2 archives are loaded; the practical limit is about 255.`);
  return { gameVersion: version || 'unknown', edition: version ? (nextGen ? 'Next-Gen' : 'Old-Gen') : 'unknown', backportedBa2Support: backport, generalArchives: general.length, textureArchives: textures.length, nextGenFormatArchives: ngOnly.map((a) => a.file), issues };
}

// Rewrites the BA2 version field (CM Toolkit "archive patcher"). Logged for undo.
function patchBa2Versions(gameId, toVersion, files) {
  if (![1, 8].includes(toVersion)) throw new Error('Version must be 1 (Old-Gen compatible) or 8 (Next-Gen)');
  const g = mods.game(gameId);
  const data = path.join(g.installDir, 'Data');
  const targets = (files?.length ? files : fs.readdirSync(data).filter((f) => /\.ba2$/i.test(f))).map((f) => path.join(data, path.basename(f)));
  const logFile = path.join(store.dataDir('logs'), 'ba2-patches.json');
  const history = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : [];
  const changed = [];
  for (const file of targets) {
    const h = ba2Header(file);
    if (!h || h.version === toVersion) continue;
    if (toVersion === 1 && ![7, 8].includes(h.version)) continue;
    if (toVersion === 8 && h.version !== 1) continue;
    const fd = fs.openSync(file, 'r+');
    const b = Buffer.alloc(4);
    b.writeUInt32LE(toVersion);
    fs.writeSync(fd, b, 0, 4, 4);
    fs.closeSync(fd);
    history.push({ file, from: h.version, to: toVersion, at: new Date().toISOString() });
    changed.push(`${path.basename(file)}: v${h.version} -> v${toVersion}`);
  }
  fs.writeFileSync(logFile, JSON.stringify(history, null, 1));
  return { changed, count: changed.length };
}

module.exports = {
  papyrusInfo, preparePapyrusSources, compilePapyrus, packArchive, unpackArchive, generatePrevis, lootInfo,
  bodyslideInfo, bodyslideBuild, checkNif, checkAssets, fo4ArchiveCheck, patchBa2Versions,
};
