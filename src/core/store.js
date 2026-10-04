// Persistent JSON state + encrypted secrets, stored in Electron's userData folder.
const fs = require('fs');
const path = require('path');

let baseDir = null;
let safeStorage = null;
const cache = new Map();

function init(userDataDir, electronSafeStorage) {
  baseDir = userDataDir;
  safeStorage = electronSafeStorage;
  fs.mkdirSync(baseDir, { recursive: true });
}

function file(name) {
  return path.join(baseDir, `${name}.json`);
}

function load(name, fallback) {
  if (cache.has(name)) return cache.get(name);
  let value = fallback;
  try {
    value = JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    value = structuredClone(fallback);
  }
  cache.set(name, value);
  return value;
}

function save(name, value) {
  cache.set(name, value);
  const target = file(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

function remove(name) {
  cache.delete(name);
  fs.rmSync(file(name), { force: true });
}

function update(name, fallback, fn) {
  const value = load(name, fallback);
  const result = fn(value);
  save(name, value);
  return result;
}

// Secrets (API keys) are encrypted with the OS keychain via safeStorage when available.
function setSecret(key, value) {
  update('secrets', {}, (s) => {
    if (!value) {
      delete s[key];
    } else if (safeStorage && safeStorage.isEncryptionAvailable()) {
      s[key] = { enc: safeStorage.encryptString(value).toString('base64') };
    } else {
      s[key] = { plain: value };
    }
  });
}

function getSecret(key) {
  const s = load('secrets', {});
  const entry = s[key];
  if (!entry) return '';
  if (entry.enc && safeStorage) {
    try {
      return safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
    } catch {
      return '';
    }
  }
  return entry.plain || '';
}

function dataDir(...parts) {
  const p = path.join(baseDir, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

module.exports = { init, load, save, remove, update, setSecret, getSecret, dataDir };
