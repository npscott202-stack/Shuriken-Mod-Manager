// Shuriken Engine: a built-in local AI runtime (llama.cpp's llama-server, Vulkan build) that
// Shuriken downloads, starts and stops itself. Works on NVIDIA, AMD and Intel GPUs, falls back
// to the CPU, and speaks the OpenAI chat API (streaming, tool calls, images).
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFile } = require('child_process');
const store = require('./store');
const archives = require('./archives');

const MODELS = {
  'qwen3-vl-2b': {
    page: 'https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF',
    label: 'Qwen3-VL 2B Instruct · built in, runs on any PC',
    about: 'Ships with the installer. Fast; best for quick questions and reading screenshots.',
    sizeGB: 1.6,
    minVramGB: 2,
    files: [
      { name: 'Qwen3VL-2B-Instruct-Q4_K_M.gguf', url: 'https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3VL-2B-Instruct-Q4_K_M.gguf', role: 'model' },
      { name: 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf', url: 'https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf', role: 'mmproj' },
    ],
  },
  'qwen3-vl-8b': {
    page: 'https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF',
    label: 'Qwen3-VL 8B Instruct · best quality',
    about: 'Much better at multi-step fixes, playtests and reading busy screenshots. Needs an 8 GB+ graphics card.',
    sizeGB: 5.8,
    minVramGB: 7,
    files: [
      { name: 'Qwen3VL-8B-Instruct-Q4_K_M.gguf', url: 'https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/main/Qwen3VL-8B-Instruct-Q4_K_M.gguf', role: 'model' },
      { name: 'mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf', url: 'https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf', role: 'mmproj' },
    ],
  },
  'qwen3-vl-4b': {
    page: 'https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF',
    label: 'Qwen3-VL 4B Instruct · faster, for 4–6 GB GPUs',
    about: 'A good step up from the built-in model for 4-6 GB graphics cards.',
    sizeGB: 3.0,
    minVramGB: 4,
    files: [
      { name: 'Qwen3VL-4B-Instruct-Q4_K_M.gguf', url: 'https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf', role: 'model' },
      { name: 'mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf', url: 'https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf', role: 'mmproj' },
    ],
  },
};
const DEFAULT_MODEL = 'qwen3-vl-2b';
// Best first: the AI uses the strongest model present unless the user picked one.
const PREFERENCE = ['qwen3-vl-8b', 'qwen3-vl-4b', 'qwen3-vl-2b'];
const CONTEXT = 12288;
const UA = { 'User-Agent': 'Shuriken (desktop mod manager)' };

const engineDir = () => store.dataDir('engine');
const modelsDir = () => store.dataDir('models');

// The installer ships the engine and the 2B model in resourcesi, so the AI works offline right
// after install. Downloaded engines/models in the data folder take precedence.
function bundledDir() {
  const candidates = [process.resourcesPath && path.join(process.resourcesPath, 'ai'), path.join(__dirname, '..', '..', 'ai-bundle')].filter(Boolean);
  return candidates.find((d) => fs.existsSync(path.join(d, 'engine', 'llama-server.exe'))) || null;
}

function modelFile(name) {
  const own = path.join(modelsDir(), name);
  if (fs.existsSync(own)) return own;
  const b = bundledDir();
  const shipped = b && path.join(b, 'models', name);
  return shipped && fs.existsSync(shipped) ? shipped : own;
}

function builtIn(id) {
  const b = bundledDir();
  return !!b && MODELS[id].files.every((f) => fs.existsSync(path.join(b, 'models', f.name)));
}

// ---------- engine binaries ----------
function installedBuild() {
  const dir = engineDir();
  const builds = fs.readdirSync(dir).filter((n) => /^b\d+$/.test(n) && fs.existsSync(path.join(dir, n, 'llama-server.exe')));
  builds.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  if (builds[0]) return { build: builds[0], exe: path.join(dir, builds[0], 'llama-server.exe') };
  const b = bundledDir();
  return b ? { build: 'built-in', exe: path.join(b, 'engine', 'llama-server.exe') } : null;
}

async function downloadFile(url, dest, onProgress = () => {}, label = '', signal) {
  const part = `${dest}.part`;
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const res = await fetch(url, { headers: { ...UA, ...(have ? { Range: `bytes=${have}-` } : {}) }, redirect: 'follow', signal });
  if (!res.ok && res.status !== 206) throw new Error(`Download failed (${res.status}) for ${path.basename(dest)}`);
  const resumed = res.status === 206;
  const total = Number(res.headers.get('content-length') || 0) + (resumed ? have : 0);
  const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
  let done = resumed ? have : 0;
  let last = 0;
  try {
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      done += chunk.length;
      if (Date.now() - last > 300) {
        last = Date.now();
        onProgress({ label, done, total });
      }
    }
  } finally {
    // Keep the .part file so a cancelled or failed download resumes where it stopped.
    await new Promise((resolve) => out.end(resolve));
  }
  fs.renameSync(part, dest);
  onProgress({ label, done, total });
}

