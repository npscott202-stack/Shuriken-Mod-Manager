// Workshop: mod projects the AI (or the user) builds from scratch.
// Bethesda projects and Minecraft config/KubeJS projects are live Shuriken mods (files go
// straight to staging and deploy like any mod). Datapacks, resource packs and Fabric mods are
// source folders that get packaged/built and then installed.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const mods = require('./mods');
const mc = require('./integrations/minecraft');

const KINDS = {
  'bethesda-mod': { label: 'Bethesda mod (plugin, scripts, configs, assets)', kinds: ['bethesda'], staged: 'data' },
  'mc-datapack': { label: 'Minecraft datapack (recipes, loot, functions, worldgen)', kinds: ['minecraft'] },
  'mc-resourcepack': { label: 'Minecraft resource pack (textures, models, sounds, lang)', kinds: ['minecraft'] },
  'mc-config': { label: 'Minecraft config / KubeJS scripts (files in the instance folder)', kinds: ['minecraft'], staged: 'mc-root' },
  'fabric-mod': { label: 'Fabric mod (Java, built with Gradle)', kinds: ['minecraft'] },
  'generic-mod': { label: 'Mod files for this game (configs, scripts, assets in its mod folder)', kinds: ['generic'], staged: 'generic' },
};

function kindAllowed(kind, gameId) {
  return KINDS[kind].kinds.includes(mods.game(gameId).kind);
}

function db() {
  return store.load('workshop', { projects: {} });
}

function save() {
  store.save('workshop', db());
}

function get(projectId) {
  const p = db().projects[projectId];
  if (!p) throw new Error(`No workshop project "${projectId}". Use workshop_list.`);
  return p;
}

function list(gameId) {
  return Object.values(db().projects)
    .filter((p) => !gameId || p.gameId === gameId)
    .map((p) => ({ ...p, kindLabel: KINDS[p.kind].label, fileCount: fs.existsSync(p.dir) ? files(p.id).length : 0 }));
}

async function create(gameId, name, kind, { mcVersion } = {}) {
  const def = KINDS[kind];
  if (!def) throw new Error(`kind must be one of ${Object.keys(KINDS).join(', ')}`);
  if (!kindAllowed(kind, gameId)) throw new Error(`${kind} projects are not available for this game.`);
  const id = `${mods.slug(name)}-${Date.now().toString(36)}`;
  const project = { id, gameId, name, kind, createdAt: new Date().toISOString() };
  if (def.staged) {
    project.modId = id;
    project.dir = mods.modDir(gameId, id);
    fs.mkdirSync(project.dir, { recursive: true });
    mods.registerMod(gameId, { id, name, type: def.staged, source: 'workshop', workshop: true, version: '0.1.0' });
  } else {
    project.dir = kind === 'mc-datapack'
      ? path.join(store.dataDir('workshop', id), mods.slug(name))
      : store.dataDir('workshop', id, 'src');
    fs.mkdirSync(project.dir, { recursive: true });
    if (kind === 'fabric-mod') {
      const s = mods.state(gameId);
      project.template = await mc.createFabricProject(project.dir, mcVersion || s.mcVersion || '1.21.1');
    }
  }
  db().projects[id] = project;
  save();
  return { ...project, files: files(id).slice(0, 100) };
}

function remove(projectId) {
  const p = get(projectId);
  if (p.modId) mods.removeMod(p.gameId, p.modId);
  else fs.rmSync(path.join(store.dataDir('workshop'), p.id), { recursive: true, force: true });
  delete db().projects[projectId];
  save();
}

function resolveIn(p, rel) {
  const target = path.resolve(p.dir, rel);
  const r = path.relative(p.dir, target);
  if (!rel || r.startsWith('..') || path.isAbsolute(r)) throw new Error('Path must stay inside the project folder.');
  return target;
}

const IGNORE = /^(\.gradle|build|\.git|\.idea|run|out)([\\/]|$)/i;

function files(projectId) {
  const p = get(projectId);
  return mods.walk(p.dir).filter((f) => !IGNORE.test(f));
}

function readFile(projectId, rel) {
  const target = resolveIn(get(projectId), rel);
  const buf = fs.readFileSync(target);
  if (buf.includes(0)) return `[binary file, ${buf.length} bytes]`;
  const text = buf.toString('utf8');
  return text.length > 200000 ? `${text.slice(0, 200000)}\n...[truncated]` : text;
}

