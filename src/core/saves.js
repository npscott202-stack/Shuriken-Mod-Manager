// Save games: list, inspect (header, screenshot, plugins), find problems, back up, restore,
// clean (script data via the bundled ReSaver engine) and tidy leftover/corrupt files.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mods = require('./mods');
const plugins = require('./plugins');
const proc = require('./proc');
const { GAMES } = require('./games');

// Save and co-save extensions per game. `clean` = supported by the ReSaver engine.
const FORMATS = {
  skyrim: { ext: '.ess', co: '.skse', clean: true },
  skyrimse: { ext: '.ess', co: '.skse', clean: true },
  skyrimvr: { ext: '.ess', co: '.skse', clean: true },
  fallout4: { ext: '.fos', co: '.f4se', clean: true },
  fallout4vr: { ext: '.fos', co: '.f4se', clean: true },
  starfield: { ext: '.sfs', co: '.sfse', clean: false },
  falloutnv: { ext: '.fos', co: '.nvse', clean: false },
  fallout3: { ext: '.fos', co: '.fose', clean: false },
  oblivion: { ext: '.ess', co: '.obse', clean: false },
};
const BACKUP_DIR = 'Shuriken Backups';

function supported(gameId) {
  return !!FORMATS[gameId] && !!GAMES[gameId]?.myGames;
}

function format(gameId) {
  const f = FORMATS[gameId];
  if (!f) throw new Error('Save management is available for Bethesda games (Skyrim, Fallout, Starfield, Oblivion).');
  return f;
}

// The folder the game actually saves to: the profile's own saves in virtual mode, else My Games\<game>\<sLocalSavePath>.
function savesDir(gameId) {
  const def = GAMES[gameId];
  const s = mods.state(gameId);
  const p = s.profiles?.[s.activeProfile];
  if (mods.deployMode(gameId) === 'virtual' && p?.localSaves) return path.join(mods.profileDir(gameId), 'saves');
  const myGames = def.myGames();
  let rel = 'Saves';
  for (const ini of [...(def.iniFiles || [])].reverse()) {
    try {
      const m = fs.readFileSync(path.join(myGames, ini), 'utf8').match(/^\s*sLocalSavePath\s*=\s*(.+?)\s*$/im);
      if (m) { rel = m[1].replace(/[\\/]+$/, ''); break; }
    } catch {
      // ini missing
    }
  }
  return path.isAbsolute(rel) ? rel : path.join(myGames, rel);
}

// ---------- header parsing ----------
function wstr(buf, o) {
  const len = buf.readUInt16LE(o.p);
  const s = buf.toString('latin1', o.p + 2, o.p + 2 + len);
  o.p += 2 + len;
  return s;
}

function readHead(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function readAt(file, offset, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, offset);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

// LZ4 block decoder that stops once `want` bytes are produced (Skyrim SE compresses the save body).
function lz4Partial(src, want) {
  const out = Buffer.alloc(want + 65536);
  let s = 0;
  let d = 0;
  while (s < src.length && d < want) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255 && s < src.length); }
    if (d + lit > out.length) lit = out.length - d;
    src.copy(out, d, s, s + lit);
    s += lit;
    d += lit;
    if (s >= src.length || d >= want) break;
    const off = src[s] | (src[s + 1] << 8);
    s += 2;
    let m = (token & 15) + 4;
    if ((token & 15) === 15) { let b; do { b = src[s++]; m += b; } while (b === 255 && s < src.length); }
    if (!off || off > d) throw new Error('bad LZ4 data');
    for (let i = 0; i < m && d < out.length; i++, d++) out[d] = out[d - off];
  }
  return out.subarray(0, d);
}

const MAGIC = { TESV_SAVEGAME: 'skyrim', FO4_SAVEGAME: 'fallout4' };

