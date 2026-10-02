// Minecraft automation: WorldPainter scripting, procedural heightmaps, world (level.dat) info,
// datapack installs and Fabric mod projects built with Gradle.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const store = require('../store');
const mods = require('../mods');
const tools = require('../tools');
const archives = require('../archives');
const proc = require('../proc');

// ---------- WorldPainter ----------
function wpscriptPath(gameId) {
  const t = tools.find(gameId, 'worldpainter');
  const dirs = [t && path.dirname(t.path), path.join(process.env.ProgramFiles || '', 'WorldPainter'), path.join(process.env['ProgramFiles(x86)'] || '', 'WorldPainter')].filter(Boolean);
  for (const d of dirs) for (const n of ['wpscript.exe', 'wpscript.cmd', 'wpscript.bat']) if (fs.existsSync(path.join(d, n))) return path.join(d, n);
  return null;
}

async function runWorldPainterScript(gameId, script, args = []) {
  const exe = wpscriptPath(gameId);
  if (!exe) throw new Error('WorldPainter not found. Install it from worldpainter.net (it includes wpscript), or add worldpainter.exe on the Tools page.');
  const file = path.join(store.dataDir('worldpainter'), `script_${Date.now()}.js`);
  fs.writeFileSync(file, script);
  const r = await proc.run(exe, [file, ...args.map(String)], { cwd: path.dirname(exe), timeoutMs: 60 * 60000 });
  return { exitCode: r.code, output: proc.tail(r.output, 120), scriptFile: file };
}

let wpInfoCache = null;
async function worldPainterInfo(gameId) {
  if (wpInfoCache) return wpInfoCache;
  const r = await runWorldPainterScript(gameId, [
    "var pm = Java.type('org.pepsoft.worldpainter.plugins.PlatformManager').getInstance();",
    'var all = pm.getAllPlatforms();',
    "for (var i = 0; i < all.size(); i++) { var p = all.get(i); print('FMT|' + p.id + '|' + p.displayName + '|' + p.minMinHeight + '|' + p.maxMaxHeight); }",
  ].join('\n'));
  const formats = r.output.split(/\r?\n/).filter((l) => l.startsWith('FMT|')).map((l) => {
    const [, id, name, minY, maxY] = l.split('|');
    return { id, name, minBuildLimit: Number(minY), maxBuildLimit: Number(maxY) };
  });
  wpInfoCache = {
    wpscript: wpscriptPath(gameId),
    mapFormats: formats,
    usage: "var fmt = wp.getMapFormat().withId('<id>').go(); then .withMapFormat(fmt) on createWorld(). Pick the newest format that covers the player's Minecraft version.",
    terrainIndices: '0 Grass, 2 Dirt, 3 Coarse Dirt, 4 Podzol, 5 Sand, 6 Red Sand, 9 Mesa, 10 Terracotta, 27 Sandstone, 28 Stone, 29 Rock, 30 Cobblestone, 34 Gravel, 35 Clay, 36 Beaches, 37 Water, 38 Lava, 39 Stone with Snow, 40 Deep Snow, 41 Netherrack, 44 Mycelium, 45 End Stone, 72 Granite, 73 Diorite, 74 Andesite, 75 Stone Mix, 100 Dirt Path, 150 Deepslate, 151 Tuff, 152 Basalt, 157 Calcite, 158 Mud, 160 Moss',
  };
  return wpInfoCache;
}

// ---------- heightmap generator (8-bit grayscale PNG) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodeGray(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const perm = new Uint16Array(512);
  const vals = new Float32Array(256);
  const r = rng(seed);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) vals[i] = r() * 2 - 1;
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const v = (i, j) => vals[perm[(perm[(i & 255)] + (j & 255)) & 511]];
    const u = fade(xf), w = fade(yf);
    const a = v(xi, yi) + u * (v(xi + 1, yi) - v(xi, yi));
    const b = v(xi, yi + 1) + u * (v(xi + 1, yi + 1) - v(xi, yi + 1));
    return a + w * (b - a);
  };
}

