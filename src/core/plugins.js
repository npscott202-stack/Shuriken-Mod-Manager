// Bethesda plugin (.esp/.esm/.esl) header parsing and load-order management.
const fs = require('fs');
const path = require('path');

const PLUGIN_RE = /\.(esp|esm|esl)$/i;

// Reads the TES4 header record: flags, author, description and master list.
// headerSize: 24 for Skyrim/Fallout 3+/Starfield, 20 for Oblivion.
function readHeader(filePath, headerSize = 24) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(headerSize);
    fs.readSync(fd, head, 0, headerSize, 0);
    if (head.toString('latin1', 0, 4) !== 'TES4') throw new Error('Not a TES4 plugin');
    const dataSize = head.readUInt32LE(4);
    const flags = head.readUInt32LE(8);
    const data = Buffer.alloc(Math.min(dataSize, 4 * 1024 * 1024));
    fs.readSync(fd, data, 0, data.length, headerSize);

    const masters = [];
    let author = '';
    let description = '';
    let version = null;
    let recordCount = null;
    let off = 0;
    let bigSize = null;
    while (off + 6 <= data.length) {
      const type = data.toString('latin1', off, off + 4);
      let size = data.readUInt16LE(off + 4);
      off += 6;
      if (bigSize !== null) { size = bigSize; bigSize = null; }
      if (type === 'XXXX') { bigSize = data.readUInt32LE(off); off += size; continue; }
      const body = data.subarray(off, off + size);
      const zstr = () => body.toString('latin1').replace(/\0.*$/s, '');
      if (type === 'HEDR' && size >= 8) { version = +body.readFloatLE(0).toFixed(2); recordCount = body.readUInt32LE(4); }
      else if (type === 'CNAM') author = zstr();
      else if (type === 'SNAM') description = zstr();
      else if (type === 'MAST') masters.push(zstr());
      off += size;
    }
    return { flags, masters, author, description, version, recordCount };
  } finally {
    fs.closeSync(fd);
  }
}

function describeFlags(game, name, flags) {
  const ext = path.extname(name).toLowerCase();
  const isMaster = (flags & 0x1) !== 0 || ext === '.esm' || ext === '.esl';
  const isLight = ext === '.esl' || (flags & game.lightFlag) !== 0;
  const isMedium = game.id === 'starfield' && (flags & 0x400) !== 0;
  return { isMaster, isLight, isMedium };
}