// Downloads the newest llama.cpp Vulkan build (≈35 MB) if none is installed.
async function installEngine(onProgress) {
  const have = installedBuild();
  if (have) return have;
  const res = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', { headers: UA });
  if (!res.ok) throw new Error(`Could not reach GitHub (${res.status}) to download the AI engine.`);
  const rel = await res.json();
  const asset = rel.assets.find((a) => /bin-win-vulkan-x64\.zip$/.test(a.name));
  if (!asset) throw new Error('No Windows build found in the latest llama.cpp release.');
  const build = (asset.name.match(/llama-(b\d+)-/) || [])[1] || rel.tag_name;
  const zip = path.join(engineDir(), asset.name);
  await downloadFile(asset.browser_download_url, zip, onProgress, 'AI engine');
  const target = path.join(engineDir(), build);
  await archives.extract(zip, target);
  fs.rmSync(zip, { force: true });
  return installedBuild();
}

// ---------- models ----------
function modelPaths(id) {
  const m = MODELS[id];
  if (!m) throw new Error(`Unknown model ${id}`);
  const p = (role) => modelFile(m.files.find((f) => f.role === role).name);
  return { model: p('model'), mmproj: p('mmproj') };
}

function modelInstalled(id) {
  return MODELS[id].files.every((f) => fs.existsSync(modelFile(f.name)));
}

// The model to use: the user's choice if it is installed, else the best installed one.
function resolveModel(preferred) {
  if (preferred && MODELS[preferred] && modelInstalled(preferred)) return preferred;
  return PREFERENCE.find((id) => modelInstalled(id)) || (MODELS[preferred] ? preferred : DEFAULT_MODEL);
}

async function installModel(id, onProgress, signal) {
  for (const f of MODELS[id].files) {
    const dest = path.join(modelsDir(), f.name);
    if (!fs.existsSync(modelFile(f.name))) await downloadFile(f.url, dest, onProgress, f.role === 'model' ? 'AI model' : 'Screenshot reader', signal);
  }
}

// Adds model files the user downloaded by hand (from the model's Hugging Face page).
function importModelFiles(paths) {
  const known = new Map();
  for (const [id, m] of Object.entries(MODELS)) for (const f of m.files) known.set(f.name.toLowerCase(), { id, name: f.name });
  const added = [];
  const unknown = [];
  for (const p of paths) {
    const hit = known.get(path.basename(p).toLowerCase());
    if (!hit) { unknown.push(path.basename(p)); continue; }
    const dest = path.join(modelsDir(), hit.name);
    if (path.resolve(p).toLowerCase() !== path.resolve(dest).toLowerCase()) fs.copyFileSync(p, dest);
    added.push(hit);
  }
  const complete = [...new Set(added.map((a) => a.id))].filter((id) => modelInstalled(id));
  return { added: added.map((a) => a.name), unknown, complete };
}

function modelsFolder() {
  return modelsDir();
}

