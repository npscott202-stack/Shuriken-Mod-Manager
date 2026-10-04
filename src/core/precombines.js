// Precombine / previs analysis for Fallout 4 (and Fallout 4 VR).
//
// Fallout 4 merges static objects of a cell into "precombined" meshes (CELL XCRI lists the
// references baked into them, PCMB is the build timestamp) and pre-computes visibility (previs).
// When a plugin loaded after the one that built a cell's precombines edits, moves or deletes one
// of those references, the engine drops the precombines for the whole cell: big FPS loss, and
// previs breaks (flickering / invisible objects). This module walks the active load order and
// reports which plugins break which cells, which previs patches are overridden by older data,
// and suggests load-order fixes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const store = require('./store');
const mods = require('./mods');
const plugins = require('./plugins');

const SUPPORTED = new Set(['fallout4', 'fallout4vr']);
const CACHE_VERSION = 3;
const PREVIS_REPAIR = { id: 46403, name: 'Previsibines Repair Pack (PRP)', plugins: ['prp.esp', 'ppf.esm'] };

// ---------- plugin reader ----------
function readSubrecords(data) {
  const out = [];
  let p = 0;
  let big = 0;
  while (p + 6 <= data.length) {
    const type = data.toString('latin1', p, p + 4);
    let size = data.readUInt16LE(p + 4);
    p += 6;
    if (type === 'XXXX') { big = data.readUInt32LE(p); p += size; continue; }
    if (big) { size = big; big = 0; }
    out.push([type, data.subarray(p, p + size)]);
    p += size;
  }
  return out;
}

function recordData(buf, off, size, flags) {
  const raw = buf.subarray(off + 24, off + 24 + size);
  if (flags & 0x00040000) return zlib.inflateSync(raw.subarray(4));
  return raw;
}

// Parses one plugin: its masters, every CELL record it contains (with precombine data) and
// the placed references (REFR) it overrides inside cells.
function parsePlugin(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('latin1', 0, 4) !== 'TES4') throw new Error('not a plugin');
  const tes4Size = buf.readUInt32LE(4);
  const masters = [];
  for (const [t, d] of readSubrecords(recordData(buf, 0, tes4Size, buf.readUInt32LE(8)))) if (t === 'MAST') masters.push(d.toString('latin1').replace(/\0.*$/s, ''));
  const cells = []; // [fid, pcmb, visi, xcri[] | null, edid, x, y, interior]
  const refs = []; // [fid, cellFid, flags]  (overrides only)
  const newRefs = {}; // cellFid -> count of new references added
  const selfIndex = masters.length;
  const end = buf.length;
  const stack = []; // [endOffset, type, label]
  let p = 24 + tes4Size;
  while (p + 24 <= end) {
    while (stack.length && p >= stack[stack.length - 1][0]) stack.pop();
    const type = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (type === 'GRUP') {
      stack.push([p + size, buf.readInt32LE(p + 12), buf.readUInt32LE(p + 8)]);
      p += 24;
      continue;
    }
    const flags = buf.readUInt32LE(p + 8);
    const fid = buf.readUInt32LE(p + 12);
    if (type === 'CELL') {
      let pcmb = 0;
      let visi = 0;
      let xcri = null;
      let edid = '';
      let x = null;
      let y = null;
      let interior = false;
      try {
        for (const [t, d] of readSubrecords(recordData(buf, p, size, flags))) {
          if (t === 'EDID') edid = d.toString('latin1').replace(/\0.*$/s, '');
          else if (t === 'DATA' && d.length >= 1) interior = !!(d[0] & 1);
          else if (t === 'XCLC' && d.length >= 8) { x = d.readInt32LE(0); y = d.readInt32LE(4); }
          else if (t === 'PCMB' && d.length >= 2) pcmb = d.length >= 4 ? d.readUInt32LE(0) : d.readUInt16LE(0);
          else if (t === 'VISI' && d.length >= 2) visi = d.length >= 4 ? d.readUInt32LE(0) : d.readUInt16LE(0);
          else if (t === 'XCRI' && d.length >= 8) {
            // mesh count, entry count, mesh hashes, then (reference, mesh) pairs
            const start = 8 + d.readUInt32LE(0) * 4;
            xcri = [];
            for (let i = start; i + 8 <= d.length; i += 8) xcri.push(d.readUInt32LE(i));
          }
        }
      } catch {
        // unreadable cell record: keep what we have
      }
      cells.push([fid, pcmb, visi, xcri, edid, x, y, interior]);
    } else if (type === 'REFR') {
      const parent = stack.length ? stack[stack.length - 1] : null;
      if (parent && (parent[1] === 8 || parent[1] === 9)) {
        if ((fid >>> 24) < selfIndex) refs.push([fid, parent[2], flags]);
        else newRefs[parent[2]] = (newRefs[parent[2]] || 0) + 1;
      }
    }
    p += 24 + size;
  }
  return { masters, cells, refs, newRefs };
}

