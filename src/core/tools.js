// External modding tools: catalog, PC scan, registration, launching, and generic/automated runs.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const mods = require('./mods');
const store = require('./store');
const proc = require('./proc');

const BETH = Object.values(require('./games').GAMES).filter((g) => g.kind === 'bethesda').map((g) => g.id);
const MC = ['minecraft'];

// kind -> how Shuriken (and its AI) can use the tool.
const CATALOG = {
  xedit: { name: 'xEdit', games: BETH, exe: ['SSEEdit.exe', 'SSEEdit64.exe', 'FO4Edit.exe', 'FO4Edit64.exe', 'SF1Edit.exe', 'SF1Edit64.exe', 'xEdit.exe', 'xEdit64.exe'], ai: 'Cleans plugins and runs AI-written xEdit scripts to inspect, patch or create plugins' },
  creationkit: { name: 'Creation Kit', games: BETH, exe: ['CreationKit.exe', 'CreationKit64.exe'], ai: 'Generates precombines/previs (Fallout 4) from the command line' },
  papyrus: { name: 'Papyrus Compiler', games: BETH, exe: ['PapyrusCompiler.exe'], ai: 'Compiles Papyrus scripts the AI writes' },
  loot: { name: 'LOOT', games: BETH, exe: ['LOOT.exe'], ai: 'Auto-sorts and reads LOOT masterlist notes (dirty edits, requirements, incompatibilities)' },
  bsarch: { name: 'BSArch', games: BETH, exe: ['BSArch.exe', 'BSArch64.exe'], ai: 'Packs and unpacks BSA/BA2 archives' },
  bsarchpro: { name: 'BSArchPro', games: BETH, exe: ['BSArchPro.exe'], ai: 'Launch; the AI uses BSArch (command line) for the same jobs' },
  archive2: { name: 'Archive2', games: ['fallout4', 'starfield'], exe: ['Archive2.exe'], ai: 'Packs and unpacks BA2 archives' },
  bodyslide: { name: 'BodySlide', games: ['skyrimse', 'fallout4'], exe: ['BodySlide x64.exe', 'BodySlide.exe'], ai: 'Batch-builds outfit groups with a preset' },
  wryebash: { name: 'Wrye Bash', games: BETH, exe: ['Wrye Bash.exe'], ai: 'Launch only (no automation interface); the AI gives step-by-step instructions' },
  cmtoolkit: { name: 'CM Toolkit', games: ['fallout4'], exe: ['cm-toolkit.exe', 'CMToolkit.exe', 'Collective Modding Toolkit.exe', 'cmt.exe'], ai: 'Launch; the AI runs the same BA2 version/limit checks and patching itself' },
  cao: { name: 'Cathedral Assets Optimizer', games: BETH, exe: ['Cathedral Assets Optimizer.exe', 'CAO.exe'], ai: 'Launch only' },
  nifskope: { name: 'NifSkope', games: BETH, exe: ['NifSkope.exe'], ai: 'Launch; the AI reads NIF texture paths itself to find missing textures' },
  texconv: { name: 'texconv', games: BETH, exe: ['texconv.exe'], ai: 'Command line: the AI can run it to convert/resize textures' },
  dyndolod: { name: 'DynDOLOD / xLODGen / TexGen', games: BETH, exe: ['DynDOLODx64.exe', 'TexGenx64.exe', 'xLODGenx64.exe', 'DynDOLOD.exe'], ai: 'Launch only' },
  behavior: { name: 'Nemesis / Pandora', games: ['skyrimse'], exe: ['Nemesis Unlimited Behavior Engine.exe', 'Pandora Behaviour Engine.exe', 'Pandora Behaviour Engine+.exe'], ai: 'Launch only; re-run after adding animation mods' },
  worldpainter: { name: 'WorldPainter', games: MC, exe: ['worldpainter.exe', 'WorldPainter.exe'], ai: 'Generates terrain and whole worlds from AI-written WorldPainter scripts' },
  mcreator: { name: 'MCreator', games: MC, exe: ['mcreator.exe', 'MCreator.exe'], ai: 'Launch only' },
  blockbench: { name: 'Blockbench', games: MC, exe: ['Blockbench.exe'], ai: 'Launch only' },
  amulet: { name: 'Amulet Editor', games: MC, exe: ['amulet_app.exe', 'Amulet.exe'], ai: 'Launch only' },
};

const EXE_INDEX = new Map();
for (const [kind, def] of Object.entries(CATALOG)) for (const e of def.exe) EXE_INDEX.set(e.toLowerCase(), kind);

function guessKind(exePath) {
  return EXE_INDEX.get(path.basename(exePath).toLowerCase()) || 'other';
}

function describe(kind) {
  return CATALOG[kind] || { name: 'Tool', ai: 'Launch; the AI can run it with command-line arguments' };
}

