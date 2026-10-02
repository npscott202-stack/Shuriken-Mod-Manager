// Shuriken Local AI: runs the assistant on the user's own GPU through Ollama (no API key).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3-vl:8b';
// 8K tokens keeps an 8B model fully on an 8 GB GPU; larger contexts spill to the CPU and get slow.
const CONTEXT = Number(process.env.SHURIKEN_LOCAL_CTX) || 8192;

function ollamaExe() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    path.join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function api(pathname, body, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${HOST}${pathname}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

// Starts the Ollama server if it is installed but not running.
async function ensureServer() {
  try {
    await api('/api/version', null, { timeoutMs: 2000 });
    return true;
  } catch {
    const exe = ollamaExe();
    if (!exe) return false;
    spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        await api('/api/version', null, { timeoutMs: 1000 });
        return true;
      } catch {
        // still starting
      }
    }
    return false;
  }
}

async function status(model = DEFAULT_MODEL) {
  const installed = !!ollamaExe();
  const running = installed && (await ensureServer());
  let models = [];
  let caps = [];
  if (running) {
    models = ((await api('/api/tags')).models || []).map((m) => ({ name: m.name, sizeGB: +(m.size / 1e9).toFixed(1) }));
    if (models.some((m) => m.name === model)) caps = (await api('/api/show', { model })).capabilities || [];
  }
  return { installed, running, models, model, ready: running && models.some((m) => m.name === model), capabilities: caps };
}

// Downloads a model, reporting progress through onProgress({ status, completed, total }).
async function pull(model, onProgress = () => {}) {
  if (!(await ensureServer())) throw new Error('Ollama is not installed. Install it from ollama.com (free), then try again.');
  const res = await fetch(`${HOST}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  let buf = '';
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.error) throw new Error(ev.error);
      onProgress(ev);
    }
  }
  return { model, done: true };
}

// One streamed chat turn. Calls onEvent for thinking/text deltas and returns the final assistant message.
async function chatTurn({ model, messages, tools, think }, onEvent) {
  const res = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model, messages, tools, stream: true, think, keep_alive: '30m', options: { num_ctx: CONTEXT, temperature: 0.4 } }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (/does not support thinking/i.test(text) && think) return chatTurn({ model, messages, tools, think: false }, onEvent);
    throw new Error(`Local AI error ${res.status}: ${text.slice(0, 300)}`);
  }
  const msg = { role: 'assistant', content: '', thinking: '', tool_calls: [] };
  let buf = '';
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.error) throw new Error(ev.error);
      const m = ev.message || {};
      if (m.thinking) {
        msg.thinking += m.thinking;
        onEvent({ type: 'thinking', delta: m.thinking });
      }
      if (m.content) {
        msg.content += m.content;
        onEvent({ type: 'text', delta: m.content });
      }
      if (m.tool_calls?.length) msg.tool_calls.push(...m.tool_calls);
    }
  }
  if (!msg.tool_calls.length) delete msg.tool_calls;
  if (!msg.thinking) delete msg.thinking;
  return msg;
}

module.exports = { DEFAULT_MODEL, status, pull, chatTurn, ensureServer, ollamaExe };