const STYLES = ['continent', 'islands', 'archipelago', 'mountains', 'plains', 'valleys', 'canyons'];

function generateHeightmap({ width = 1024, height = 1024, seed = Date.now() % 100000, style = 'continent', scale = 1, roughness = 0.5, seaLevel = 0.35, heightRange = 200 }) {
  width = Math.max(64, Math.min(8192, Math.round(width)));
  height = Math.max(64, Math.min(8192, Math.round(height)));
  if (!STYLES.includes(style)) throw new Error(`style must be one of ${STYLES.join(', ')}`);
  const noise = makeNoise(seed);
  const warp = makeNoise(seed + 77);
  const base = 1 / (256 * scale);
  const gain = 0.35 + roughness * 0.3;
  const fbm = (x, y, oct = 6, ridged = false) => {
    let f = base, a = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      let n = noise(x * f, y * f);
      if (ridged) n = 1 - Math.abs(n) * 2;
      sum += n * a;
      norm += a;
      f *= 2.02;
      a *= gain;
    }
    return sum / norm;
  };
  const out = new Float32Array(width * height);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const wx = x + warp(x * base * 2, y * base * 2) * 60 * scale;
      const wy = y + warp(x * base * 2 + 31, y * base * 2 + 17) * 60 * scale;
      const nx = x / width - 0.5, ny = y / height - 0.5;
      const d = Math.sqrt(nx * nx + ny * ny) * 2;
      let h = fbm(wx, wy) * 0.5 + 0.5;
      switch (style) {
        case 'continent': h = h * 0.75 + 0.35 - d * 0.55; break;
        case 'islands': h = h * 0.9 + 0.15 - d * 0.35; h = h > 0.45 ? 0.45 + (h - 0.45) * 1.6 : h; break;
        case 'archipelago': h = fbm(wx * 2.5, wy * 2.5) * 0.5 + 0.5; h = h * 1.1 - 0.12; break;
        case 'mountains': h = h * 0.4 + Math.pow(Math.max(0, fbm(wx, wy, 7, true)), 2) * 0.75 + 0.1; break;
        case 'plains': h = 0.42 + (h - 0.5) * 0.25 + fbm(wx * 0.3, wy * 0.3) * 0.08; break;
        case 'valleys': h = 0.3 + (1 - Math.pow(Math.max(0, fbm(wx * 0.6, wy * 0.6, 5, true)), 1.5)) * 0.55 + (h - 0.5) * 0.2; break;
        case 'canyons': { const r = fbm(wx * 0.5, wy * 0.5, 4, true); h = r > 0.75 ? 0.25 + (1 - r) * 0.6 : 0.55 + (h - 0.5) * 0.2; break; }
      }
      out[y * width + x] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  const px = Buffer.alloc(width * height);
  let water = 0;
  const seaValue = Math.round(seaLevel * 255);
  for (let i = 0; i < out.length; i++) {
    const v = Math.round(((out[i] - min) / (max - min || 1)) * 255);
    px[i] = v;
    if (v < seaValue) water++;
  }
  const file = path.join(store.dataDir('heightmaps'), `heightmap_${style}_${seed}_${width}x${height}.png`);
  fs.writeFileSync(file, encodeGray(width, height, px));
  const lo = Math.round(62 - seaLevel * heightRange);
  return {
    file, width, height, seed, style,
    waterCoverage: `${Math.round((100 * water) / out.length)}%`,
    worldPainterMapping: `.fromLevels(0, 255).toLevels(${lo}, ${lo + heightRange}) with water level 62 puts pixel value ${seaValue} at sea level`,
  };
}