function removeModel(id) {
  if (server && server.modelId === id) stop();
  for (const f of MODELS[id].files) fs.rmSync(path.join(modelsDir(), f.name), { force: true });
}

// ---------- GPU choice ----------
let deviceCache = null;
function listDevices(exe) {
  if (deviceCache) return Promise.resolve(deviceCache);
  return new Promise((resolve) => {
    execFile(exe, ['--list-devices'], { windowsHide: true, timeout: 30000 }, (_e, stdout = '', stderr = '') => {
      const devices = [];
      for (const m of `${stdout}\n${stderr}`.matchAll(/^\s*(Vulkan\d+|CUDA\d+):\s*(.+?)\s*\((\d+) MiB,\s*(\d+) MiB free\)/gm)) {
        devices.push({ id: m[1], name: m[2], totalMB: Number(m[3]), freeMB: Number(m[4]) });
      }
      deviceCache = devices;
      resolve(devices);
    });
  });
}

// Dedicated GPUs beat integrated ones even when the integrated GPU reports more (shared) memory.
function deviceScore(d) {
  const n = d.name.toLowerCase();
  if (/nvidia|geforce|rtx|quadro/.test(n)) return 3;
  if (/radeon (rx|pro)|rx \d{3,4}/.test(n)) return 3;
  if (/arc\(tm\) [ab]\d|arc [ab]\d/.test(n)) return 2;
  return 1;
}

function pickDevice(devices) {
  return [...devices].sort((a, b) => deviceScore(b) - deviceScore(a) || b.freeMB - a.freeMB)[0] || null;
}

// ---------- server lifecycle ----------
let server = null; // { proc, port, modelId, ready: Promise, device, log }
let idleTimer = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function waitHealthy(port, proc, timeoutMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) return false;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return true;
    } catch {
      // still loading
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function bumpIdle() {
  clearTimeout(idleTimer);
  // Free the GPU after 20 idle minutes so games get their VRAM back.
  idleTimer = setTimeout(() => stop(), 20 * 60 * 1000);
}

// Serialized so a warm-up and a chat request can never launch two engines.
let startLock = Promise.resolve();
function start(modelId = DEFAULT_MODEL) {
  const run = startLock.then(() => startUnlocked(modelId));
  startLock = run.catch(() => {});
  return run;
}

async function startUnlocked(modelId) {
  if (server && server.modelId === modelId && server.proc.exitCode === null) {
    await server.ready;
    bumpIdle();
    return server;
  }
  stop();
  const eng = installedBuild();
  if (!eng) throw new Error('The AI engine is not installed yet. Open Settings → AI assistant and click "Set up Shuriken AI".');
  if (!modelInstalled(modelId)) throw new Error('The AI model is not downloaded yet. Open Settings → AI assistant and click "Set up Shuriken AI".');
  const { model, mmproj } = modelPaths(modelId);
  const device = pickDevice(await listDevices(eng.exe));
  const port = await freePort();
  const args = ['-m', model, '--mmproj', mmproj, '--host', '127.0.0.1', '--port', String(port), '-c', String(CONTEXT),
    '--jinja', '-fa', 'auto', '-ctk', 'q8_0', '-ctv', 'q8_0', '--no-webui', '-np', '1', '--fit', 'on'];
  if (device) args.push('--device', device.id);
  const logFile = path.join(store.dataDir('logs'), 'engine.log');
  const log = fs.createWriteStream(logFile, { flags: 'w' });
  const proc = spawn(eng.exe, args, { cwd: path.dirname(eng.exe), windowsHide: true });
  proc.stdout.pipe(log);
  proc.stderr.pipe(log);
  server = { proc, port, modelId, device, logFile };
  server.ready = waitHealthy(port, proc).then((ok) => {
    if (!ok) {
      const tail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-12).join('\n') : '';
      stop();
      throw new Error(`The AI engine failed to start. Last log lines:\n${tail}`);
    }
    return server;
  });
  proc.on('exit', () => {
    if (server?.proc === proc) server = null;
  });
  await server.ready;
  bumpIdle();
  return server;
}

