// Playtest mode: the AI launches the game, travels to a place, looks at it (screenshots), drives
// the console (Bethesda games), moves the camera/character and inspects objects, while the user
// keeps chatting from the launcher. Input goes through bin/shuriken-input.exe (real scancodes).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');
const mods = require('./mods');
const { GAMES } = require('./games');

let launcher = null; // set by main.js: (gameId) => launches the game the normal way
let session = null; // { gameId, exe, startedAt, consoleLog, notes: [] }

function setLauncher(fn) {
  launcher = fn;
}

function helper() {
  return path.join(__dirname, 'bin', 'shuriken-input.exe').replace('app.asar', 'app.asar.unpacked');
}

function input(script, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile(helper(), [script], { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      const out = String(stdout || '').trim();
      if (/^error /m.test(out)) return reject(new Error(out.match(/^error (.*)$/m)[1]));
      if (err && !out) return reject(err);
      resolve(out);
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isBethesda = (gameId) => GAMES[gameId]?.kind === 'bethesda';

// The process whose window we drive: the game exe (script extender loaders exit after starting it).
function exeName(gameId) {
  const g = GAMES[gameId];
  return path.basename(g.exe || '');
}

async function windowInfo(gameId) {
  const out = await input(`find ${exeName(gameId)}`);
  const m = out.match(/^window (\d+) (\d+) (-?\d+) (-?\d+) (\d+) (\d+) (\d)/m);
  return m ? { pid: Number(m[2]), x: Number(m[3]), y: Number(m[4]), width: Number(m[5]), height: Number(m[6]), foreground: m[7] === '1' } : null;
}

function requireSession(gameId) {
  if (!session || session.gameId !== gameId) throw new Error('No playtest is running for this game. Start one with playtest_start.');
}

async function screenshot(gameId, { focus = true } = {}) {
  const file = path.join(store.dataDir('screenshots'), `playtest-${Date.now()}.jpg`);
  if (focus) await input(`focus ${exeName(gameId)}; wait 250`);
  const out = await input(`shot ${exeName(gameId)} "${file}" 1280`);
  const data = fs.readFileSync(file).toString('base64');
  const black = fs.statSync(file).size < 15000;
  return { file, note: black ? 'The capture looks blank: the game may be in exclusive fullscreen. Use playtest_setup_window to switch it to borderless windowed.' : out, image: { mediaType: 'image/jpeg', data } };
}

// ---------- console (Bethesda) ----------
function consoleFile(gameId) {
  return path.join(mods.game(gameId).installDir, 'shuriken_console.txt');
}

// Opens the console, runs each command, closes it, and returns what the console printed
// (captured with "scof", which mirrors console output to a file in the game folder).
async function consoleRun(gameId, commands) {
  requireSession(gameId);
  if (!isBethesda(gameId)) throw new Error('The console is only available in Bethesda games.');
  const file = consoleFile(gameId);
  const before = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const lines = [];
  if (!session.scof) lines.push('scof shuriken_console.txt');
  lines.push(...commands.map((c) => String(c).replace(/;/g, '\\;').replace(/[\r\n]+/g, ' ')));
  let script = `focus ${exeName(gameId)}; wait 200; tap tilde; wait 350`;
  for (const l of lines) script += `; text ${l}; wait 60; tap enter; wait 450`;
  script += '; wait 300; tap tilde; wait 200';
  await input(script, 60000 + commands.length * 5000);
  session.scof = true;
  await wait(400);
  let output = '';
  try {
    const buf = fs.readFileSync(file);
    output = buf.subarray(before).toString('latin1').trim();
  } catch {
    output = '(no console output captured)';
  }
  session.log.push(...commands.map((c) => `> ${c}`));
  return output.slice(-8000) || '(the commands printed nothing)';
}

// ---------- start / stop ----------
async function start(gameId, { save, location, waitSeconds = 45 } = {}) {
  if (!launcher) throw new Error('Launcher not ready');
  const g = mods.game(gameId);
  if (!g.installDir) throw new Error('Set the game folder first.');
  let win = await windowInfo(gameId);
  if (!win) {
    await launcher(gameId);
    const t = Date.now();
    while (Date.now() - t < 240000) {
      await wait(2000);
      win = await windowInfo(gameId);
      if (win) break;
    }
    if (!win) throw new Error(`${g.name} did not open a window within 4 minutes.`);
    // Give the intro/main menu time to settle before typing.
    await wait(waitSeconds * 1000);
  }
  session = { gameId, startedAt: Date.now(), scof: false, log: [] };
  const steps = [];
  if (isBethesda(gameId) && (save || location)) {
    // Skip intro videos / press-any-key screens so the console can open.
    await input(`focus ${exeName(gameId)}; wait 300; tap esc; wait 600; tap esc; wait 600`);
    if (save) {
      const name = String(save).replace(/\.(fos|ess|sfs)$/i, '');
      steps.push(await consoleRun(gameId, [`load "${name}"`]));
      await wait(25000);
    } else if (location) {
      steps.push(await consoleRun(gameId, [`coc ${location}`]));
      await wait(25000);
    }
  }
  const shot = await screenshot(gameId);
  return { started: true, window: win, console: steps.join('\n'), ...shot };
}

async function stop(gameId) {
  if (!(await windowInfo(gameId))) { session = null; return { stopped: true, note: 'The game was not running.' }; }
  if (isBethesda(gameId)) {
    try {
      await consoleRun(gameId, ['qqq']);
    } catch {
      await input(`close ${exeName(gameId)}`);
    }
  } else {
    await input(`close ${exeName(gameId)}`);
  }
  session = null;
  return { stopped: true };
}

async function status(gameId) {
  const win = await windowInfo(gameId);
  return { running: !!win, window: win, session: session?.gameId === gameId ? { startedAt: new Date(session.startedAt).toISOString(), recentCommands: session.log.slice(-15) } : null };
}

// ---------- movement / inspection ----------
const KEYS = new Set(['w', 'a', 's', 'd', 'e', 'r', 'q', 'f', 'z', 'x', 'c', 'v', 'tab', 'space', 'esc', 'enter', 'lshift', 'lctrl', 'lalt', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'f5', 'f9', 'up', 'down', 'left', 'right', 'i', 'j', 'm', 'p', 't', 'b', 'g', 'h', 'k', 'l', 'n', 'o', 'u', 'y', 'tilde']);

async function act(gameId, actions = []) {
  requireSession(gameId);
  let script = `focus ${exeName(gameId)}; wait 200`;
  for (const a of actions.slice(0, 40)) {
    if (a.key) {
      const k = String(a.key).toLowerCase();
      if (!KEYS.has(k)) throw new Error(`Key "${a.key}" is not allowed in playtest actions`);
      script += a.ms ? `; hold ${k} ${Math.min(Number(a.ms) || 100, 15000)}` : `; tap ${k}`;
    } else if (a.look) {
      script += `; move ${Math.round(a.look[0] || 0)} ${Math.round(a.look[1] || 0)} 20`;
    } else if (a.click) {
      script += `; click ${a.click === 'right' ? 'right' : 'left'}`;
    } else if (a.wait) {
      script += `; wait ${Math.min(Number(a.wait) || 0, 20000)}`;
    } else if (a.text) {
      script += `; text ${String(a.text).replace(/;/g, '\\;')}`;
    }
    script += '; wait 120';
  }
  await input(script, 180000);
  return screenshot(gameId, { focus: false });
}

// Bethesda: opens the console and clicks whatever is under the crosshair, so the console shows
// its reference id (and, with "Better Console"/"More Informative Console", the plugin it came from).
async function inspect(gameId, commands = []) {
  requireSession(gameId);
  if (!isBethesda(gameId)) throw new Error('Inspect uses the console: Bethesda games only. Use playtest_screenshot instead.');
  await input(`focus ${exeName(gameId)}; wait 200; tap tilde; wait 400; center ${exeName(gameId)}; wait 150; click left; wait 400`);
  const shot = await screenshot(gameId, { focus: false });
  let output = '';
  if (commands.length) {
    const file = consoleFile(gameId);
    const before = fs.existsSync(file) ? fs.statSync(file).size : 0;
    let script = '';
    for (const c of commands) script += `text ${String(c).replace(/;/g, '\\;')}; wait 60; tap enter; wait 450; `;
    await input(script + 'wait 300');
    try { output = fs.readFileSync(file).subarray(before).toString('latin1').trim(); } catch { output = ''; }
  }
  await input('tap tilde; wait 200');
  return { ...shot, console: output, note: 'The console was opened and the object under the crosshair selected. Its ID is shown at the top of the console in the screenshot.' };
}

// Exclusive fullscreen cannot be captured; borderless windowed can.
function setupWindow(gameId) {
  const g = GAMES[gameId];
  if (!isBethesda(gameId)) throw new Error('Set the game to windowed or borderless in its own video settings.');
  const diagnostics = require('./diagnostics');
  const prefs = (g.iniFiles || []).find((f) => /prefs/i.test(f));
  if (!prefs) throw new Error('No Prefs INI known for this game');
  const file = diagnostics.iniPath(gameId, prefs);
  diagnostics.setIniValue(file, 'Display', 'bFull Screen', '0');
  diagnostics.setIniValue(file, 'Display', 'bBorderless', '1');
  return { changed: [`${prefs} [Display] bFull Screen=0`, `${prefs} [Display] bBorderless=1`], note: 'Restart the game for this to apply.' };
}

// Finds cells (interiors and named exteriors) by editor ID across the active load order, for coc.
function findLocation(gameId, query) {
  if (!isBethesda(gameId) || gameId === 'oblivion') throw new Error('Location search reads Skyrim / Fallout / Starfield plugins.');
  const precombines = require('./precombines');
  const q = String(query).toLowerCase().replace(/\s+/g, '');
  const hits = [];
  for (const p of precombines.activeLoadOrder(gameId)) {
    let data;
    try {
      data = precombines.cachedParse(p.file);
    } catch {
      continue;
    }
    for (const c of data.cells) {
      const edid = c[4];
      if (edid && edid.toLowerCase().includes(q)) hits.push({ editorId: edid, plugin: p.name, interior: !!c[7], grid: c[5] !== null && c[5] !== undefined ? [c[5], c[6]] : null });
    }
    if (hits.length > 400) break;
  }
  const seen = new Set();
  return hits.filter((h) => !seen.has(h.editorId) && seen.add(h.editorId)).sort((a, b) => a.editorId.length - b.editorId.length).slice(0, 40);
}

function active() {
  return session ? { gameId: session.gameId, startedAt: session.startedAt } : null;
}

module.exports = { setLauncher, start, stop, status, screenshot, consoleRun, act, inspect, setupWindow, findLocation, active };