// ---------- scanning ----------
const SKIP = new Set(['windows', 'programdata', '$recycle.bin', 'system volume information', 'node_modules', 'appdata', 'steamapps', '.git', 'winsxs', 'microsoft', 'nvidia corporation', 'common files', 'windowsapps']);

function scanDir(root, depth, found, budget) {
  if (depth < 0 || budget.n <= 0) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  budget.n--;
  for (const e of entries) {
    if (e.isFile()) {
      const kind = EXE_INDEX.get(e.name.toLowerCase());
      if (kind) found.set(path.join(root, e.name).toLowerCase(), { kind, path: path.join(root, e.name) });
    }
  }
  for (const e of entries) {
    if (e.isDirectory() && !SKIP.has(e.name.toLowerCase())) scanDir(path.join(root, e.name), depth - 1, found, budget);
  }
}

function scanPc() {
  const found = new Map();
  const budget = { n: 40000 };
  const home = os.homedir();
  const roots = [
    [path.join(home, 'Desktop'), 4], [path.join(home, 'Downloads'), 3], [path.join(home, 'Documents'), 4],
    [path.join(process.env.LOCALAPPDATA || '', 'Programs'), 3],
    [process.env.ProgramFiles || 'C:\\Program Files', 3], [process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 3],
  ];
  for (const id of BETH) {
    const dir = mods.state(id).installDir;
    if (dir) roots.push([dir, 2], [path.join(dir, 'Tools'), 3], [path.join(dir, 'Data', 'CalienteTools'), 3], [path.join(path.dirname(dir), '..', '..'), 1]);
  }
  for (let c = 67; c <= 90; c++) {
    const drive = `${String.fromCharCode(c)}:\\`;
    if (fs.existsSync(drive)) roots.push([drive, 3]);
  }
  for (const [r, d] of roots) scanDir(r, d, found, budget);
  // WorldPainter's script runner lives next to the app.
  return [...found.values()];
}

// Scan results for one game, minus tools already registered.
function scanForGame(gameId) {
  const s = mods.state(gameId);
  const known = new Set((s.tools || []).map((t) => t.path.toLowerCase()));
  const g = mods.game(gameId);
  return scanPc()
    .filter((t) => CATALOG[t.kind].games.includes(gameId) && !known.has(t.path.toLowerCase()))
    .filter((t) => t.kind !== 'xedit' || g.xeditNames?.some((n) => n.toLowerCase() === path.basename(t.path).toLowerCase()))
    .map((t) => ({ ...t, name: path.basename(t.path, '.exe'), args: defaultArgs(gameId, t), ai: CATALOG[t.kind].ai }));
}

function defaultArgs(gameId, t) {
  const g = mods.game(gameId);
  if (t.kind === 'xedit' && /^xedit/i.test(path.basename(t.path))) return [g.xeditArg];
  return [];
}

// Quick suggestions from well-known locations (no full scan).
function suggestions(gameId) {
  const g = mods.game(gameId);
  const out = [];
  const add = (kind, p, args = []) => fs.existsSync(p) && out.push({ kind, name: path.basename(p, '.exe'), path: p, args, ai: CATALOG[kind].ai });
  if (g.kind === 'bethesda' && g.installDir) {
    for (const dir of [g.installDir, path.join(g.installDir, 'Tools'), path.join(g.installDir, 'xEdit')]) {
      for (const exe of g.xeditNames) add('xedit', path.join(dir, exe), exe.startsWith('xEdit') ? [g.xeditArg] : []);
      add('bsarch', path.join(dir, 'BSArch.exe'));
      add('bsarchpro', path.join(dir, 'BSArchPro.exe'));
    }
    add('creationkit', path.join(g.installDir, 'CreationKit.exe'));
    add('papyrus', path.join(g.installDir, 'Papyrus Compiler', 'PapyrusCompiler.exe'));
    add('papyrus', path.join(g.installDir, 'Tools', 'Papyrus Compiler', 'PapyrusCompiler.exe'));
    add('archive2', path.join(g.installDir, 'Tools', 'Archive2', 'Archive2.exe'));
    add('bodyslide', path.join(g.installDir, 'Data', 'CalienteTools', 'BodySlide', 'BodySlide x64.exe'));
    for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) add('loot', path.join(pf, 'LOOT', 'LOOT.exe'));
  }
  if (g.kind === 'minecraft') {
    for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) add('worldpainter', path.join(pf, 'WorldPainter', 'worldpainter.exe'));
  }
  return out;
}