function readCcc(game) {
  if (!game.cccFile) return [];
  try {
    return fs
      .readFileSync(path.join(game.installDir, game.cccFile), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readLines(file) {
  try {
    return fs.readFileSync(file, 'latin1').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

// Current load order -> [{ name, enabled }].
//  - Skyrim SE/Fallout 4/Starfield/VR: plugins.txt with "*" marking active plugins
//  - Skyrim LE: order in loadorder.txt, active set in plugins.txt
//  - Oblivion/Fallout 3/New Vegas: order by file modification time, active set in plugins.txt
function readPluginsTxt(game) {
  const dir = game.pluginsDir();
  const lines = readLines(path.join(dir, 'plugins.txt'));
  if (game.pluginStar !== false) return lines.map((l) => ({ name: l.replace(/^\*/, ''), enabled: l.startsWith('*') }));
  const active = new Set(lines.map((l) => l.toLowerCase()));
  let order = [];
  if (game.timestampOrder && game.installDir) {
    const data = path.join(game.installDir, 'Data');
    try {
      order = fs.readdirSync(data).filter((f) => PLUGIN_RE.test(f))
        .map((f) => ({ f, t: fs.statSync(path.join(data, f)).mtimeMs, m: /\.esm$/i.test(f) }))
        .sort((a, b) => (b.m - a.m) || (a.t - b.t)).map((x) => x.f);
    } catch {
      order = [];
    }
  } else {
    order = readLines(path.join(dir, 'loadorder.txt'));
  }
  if (!order.length) order = lines;
  return order.map((name) => ({ name, enabled: active.has(name.toLowerCase()) }));
}

function writePluginsTxt(game, list) {
  const dir = game.pluginsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'plugins.txt');
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.shuriken.bak`);
  const lines = ['# This file is managed by Shuriken'];
  if (game.pluginStar === false) {
    for (const name of implicitList(game)) lines.push(name);
    for (const p of list) if (p.enabled) lines.push(p.name);
  } else {
    for (const p of list) lines.push(`${p.enabled ? '*' : ''}${p.name}`);
  }
  fs.writeFileSync(file, lines.join('\r\n') + '\r\n', 'latin1');
  // Skyrim SE/LE also honour loadorder.txt; keep it in sync.
  if (game.id === 'skyrimse' || game.id === 'skyrim') {
    const all = [...implicitList(game), ...list.map((p) => p.name)];
    fs.writeFileSync(path.join(dir, 'loadorder.txt'), all.join('\r\n') + '\r\n', 'latin1');
  }
  // Older games load by file date: give each plugin an increasing timestamp.
  if (game.timestampOrder && game.installDir) {
    const data = path.join(game.installDir, 'Data');
    const base = new Date('2008-01-01T00:00:00Z').getTime() / 1000;
    [...implicitList(game), ...list.map((p) => p.name)].forEach((name, i) => {
      try {
        fs.utimesSync(path.join(data, name), base + i * 60, base + i * 60);
      } catch {
        // missing file
      }
    });
  }
}

function implicitList(game) {
  const dataDir = path.join(game.installDir, 'Data');
  const present = (n) => fs.existsSync(path.join(dataDir, n));
  return [...game.implicitPlugins, ...readCcc(game)].filter(present);
}

// Merges plugins present in Data with the saved order. Returns the full list with header info.
function scan(game) {
  const dataDir = path.join(game.installDir, 'Data');
  let files = [];
  try {
    files = fs.readdirSync(dataDir).filter((f) => PLUGIN_RE.test(f));
  } catch {
    return { implicit: [], plugins: [] };
  }
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  const implicit = implicitList(game);
  const implicitSet = new Set(implicit.map((n) => n.toLowerCase()));

  const ordered = [];
  const seen = new Set();
  for (const entry of readPluginsTxt(game)) {
    const real = lower.get(entry.name.toLowerCase());
    if (!real || implicitSet.has(real.toLowerCase()) || seen.has(real.toLowerCase())) continue;
    ordered.push({ name: real, enabled: entry.enabled });
    seen.add(real.toLowerCase());
  }
  // New plugins: masters before non-masters, appended to the end.
  const fresh = files.filter((f) => !seen.has(f.toLowerCase()) && !implicitSet.has(f.toLowerCase()));
  const info = (name) => {
    try {
      const h = readHeader(path.join(dataDir, name), game.headerSize || 24);
      return { ...h, ...describeFlags(game, name, h.flags) };
    } catch (e) {
      return { error: e.message, masters: [], isMaster: false, isLight: false };
    }
  };
  const enrich = (p) => ({ ...p, ...info(p.name) });
  const freshInfo = fresh.map((f) => enrich({ name: f, enabled: true, isNew: true }));
  const plugins = [
    ...ordered.map(enrich),
    ...freshInfo.filter((p) => p.isMaster),
    ...freshInfo.filter((p) => !p.isMaster),
  ];
  return { implicit: implicit.map((name) => ({ name, enabled: true, implicit: true, ...info(name) })), plugins };
}

// Problems: missing masters, masters loading after dependants, plugin limits.
function analyze(game, scanResult) {
  const { implicit, plugins } = scanResult;
  const issues = [];
  const loaded = [...implicit, ...plugins.filter((p) => p.enabled)];
  const index = new Map(loaded.map((p, i) => [p.name.toLowerCase(), i]));
  loaded.forEach((p, i) => {
    for (const m of p.masters || []) {
      const mi = index.get(m.toLowerCase());
      if (mi === undefined) {
        issues.push({ severity: 'error', plugin: p.name, type: 'missing-master', message: `${p.name} requires ${m}, which is missing or disabled.` });
      } else if (mi > i) {
        issues.push({ severity: 'error', plugin: p.name, type: 'master-order', message: `${p.name} loads before its master ${m}.` });
      }
    }
    if (p.error) issues.push({ severity: 'warning', plugin: p.name, type: 'unreadable', message: `${p.name}: ${p.error}` });
  });
  const full = loaded.filter((p) => !p.isLight && !p.isMedium).length;
  const light = loaded.filter((p) => p.isLight).length;
  if (full > 254) issues.push({ severity: 'error', type: 'limit', message: `${full} full plugins enabled; the engine limit is 254. ESL-flag or merge some.` });
  if (light > 4096) issues.push({ severity: 'error', type: 'limit', message: `${light} light plugins enabled; the limit is 4096.` });
  return { issues, counts: { full, light, total: loaded.length } };
}

// Stable sort: keeps current order but guarantees masters load before plugins that need them,
// and ESM-flagged files ahead of regular plugins.
function autoSort(plugins) {
  const byName = new Map(plugins.map((p) => [p.name.toLowerCase(), p]));
  const result = [];
  const state = new Map();
  const visit = (p) => {
    const key = p.name.toLowerCase();
    if (state.get(key) === 'done' || state.get(key) === 'active') return;
    state.set(key, 'active');
    for (const m of p.masters || []) {
      const dep = byName.get(m.toLowerCase());
      if (dep) visit(dep);
    }
    state.set(key, 'done');
    result.push(p);
  };
  const masters = plugins.filter((p) => p.isMaster);
  const rest = plugins.filter((p) => !p.isMaster);
  masters.forEach(visit);
  rest.forEach(visit);
  return result;
}

module.exports = { readHeader, scan, analyze, autoSort, writePluginsTxt, readPluginsTxt, PLUGIN_RE };