// ---------- NBT / worlds ----------
function readNbt(buf) {
  let o = 0;
  const u8 = () => buf[o++];
  const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; };
  const payload = (t) => {
    switch (t) {
      case 1: return buf.readInt8(o++);
      case 2: return i16();
      case 3: return i32();
      case 4: { const v = buf.readBigInt64BE(o); o += 8; return Number(v); }
      case 5: { const v = buf.readFloatBE(o); o += 4; return v; }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 7: { const n = i32(); o += n; return `[${n} bytes]`; }
      case 8: return str();
      case 9: { const et = u8(); const n = i32(); const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a; }
      case 10: { const obj = {}; for (;;) { const ct = u8(); if (ct === 0) return obj; const name = str(); obj[name] = payload(ct); } }
      case 11: { const n = i32(); o += n * 4; return `[${n} ints]`; }
      case 12: { const n = i32(); o += n * 8; return `[${n} longs]`; }
      default: throw new Error(`Bad NBT tag ${t}`);
    }
  };
  const type = u8();
  str();
  return payload(type);
}

function savesDir(gameId) {
  return path.join(mods.game(gameId).installDir, 'saves');
}

function listWorlds(gameId) {
  const dir = savesDir(gameId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
    const w = { folder: e.name, path: path.join(dir, e.name) };
    try {
      const data = readNbt(zlib.gunzipSync(fs.readFileSync(path.join(w.path, 'level.dat')))).Data;
      Object.assign(w, {
        name: data.LevelName, version: data.Version?.Name, gameType: ['survival', 'creative', 'adventure', 'spectator'][data.GameType] ?? data.GameType,
        hardcore: !!data.hardcore, lastPlayed: data.LastPlayed ? new Date(data.LastPlayed).toISOString() : null,
        datapacksEnabled: data.DataPacks?.Enabled, datapacksDisabled: data.DataPacks?.Disabled,
      });
    } catch (err) {
      w.error = `level.dat unreadable: ${err.message}`;
    }
    try { w.datapackFiles = fs.readdirSync(path.join(w.path, 'datapacks')); } catch { w.datapackFiles = []; }
    return w;
  });
}

function installDatapack(gameId, sourcePath, worldFolder) {
  const world = path.join(savesDir(gameId), worldFolder);
  if (!fs.existsSync(path.join(world, 'level.dat'))) throw new Error(`World "${worldFolder}" not found in saves.`);
  const dest = path.join(world, 'datapacks', path.basename(sourcePath));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(sourcePath, dest, { recursive: true });
  return { installed: dest, note: 'Run /reload in the world (or reopen it) to load the datapack.' };
}

