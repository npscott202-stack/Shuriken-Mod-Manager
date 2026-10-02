// Simple download manager with progress events.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const store = require('./store');

const events = new EventEmitter();
const active = new Map();
let counter = 0;

function downloadsDir() {
  return store.dataDir('downloads');
}

function safeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180);
}

async function download(url, { fileName, headers = {}, meta = {} } = {}) {
  const id = ++counter;
  const res = await fetch(url, { headers: { 'User-Agent': 'Shuriken/0.1 (desktop mod manager)', ...headers }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const name = safeName(fileName || decodeURIComponent(path.basename(new URL(res.url).pathname)) || `download-${id}`);
  const dest = path.join(downloadsDir(), name);
  const total = Number(res.headers.get('content-length')) || 0;
  const entry = { id, name, dest, total, received: 0, status: 'downloading', meta };
  active.set(id, entry);
  events.emit('progress', { ...entry });

  const out = fs.createWriteStream(dest);
  let lastEmit = 0;
  try {
    for await (const chunk of res.body) {
      out.write(chunk);
      entry.received += chunk.length;
      if (Date.now() - lastEmit > 250) {
        lastEmit = Date.now();
        events.emit('progress', { ...entry });
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    entry.status = 'done';
    events.emit('progress', { ...entry });
    return entry;
  } catch (e) {
    out.destroy();
    entry.status = 'failed';
    entry.error = e.message;
    events.emit('progress', { ...entry });
    throw e;
  }
}

function listDownloaded() {
  const dir = downloadsDir();
  return fs
    .readdirSync(dir)
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, path: path.join(dir, name), size: st.size, date: st.mtime.toISOString() };
    })
    .filter((f) => !f.name.endsWith('.json'))
    .sort((a, b) => b.date.localeCompare(a.date));
}

module.exports = { download, events, listDownloaded, downloadsDir };