const memo = new Map();

function cachedParse(file) {
  const st = fs.statSync(file);
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (memo.has(key)) return memo.get(key);
  const dir = store.dataDir('cache', 'precombines');
  const cacheFile = path.join(dir, `${path.basename(file).replace(/[^\w.-]+/g, '_')}-${st.size}-${Math.round(st.mtimeMs)}-v${CACHE_VERSION}.json`);
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    parsed = parsePlugin(file);
    // Only worth caching the big ones; small plugins parse in milliseconds.
    if (st.size > 5 * 1024 * 1024) {
      for (const f of fs.readdirSync(dir)) if (f.startsWith(`${path.basename(file).replace(/[^\w.-]+/g, '_')}-`)) fs.rmSync(path.join(dir, f), { force: true });
      fs.writeFileSync(cacheFile, JSON.stringify(parsed));
    }
  }
  memo.set(key, parsed);
  return parsed;
}

// ---------- load order ----------
function activeLoadOrder(gameId) {
  const g = mods.game(gameId);
  const scan = plugins.scan(g);
  const files = g.pluginFiles ? g.pluginFiles() : null;
  const dataDir = path.join(g.installDir, 'Data');
  const resolve = (name) => {
    const hit = files?.get(name.toLowerCase());
    if (hit) return hit.path;
    return path.join(dataDir, name);
  };
  const official = new Set(scan.implicit.map((p) => p.name.toLowerCase()));
  return [...scan.implicit, ...scan.plugins]
    .filter((p) => p.enabled)
    .map((p) => ({ name: p.name, file: resolve(p.name), master: !!p.isMaster || /\.esm$/i.test(p.name), official: official.has(p.name.toLowerCase()) || /^(dlc|cc[a-z]{3}fo4)/i.test(p.name) }))
    .filter((p) => fs.existsSync(p.file));
}

function cellLabel(c) {
  if (c.edid) return c.edid;
  if (c.x !== null && c.x !== undefined) return `Exterior (${c.x}, ${c.y})`;
  return 'Unnamed cell';
}