// ---------- Fabric mod projects ----------
let branchCache = null;
async function fabricBranches() {
  if (branchCache) return branchCache;
  const res = await fetch('https://api.github.com/repos/FabricMC/fabric-example-mod/branches?per_page=100', { headers: { 'User-Agent': 'Shuriken' } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  branchCache = (await res.json()).map((b) => b.name);
  return branchCache;
}

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function createFabricProject(dir, mcVersion) {
  const branches = (await fabricBranches()).filter((b) => /^\d+(\.\d+)*$/.test(b));
  const branch = branches.includes(mcVersion) ? mcVersion : branches.filter((b) => cmpVersion(b, mcVersion) <= 0).sort(cmpVersion).pop();
  if (!branch) throw new Error(`No Fabric template for Minecraft ${mcVersion}`);
  const res = await fetch(`https://codeload.github.com/FabricMC/fabric-example-mod/zip/refs/heads/${branch}`, { headers: { 'User-Agent': 'Shuriken' } });
  if (!res.ok) throw new Error(`Template download failed: HTTP ${res.status}`);
  const zip = path.join(os.tmpdir(), `fabric-template-${Date.now()}.zip`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-template-'));
  await archives.extract(zip, tmp);
  const inner = fs.readdirSync(tmp).map((n) => path.join(tmp, n)).find((p) => fs.statSync(p).isDirectory());
  fs.cpSync(inner, dir, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  return { templateBranch: branch, files: mods.walk(dir).filter((f) => !f.startsWith('.git')).slice(0, 80) };
}

function jdkVersion(home) {
  try {
    const m = fs.readFileSync(path.join(home, 'release'), 'utf8').match(/JAVA_VERSION="(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

// Downloads a portable Eclipse Temurin JDK into Shuriken's data folder (no system install).
async function portableJdk(major) {
  const root = store.dataDir('jdk', String(major));
  const existing = fs.readdirSync(root).map((n) => path.join(root, n)).find((p) => fs.existsSync(path.join(p, 'bin', 'javac.exe')));
  if (existing) return existing;
  const zip = path.join(os.tmpdir(), `temurin-${major}.zip`);
  const res = await fetch(`https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jdk/hotspot/normal/eclipse`, { headers: { 'User-Agent': 'Shuriken' } });
  if (!res.ok) throw new Error(`Could not download Java ${major}: HTTP ${res.status}`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  await archives.extract(zip, root);
  fs.rmSync(zip, { force: true });
  const home = fs.readdirSync(root).map((n) => path.join(root, n)).find((p) => fs.existsSync(path.join(p, 'bin', 'javac.exe')));
  if (!home) throw new Error(`Java ${major} download did not contain a JDK`);
  return home;
}

// Newest JDK on this PC (or Shuriken's portable ones).
function findJdk() {
  const candidates = [];
  try {
    const jdkRoot = store.dataDir('jdk');
    for (const v of fs.readdirSync(jdkRoot)) for (const n of fs.readdirSync(path.join(jdkRoot, v))) candidates.push(path.join(jdkRoot, v, n));
  } catch {
    // none downloaded
  }
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);
  try {
    for (const line of execFileSync('where', ['javac'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)) if (line.trim()) candidates.push(path.dirname(path.dirname(line.trim())));
  } catch {
    // javac not on PATH
  }
  for (const root of ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Zulu']) {
    try {
      for (const n of fs.readdirSync(root)) candidates.push(path.join(root, n));
    } catch {
      // not installed
    }
  }
  return candidates
    .filter((c) => fs.existsSync(path.join(c, 'bin', 'javac.exe')))
    .sort((a, b) => jdkVersion(b) - jdkVersion(a))[0] || null;
}

async function gradleBuild(dir) {
  const gradlew = path.join(dir, 'gradlew.bat');
  if (!fs.existsSync(gradlew)) throw new Error('This project has no gradlew.bat.');
  let jdk = findJdk() || (await portableJdk(21));
  const build = () => proc.run('cmd.exe', ['/d', '/c', gradlew, 'build', '--no-daemon', '--console=plain'], { cwd: dir, env: { JAVA_HOME: jdk }, timeoutMs: 40 * 60000 });
  let r = await build();
  // Newer Fabric Loom / Minecraft versions need a newer Java than the PC has: fetch it and retry.
  const need = Number(r.output.match(/at least JVM runtime version (\d+)/)?.[1] || r.output.match(/requires Java (\d+)/i)?.[1] || 0);
  if (r.code !== 0 && need > jdkVersion(jdk)) {
    jdk = await portableJdk(need);
    r = await build();
  }
  const libs = path.join(dir, 'build', 'libs');
  const jars = fs.existsSync(libs) ? fs.readdirSync(libs).filter((f) => f.endsWith('.jar') && !/-(sources|dev|javadoc)\.jar$/.test(f)).map((f) => path.join(libs, f)) : [];
  return { ok: r.code === 0 && jars.length > 0, exitCode: r.code, jdk, jars, output: proc.tail(r.output, r.code === 0 ? 25 : 120) };
}

module.exports = { runWorldPainterScript, wpscriptPath, worldPainterInfo, generateHeightmap, STYLES, listWorlds, installDatapack, savesDir, createFabricProject, gradleBuild, findJdk };
