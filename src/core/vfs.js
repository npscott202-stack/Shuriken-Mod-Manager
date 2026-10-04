// Virtual mode (Mod Organizer 2 style): the game and tools run inside a usvfs virtual file system,
// so enabled mods appear in the game folder without anything being copied or linked there.
// usvfs (GPL-3.0, the library MO2 uses) is downloaded on first use; vfs-helper/ is our launcher.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const store = require('./store');
const mods = require('./mods');
const { GAMES } = require('./games');
const library = require('./library');

const USVFS_VERSION = 'v0.5.7.2';
const USVFS_URL = `https://github.com/ModOrganizer2/usvfs/releases/download/${USVFS_VERSION}/usvfs_${USVFS_VERSION}.7z`;
const FLAG = { RECURSIVE: 8, CREATETARGET: 4 };

const helperExe = () => path.join(__dirname, 'bin', 'shuriken-vfs.exe').replace('app.asar', 'app.asar.unpacked');
const usvfsDir = () => path.join(store.dataDir('vfs'), USVFS_VERSION);

function usvfsInstalled() {
  return ['usvfs_x64.dll', 'usvfs_x86.dll', 'usvfs_proxy_x64.exe', 'usvfs_proxy_x86.exe'].every((f) => fs.existsSync(path.join(usvfsDir(), f)));
}