// Parses the header of a Skyrim (LE/SE/VR) or Fallout 4 save, plus its plugin list.
function parseSave(file) {
  const head = readHead(file, 4096);
  const magicLen = head.toString('latin1', 0, 4) === 'TESV' ? 13 : head.toString('latin1', 0, 4) === 'FO4_' ? 12 : 0;
  if (!magicLen) return null;
  const magic = head.toString('latin1', 0, magicLen);
  if (!MAGIC[magic]) return null;
  const o = { p: magicLen };
  const headerSize = head.readUInt32LE(o.p); o.p += 4;
  const start = o.p;
  const h = { version: head.readUInt32LE(o.p) };
  o.p += 4;
  h.saveNumber = head.readUInt32LE(o.p); o.p += 4;
  h.name = wstr(head, o);
  h.level = head.readUInt32LE(o.p); o.p += 4;
  h.location = wstr(head, o);
  h.gameDate = wstr(head, o);
  h.race = wstr(head, o);
  h.sex = head.readUInt16LE(o.p) === 1 ? 'female' : 'male'; o.p += 2;
  o.p += 8; // current / needed XP
  const ft = head.readBigUInt64LE(o.p); o.p += 8;
  h.savedAt = new Date(Number(ft / 10000n - 11644473600000n)).toISOString();
  h.shotWidth = head.readUInt32LE(o.p); o.p += 4;
  h.shotHeight = head.readUInt32LE(o.p); o.p += 4;
  const isSkyrim = magic === 'TESV_SAVEGAME';
  h.compression = isSkyrim && h.version >= 12 ? head.readUInt16LE(o.p) : 0;
  if (isSkyrim && h.version >= 12) o.p += 2;
  if (o.p - start !== headerSize) throw new Error('Header size does not match: the file is damaged.');
  h.bpp = isSkyrim && h.version < 12 ? 3 : 4;
  h.shotOffset = o.p;
  const bodyOffset = o.p + h.shotWidth * h.shotHeight * h.bpp;
  const size = fs.statSync(file).size;
  if (bodyOffset >= size) throw new Error('The file ends inside the screenshot: it is truncated.');
  let body;
  if (h.compression) {
    const lens = readAt(file, bodyOffset, 8);
    const comp = readAt(file, bodyOffset + 8, Math.min(lens.readUInt32LE(4), 256 * 1024));
    if (bodyOffset + 8 + lens.readUInt32LE(4) > size) throw new Error('The compressed data is cut off: the file is truncated.');
    body = h.compression === 2 ? lz4Partial(comp, 128 * 1024) : zlib.inflateSync(comp, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  } else {
    body = readAt(file, bodyOffset, 128 * 1024);
  }
  const b = { p: 0 };
  h.formVersion = body[b.p++];
  if (!isSkyrim) h.gameVersion = wstr(body, b);
  b.p += 4; // plugin info size
  const full = body[b.p++];
  h.plugins = [];
  for (let i = 0; i < full; i++) h.plugins.push(wstr(body, b));
  h.lightPlugins = [];
  const esl = isSkyrim ? h.formVersion >= 78 : h.formVersion >= 68;
  if (esl) {
    const lite = body.readUInt16LE(b.p); b.p += 2;
    for (let i = 0; i < lite; i++) h.lightPlugins.push(wstr(body, b));
  }
  if (![...h.plugins, ...h.lightPlugins].every((n) => /\.es[mpl]$/i.test(n))) throw new Error('The plugin list is unreadable: the file is damaged.');
  return h;
}

// Fallout 4 / Skyrim file names carry the character id and a hex-encoded name: Save12_0677DE12_4B616E65_...
function nameFromFilename(base) {
  const m = base.match(/_[0-9A-F]{8}[_M]([0-9A-F]{2,})_/i);
  if (!m) return null;
  try {
    return Buffer.from(m[1], 'hex').toString('latin1');
  } catch {
    return null;
  }
}

// ---------- listing ----------
const cache = new Map(); // file -> { mtime, size, info }

function activePluginSet(gameId) {
  try {
    const g = mods.game(gameId);
    const scan = plugins.scan(g);
    const all = [...scan.implicit, ...scan.plugins];
    return { names: new Set(all.filter((p) => p.enabled).map((p) => p.name.toLowerCase())), all: new Set(all.map((p) => p.name.toLowerCase())) };
  } catch {
    return null;
  }
}

function list(gameId) {
  const fmt = format(gameId);
  const dir = savesDir(gameId);
  if (!fs.existsSync(dir)) return { dir, saves: [], junk: [], backups: listBackups(gameId).length, cleanable: fmt.clean };
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  const active = activePluginSet(gameId);
  const g = mods.game(gameId);
  const usesExtender = g.loader && g.installDir && fs.existsSync(path.join(g.installDir, g.loader));
  const saves = [];
  const junk = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const lower = e.name.toLowerCase();
    const st = fs.statSync(full);
    if (lower.endsWith(`${fmt.ext}.tmp`) || lower.endsWith('.tmp')) { junk.push({ file: e.name, size: st.size, reason: 'Leftover temporary file from a save that did not finish (crash or full disk).' }); continue; }
    if (lower.endsWith(fmt.co)) {
      if (!names.has(lower.slice(0, -fmt.co.length) + fmt.ext)) junk.push({ file: e.name, size: st.size, reason: `${fmt.co} co-save without its save game.` });
      continue;
    }
    if (!lower.endsWith(fmt.ext)) continue;
    const base = e.name.slice(0, -fmt.ext.length);
    const item = { file: e.name, size: st.size, modified: st.mtime.toISOString(), cosave: names.has((base + fmt.co).toLowerCase()), issues: [] };
    if (st.size === 0) {
      item.issues.push({ level: 'err', text: 'Empty file (0 bytes): this save was never written.' });
      junk.push({ file: e.name, size: 0, reason: 'Empty save file (0 bytes).' });
    } else if (fmt.clean) {
      const c = cache.get(full);
      let info = c && c.mtime === st.mtimeMs && c.size === st.size ? c.info : null;
      if (!info) {
        try {
          info = parseSave(full) || { error: 'Not a recognised save file.' };
        } catch (err) {
          info = { error: err.message };
        }
        cache.set(full, { mtime: st.mtimeMs, size: st.size, info });
      }
      if (info.error) {
        item.issues.push({ level: 'err', text: `Corrupt: ${info.error}` });
      } else {
        Object.assign(item, { name: info.name, level: info.level, location: info.location, gameDate: info.gameDate, race: info.race, sex: info.sex, savedAt: info.savedAt, saveNumber: info.saveNumber, gameVersion: info.gameVersion, pluginCount: info.plugins.length + info.lightPlugins.length, hasShot: info.shotWidth > 0 });
        if (active) {
          const missing = [...info.plugins, ...info.lightPlugins].filter((n) => !active.names.has(n.toLowerCase()));
          if (missing.length) {
            item.missing = missing;
            item.issues.push({ level: 'warn', text: `${missing.length} plugin${missing.length > 1 ? 's' : ''} used by this save ${missing.length > 1 ? 'are' : 'is'} not active: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}` });
          }
        }
      }
      if (usesExtender && !item.cosave) item.issues.push({ level: 'info', text: `No ${fmt.co} co-save: script extender data (for mods that need it) is missing.` });
    } else {
      item.name = nameFromFilename(base);
    }
    if (!item.name) item.name = nameFromFilename(base);
    saves.push(item);
  }
  saves.sort((a, b) => b.modified.localeCompare(a.modified));
  return { dir, saves, junk, backups: listBackups(gameId).length, cleanable: fmt.clean };
}

