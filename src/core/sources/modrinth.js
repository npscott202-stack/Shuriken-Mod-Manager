// Modrinth API v2 (no key needed): search, versions, dependency resolution, .mrpack import/export.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const downloads = require('../downloads');
const archives = require('../archives');

const API = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': 'Shuriken/0.1 (desktop mod manager)' };

async function get(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Modrinth ${res.status}: ${await res.text()}`);
  return res.json();
}

async function search({ query = '', projectType = 'mod', mcVersion, loader, limit = 20, offset = 0, index = 'relevance' }) {
  const facets = [[`project_type:${projectType}`]];
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  if (loader && projectType === 'mod') facets.push([`categories:${loader}`]);
  const params = new URLSearchParams({ query, limit: String(limit), offset: String(offset), index, facets: JSON.stringify(facets) });
  return get(`${API}/search?${params}`);
}

function project(idOrSlug) {
  return get(`${API}/project/${encodeURIComponent(idOrSlug)}`);
}

async function versions(projectId, { mcVersion, loader, projectType } = {}) {
  const params = new URLSearchParams();
  if (loader && (!projectType || projectType === 'mod')) params.set('loaders', JSON.stringify([loader]));
  if (mcVersion) params.set('game_versions', JSON.stringify([mcVersion]));
  return get(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
}

const TYPE_MAP = { mod: 'mc-mod', resourcepack: 'mc-resourcepack', shader: 'mc-shaderpack', datapack: 'mc-datapack' };

// Downloads the best matching version and its required dependencies, returning install jobs.
async function resolve(projectId, opts, seen = new Set()) {
  if (seen.has(projectId)) return [];
  seen.add(projectId);
  const proj = await project(projectId);
  const list = await versions(projectId, { ...opts, projectType: proj.project_type });
  if (!list.length) throw new Error(`${proj.title} has no version for ${opts.mcVersion || 'any version'} ${opts.loader || ''}`.trim());
  const version = list.find((v) => v.version_type === 'release') || list[0];
  const file = version.files.find((f) => f.primary) || version.files[0];
  const jobs = [{ project: proj, version, file }];
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required' || !dep.project_id) continue;
    if (opts.skip?.has(dep.project_id)) continue;
    try {
      jobs.push(...(await resolve(dep.project_id, opts, seen)));
    } catch (e) {
      jobs.push({ error: e.message, projectId: dep.project_id });
    }
  }
  return jobs;
}

async function downloadJob(job) {
  const entry = await downloads.download(job.file.url, { fileName: job.file.filename, meta: { title: job.project.title } });
  return {
    path: entry.dest,
    meta: {
      name: job.project.title,
      version: job.version.version_number,
      source: 'modrinth',
      sourceId: job.project.id,
      sourceUrl: `https://modrinth.com/${job.project.project_type}/${job.project.slug}`,
      type: TYPE_MAP[job.project.project_type] || 'mc-mod',
      modrinth: { versionId: job.version.id, url: job.file.url, hashes: job.file.hashes, size: job.file.size, filename: job.file.filename },
    },
  };
}

// --- .mrpack ---
function run7z(args) {
  const exe = require('7zip-bin').path7za.replace('app.asar', 'app.asar.unpacked');
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`7-Zip exited ${code}`))));
  });
}

async function readMrpack(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mrpack-'));
  await archives.extract(file, tmp);
  const index = JSON.parse(fs.readFileSync(path.join(tmp, 'modrinth.index.json'), 'utf8'));
  return { tmp, index };
}

async function exportMrpack({ name, mcVersion, loader, loaderVersion, mods, outFile, instanceDir }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mrpack-out-'));
  const files = [];
  const overrides = path.join(tmp, 'overrides');
  for (const m of mods) {
    const sub = { 'mc-resourcepack': 'resourcepacks', 'mc-shaderpack': 'shaderpacks', 'mc-datapack': 'datapacks' }[m.type] || 'mods';
    if (m.modrinth?.hashes && m.modrinth.url) {
      files.push({
        path: `${sub}/${m.modrinth.filename}`,
        hashes: { sha1: m.modrinth.hashes.sha1, sha512: m.modrinth.hashes.sha512 },
        downloads: [m.modrinth.url],
        fileSize: m.modrinth.size,
      });
    } else if (m.localFile && fs.existsSync(m.localFile)) {
      fs.mkdirSync(path.join(overrides, sub), { recursive: true });
      fs.copyFileSync(m.localFile, path.join(overrides, sub, path.basename(m.localFile)));
    }
  }
  if (instanceDir && fs.existsSync(path.join(instanceDir, 'config'))) {
    fs.cpSync(path.join(instanceDir, 'config'), path.join(overrides, 'config'), { recursive: true });
  }
  const deps = { minecraft: mcVersion };
  if (loader && loader !== 'vanilla') deps[loader === 'fabric' ? 'fabric-loader' : loader === 'quilt' ? 'quilt-loader' : loader] = loaderVersion || '*';
  const index = { formatVersion: 1, game: 'minecraft', versionId: '1.0.0', name, summary: 'Built with Shuriken', files, dependencies: deps };
  fs.writeFileSync(path.join(tmp, 'modrinth.index.json'), JSON.stringify(index, null, 2));
  if (fs.existsSync(outFile)) fs.rmSync(outFile);
  await run7z(['a', '-tzip', outFile, path.join(tmp, '*')]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { outFile, fileCount: files.length };
}

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

module.exports = { search, project, versions, resolve, downloadJob, readMrpack, exportMrpack, sha1, TYPE_MAP };