// Downloads usvfs (≈26 MB archive, ≈3 MB kept) from Mod Organizer 2's official release.
async function ensureUsvfs(onProgress = () => {}) {
  if (usvfsInstalled()) return usvfsDir();
  const archive = path.join(store.dataDir('vfs'), `usvfs_${USVFS_VERSION}.7z`);
  const res = await fetch(USVFS_URL, { headers: { 'User-Agent': 'Shuriken' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download the virtual file system (${res.status}).`);
  const total = Number(res.headers.get('content-length') || 0);
  const out = fs.createWriteStream(archive);
  let done = 0;
  for await (const chunk of res.body) {
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    done += chunk.length;
    onProgress({ label: 'Virtual file system', done, total });
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  const exe = require('7zip-bin').path7za.replace('app.asar', 'app.asar.unpacked');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shuriken-usvfs-'));
  await new Promise((resolve, reject) => execFile(exe, ['x', archive, `-o${tmp}`, '-y', 'bin\\*'], { windowsHide: true }, (e) => (e ? reject(e) : resolve())));
  fs.mkdirSync(usvfsDir(), { recursive: true });
  for (const f of fs.readdirSync(path.join(tmp, 'bin'))) fs.copyFileSync(path.join(tmp, 'bin', f), path.join(usvfsDir(), f));
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  if (!usvfsInstalled()) throw new Error('The virtual file system download was incomplete.');
  return usvfsDir();
}

// Builds the link list for the active instance/profile.
function mappings(gameId) {
  const g = mods.game(gameId);
  const def = GAMES[gameId];
  const s = mods.state(gameId);
  const p = mods.profile(gameId);
  const links = [];
  for (const id of p.order) {
    const mod = s.mods[id];
    if (!p.enabled[id] || !mod || mod.type === 'root') continue; // root mods are real files (see mods.needsRealFile)
    const src = mods.modDir(gameId, id);
    if (!fs.existsSync(src) || !fs.readdirSync(src).length) continue;
    links.push({ type: 'dir', src, dst: mods.targetRoot(g, mod), flags: FLAG.RECURSIVE });
  }
  // New files the game/tools create land in Overwrite instead of the game folder.
  const writeRoot = g.kind === 'generic' ? library.expand(g.base, g.installDir) : path.join(g.installDir, 'Data');
  links.push({ type: 'dir', src: mods.overwriteDir(gameId), dst: writeRoot, flags: FLAG.RECURSIVE | FLAG.CREATETARGET });

  if (def.kind === 'bethesda') {
    const prof = mods.profileDir(gameId);
    const realPlugins = def.pluginsDir();
    fs.mkdirSync(realPlugins, { recursive: true });
    for (const f of ['plugins.txt', 'loadorder.txt']) {
      if (fs.existsSync(path.join(prof, f))) links.push({ type: 'file', src: path.join(prof, f), dst: path.join(realPlugins, f), flags: 0 });
    }
    const myGames = def.myGames();
    if (p.localInis) {
      const iniDir = path.join(prof, 'ini');
      for (const f of fs.existsSync(iniDir) ? fs.readdirSync(iniDir) : []) links.push({ type: 'file', src: path.join(iniDir, f), dst: path.join(myGames, f), flags: 0 });
    }
    if (p.localSaves) {
      const saves = path.join(prof, 'saves');
      fs.mkdirSync(saves, { recursive: true });
      links.push({ type: 'dir', src: saves, dst: path.join(myGames, 'Saves'), flags: FLAG.RECURSIVE | FLAG.CREATETARGET });
    }
  }
  return links;
}

function writeConfig(gameId, { exe, args = '', cwd }) {
  const dir = store.dataDir('vfs', 'runs');
  const stamp = Date.now();
  const log = path.join(dir, `run-${stamp}.log`);
  const lines = [
    `usvfs=${usvfsDir()}`,
    `instance=shuriken-${gameId}-${stamp}`,
    `log=${log}`,
    ...mappings(gameId).map((l) => `${l.type}|${l.src}|${l.dst}|${l.flags}`),
    `exe=${exe}`,
    `args=${args}`,
    `cwd=${cwd || path.dirname(exe)}`,
  ];
  const cfg = path.join(dir, `run-${stamp}.txt`);
  fs.writeFileSync(cfg, lines.join('\r\n'), 'utf8');
  // Keep the runs folder small.
  const old = fs.readdirSync(dir).sort().slice(0, -20);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return { cfg, log };
}

function readEvents(log) {
  try {
    return fs.readFileSync(log, 'utf8').split(/\r?\n/).filter((l) => /^\d\d:\d\d:\d\d /.test(l)).map((l) => l.slice(9));
  } catch {
    return [];
  }
}

// Resolves where a program really lives: physically in the game folder, or inside an enabled mod.
function resolveVirtual(gameId, file) {
  if (fs.existsSync(file)) return file;
  const g = mods.game(gameId);
  for (const l of mappings(gameId).filter((x) => x.type === 'dir').reverse()) {
    const rel = path.relative(l.dst, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const candidate = path.join(l.src, rel);
    if (fs.existsSync(candidate)) return file; // usvfs serves it at the virtual path
  }
  void g;
  return null;
}

// Prepares a VFS run without starting it (used by the xEdit runner, which starts the helper itself).
async function prepareRun(gameId, { exe, args = '', cwd }) {
  await ensureUsvfs();
  if (mods.game(gameId).kind === 'bethesda') mods.syncPlugins(gameId);
  return { helper: helperExe(), ...writeConfig(gameId, { exe, args, cwd }) };
}

// Quotes an argument list into one command-line string for the helper config.
function joinArgs(list) {
  return (list || []).map((a) => (/[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a)).join(' ');
}

// Starts a program inside the VFS. Resolves once it has started (or failed). With wait: true,
// resolves when it and everything it launched have exited.
async function launch(gameId, { exe, args = '', cwd, wait = false, timeoutMs = 3 * 3600 * 1000 }) {
  await ensureUsvfs();
  if (!resolveVirtual(gameId, exe)) throw new Error(`${path.basename(exe)} was not found in the game folder or your enabled mods.`);
  if (mods.game(gameId).kind === 'bethesda') mods.syncPlugins(gameId);
  const { cfg, log } = writeConfig(gameId, { exe, args, cwd });
  const child = spawn(helperExe(), [cfg], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  const start = Date.now();
  while (Date.now() - start < (wait ? timeoutMs : 60000)) {
    await new Promise((r) => setTimeout(r, 400));
    const events = readEvents(log);
    const err = events.find((e) => e.startsWith('error'));
    if (err) throw new Error(`Virtual launch failed: ${err.slice(6)}`);
    if (!wait && events.some((e) => e.startsWith('started'))) return { started: true, log, events };
    if (wait && events.includes('done')) return { started: true, finished: true, log, events };
    if (child.exitCode !== null && child.exitCode !== 0) throw new Error(`Virtual launch failed (code ${child.exitCode}). See ${log}`);
  }
  if (wait) throw new Error('Timed out waiting for the program to finish.');
  throw new Error('The program did not start within a minute.');
}

// Files the game or tools wrote into Overwrite.
function overwriteFiles(gameId) {
  return mods.walk(mods.overwriteDir(gameId));
}

// Turns everything in Overwrite into a normal mod (like MO2's "Create mod from overwrite").
function overwriteToMod(gameId, name) {
  const src = mods.overwriteDir(gameId);
  if (!mods.walk(src).length) throw new Error('Overwrite is empty.');
  const g = mods.game(gameId);
  const id = `${mods.slug(name)}-${Date.now().toString(36)}`;
  const dest = mods.modDir(gameId, id);
  fs.renameSync(src, dest);
  mods.overwriteDir(gameId);
  return mods.registerMod(gameId, { id, name, type: g.kind === 'generic' ? 'generic' : 'data', source: 'overwrite', version: '' });
}

function clearOverwrite(gameId) {
  const dir = mods.overwriteDir(gameId);
  fs.rmSync(dir, { recursive: true, force: true });
  mods.overwriteDir(gameId);
}

module.exports = { ensureUsvfs, usvfsInstalled, mappings, launch, prepareRun, joinArgs, overwriteFiles, overwriteToMod, clearOverwrite };