// Screenshot stored in the save, as raw RGBA; main.js turns it into an image.
function screenshot(gameId, file) {
  const full = resolveSave(gameId, file);
  const h = parseSave(full);
  if (!h || !h.shotWidth) return null;
  const raw = readAt(full, h.shotOffset, h.shotWidth * h.shotHeight * h.bpp);
  const bgra = Buffer.alloc(h.shotWidth * h.shotHeight * 4);
  for (let i = 0, j = 0; j < bgra.length; i += h.bpp, j += 4) {
    bgra[j] = raw[i + 2];
    bgra[j + 1] = raw[i + 1];
    bgra[j + 2] = raw[i];
    bgra[j + 3] = 255;
  }
  return { width: h.shotWidth, height: h.shotHeight, bgra };
}

function resolveSave(gameId, file) {
  const dir = savesDir(gameId);
  const full = path.join(dir, path.basename(file));
  if (!fs.existsSync(full)) throw new Error(`Save not found: ${file}`);
  return full;
}

// ---------- deep check / clean (ReSaver engine) ----------
function toolJar() {
  return path.join(__dirname, 'bin', 'shuriken-savetool.jar').replace('app.asar', 'app.asar.unpacked');
}

async function java() {
  const mcx = require('./integrations/minecraft');
  const jdk = mcx.findJdk() || (await mcx.portableJdk(21));
  return path.join(jdk, 'bin', 'java.exe');
}

async function runTool(args) {
  const r = await proc.run(await java(), ['-Xmx3g', '-jar', toolJar(), ...args], { timeoutMs: 10 * 60000 });
  const line = String(r.output).split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error(`Save tool failed: ${proc.tail(r.output, 15)}`);
  const json = JSON.parse(line);
  if (json.error) throw new Error(json.error);
  return json;
}

function verdict(info) {
  const issues = [];
  const p = info.papyrus || {};
  if (info.broken || info.truncated) issues.push({ level: 'err', text: 'The save is truncated or damaged. Load an earlier save; this one cannot be repaired.' });
  if (info.pluginOverflow) issues.push({ level: 'err', text: 'Too many plugins were active when this was saved (plugin limit overflow).' });
  if (p.broken) issues.push({ level: 'err', text: 'The script (Papyrus) section is damaged.' });
  if (p.unattachedInstances) issues.push({ level: 'warn', text: `${p.unattachedInstances} unattached script instances (left behind by removed or changed mods). Safe to clean.` });
  if (p.undefinedElements) issues.push({ level: 'warn', text: `${p.undefinedElements} script elements whose scripts no longer exist (mod removed mid-game). Cleaning removes them.` });
  if (p.undefinedThreads) issues.push({ level: 'err', text: `${p.undefinedThreads} running script threads from removed scripts: a common cause of load crashes and frozen quests. Cleaning stops them.` });
  if (p.suspendedStacks > 50) issues.push({ level: 'warn', text: `${p.suspendedStacks} suspended script stacks: scripts are backing up (script lag).` });
  if (p.activeScripts > 400) issues.push({ level: 'warn', text: `${p.activeScripts} active script threads: a script-heavy mod may be overloading the engine.` });
  if (!issues.length) issues.push({ level: 'ok', text: 'No script problems found.' });
  return issues;
}

