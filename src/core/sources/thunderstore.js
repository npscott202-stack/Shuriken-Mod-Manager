// Thunderstore (BepInEx games: Valheim, Lethal Company, Risk of Rain 2...): searchable package index,
// dependency resolution and r2modman-style install layout.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const store = require('../store');
const mods = require('../mods');
const archives = require('../archives');
const downloads = require('../downloads');

const UA = { 'User-Agent': 'Shuriken/0.3 (desktop mod manager)' };
const MAX_AGE = 12 * 3600 * 1000;
const memory = new Map();

async function gunzipJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Thunderstore ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return JSON.parse(text);
}

function compact(p) {
  const latest = p.versions?.[0] || {};
  return {
    full: p.full_name,
    name: p.name,
    owner: p.owner,
    url: p.package_url,
    rating: p.rating_score || 0,
    downloads: (p.versions || []).reduce((n, v) => n + (v.downloads || 0), 0),
    updated: p.date_updated,
    categories: p.categories || [],
    deprecated: !!p.is_deprecated,
    nsfw: !!p.has_nsfw_content,
    version: latest.version_number,
    description: latest.description || '',
    icon: latest.icon,
    download: latest.download_url,
    deps: latest.dependencies || [],
  };
}

// Downloads (or loads the cached) package index for a community, e.g. "valheim".
async function index(community, onProgress = () => {}) {
  if (memory.has(community)) return memory.get(community);
  const file = path.join(store.dataDir('thunderstore'), `${community}.json`);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < MAX_AGE) {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    memory.set(community, list);
    return list;
  }
  const chunks = await gunzipJson(`https://thunderstore.io/c/${community}/api/v1/package-listing-index/`);
  const list = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress({ done: i, total: chunks.length });
    for (const p of await gunzipJson(chunks[i])) list.push(compact(p));
  }
  fs.writeFileSync(file, JSON.stringify(list));
  memory.set(community, list);
  return list;
}

async function search(community, query = '', limit = 40) {
  const list = await index(community);
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  return list
    .filter((p) => !p.deprecated && !p.nsfw)
    .filter((p) => !words.length || words.every((w) => `${p.name} ${p.owner} ${p.description}`.toLowerCase().includes(w)))
    .map((p) => ({ ...p, score: (q && p.name.toLowerCase() === q.replace(/\s+/g, '_') ? 1e12 : 0) + p.downloads }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// "Owner-Name-1.2.3" -> package, plus all of its dependencies (deepest first).
async function resolve(community, fullName, seen = new Set()) {
  const list = await index(community);
  const byFull = new Map(list.map((p) => [p.full, p]));
  const order = [];
  const visit = (full) => {
    if (seen.has(full)) return;
    seen.add(full);
    const p = byFull.get(full);
    if (!p) {
      order.push({ missing: full });
      return;
    }
    for (const d of p.deps) visit(d.replace(/-\d+\.\d+\.\d+$/, ''));
    order.push(p);
  };
  visit(fullName.replace(/-\d+\.\d+\.\d+$/, ''));
  return order;
}

const JUNK = /^(manifest\.json|icon\.png|readme(\.md|\.txt)?|changelog(\.md|\.txt)?|license(\.md|\.txt)?)$/i;

function copyTree(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

// Lays a Thunderstore zip out the way r2modman does, relative to the game folder.
function layout(tmp, dest, pkg) {
  const entries = fs.readdirSync(tmp, { withFileTypes: true });
  const isPack = /^BepInExPack/i.test(pkg.name) || entries.some((e) => e.isDirectory() && /^BepInExPack/i.test(e.name));
  if (isPack) {
    const inner = entries.find((e) => e.isDirectory() && /^BepInEx(Pack.*)?$/i.test(e.name) && fs.existsSync(path.join(tmp, e.name, 'BepInEx')));
    const root = inner ? path.join(tmp, inner.name) : tmp;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) if (!JUNK.test(e.name)) copyTree(path.join(root, e.name), path.join(dest, e.name));
    return;
  }
  const target = (sub) => path.join(dest, 'BepInEx', sub, pkg.full);
  for (const e of entries) {
    const src = path.join(tmp, e.name);
    const lower = e.name.toLowerCase();
    if (JUNK.test(e.name)) continue;
    if (e.isDirectory() && lower === 'bepinex') copyTree(src, path.join(dest, 'BepInEx'));
    else if (e.isDirectory() && lower === 'config') copyTree(src, path.join(dest, 'BepInEx', 'config'));
    else if (e.isDirectory() && ['plugins', 'patchers', 'core', 'monomod'].includes(lower)) copyTree(src, target(lower));
    else copyTree(src, path.join(target('plugins'), e.name));
  }
}

async function installPackage(gameId, community, pkg) {
  const s = mods.state(gameId);
  const existing = Object.values(s.mods).find((m) => m.source === 'thunderstore' && m.sourceId === pkg.full);
  if (existing && existing.version === pkg.version) return { mod: existing, skipped: true };
  const entry = await downloads.download(pkg.download, { fileName: `${pkg.full}-${pkg.version}.zip`, meta: { title: pkg.name } });
  const id = existing ? existing.id : `${mods.slug(pkg.full)}-${Date.now().toString(36)}`;
  const dest = mods.modDir(gameId, id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shuriken-ts-'));
  await archives.extract(entry.dest, tmp);
  layout(tmp, dest, pkg);
  fs.rmSync(tmp, { recursive: true, force: true });
  return {
    mod: mods.registerMod(gameId, {
      id, name: pkg.name.replace(/_/g, ' '), type: 'generic', version: pkg.version, source: 'thunderstore', sourceId: pkg.full,
      sourceUrl: pkg.url, author: pkg.owner,
    }),
  };
}

// Installs a package and its dependencies. Returns per-package results.
async function install(gameId, community, fullName) {
  const results = [];
  for (const pkg of await resolve(community, fullName)) {
    if (pkg.missing) {
      results.push({ error: `Dependency ${pkg.missing} is not on Thunderstore for this game` });
      continue;
    }
    try {
      results.push(await installPackage(gameId, community, pkg));
    } catch (e) {
      results.push({ error: `${pkg.full}: ${e.message}` });
    }
  }
  return results;
}

module.exports = { index, search, resolve, install, layout };
