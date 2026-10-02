// BSA (Skyrim SE v104/v105) and BA2 (Fallout 4 / Starfield) file listing, plus 7-Zip extraction.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, pos);
  return buf;
}

function listBsa(fd) {
  const h = readAt(fd, 0, 36);
  const version = h.readUInt32LE(4);
  const folderOffset = h.readUInt32LE(8);
  const flags = h.readUInt32LE(12);
  const folderCount = h.readUInt32LE(16);
  const fileCount = h.readUInt32LE(20);
  const totalFileNameLength = h.readUInt32LE(28);
  const folderRecSize = version === 105 ? 24 : 16;
  const folders = readAt(fd, folderOffset, folderCount * folderRecSize);
  const counts = [];
  for (let i = 0; i < folderCount; i++) counts.push(folders.readUInt32LE(i * folderRecSize + 8));

  let pos = folderOffset + folderCount * folderRecSize;
  const hasDirNames = (flags & 0x1) !== 0;
  const dirs = [];
  for (let i = 0; i < folderCount; i++) {
    let name = '';
    if (hasDirNames) {
      const len = readAt(fd, pos, 1)[0];
      name = readAt(fd, pos + 1, len).toString('latin1').replace(/\0$/, '');
      pos += 1 + len;
    }
    dirs.push(name);
    pos += counts[i] * 16;
  }
  const names = (flags & 0x2) ? readAt(fd, pos, totalFileNameLength).toString('latin1').split('\0') : [];
  const files = [];
  let n = 0;
  for (let i = 0; i < folderCount; i++) {
    for (let j = 0; j < counts[i]; j++) files.push(`${dirs[i]}\\${names[n++] || '?'}`);
  }
  return { format: `BSA v${version}`, fileCount, files };
}

function listBa2(fd) {
  const h = readAt(fd, 0, 24);
  const version = h.readUInt32LE(4);
  const type = h.toString('latin1', 8, 12);
  const fileCount = h.readUInt32LE(12);
  const nameTableOffset = Number(h.readBigUInt64LE(16));
  const size = fs.fstatSync(fd).size;
  const table = readAt(fd, nameTableOffset, Math.min(size - nameTableOffset, 64 * 1024 * 1024));
  const files = [];
  let off = 0;
  for (let i = 0; i < fileCount && off + 2 <= table.length; i++) {
    const len = table.readUInt16LE(off);
    files.push(table.toString('latin1', off + 2, off + 2 + len));
    off += 2 + len;
  }
  return { format: `BA2 v${version} ${type}`, fileCount, files };
}

const listCache = new Map();

function listArchive(filePath) {
  const stat = fs.statSync(filePath);
  const key = `${filePath}|${stat.mtimeMs}|${stat.size}`;
  if (listCache.has(key)) return listCache.get(key);
  const fd = fs.openSync(filePath, 'r');
  try {
    const magic = readAt(fd, 0, 4).toString('latin1');
    let result;
    if (magic === 'BSA\0') result = listBsa(fd);
    else if (magic === 'BTDX') result = listBa2(fd);
    else throw new Error(`Unknown archive format (${JSON.stringify(magic)})`);
    listCache.set(key, result);
    return result;
  } finally {
    fs.closeSync(fd);
  }
}

// --- 7-Zip extraction for downloaded mod archives (.zip/.7z; .rar needs full 7-Zip installed) ---
function sevenZipPath() {
  const installed = ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].find((p) => fs.existsSync(p));
  if (installed) return installed;
  const bundled = require('7zip-bin').path7za;
  return bundled.replace('app.asar', 'app.asar.unpacked');
}

function extract(archivePath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const exe = sevenZipPath();
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['x', archivePath, `-o${outDir}`, '-y', '-bso0', '-bsp0'], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      if (/\.rar$/i.test(archivePath) && /7za/i.test(exe)) {
        return reject(new Error('RAR archives need the full 7-Zip installed (https://www.7-zip.org).'));
      }
      reject(new Error(`7-Zip failed (${code}): ${err.trim()}`));
    });
  });
}

module.exports = { listArchive, extract, ARCHIVE_RE: /\.(bsa|ba2)$/i };