async function analyze(gameId, file) {
  const fmt = format(gameId);
  if (!fmt.clean) throw new Error(`Deep save checks are not available for ${GAMES[gameId].name} yet.`);
  const info = await runTool(['info', resolveSave(gameId, file)]);
  info.issues = verdict(info);
  info.canClean = !!(info.papyrus && (info.papyrus.unattachedInstances || info.papyrus.undefinedElements || info.papyrus.undefinedThreads)) && !info.broken && !info.truncated;
  return info;
}

function backupRoot(gameId) {
  return path.join(savesDir(gameId), BACKUP_DIR);
}

function backupFiles(gameId, file, reason) {
  const fmt = format(gameId);
  const full = resolveSave(gameId, file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(backupRoot(gameId), `${stamp} ${reason}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(full, path.join(dir, path.basename(full)));
  const co = full.slice(0, -fmt.ext.length) + fmt.co;
  if (fs.existsSync(co)) fs.copyFileSync(co, path.join(dir, path.basename(co)));
  return dir;
}

const CLEAN_OPS = ['unattached', 'undefined'];

async function clean(gameId, file, ops = CLEAN_OPS) {
  const fmt = format(gameId);
  if (!fmt.clean) throw new Error(`Save cleaning is not available for ${GAMES[gameId].name} yet.`);
  const full = resolveSave(gameId, file);
  const bad = ops.filter((o) => !['unattached', 'undefined', 'nonexistent', 'formlists', 'havok'].includes(o));
  if (bad.length) throw new Error(`Unknown clean option: ${bad.join(', ')}`);
  const backup = backupFiles(gameId, file, 'before clean');
  const work = path.join(savesDir(gameId), BACKUP_DIR, '_work');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const out = path.join(work, path.basename(full));
  try {
    const result = await runTool(['clean', full, out, ...ops]);
    // The tool re-reads its output before reporting, so only a verified file replaces the save.
    fs.copyFileSync(out, full);
    result.issues = verdict(result);
    result.backup = backup;
    cache.delete(full);
    return result;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function listBackups(gameId) {
  const root = backupRoot(gameId);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_work')
    .map((e) => {
      const dir = path.join(root, e.name);
      const files = fs.readdirSync(dir);
      return { id: e.name, files, size: files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) };
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

function restoreBackup(gameId, id) {
  const dir = path.join(backupRoot(gameId), path.basename(id));
  if (!fs.existsSync(dir)) throw new Error('Backup not found');
  const restored = [];
  for (const f of fs.readdirSync(dir)) {
    const target = path.join(savesDir(gameId), f);
    if (fs.existsSync(target) && f.toLowerCase().endsWith(format(gameId).ext)) backupFiles(gameId, f, 'before restore');
    fs.copyFileSync(path.join(dir, f), target);
    cache.delete(target);
    restored.push(f);
  }
  return { restored };
}

function backupAll(gameId) {
  const fmt = format(gameId);
  const dir = savesDir(gameId);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(backupRoot(gameId), `${stamp} all saves`);
  fs.mkdirSync(out, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    const l = f.toLowerCase();
    if (l.endsWith(fmt.ext) || l.endsWith(fmt.co)) { fs.copyFileSync(path.join(dir, f), path.join(out, f)); n++; }
  }
  return { folder: out, files: n };
}

// Moves files to the Recycle Bin (recoverable), with the save's co-save.
async function trash(gameId, files) {
  const { shell } = require('electron');
  const fmt = format(gameId);
  const dir = savesDir(gameId);
  const removed = [];
  for (const f of files) {
    const full = path.join(dir, path.basename(f));
    if (!fs.existsSync(full)) continue;
    await shell.trashItem(full);
    removed.push(path.basename(f));
    if (full.toLowerCase().endsWith(fmt.ext)) {
      const co = full.slice(0, -fmt.ext.length) + fmt.co;
      if (fs.existsSync(co)) { await shell.trashItem(co); removed.push(path.basename(co)); }
    }
    cache.delete(full);
  }
  return { removed };
}

async function cleanupJunk(gameId) {
  const { junk } = list(gameId);
  return trash(gameId, junk.map((j) => j.file));
}

module.exports = { supported, savesDir, list, screenshot, analyze, clean, listBackups, restoreBackup, backupAll, trash, cleanupJunk, parseSave, CLEAN_OPS };