function stop() {
  clearTimeout(idleTimer);
  if (server?.proc && server.proc.exitCode === null) server.proc.kill();
  server = null;
}

async function status(modelId = DEFAULT_MODEL) {
  const eng = installedBuild();
  const devices = eng ? await listDevices(eng.exe).catch(() => []) : [];
  const device = pickDevice(devices);
  return {
    engineInstalled: !!eng,
    build: eng?.build || null,
    model: modelId,
    models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, about: m.about, page: m.page, files: m.files.map((f) => f.name), sizeGB: m.sizeGB, installed: modelInstalled(id), builtIn: builtIn(id), recommended: device ? device.totalMB / 1024 >= m.minVramGB : id === 'qwen3-vl-4b' })),
    ready: !!eng && modelInstalled(modelId),
    running: !!server && server.proc.exitCode === null,
    device: device ? `${device.name} (${Math.round(device.totalMB / 1024)} GB)` : 'CPU (no supported GPU found)',
    recommendedModel: !device ? 'qwen3-vl-2b' : device.totalMB / 1024 >= MODELS['qwen3-vl-8b'].minVramGB ? 'qwen3-vl-8b' : device.totalMB / 1024 >= MODELS['qwen3-vl-4b'].minVramGB ? 'qwen3-vl-4b' : 'qwen3-vl-2b',
  };
}

// Loads the model and runs a tiny request so the GPU kernels are compiled before the user asks
// anything. Safe to call repeatedly; does nothing if the engine isn't set up.
let warming = null;
async function warm(modelId = DEFAULT_MODEL) {
  if (!installedBuild() || !modelInstalled(modelId)) return { warmed: false };
  if (server && server.modelId === modelId && server.warm) return { warmed: true };
  if (warming) return warming;
  warming = (async () => {
    try {
      const s = await start(modelId);
      await fetch(`http://127.0.0.1:${s.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'system', content: 'You are a helpful assistant.'.repeat(60) }, { role: 'user', content: 'Say OK.' }], max_tokens: 1 }),
      });
      if (server) server.warm = true;
      return { warmed: true };
    } finally {
      warming = null;
    }
  })();
  return warming;
}

// One-click setup: engine + model.
async function setup(modelId, onProgress) {
  await installEngine(onProgress);
  await installModel(modelId, onProgress);
  return status(modelId);
}

// ---------- chat (OpenAI-compatible streaming) ----------
// Streams one assistant turn. onEvent receives { type: 'text' | 'thinking', delta }. Returns
// { content, tool_calls } where tool_calls are OpenAI-style.
async function chatTurn({ modelId, messages, tools, signal }, onEvent) {
  const s = await start(modelId);
  const res = await fetch(`http://127.0.0.1:${s.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, tools, stream: true, temperature: 0.5, top_p: 0.9, max_tokens: 4096 }),
    signal,
  });
  if (!res.ok) throw new Error(`AI engine error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const msg = { role: 'assistant', content: '', tool_calls: [] };
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let ev;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      if (ev.error) throw new Error(ev.error.message || String(ev.error));
      const d = ev.choices?.[0]?.delta || {};
      if (d.reasoning_content) onEvent({ type: 'thinking', delta: d.reasoning_content });
      if (d.content) {
        msg.content += d.content;
        onEvent({ type: 'text', delta: d.content });
      }
      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? msg.tool_calls.length;
        const cur = (msg.tool_calls[i] = msg.tool_calls[i] || { id: tc.id || `call_${Date.now()}_${i}`, type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      }
    }
  }
  msg.tool_calls = msg.tool_calls.filter(Boolean);
  if (!msg.tool_calls.length) delete msg.tool_calls;
  bumpIdle();
  return msg;
}

module.exports = { MODELS, DEFAULT_MODEL, resolveModel, importModelFiles, modelsFolder, status, setup, warm, installEngine, installModel, removeModel, start, stop, chatTurn, listDevices, pickDevice };