function writeFile(projectId, rel, content, encoding = 'utf8') {
  const p = get(projectId);
  const target = resolveIn(p, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, encoding === 'base64' ? Buffer.from(content, 'base64') : content);
  markDirty(p);
  return { written: rel, bytes: fs.statSync(target).size };
}

function deleteFile(projectId, rel) {
  const p = get(projectId);
  fs.rmSync(resolveIn(p, rel), { recursive: true, force: true });
  markDirty(p);
  return { deleted: rel };
}

function markDirty(p) {
  if (!p.modId) return;
  mods.state(p.gameId).deployment.dirty = true;
  mods.save(p.gameId);
}

// Moves files that a tool created in the game's Data folder (xEdit plugins, CK outputs) into the project.
function capture(projectId, dataPaths) {
  const p = get(projectId);
  if (p.kind !== 'bethesda-mod') throw new Error('Capture is for Bethesda projects.');
  const g = mods.game(p.gameId);
  const data = path.join(g.installDir, 'Data');
  const deployed = mods.state(p.gameId).deployment.files || {};
  const moved = [];
  for (const rel of dataPaths) {
    const src = path.resolve(data, rel);
    if (path.relative(data, src).startsWith('..')) throw new Error(`${rel} is outside Data`);
    if (!fs.existsSync(src)) throw new Error(`${rel} not found in Data`);
    const all = fs.statSync(src).isDirectory() ? mods.walk(src).map((f) => path.join(rel, f)) : [rel];
    for (const f of all) {
      const from = path.join(data, f);
      if (deployed[from.toLowerCase()]) throw new Error(`${f} belongs to an installed mod; only capture new files.`);
      const to = path.join(p.dir, f);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      try {
        fs.renameSync(from, to);
      } catch {
        fs.copyFileSync(from, to);
        fs.rmSync(from);
      }
      moved.push(f);
    }
  }
  const s = mods.state(p.gameId);
  s.deployment.dirty = true;
  mods.save(p.gameId);
  return { moved, note: 'Deploy to link these files back into the game.' };
}

function zipFolder(src, outFile) {
  const exe = require('7zip-bin').path7za.replace('app.asar', 'app.asar.unpacked');
  return new Promise((resolve, reject) => {
    if (fs.existsSync(outFile)) fs.rmSync(outFile);
    const child = spawn(exe, ['a', '-tzip', outFile, path.join(src, '*')], { windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(outFile) : reject(new Error(`zip failed (${code})`))));
  });
}

// Builds/packages the project and installs the result into Shuriken (or a world for datapacks).
async function packageProject(projectId, { world } = {}) {
  const p = get(projectId);
  if (KINDS[p.kind].staged) return { note: 'This project is already a live mod. Deploy to apply.' };
  if (p.kind === 'mc-datapack') {
    if (!fs.existsSync(path.join(p.dir, 'pack.mcmeta'))) throw new Error('Add pack.mcmeta first.');
    if (!world) throw new Error('Choose a world folder (list_worlds) to install the datapack into.');
    return mc.installDatapack(p.gameId, p.dir, world);
  }
  if (p.kind === 'mc-resourcepack') {
    if (!fs.existsSync(path.join(p.dir, 'pack.mcmeta'))) throw new Error('Add pack.mcmeta first.');
    const zip = path.join(store.dataDir('workshop', p.id), `${mods.slug(p.name)}.zip`);
    await zipFolder(p.dir, zip);
    const r = await mods.installFile(p.gameId, zip, { name: p.name, type: 'mc-resourcepack', source: 'workshop', sourceId: p.id });
    return { installedMod: r.mod?.name, note: 'Deploy, then enable the pack in Options > Resource Packs.' };
  }
  if (p.kind === 'fabric-mod') {
    const build = await mc.gradleBuild(p.dir);
    if (!build.ok) return { built: false, ...build };
    const r = await mods.installFile(p.gameId, build.jars[0], { name: p.name, type: 'mc-mod', source: 'workshop', sourceId: p.id });
    return { built: true, jar: path.basename(build.jars[0]), installedMod: r.mod?.name, output: build.output, note: 'Deploy to apply.' };
  }
  throw new Error('Unknown project kind');
}

module.exports = { KINDS, kindAllowed, list, get, create, remove, files, readFile, writeFile, deleteFile, capture, packageProject };