// ---------- analysis ----------
async function analyze(gameId, { onProgress } = {}) {
  if (!SUPPORTED.has(gameId)) {
    const name = mods.game(gameId).name;
    if (gameId === 'starfield') throw new Error('Starfield precombines are not supported yet: its plugin format and Creation Kit tooling differ from Fallout 4.');
    throw new Error(`${name} has no precombined meshes / previs system to repair (that is a Fallout 4 engine feature).`);
  }
  const g = mods.game(gameId);
  if (!g.installDir) throw new Error('Set the game folder first.');
  const order = activeLoadOrder(gameId);
  const lowerIndex = new Map(order.map((p, i) => [p.name.toLowerCase(), i]));
  const state = new Map(); // cellKey -> { pcmb, visi, xcri:Set, setBy, winner, history:Map(pcmb->pluginIdx), label, interior }
  const breaches = []; // { plugin, cell, ref, deleted }
  const disabled = []; // { plugin, cell, from }
  const reverts = []; // { plugin, cell, olderFrom, newerFrom }
  const parsedMasters = [];
  const errors = [];
  let t = Date.now();
  for (let i = 0; i < order.length; i++) {
    const pl = order[i];
    if (onProgress && Date.now() - t > 250) { onProgress({ done: i, total: order.length, plugin: pl.name }); t = Date.now(); await new Promise((r) => setImmediate(r)); }
    let data;
    try {
      data = cachedParse(pl.file);
    } catch (err) {
      errors.push({ plugin: pl.name, error: err.message });
      continue;
    }
    const names = [...data.masters.map((m) => m.toLowerCase()), pl.name.toLowerCase()];
    parsedMasters[i] = data.masters;
    const key = (fid) => `${names[Math.min(fid >>> 24, names.length - 1)]}:${(fid & 0xffffff).toString(16)}`;
    for (const [fid, pcmb, visi, xcri, edid, x, y, interior] of data.cells) {
      const k = key(fid);
      const prev = state.get(k);
      const xset = xcri ? new Set(xcri.map(key)) : null;
      if (!prev) {
        state.set(k, { pcmb, visi, xcri: xset, setBy: i, winner: i, history: new Map(pcmb ? [[pcmb, i]] : []), label: cellLabel({ edid, x, y }), interior });
        continue;
      }
      if (edid && !prev.label.startsWith(edid)) prev.label = edid;
      if (pl.official) {
        // Official DLC / Creation Club edits are the game's own baseline.
        Object.assign(prev, { pcmb, visi, xcri: pcmb ? xset : null, setBy: i, winner: i, history: new Map(pcmb ? [[pcmb, i]] : []) });
        continue;
      }
      if (prev.pcmb && !pcmb) disabled.push({ plugin: i, cell: k, from: prev.setBy });
      if (pcmb && pcmb !== prev.pcmb) {
        const earlier = prev.history.get(pcmb);
        if (earlier !== undefined && earlier !== i) {
          if (prev.setBy !== earlier) reverts.push({ plugin: i, cell: k, olderFrom: earlier, newerFrom: prev.setBy });
          prev.setBy = earlier;
        } else {
          prev.setBy = i;
          prev.history.set(pcmb, i);
        }
      }
      if (!pcmb) prev.setBy = i;
      prev.pcmb = pcmb;
      prev.visi = visi;
      prev.xcri = pcmb ? xset : null;
      prev.winner = i;
    }
    for (const [fid, cellFid, flags] of pl.official ? [] : data.refs) {
      const ck = key(cellFid);
      const cell = state.get(ck);
      if (!cell || !cell.pcmb || !cell.xcri || cell.setBy === i) continue;
      const rk = key(fid);
      if (cell.xcri.has(rk)) breaches.push({ plugin: i, cell: ck, ref: rk, deleted: !!(flags & 0x20) });
    }
  }
  onProgress?.({ done: order.length, total: order.length });

  // A breach is repaired when a plugin loaded later rebuilt that cell's precombines with the
  // breaking plugin as a master; rebuilt without it, the edit is at least not breaking the cell.
  const brokenCells = new Map(); // cellKey -> Set(pluginIdx)
  const fixedBy = new Map();
  for (const b of breaches) {
    const cell = state.get(b.cell);
    if (!cell.pcmb) continue; // cell has no precombines in the end anyway (reported as disabled)
    if (cell.setBy > b.plugin) {
      const masters = (parsedMasters[cell.setBy] || []).map((m) => m.toLowerCase());
      if (!fixedBy.has(b.cell)) fixedBy.set(b.cell, { by: cell.setBy, includes: new Set() });
      if (masters.includes(order[b.plugin].name.toLowerCase())) fixedBy.get(b.cell).includes.add(b.plugin);
      continue;
    }
    if (!brokenCells.has(b.cell)) brokenCells.set(b.cell, new Set());
    brokenCells.get(b.cell).add(b.plugin);
  }
  const finalDisabled = new Map();
  for (const d of disabled) {
    const cell = state.get(d.cell);
    if (!cell.pcmb && cell.winner >= d.plugin) finalDisabled.set(d.cell, d.plugin);
  }
  const finalReverts = reverts.filter((r) => state.get(r.cell).setBy === r.olderFrom);

  const byPlugin = new Map();
  const bump = (idx, field) => {
    const name = order[idx].name;
    if (!byPlugin.has(name)) byPlugin.set(name, { plugin: name, index: idx, breaksCells: 0, disablesCells: 0, revertsCells: 0 });
    byPlugin.get(name)[field]++;
  };
  for (const set of brokenCells.values()) for (const i of set) bump(i, 'breaksCells');
  for (const i of finalDisabled.values()) bump(i, 'disablesCells');
  for (const r of finalReverts) bump(r.plugin, 'revertsCells');

  // Load-order suggestions: when a previs patch is overridden by older data from a plugin that
  // loads after it, moving the patch below that plugin restores the newer precombines.
  const rebuilt = new Map();
  for (const c of state.values()) if (c.pcmb) rebuilt.set(c.setBy, (rebuilt.get(c.setBy) || 0) + 1);
  const isPrevisPatch = (i) => (rebuilt.get(i) || 0) >= 20 || /prp|previs|precomb/i.test(order[i].name);
  const suggestions = new Map();
  for (const r of finalReverts) {
    const patch = order[r.newerFrom].name;
    const after = order[r.plugin].name;
    // Masters must stay in the master block, official files stay put, and a big previs patch
    // overriding a small one is usually deliberate.
    if (order[r.newerFrom].official || (order[r.newerFrom].master && !order[r.plugin].master) || isPrevisPatch(r.plugin)) continue;
    const patchMasters = (parsedMasters[r.plugin] || []).map((m) => m.toLowerCase());
    if (patchMasters.includes(patch.toLowerCase())) continue; // `after` needs `patch` first
    const k = `${patch}>${after}`;
    if (!suggestions.has(k)) suggestions.set(k, { move: patch, after, cells: 0 });
    suggestions.get(k).cells++;
  }

  const cellsWithPrecombines = [...state.values()].filter((c) => c.pcmb).length;
  const cellDetails = [];
  for (const [k, set] of brokenCells) cellDetails.push({ cell: state.get(k).label, problem: 'broken', plugins: [...set].map((i) => order[i].name), builtBy: order[state.get(k).setBy].name });
  for (const [k, i] of finalDisabled) cellDetails.push({ cell: state.get(k).label, problem: 'disabled', plugins: [order[i].name] });
  for (const r of finalReverts) cellDetails.push({ cell: state.get(r.cell).label, problem: 'reverted', plugins: [order[r.plugin].name], builtBy: order[r.newerFrom].name });
  const active = new Set(order.map((p) => p.name.toLowerCase()));
  return {
    plugins: order.length,
    cellsWithPrecombines,
    brokenCells: brokenCells.size,
    disabledCells: finalDisabled.size,
    revertedCells: finalReverts.length,
    repairedCells: fixedBy.size,
    prpInstalled: PREVIS_REPAIR.plugins.some((p) => active.has(p)),
    prp: PREVIS_REPAIR,
    offenders: [...byPlugin.values()].filter((o) => o.breaksCells || o.disablesCells || o.revertsCells).sort((a, b) => (b.breaksCells + b.disablesCells + b.revertsCells) - (a.breaksCells + a.disablesCells + a.revertsCells)),
    previsPatches: [...rebuilt.entries()].filter(([i]) => !order[i].official).map(([i, cells]) => ({ plugin: order[i].name, cells })).sort((a, b) => b.cells - a.cells).slice(0, 40),
    suggestions: [...suggestions.values()].sort((a, b) => b.cells - a.cells),
    cells: cellDetails.slice(0, 400),
    errors,
  };
}

// Moves each previs patch to just after the plugin that overrides it (only when masters allow it).
function applySuggestions(gameId, suggestions) {
  const g = mods.game(gameId);
  const scan = plugins.scan(g);
  const list = scan.plugins.map((p) => ({ name: p.name, enabled: p.enabled }));
  const moved = [];
  for (const s of suggestions) {
    const from = list.findIndex((p) => p.name.toLowerCase() === s.move.toLowerCase());
    const target = list.findIndex((p) => p.name.toLowerCase() === s.after.toLowerCase());
    if (from < 0 || target < 0 || from > target) continue;
    const [item] = list.splice(from, 1);
    const at = list.findIndex((p) => p.name.toLowerCase() === s.after.toLowerCase());
    list.splice(at + 1, 0, item);
    moved.push(`${s.move} → after ${s.after}`);
  }
  if (!moved.length) return { moved };
  mods.savePluginOrder(gameId, list);
  return { moved };
}

module.exports = { analyze, applySuggestions, parsePlugin, cachedParse, activeLoadOrder, SUPPORTED, PREVIS_REPAIR };