function list(gameId) {
  const s = mods.state(gameId);
  const registered = (s.tools || []).map((t) => ({ ...t, ai: describe(t.kind).ai }));
  const known = new Set(registered.map((t) => t.path.toLowerCase()));
  const seen = new Set();
  const suggested = suggestions(gameId).filter((t) => {
    const k = t.path.toLowerCase();
    if (known.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { registered, suggested, catalog: Object.entries(CATALOG).filter(([, d]) => d.games.includes(gameId)).map(([kind, d]) => ({ kind, name: d.name, ai: d.ai })) };
}

function add(gameId, tool) {
  const s = mods.state(gameId);
  s.tools = s.tools || [];
  if (s.tools.some((t) => t.path.toLowerCase() === tool.path.toLowerCase())) return s.tools.find((t) => t.path.toLowerCase() === tool.path.toLowerCase());
  const kind = tool.kind || guessKind(tool.path);
  const entry = { id: `tool-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: tool.name || path.basename(tool.path, '.exe'), path: tool.path, args: tool.args || defaultArgs(gameId, { kind, path: tool.path }), kind };
  s.tools.push(entry);
  mods.save(gameId);
  return entry;
}

function remove(gameId, toolId) {
  const s = mods.state(gameId);
  s.tools = (s.tools || []).filter((t) => t.id !== toolId);
  mods.save(gameId);
}

// Registered tool of a kind, else a well-known location.
function find(gameId, kind) {
  const s = mods.state(gameId);
  return (s.tools || []).find((t) => t.kind === kind && fs.existsSync(t.path)) || suggestions(gameId).find((t) => t.kind === kind) || null;
}

function byId(gameId, toolId) {
  const s = mods.state(gameId);
  return (s.tools || []).find((t) => t.id === toolId) || suggestions(gameId).find((t) => t.path === toolId) || null;
}

// In virtual mode every tool runs inside the VFS so it sees the same Data folder as the game.
const isVirtual = (gameId) => mods.deployMode(gameId) === 'virtual';
const vfs = () => require('./vfs');

async function launch(gameId, toolId, extraArgs = []) {
  const tool = byId(gameId, toolId);
  if (!tool) throw new Error('Tool not found. Add it on the Tools page.');
  if (isVirtual(gameId)) {
    await vfs().launch(gameId, { exe: tool.path, args: vfs().joinArgs([...(tool.args || []), ...extraArgs]), cwd: path.dirname(tool.path) });
    return { launched: `${tool.name} (virtual)` };
  }
  const child = spawn(tool.path, [...(tool.args || []), ...extraArgs], { cwd: path.dirname(tool.path), detached: true, stdio: 'ignore' });
  child.unref();
  return { launched: tool.name };
}

// Generic: run a registered tool with arguments and capture its output.
async function runTool(gameId, toolId, args = [], { wait = true, timeoutMin = 30 } = {}) {
  const tool = byId(gameId, toolId);
  if (!tool) throw new Error('Tool not registered. Only tools on the Tools page can be run.');
  if (!wait) return launch(gameId, toolId, args);
  if (isVirtual(gameId)) {
    const r = await vfs().launch(gameId, { exe: tool.path, args: vfs().joinArgs([...(tool.args || []), ...args]), cwd: path.dirname(tool.path), wait: true, timeoutMs: timeoutMin * 60000 });
    return { tool: tool.name, virtual: true, events: r.events, note: 'Ran inside the virtual file system; new files it wrote are in Overwrite.' };
  }
  const r = await proc.run(tool.path, [...(tool.args || []), ...args], { cwd: path.dirname(tool.path), timeoutMs: timeoutMin * 60000, hidden: false });
  return { tool: tool.name, exitCode: r.code, output: proc.tail(r.output, 150) };
}

// xEdit names its log after the mode (FO4Edit_log.txt, FO4Script_log.txt, ...): take the newest
// log written since `since`, and only its last session.
function xeditLog(tool, since = 0) {
  const dir = path.dirname(tool.path);
  const logs = fs.readdirSync(dir).filter((n) => /_log\.txt$/i.test(n)).map((n) => path.join(dir, n))
    .map((p) => ({ p, t: fs.statSync(p).mtimeMs })).filter((x) => x.t >= since).sort((a, b) => b.t - a.t);
  if (!logs.length) return null;
  const lines = fs.readFileSync(logs[0].p, 'utf8').split(/\r?\n/);
  let start = 0;
  lines.forEach((l, i) => { if (/starting session/.test(l)) start = i; });
  return lines.slice(start).filter((l) => !/Background Loader:/.test(l)).join('\n');
}

function xeditBaseArgs(gameId, tool) {
  const g = mods.game(gameId);
  const args = [...(tool.args || [])];
  if (/^xedit/i.test(path.basename(tool.path)) && !args.includes(g.xeditArg)) args.unshift(g.xeditArg);
  return args;
}

// Runs xEdit through xedit-runner.ps1, which dismisses xEdit's startup message, confirms the
// preselected plugins and (with autoSave) confirms saving, so runs finish unattended.
async function runXedit(tool, args, { autoSave = false, timeoutMin = 45, gameId } = {}) {
  const runner = path.join(__dirname, 'scripts', 'xedit-runner.ps1').replace('app.asar', 'app.asar.unpacked');
  const b64 = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
  const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner, '-Exe', tool.path, '-ArgsB64', b64, '-TimeoutSec', String(timeoutMin * 60)];
  if (autoSave) psArgs.push('-AutoSave');
  if (gameId && isVirtual(gameId)) {
    const run = await vfs().prepareRun(gameId, { exe: tool.path, args: vfs().joinArgs(args), cwd: path.dirname(tool.path) });
    psArgs.push('-VfsHelper', run.helper, '-VfsConfig', run.cfg);
  }
  const r = await proc.run('powershell.exe', psArgs, { timeoutMs: (timeoutMin + 2) * 60000 });
  const events = r.output.split(/\r?\n/).filter((l) => l.startsWith('EVENT ') && !l.startsWith('EVENT args')).map((l) => l.slice(6));
  return { timedOut: events.includes('timeout'), events };
}

// xEdit Quick Auto Clean: removes ITMs/UDRs from a plugin. xEdit writes a backup itself.
async function xeditQuickClean(gameId, plugin) {
  const tool = find(gameId, 'xedit');
  if (!tool) throw new Error('xEdit (SSEEdit/FO4Edit/SF1Edit) not found. Add it on the Tools page.');
  const args = [...xeditBaseArgs(gameId, tool), '-qac', '-autoexit', '-autoload', plugin];
  const started = Date.now() - 2000;
  const r = await runXedit(tool, args, { timeoutMin: 20, gameId });
  const log = xeditLog(tool, started);
  return { ...r, log: log ? proc.tail(log, 80) : '(no xEdit log found)' };
}

// Runs an AI-written xEdit Pascal script. Optionally loads only some plugins (plus their masters).
async function xeditScript(gameId, script, plugins) {
  const tool = find(gameId, 'xedit');
  if (!tool) throw new Error('xEdit (SSEEdit/FO4Edit/SF1Edit) not found. Add it on the Tools page.');
  // xEdit only runs scripts by name from its scripts path, so point -S: at Shuriken's folder.
  const dir = store.dataDir('xedit-scripts');
  const name = `Shuriken_${Date.now()}.pas`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, script);
  const args = [...xeditBaseArgs(gameId, tool), `-S:${dir}\\`, `-script:${name}`, '-autoload', '-autoexit', '-IKnowWhatImDoing'];
  if (plugins?.length) {
    const runDir = store.dataDir('xedit-scripts', `run_${Date.now()}`);
    const pl = path.join(runDir, 'plugins.txt');
    fs.writeFileSync(pl, plugins.map((p) => `*${p}`).join('\r\n'));
    args.push(`-P:${pl}`);
  }
  const started = Date.now() - 2000;
  const r = await runXedit(tool, args, { autoSave: true, gameId });
  const raw = xeditLog(tool, started);
  const log = raw ? proc.tail(raw.split(/\r?\n/).filter((l) => !/^Using |Mozilla Public License|Source Code Form|^\s*$/.test(l)).join('\n'), 250) : '(xEdit did not write a log)';
  return {
    ...r,
    scriptFile: file,
    log,
    note: (isVirtual(gameId) ? 'Virtual mode: new plugins xEdit creates land in Overwrite (use "Create mod from Overwrite" or workshop_capture). ' : '') + 'Read-only scripts run unattended. Scripts that create or modify plugins load the whole load order (minutes for big setups) and xEdit may wait for the user to confirm in its window; if this run timed out, ask the user to watch the xEdit window and click OK when asked, then run it again. New plugins are created in the game Data folder: use workshop_capture to move them into a workshop project.',
  };
}

async function lootSort(gameId) {
  const tool = find(gameId, 'loot');
  if (!tool) throw new Error('LOOT not found. Install it from loot.github.io or add it on the Tools page.');
  const LOOT_GAME = { skyrimse: 'Skyrim Special Edition', fallout4: 'Fallout4', starfield: 'Starfield' };
  const lootArgs = [`--game=${LOOT_GAME[gameId]}`, '--auto-sort'];
  if (isVirtual(gameId)) {
    await vfs().launch(gameId, { exe: tool.path, args: vfs().joinArgs(lootArgs), cwd: path.dirname(tool.path), wait: true, timeoutMs: 10 * 60000 });
    return { virtual: true };
  }
  const r = await proc.run(tool.path, lootArgs, { cwd: path.dirname(tool.path), timeoutMs: 10 * 60000, hidden: false });
  return { exitCode: r.code };
}

module.exports = { CATALOG, list, add, remove, launch, runTool, xeditQuickClean, xeditScript, lootSort, find, byId, guessKind, scanForGame, describe };
