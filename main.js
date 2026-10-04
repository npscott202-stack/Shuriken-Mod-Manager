// Shuriken – Electron main process: window, IPC API, nxm:// handling, screenshots and game launch.
const { app, BrowserWindow, ipcMain, dialog, shell, desktopCapturer, screen, nativeImage, globalShortcut, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const store = require('./src/core/store');
const { GAMES, CORE, detectAll, detectMinecraftProfiles, publicInfo } = require('./src/core/games');

let win = null;
let mods, plugins, archives, diagnostics, tools, ai, downloads, modrinth, nexus, loaders, workshop, mcx, beth, engine, thunderstore, vfs;

const pendingApprovals = new Map();

// Appends errors to <data>/logs/shuriken.log so users can send a report.
function logError(where, err) {
  try {
    const text = err?.stack || err?.message || String(err);
    const file = path.join(app.getPath('userData'), 'logs', 'shuriken.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 2e6) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${where}: ${text}
`);
  } catch {
    // logging must never throw
  }
}
process.on('uncaughtException', (e) => logError('main', e));
process.on('unhandledRejection', (e) => logError('main(promise)', e));

function loadCore() {
  mods = require('./src/core/mods');
  plugins = require('./src/core/plugins');
  archives = require('./src/core/archives');
  diagnostics = require('./src/core/diagnostics');
  tools = require('./src/core/tools');
  ai = require('./src/core/ai');
  downloads = require('./src/core/downloads');
  modrinth = require('./src/core/sources/modrinth');
  nexus = require('./src/core/sources/nexus');
  loaders = require('./src/core/sources/loaders');
  workshop = require('./src/core/workshop');
  mcx = require('./src/core/integrations/minecraft');
  beth = require('./src/core/integrations/bethesda');
  engine = require('./src/core/engine');
  thunderstore = require('./src/core/sources/thunderstore');
  vfs = require('./src/core/vfs');
}

function settings() {
  return store.load('settings', { aiModel: 'claude-opus-5-5', aiEffort: 'high', aiAutoApprove: false, autoDeployOnLaunch: true, handleNxm: false, minecraftLauncher: '' });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f1117',
    title: 'Shuriken',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
}

// ---------- screenshots ----------
function encodeImage(img) {
  let image = img;
  const { width } = image.getSize();
  if (width > 1920) image = image.resize({ width: 1920, quality: 'best' });
  const jpeg = image.toJPEG(85);
  return { mediaType: 'image/jpeg', data: jpeg.toString('base64'), width: image.getSize().width, height: image.getSize().height };
}

async function captureScreen(hideWindow) {
  const wasVisible = win && win.isVisible() && !win.isMinimized();
  if (hideWindow && wasVisible) {
    win.minimize();
    await new Promise((r) => setTimeout(r, 450));
  }
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    if (!source) throw new Error('No screen available to capture');
    const encoded = encodeImage(source.thumbnail);
    const file = path.join(store.dataDir('screenshots'), `screenshot-${Date.now()}.jpg`);
    fs.writeFileSync(file, Buffer.from(encoded.data, 'base64'));
    return { ...encoded, path: file, name: path.basename(file) };
  } finally {
    if (hideWindow && wasVisible) win.restore();
  }
}

function imageFromFile(file) {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) throw new Error(`Could not read image ${path.basename(file)} (use PNG or JPG)`);
  return { ...encodeImage(img), name: path.basename(file), path: file };
}

// ---------- game launch ----------
function findMinecraftLauncher() {
  const custom = settings().minecraftLauncher;
  const candidates = [
    custom,
    'C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe',
    path.join(process.env['ProgramFiles(x86)'] || '', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    path.join(process.env.ProgramFiles || '', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function findJava() {
  try {
    const out = execFileSync('where', ['javaw'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim();
    if (out) return out;
  } catch {
    // not on PATH
  }
  const roots = [
    path.join(process.env.APPDATA || '', '.minecraft', 'runtime'),
    path.join(process.env.LOCALAPPDATA || '', 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime'),
  ];
  const search = (dir, depth) => {
    if (depth > 5) return null;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) if (e.isFile() && e.name.toLowerCase() === 'javaw.exe') return path.join(dir, e.name);
    for (const e of entries) if (e.isDirectory()) {
      const r = search(path.join(dir, e.name), depth + 1);
      if (r) return r;
    }
    return null;
  };
  for (const r of roots) {
    const hit = search(r, 0);
    if (hit) return hit;
  }
  return null;
}

async function launchGame(gameId) {
  const g = mods.game(gameId);
  const s = mods.state(gameId);
  if (s.deployment.dirty && settings().autoDeployOnLaunch && g.installDir) await mods.deploy(gameId);
  if (g.kind === 'minecraft') {
    const launcher = findMinecraftLauncher();
    if (!launcher) throw new Error('Minecraft Launcher not found. Set its path in Settings.');
    spawn(launcher, [], { detached: true, stdio: 'ignore' }).unref();
    return { launched: path.basename(launcher) };
  }
  if (!g.installDir) throw new Error(`Set the ${g.name} folder first.`);
  // Script extender loader first (Bethesda), then the game's own exe, then Steam.
  const candidates = [g.loader, g.exe].filter(Boolean).map((rel) => path.join(g.installDir, rel));
  const exe = candidates.find((p) => fs.existsSync(p));
  if (exe && mods.deployMode(gameId) === 'virtual') {
    await vfs.launch(gameId, { exe, cwd: path.dirname(exe) });
    return { launched: `${path.basename(exe)} (virtual mods)` };
  }
  if (exe) {
    spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref();
    return { launched: path.basename(exe) };
  }
  if (g.steamAppId) {
    await shell.openExternal(`steam://rungameid/${g.steamAppId}`);
    return { launched: `${g.short} through Steam` };
  }
  throw new Error(`Couldn't find how to start ${g.name}. Start it from its own launcher.`);
}

// ---------- nxm:// ----------
async function handleNxm(link) {
  try {
    const info = nexus.parseNxm(link);
    const gameId = Object.values(GAMES).find((g) => g.nexusDomain === info.domain)?.id;
    if (!gameId) throw new Error(`Shuriken does not manage "${info.domain}" yet.`);
    send('toast', { kind: 'info', text: `Nexus download started (mod ${info.modId})` });
    const links = await nexus.downloadLinks(info.domain, info.modId, info.fileId, info);
    const modInfo = await nexus.mod(info.domain, info.modId).catch(() => null);
    const fileInfo = await nexus.files(info.domain, info.modId).then((r) => r.files.find((f) => String(f.file_id) === info.fileId)).catch(() => null);
    const entry = await downloads.download(links[0].URI, { fileName: fileInfo?.file_name, meta: { title: modInfo?.name } });
    const result = await mods.installFile(gameId, entry.dest, {
      name: modInfo?.name, version: fileInfo?.version || modInfo?.version, source: 'nexus', sourceId: info.modId, fileId: info.fileId,
      sourceUrl: `https://www.nexusmods.com/${info.domain}/mods/${info.modId}`,
    });
    send('nxm:installed', { gameId, result });
  } catch (e) {
    send('toast', { kind: 'error', text: e.message });
  }
}

function nxmFromArgv(argv) {
  return argv.find((a) => a.startsWith('nxm://'));
}

// ---------- IPC ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      logError(channel, e);
      return { ok: false, error: e.message || String(e) };
    }
  });
}

function gameView(gameId) {
  const g = mods.game(gameId);
  const s = mods.state(gameId);
  return {
    ...publicInfo(GAMES[gameId]),
    installDir: s.installDir,
    stagingDir: s.installDir ? mods.stagingDir(gameId) : null,
    mcVersion: s.mcVersion,
    loader: s.loader,
    profiles: mods.profiles(gameId),
    deployment: { deployedAt: s.deployment.deployedAt, dirty: s.deployment.dirty, files: Object.keys(s.deployment.files || {}).length },
    modCount: Object.keys(s.mods).length,
    scriptExtender: g.kind === 'bethesda' && g.installDir ? fs.existsSync(path.join(g.installDir, g.loader)) : null,
    scriptExtenderName: GAMES[gameId].scriptExtender || null,
    mcProfiles: g.kind === 'minecraft' && g.installDir ? detectMinecraftProfiles(g.installDir) : [],
    deployMode: mods.deployMode(gameId),
    instances: mods.instances(gameId),
    profileOptions: Object.fromEntries(Object.entries(s.profiles).map(([name, p]) => [name, { localInis: !!p.localInis, localSaves: !!p.localSaves }])),
    overwriteCount: s.installDir && mods.deployMode(gameId) === 'virtual' ? vfs.overwriteFiles(gameId).length : 0,
  };
}

async function installMany(gameId, files) {
  const results = [];
  for (const f of files) {
    try {
      if (/\.mrpack$/i.test(f)) results.push(...(await importMrpack(gameId, f)));
      else results.push(await mods.installFile(gameId, f, {}));
    } catch (e) {
      results.push({ error: `${path.basename(f)}: ${e.message}` });
    }
  }
  return results;
}

async function installModrinth(gameId, projectId) {
  const s = mods.state(gameId);
  const installedIds = new Set(Object.values(s.mods).filter((m) => m.source === 'modrinth').map((m) => m.sourceId));
  const jobs = await modrinth.resolve(projectId, { mcVersion: s.mcVersion, loader: s.loader, skip: installedIds });
  const results = [];
  for (const job of jobs) {
    if (job.error) {
      results.push({ error: job.error });
      continue;
    }
    const { path: file, meta } = await modrinth.downloadJob(job);
    results.push(await mods.installFile(gameId, file, meta));
  }
  return results;
}

async function importMrpack(gameId, file) {
  const { tmp, index } = await modrinth.readMrpack(file);
  const s = mods.state(gameId);
  const deps = index.dependencies || {};
  if (deps.minecraft) s.mcVersion = deps.minecraft;
  s.loader = deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : deps.neoforge ? 'neoforge' : deps.forge ? 'forge' : s.loader;
  mods.save(gameId);
  const results = [];
  const files = (index.files || []).filter((f) => f.env?.client !== 'unsupported');
  for (const f of files) {
    try {
      const entry = await downloads.download(f.downloads[0], { fileName: path.basename(f.path) });
      const sub = f.path.split('/')[0];
      const type = { resourcepacks: 'mc-resourcepack', shaderpacks: 'mc-shaderpack' }[sub] || 'mc-mod';
      results.push(await mods.installFile(gameId, entry.dest, {
        name: path.basename(f.path).replace(/\.(jar|zip)$/i, ''), type, source: 'modrinth-pack',
        modrinth: { url: f.downloads[0], hashes: f.hashes, size: f.fileSize, filename: path.basename(f.path) },
      }));
    } catch (e) {
      results.push({ error: `${f.path}: ${e.message}` });
    }
  }
  for (const dir of ['overrides', 'client-overrides']) {
    const o = path.join(tmp, dir);
    if (!fs.existsSync(o)) continue;
    const id = `${(index.name || 'pack').replace(/[^a-z0-9]+/gi, '-')}-${dir}-${Date.now().toString(36)}`;
    fs.cpSync(o, mods.modDir(gameId, id), { recursive: true });
    const st = mods.state(gameId);
    st.mods[id] = { id, name: `${index.name} (${dir})`, type: 'mc-root', source: 'modrinth-pack', installedAt: new Date().toISOString() };
    mods.profile(gameId).order.push(id);
    mods.profile(gameId).enabled[id] = true;
    mods.save(gameId);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return results;
}

function registerIpc() {
  handle('app:init', () => {
    const detected = applyDetection();
    const s = settings();
    if (!s.managedGames) {
      // First run: the original four games plus every library game found on this PC.
      s.managedGames = Object.keys(GAMES).filter((id) => CORE.includes(id) || detected[id]);
      store.save('settings', s);
    }
    return {
      games: Object.values(GAMES).map((g) => gameView(g.id)),
      settings: settings(),
      keys: { anthropic: !!store.getSecret('anthropicApiKey'), nexus: !!store.getSecret('nexusApiKey') },
      version: app.getVersion(),
    };
  });
  handle('games:rescan', () => {
    applyDetection();
    return { games: Object.values(GAMES).map((g) => gameView(g.id)) };
  });
  function applyDetection() {
    const detected = detectAll();
    for (const [id, d] of Object.entries(detected)) {
      const s = mods.state(id);
      if (!s.installDir && d) mods.setGamePath(id, d.installDir);
      if (id === 'minecraft' && d && !s.mcVersion) {
        const modded = (d.profiles || []).filter((p) => p.loader !== 'vanilla' && /^\d+\.\d+(\.\d+)?$/.test(p.mcVersion));
        const pick = modded.sort((a, b) => b.mcVersion.localeCompare(a.mcVersion, undefined, { numeric: true }))[0];
        if (pick) {
          s.mcVersion = pick.mcVersion;
          s.loader = pick.loader;
          mods.save(id);
        }
      }
    }
    return detected;
  }
  handle('game:get', (gameId) => gameView(gameId));
  handle('game:pickFolder', async (gameId) => {
    const r = await dialog.showOpenDialog(win, { title: `Select the ${GAMES[gameId].name} folder`, properties: ['openDirectory'] });
    if (r.canceled) return null;
    const dir = r.filePaths[0];
    const g = GAMES[gameId];
    if (g.kind === 'bethesda' && !fs.existsSync(path.join(dir, g.exe))) throw new Error(`${g.exe} was not found in that folder.`);
    mods.setGamePath(gameId, dir);
    return gameView(gameId);
  });
  handle('game:setMinecraft', (gameId, { mcVersion, loader }) => {
    const s = mods.state(gameId);
    if (mcVersion !== undefined) s.mcVersion = mcVersion;
    if (loader !== undefined) s.loader = loader;
    mods.save(gameId);
    return gameView(gameId);
  });
  handle('game:launch', (gameId) => launchGame(gameId));
  handle('game:openFolder', (gameId, which) => {
    const g = mods.game(gameId);
    const map = { install: g.installDir, staging: mods.stagingDir(gameId), mygames: g.kind === 'bethesda' ? g.myGames() : g.installDir, downloads: downloads.downloadsDir() };
    if (map[which]) shell.openPath(map[which]);
  });

  handle('mods:list', (gameId) => mods.listMods(gameId));
  handle('mods:installDialog', async (gameId) => {
    const g = GAMES[gameId];
    const filters = g.kind === 'minecraft'
      ? [{ name: 'Minecraft mods / packs', extensions: ['jar', 'zip', 'mrpack'] }]
      : [{ name: 'Mod archives', extensions: ['zip', '7z', 'rar', 'esp', 'esm', 'esl'] }];
    const r = await dialog.showOpenDialog(win, { title: 'Install mods from files', properties: ['openFile', 'multiSelections'], filters });
    if (r.canceled) return [];
    return installMany(gameId, r.filePaths);
  });
  handle('mods:installPaths', (gameId, files) => installMany(gameId, files));
  handle('mods:remove', (gameId, modId) => mods.removeMod(gameId, modId));
  handle('mods:setEnabled', (gameId, modId, enabled) => mods.setEnabled(gameId, modId, enabled));
  handle('mods:setOrder', (gameId, order) => mods.setOrder(gameId, order));
  handle('mods:rename', (gameId, modId, name) => mods.renameMod(gameId, modId, name));
  handle('mods:openFolder', (gameId, modId) => shell.openPath(mods.modDir(gameId, modId)));
  handle('mods:files', (gameId, modId) => mods.walk(mods.modDir(gameId, modId)).slice(0, 3000));

  handle('fomod:step', (token, from, selections) => mods.fomodVisibleStep(token, from, selections));
  handle('fomod:complete', (token, selections) => mods.fomodComplete(token, selections));
  handle('fomod:cancel', (token) => mods.fomodCancel(token));
  handle('fomod:image', (file) => {
    const img = nativeImage.createFromPath(file);
    return img.isEmpty() ? null : img.resize({ width: 480 }).toDataURL();
  });

  handle('instances:create', (gameId, name, copy) => mods.createInstance(gameId, name, copy));
  handle('instances:switch', (gameId, name) => mods.switchInstance(gameId, name));
  handle('instances:delete', (gameId, name) => mods.deleteInstance(gameId, name));
  handle('mode:set', async (gameId, mode) => {
    if (mode === 'virtual') await vfs.ensureUsvfs((ev) => send('engine:progress', ev));
    return mods.setDeployMode(gameId, mode);
  });
  handle('profiles:options', (gameId, name, opts) => mods.setProfileOptions(gameId, name, opts));
  handle('profiles:rename', (gameId, from, to) => mods.renameProfile(gameId, from, to));
  handle('profiles:openFolder', (gameId, name) => shell.openPath(mods.profileDir(gameId, name)));
  handle('overwrite:list', (gameId) => vfs.overwriteFiles(gameId));
  handle('overwrite:toMod', (gameId, name) => vfs.overwriteToMod(gameId, name));
  handle('overwrite:clear', (gameId) => vfs.clearOverwrite(gameId));
  handle('overwrite:open', (gameId) => shell.openPath(mods.overwriteDir(gameId)));
  handle('profiles:create', (gameId, name, copyFrom) => mods.createProfile(gameId, name, copyFrom));
  handle('profiles:switch', (gameId, name) => mods.switchProfile(gameId, name));
  handle('profiles:delete', (gameId, name) => mods.deleteProfile(gameId, name));

  handle('deploy', (gameId) => mods.deploy(gameId, (p) => send('deploy:progress', p)));
  handle('purge', (gameId) => mods.purge(gameId));

  handle('plugins:get', (gameId) => {
    const g = mods.game(gameId);
    if (!g.installDir) return { implicit: [], plugins: [], issues: [], counts: {} };
    const scan = plugins.scan(g);
    return { ...scan, ...plugins.analyze(g, scan) };
  });
  handle('plugins:save', (gameId, list) => mods.savePluginOrder(gameId, list));
  handle('plugins:autosort', (gameId) => {
    const g = mods.game(gameId);
    const sorted = plugins.autoSort(plugins.scan(g).plugins);
    mods.savePluginOrder(gameId, sorted.map((p) => ({ name: p.name, enabled: p.enabled })));
  });
  handle('plugins:loot', (gameId) => tools.lootSort(gameId));
  handle('archive:list', (file) => archives.listArchive(file));

  handle('modrinth:search', (params) => modrinth.search(params));
  handle('thunderstore:search', async (gameId, query) => {
    const community = GAMES[gameId].thunderstore;
    await thunderstore.index(community, (p) => send('toast', { kind: 'info', text: `Loading Thunderstore catalog… ${p.done + 1}/${p.total}` }));
    return thunderstore.search(community, query);
  });
  handle('thunderstore:install', (gameId, fullName) => thunderstore.install(gameId, GAMES[gameId].thunderstore, fullName));
  handle('modrinth:install', (gameId, projectId) => installModrinth(gameId, projectId));
  handle('mrpack:export', async (gameId) => {
    const s = mods.state(gameId);
    const r = await dialog.showSaveDialog(win, { title: 'Export modpack', defaultPath: `${s.activeProfile}.mrpack`, filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] });
    if (r.canceled) return null;
    const list = mods.listMods(gameId).filter((m) => m.enabled).map((m) => ({
      ...m, localFile: m.fileName ? path.join(mods.modDir(gameId, m.id), m.fileName) : null,
    }));
    let loaderVersion;
    if (s.loader === 'fabric') loaderVersion = (await loaders.fabric(s.mcVersion).catch(() => null))?.version;
    return modrinth.exportMrpack({ name: s.activeProfile, mcVersion: s.mcVersion, loader: s.loader, loaderVersion, mods: list, outFile: r.filePath, instanceDir: mods.game(gameId).installDir });
  });
  handle('collection:export', async (gameId) => {
    const s = mods.state(gameId);
    const g = mods.game(gameId);
    const r = await dialog.showSaveDialog(win, { title: 'Export mod list', defaultPath: `${g.short} - ${s.activeProfile}.shuriken.json`, filters: [{ name: 'Shuriken collection', extensions: ['json'] }] });
    if (r.canceled) return null;
    const data = {
      format: 'shuriken-collection-1', game: gameId, profile: s.activeProfile, exportedAt: new Date().toISOString(),
      mods: mods.listMods(gameId).filter((m) => m.enabled).map((m) => ({ name: m.name, version: m.version, source: m.source, sourceId: m.sourceId, fileId: m.fileId, url: m.sourceUrl, fomodChoices: m.fomodChoices })),
      plugins: g.kind === 'bethesda' && g.installDir ? plugins.readPluginsTxt(g) : undefined,
    };
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
    return r.filePath;
  });

  handle('nexus:validate', () => nexus.validate());
  handle('nexus:list', (gameId, kind) => nexus.list(GAMES[gameId].nexusDomain, kind));
  handle('nexus:files', (gameId, modId) => nexus.files(GAMES[gameId].nexusDomain, modId));
  handle('nexus:mod', (gameId, modIdOrUrl) => {
    const parsed = nexus.parseModUrl(modIdOrUrl);
    return nexus.mod(parsed?.domain || GAMES[gameId].nexusDomain, parsed?.modId || modIdOrUrl);
  });
  handle('nexus:download', async (gameId, modId, fileId) => {
    const domain = GAMES[gameId].nexusDomain;
    const links = await nexus.downloadLinks(domain, modId, fileId);
    const modInfo = await nexus.mod(domain, modId).catch(() => null);
    const fileInfo = await nexus.files(domain, modId).then((r) => r.files.find((f) => String(f.file_id) === String(fileId))).catch(() => null);
    const entry = await downloads.download(links[0].URI, { fileName: fileInfo?.file_name });
    return mods.installFile(gameId, entry.dest, { name: modInfo?.name, version: fileInfo?.version, source: 'nexus', sourceId: modId, fileId, sourceUrl: `https://www.nexusmods.com/${domain}/mods/${modId}` });
  });

  handle('mc:versions', () => loaders.minecraftVersions());
  handle('loader:install', async (loader, mcVersion) => {
    const info = await loaders[loader](mcVersion);
    const entry = await downloads.download(info.url, { fileName: info.fileName });
    const java = findJava();
    if (!java) {
      shell.showItemInFolder(entry.dest);
      return { ...info, file: entry.dest, note: 'Java was not found, so the installer was saved instead. Double-click it, or install Java 21 from adoptium.net.' };
    }
    const args = ['-jar', entry.dest, ...(loader === 'fabric' ? info.cliArgs : [])];
    spawn(java, args, { cwd: path.dirname(entry.dest), detached: true, stdio: 'ignore' }).unref();
    return { ...info, file: entry.dest, note: loader === 'fabric' ? 'Fabric was installed into the Minecraft Launcher. Pick the new Fabric profile there.' : `The ${loader} installer is open. Choose "Install client" and click OK.` };
  });

  handle('downloads:list', () => downloads.listDownloaded());
  handle('downloads:remove', (file) => {
    if (path.dirname(path.resolve(file)).toLowerCase() !== downloads.downloadsDir().toLowerCase()) throw new Error('Not a download');
    fs.rmSync(file, { force: true });
  });

  handle('tools:list', (gameId) => tools.list(gameId));
  handle('tools:addDialog', async (gameId) => {
    const r = await dialog.showOpenDialog(win, { title: 'Add a modding tool', properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe', 'bat', 'cmd'] }] });
    if (r.canceled) return null;
    return tools.add(gameId, { path: r.filePaths[0] });
  });
  handle('tools:add', (gameId, tool) => tools.add(gameId, tool));
  handle('tools:remove', (gameId, toolId) => tools.remove(gameId, toolId));
  handle('tools:launch', async (gameId, toolId) => {
    const s = mods.state(gameId);
    if (s.deployment.dirty && settings().autoDeployOnLaunch) await mods.deploy(gameId);
    return tools.launch(gameId, toolId);
  });
  handle('tools:xeditClean', (gameId, plugin) => tools.xeditQuickClean(gameId, plugin));
  handle('tools:scan', (gameId) => tools.scanForGame(gameId));

  handle('workshop:list', (gameId) => workshop.list(gameId));
  handle('workshop:kinds', (gameId) => Object.entries(workshop.KINDS).filter(([id]) => workshop.kindAllowed(id, gameId)).map(([id, k]) => ({ id, label: k.label })));
  handle('workshop:create', (gameId, name, kind) => workshop.create(gameId, name, kind));
  handle('workshop:remove', (projectId) => workshop.remove(projectId));
  handle('workshop:files', (projectId) => workshop.files(projectId));
  handle('workshop:read', (projectId, rel) => workshop.readFile(projectId, rel));
  handle('workshop:write', (projectId, rel, content) => workshop.writeFile(projectId, rel, content));
  handle('workshop:package', (projectId, world) => workshop.packageProject(projectId, { world }));
  handle('workshop:open', (projectId) => shell.openPath(workshop.get(projectId).dir));
  handle('mc:worlds', (gameId) => mcx.listWorlds(gameId));

  handle('diag:health', (gameId) => diagnostics.healthCheck(gameId));
  handle('diag:crashLogs', (gameId) => diagnostics.listCrashLogs(gameId));
  handle('diag:read', (file) => diagnostics.readText(file, 200000));

  handle('settings:set', (patch) => {
    const s = settings();
    Object.assign(s, patch);
    store.save('settings', s);
    if ('handleNxm' in patch) {
      if (patch.handleNxm) app.setAsDefaultProtocolClient('nxm');
      else app.removeAsDefaultProtocolClient('nxm');
    }
    return s;
  });
  handle('secrets:set', (key, value) => {
    if (!['anthropicApiKey', 'nexusApiKey'].includes(key)) throw new Error('Unknown secret');
    store.setSecret(key, value);
    return true;
  });

  handle('screenshot:capture', (hideWindow) => captureScreen(hideWindow));
  handle('screenshot:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Attach screenshots', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }] });
    if (r.canceled) return [];
    return r.filePaths.map(imageFromFile);
  });
  handle('screenshot:fromPaths', (files) => files.map(imageFromFile));
  handle('screenshot:fromDataUrl', (dataUrl) => encodeImage(nativeImage.createFromDataURL(dataUrl)));

  handle('ai:send', async (req) => {
    const emit = (ev) => send('ai:event', { chatId: req.chatId, ...ev });
    const approve = (request) =>
      new Promise((resolve) => {
        pendingApprovals.set(request.id, { resolve, chatId: req.chatId });
        emit({ type: 'approval', request });
      });
    try {
      await ai.send(req, emit, approve);
    } catch (e) {
      if (e?.name === 'AbortError' || /abort/i.test(e?.name || '') || /aborted/i.test(e?.message || '')) emit({ type: 'stopped' });
      else {
        logError('ai', e);
        emit({ type: 'error', message: ai.friendlyError(e) });
      }
    }
  });
  const declineApprovals = (chatId) => {
    for (const [id, p] of pendingApprovals) {
      if (p.chatId !== chatId) continue;
      p.resolve(false);
      pendingApprovals.delete(id);
    }
  };
  handle('ai:approve', (id, ok) => {
    pendingApprovals.get(id)?.resolve(!!ok);
    pendingApprovals.delete(id);
  });
  handle('ai:stop', (chatId) => {
    ai.stop(chatId);
    declineApprovals(chatId);
  });
  handle('ai:reset', (chatId) => {
    declineApprovals(chatId);
    ai.reset(chatId);
  });
  handle('engine:status', () => engine.status(settings().localModel || engine.DEFAULT_MODEL));
  handle('engine:setup', (modelId) => engine.setup(modelId || settings().localModel || engine.DEFAULT_MODEL, (ev) => send('engine:progress', ev)));
  handle('engine:remove', (modelId) => engine.removeModel(modelId));
  handle('engine:stop', () => engine.stop());
  handle('engine:warm', () => engine.warm(settings().localModel || engine.DEFAULT_MODEL));
  handle('log:error', (where, message) => logError(`renderer:${where}`, message));
  handle('logs:open', () => shell.openPath(store.dataDir('logs')));
  // Text for "Copy bug report": versions, games and the tail of the logs (no keys or personal paths beyond folders).
  handle('app:bugReport', async () => {
    const tail = (file, n) => {
      try {
        return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-n).join('\n');
      } catch {
        return '(none)';
      }
    };
    const s = settings();
    const st = await engine.status(s.localModel || engine.DEFAULT_MODEL).catch((e) => ({ error: e.message }));
    return [
      `Shuriken ${app.getVersion()} · Electron ${process.versions.electron} · Windows ${require('os').release()}`,
      `AI: ${ai.provider(s)} · engine ${st.build || 'not installed'} · model ${st.model} ready=${st.ready} · ${st.device || ''}`,
      `Games: ${(s.managedGames || []).map((id) => `${id}${mods.state(id).installDir ? '' : '(no folder)'}:${Object.keys(mods.state(id).mods).length} mods`).join(', ')}`,
      '--- shuriken.log ---',
      tail(path.join(app.getPath('userData'), 'logs', 'shuriken.log'), 80),
      '--- engine.log ---',
      tail(path.join(app.getPath('userData'), 'logs', 'engine.log'), 25),
    ].join('\n');
  });
  // Looks for a newer GitHub release.
  handle('app:checkUpdate', async () => {
    const res = await fetch('https://api.github.com/repos/npscott202-stack/Shuriken-Mod-Manager/releases/latest', { headers: { 'User-Agent': 'Shuriken' } });
    if (!res.ok) return null;
    const rel = await res.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    const newer = (a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
      return false;
    };
    return newer(latest, app.getVersion()) ? { version: latest, url: rel.html_url } : null;
  });

  handle('shell:open', (target) => {
    if (/^https?:\/\//.test(target)) return shell.openExternal(target);
    return shell.openPath(target);
  });
  handle('shell:showItem', (target) => shell.showItemInFolder(target));
  handle('dialog:openFile', async (filters) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
    return r.canceled ? null : r.filePaths[0];
  });

  downloads.events.on('progress', (p) => send('download:progress', p));
}

// Asks the local model a question it can only answer by calling a tool (read-only; write tools are declined).
async function localAiSelfTest(log) {
  const s = settings();
  const savedProvider = s.aiProvider;
  const savedThink = s.localThink;
  s.aiProvider = 'local';
  if (process.env.MODFORGE_LOCALAI_NOTHINK) s.localThink = false;
  store.save('settings', s);
  const events = { text: '', tools: [], thinking: 0 };
  const t0 = Date.now();
  try {
    const images = process.env.MODFORGE_LOCALAI_IMAGE ? [{ mediaType: 'image/png', data: fs.readFileSync(process.env.MODFORGE_LOCALAI_IMAGE).toString('base64') }] : [];
    await ai.send({ chatId: `selftest-${Date.now()}`, gameId: 'fallout4', images, text: process.env.MODFORGE_LOCALAI_PROMPT || 'Using your tools, tell me how many plugins are active in my Fallout 4 load order and whether there are any load order problems. Keep it short.' },
      (ev) => {
        if (ev.type === 'text') events.text += ev.delta;
        if (ev.type === 'thinking') events.thinking += ev.delta.length;
        if (ev.type === 'tool' && ['done', 'error'].includes(ev.status)) events.tools.push(`${ev.name}:${ev.status}`);
      },
      async () => false);
  } catch (e) {
    events.text = `ERROR ${e.message}`;
  }
  log('localai', `${Math.round((Date.now() - t0) / 1000)}s`, 'tools', events.tools, 'thinking chars', events.thinking, 'answer:', events.text.slice(0, 1200));
  if (savedProvider === undefined) delete s.aiProvider;
  else s.aiProvider = savedProvider;
  if (savedThink === undefined) delete s.localThink;
  else s.localThink = savedThink;
  store.save('settings', s);
}

// ---------- self test (npm run selftest) ----------
async function selfTest() {
  const out = [];
  const log = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  try {
    if (process.env.MODFORGE_ONLY_TS) {
      const os = require('os');
      let t0 = Date.now();
      const hits = await thunderstore.search('valheim', 'jotunn', 3);
      log('ts search', `${Math.round((Date.now() - t0) / 1000)}s`, hits.map((h) => `${h.full} ${h.version} deps=${h.deps.join(',')}`));
      const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'shuriken-fakevh-'));
      const st = mods.state('valheim');
      const saved = JSON.parse(JSON.stringify(st));
      Object.assign(st, { installDir: fake, stagingDir: path.join(fake, '_staging'), mods: {}, profiles: { Default: { order: [], enabled: {}, plugins: null } }, activeProfile: 'Default', deployment: { files: {}, deployedAt: null, dirty: false } });
      t0 = Date.now();
      const r = await thunderstore.install('valheim', 'valheim', hits[0].full);
      log('ts install', `${Math.round((Date.now() - t0) / 1000)}s`, r.map((x) => x.error || `${x.mod.name} ${x.mod.version}`));
      log('ts deploy', await mods.deploy('valheim'));
      const top = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
      log('ts layout root', top(fake).filter((n) => !n.startsWith('_')), 'plugins', top(path.join(fake, 'BepInEx', 'plugins')));
      mods.purge('valheim');
      Object.keys(st).forEach((k) => delete st[k]);
      Object.assign(st, saved);
      mods.save('valheim');
      fs.rmSync(fake, { recursive: true, force: true });
      throw new Error('done (thunderstore only)');
    }
    if (process.env.MODFORGE_ONLY_VFS) {
      // Virtual mode + instances against a throwaway fake Fallout 4 folder. The "game" is a copy of
      // cmd.exe that lists what it sees, so nothing real is launched or modified.
      const os = require('os');
      const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'shuriken-vfsgame-'));
      fs.mkdirSync(path.join(fake, 'Data'));
      fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'cmd.exe'), path.join(fake, 'Fallout4.exe'));
      fs.writeFileSync(path.join(fake, 'Data', 'Fallout4.esm'), Buffer.concat([Buffer.from('TES4'), Buffer.alloc(20)]));
      const inst = mods.instances('fallout4');
      const savedActive = inst.active;
      const st = mods.state('fallout4');
      const saved = JSON.parse(JSON.stringify(st));
      Object.keys(st).forEach((k) => delete st[k]);
      Object.assign(st, { installDir: fake, stagingDir: path.join(fake, '_staging'), mods: {}, profiles: { Default: { order: [], enabled: {}, plugins: null } }, activeProfile: 'Default', deployment: { files: {}, deployedAt: null, dirty: false }, tools: [] });
      mods.save('fallout4');
      try {
        const src = path.join(fake, '_src', 'MyMod', 'Data');
        fs.mkdirSync(path.join(src, 'meshes'), { recursive: true });
        fs.writeFileSync(path.join(src, 'meshes', 'virtual_a.nif'), 'mesh');
        fs.writeFileSync(path.join(src, 'VirtualPlugin.esp'), Buffer.concat([Buffer.from('TES4'), Buffer.alloc(20)]));
        execFileSync(require('7zip-bin').path7za, ['a', '-tzip', path.join(fake, 'mymod.zip'), path.join(fake, '_src', 'MyMod')]);
        const inst1 = await mods.installFile('fallout4', path.join(fake, 'mymod.zip'), {});
        log('vfs install', inst1.mod?.name);
        await vfs.ensureUsvfs();
        log('vfs mode', mods.setDeployMode('fallout4', 'virtual'), 'deploy', JSON.stringify(await mods.deploy('fallout4')));
        const g = mods.game('fallout4');
        log('vfs load order sees', plugins.scan(g).plugins.map((p) => p.name));
        fs.writeFileSync(path.join(mods.profileDir('fallout4'), 'plugins.txt'), '*VirtualPlugin.esp\r\n');
        const out = path.join(fake, 'seen.txt');
        const realPlugins = path.join(GAMES.fallout4.pluginsDir(), 'plugins.txt');
        const before = fs.existsSync(realPlugins) ? fs.readFileSync(realPlugins, 'utf8') : '';
        const t0 = Date.now();
        await vfs.launch('fallout4', { exe: path.join(fake, 'Fallout4.exe'), args: `/c dir /b /s "${path.join(fake, 'Data')}" > "${out}" & type "${realPlugins}" >> "${out}" & echo made> "${path.join(fake, 'Data', 'GameCreated.txt')}"`, wait: true, timeoutMs: 120000 });
        const seen = fs.readFileSync(out, 'utf8');
        log('vfs launch', `${Date.now() - t0}ms`, 'sees mesh:', /virtual_a\.nif/.test(seen), 'sees plugin:', /VirtualPlugin\.esp/.test(seen), 'profile plugins.txt served:', seen.includes('*VirtualPlugin.esp'));
        log('vfs game folder clean:', !fs.existsSync(path.join(fake, 'Data', 'meshes')) && !fs.existsSync(path.join(fake, 'Data', 'GameCreated.txt')), 'overwrite:', vfs.overwriteFiles('fallout4'), 'real plugins.txt unchanged:', (fs.existsSync(realPlugins) ? fs.readFileSync(realPlugins, 'utf8') : '') === before);
        mods.createInstance('fallout4', 'Selftest Instance', false);
        mods.switchInstance('fallout4', 'Selftest Instance');
        log('instance switched:', mods.instances('fallout4').active, 'mods there:', Object.keys(mods.state('fallout4').mods).length, 'staging:', path.basename(mods.stagingDir('fallout4')));
        mods.switchInstance('fallout4', savedActive);
        mods.deleteInstance('fallout4', 'Selftest Instance');
        log('instance back:', mods.instances('fallout4').active, 'list:', mods.instances('fallout4').list, 'mods:', Object.keys(mods.state('fallout4').mods).length);
      } finally {
        mods.switchInstance('fallout4', savedActive);
        const cur = mods.state('fallout4');
        Object.keys(cur).forEach((k) => delete cur[k]);
        Object.assign(cur, saved);
        mods.save('fallout4');
        fs.rmSync(fake, { recursive: true, force: true });
      }
      throw new Error('done (vfs only)');
    }
    if (process.env.MODFORGE_ONLY_LOCALAI) {
      await localAiSelfTest(log);
      throw new Error('done (local AI only)');
    }
    const detected = detectAll();
    log('detected', Object.fromEntries(Object.entries(detected).map(([k, v]) => [k, v?.installDir || null])));
    for (const [id, d] of Object.entries(detected)) if (d && !mods.state(id).installDir) mods.setGamePath(id, d.installDir);
    for (const id of Object.keys(GAMES)) {
      const g = mods.game(id);
      log(id, 'installDir', g.installDir, 'staging', g.installDir ? mods.stagingDir(id) : null);
      if (g.kind === 'bethesda' && g.installDir) {
        const scan = plugins.scan(g);
        log(id, 'implicit', scan.implicit.length, 'plugins', scan.plugins.length, plugins.analyze(g, scan).counts);
      }
      log(id, 'health', await diagnostics.healthCheck(id));
    }
    const res = await modrinth.search({ query: 'sodium', mcVersion: '1.21.1', loader: 'fabric', limit: 2 });
    log('modrinth', res.hits.map((h) => h.title));
    log('fabric', (await loaders.fabric('1.21.1')).version);

    // Archive reader against a real game archive (read-only).
    const fo4 = mods.game('fallout4');
    if (fo4.installDir) {
      const ba2 = fs.readdirSync(path.join(fo4.installDir, 'Data')).find((f) => /\.ba2$/i.test(f));
      if (ba2) {
        const r = archives.listArchive(path.join(fo4.installDir, 'Data', ba2));
        log('ba2', ba2, r.format, r.fileCount, r.files.slice(0, 2));
      }
    }

    // Install/deploy/purge + FOMOD against a throwaway fake game folder.
    const os = require('os');
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'shuriken-fakegame-'));
    fs.mkdirSync(path.join(fake, 'Data'));
    fs.writeFileSync(path.join(fake, 'Fallout4.exe'), '');
    fs.writeFileSync(path.join(fake, 'Data', 'Fallout4.esm'), Buffer.concat([Buffer.from('TES4'), Buffer.alloc(20)]));
    fs.writeFileSync(path.join(fake, 'Data', 'original.txt'), 'vanilla');
    const saved = { ...mods.state('fallout4') };
    const st = mods.state('fallout4');
    Object.assign(st, { installDir: fake, stagingDir: path.join(fake, '_staging'), pluginsDirOverride: path.join(fake, '_appdata'), mods: {}, profiles: { Default: { order: [], enabled: {}, plugins: [] } }, activeProfile: 'Default', deployment: { files: {}, deployedAt: null, dirty: false } });
    const src = path.join(fake, '_src');
    fs.mkdirSync(path.join(src, 'MyMod', 'Data', 'meshes'), { recursive: true });
    fs.writeFileSync(path.join(src, 'MyMod', 'Data', 'meshes', 'a.nif'), 'mesh');
    fs.writeFileSync(path.join(src, 'MyMod', 'Data', 'original.txt'), 'modded');
    const exe = require('7zip-bin').path7za;
    execFileSync(exe, ['a', '-tzip', path.join(fake, 'mymod.zip'), path.join(src, 'MyMod')]);
    const inst = await mods.installFile('fallout4', path.join(fake, 'mymod.zip'), {});
    log('install', inst.mod?.type, mods.walk(mods.modDir('fallout4', inst.mod.id)));
    const fomodSrc = path.join(src, 'Fomod');
    fs.mkdirSync(path.join(fomodSrc, 'fomod'), { recursive: true });
    fs.mkdirSync(path.join(fomodSrc, 'OptA', 'textures'), { recursive: true });
    fs.mkdirSync(path.join(fomodSrc, 'OptB', 'textures'), { recursive: true });
    fs.writeFileSync(path.join(fomodSrc, 'OptA', 'textures', 'a.dds'), 'A');
    fs.writeFileSync(path.join(fomodSrc, 'OptB', 'textures', 'b.dds'), 'B');
    fs.writeFileSync(path.join(fomodSrc, 'fomod', 'ModuleConfig.xml'), `<config><moduleName>Test</moduleName><installSteps order="Explicit"><installStep name="Pick"><optionalFileGroups order="Explicit"><group name="Res" type="SelectExactlyOne"><plugins order="Explicit"><plugin name="A"><description>a</description><files><folder source="OptA" destination="" /></files><typeDescriptor><type name="Optional"/></typeDescriptor></plugin><plugin name="B"><description>b</description><files><folder source="OptB" destination="" /></files><typeDescriptor><type name="Optional"/></typeDescriptor></plugin></plugins></group></optionalFileGroups></installStep></installSteps></config>`);
    execFileSync(exe, ['a', '-tzip', path.join(fake, 'fomod.zip'), path.join(fomodSrc, '*')]);
    const f = await mods.installFile('fallout4', path.join(fake, 'fomod.zip'), {});
    const step = mods.fomodVisibleStep(f.fomod.token, 0, {});
    const fm = mods.fomodComplete(f.fomod.token, { 0: { 0: [1] } });
    log('fomod', step, mods.walk(mods.modDir('fallout4', fm.id)));
    const dep = await mods.deploy('fallout4');
    log('deploy', dep, fs.readFileSync(path.join(fake, 'Data', 'original.txt'), 'utf8'), fs.existsSync(path.join(fake, 'Data', 'textures', 'b.dds')));
    mods.setEnabled('fallout4', inst.mod.id, false);
    log('redeploy', await mods.deploy('fallout4'), fs.readFileSync(path.join(fake, 'Data', 'original.txt'), 'utf8'));
    log('purge', mods.purge('fallout4'), fs.readdirSync(path.join(fake, 'Data')));
    log('find', mods.findFile('fallout4', 'b.dds'));
    Object.keys(st).forEach((k) => delete st[k]);
    Object.assign(st, saved);
    mods.save('fallout4');
    fs.rmSync(fake, { recursive: true, force: true });

    // ---- integrations (read-only against the real setup) ----
    const ai = require('./src/core/ai');
    const names = ai.TOOL_DEFS.map((t) => t.name);
    const badSchema = ai.TOOL_DEFS.filter((t) => (t.input_schema.required || []).some((r) => !(r in t.input_schema.properties)));
    log('ai tools', names.length, 'unique', new Set(names).size === names.length, 'bad schemas', badSchema.map((t) => t.name));
    let t0 = Date.now();
    const scanned = tools.scanForGame('fallout4');
    log('tool scan fo4', `${Date.now() - t0}ms`, scanned.map((x) => `${x.kind}:${x.path}`));
    log('tool scan mc', tools.scanForGame('minecraft').map((x) => `${x.kind}:${x.path}`));
    log('papyrus fo4', beth.papyrusInfo('fallout4'));
    log('fo4 archives', await beth.fo4ArchiveCheck('fallout4'));
    log('loot', JSON.stringify(beth.lootInfo('fallout4', 'Unofficial Fallout 4 Patch.esp')).slice(0, 300));
    const nifTmp = path.join(os.tmpdir(), 'mf-test.nif');
    fs.writeFileSync(nifTmp, Buffer.concat([Buffer.from('Gamebryo File Format\0\0'), Buffer.from('textures\\architecture\\test_d.dds\0junk\0Textures\\Actors\\Character\\BaseHumanFemale\\BaseFemaleHead_d.DDS\0')]));
    t0 = Date.now();
    log('nif check', beth.checkNif('fallout4', nifTmp), `${Date.now() - t0}ms`);
    const hm = mcx.generateHeightmap({ width: 512, height: 512, seed: 42, style: 'islands' });
    const img = nativeImage.createFromPath(hm.file);
    log('heightmap', hm.waterCoverage, hm.worldPainterMapping, 'decodes', img.getSize());
    log('worlds', mcx.listWorlds('minecraft').map((w) => `${w.folder}: ${w.name} ${w.version} ${w.gameType} ${w.error || ''}`));
    log('wpscript', mcx.wpscriptPath('minecraft'), 'jdk', mcx.findJdk());

    const dp = await workshop.create('minecraft', 'Selftest Pack', 'mc-datapack');
    workshop.writeFile(dp.id, 'pack.mcmeta', '{"pack":{"pack_format":48,"description":"test"}}');
    workshop.writeFile(dp.id, 'data/selftest/function/hello.mcfunction', 'say hello');
    log('workshop datapack', workshop.files(dp.id));
    try { workshop.writeFile(dp.id, '..\\..\\escape.txt', 'x'); log('ESCAPE NOT BLOCKED'); } catch (e) { log('escape blocked', e.message); }
    workshop.remove(dp.id);
    const bm = await workshop.create('fallout4', 'Selftest Beth', 'bethesda-mod');
    workshop.writeFile(bm.id, 'Scripts\\Source\\User\\SelftestScript.psc', 'ScriptName SelftestScript extends Quest\n');
    log('workshop beth', bm.dir, workshop.files(bm.id));
    workshop.remove(bm.id);
    log('fo4 mods after cleanup', Object.keys(mods.state('fallout4').mods).length);

    // ---- library: generic game install/deploy against a fake Stardew Valley folder ----
    log('library games', Object.keys(GAMES).length, 'detected', Object.entries(detectAll()).filter(([, d]) => d).map(([id]) => id));
    const fakeSv = fs.mkdtempSync(path.join(os.tmpdir(), 'shuriken-fakesv-'));
    const svState = mods.state('stardewvalley');
    const svSaved = JSON.parse(JSON.stringify(svState));
    Object.assign(svState, { installDir: fakeSv, stagingDir: path.join(fakeSv, '_staging'), mods: {}, profiles: { Default: { order: [], enabled: {}, plugins: null } }, activeProfile: 'Default', deployment: { files: {}, deployedAt: null, dirty: false } });
    const svSrc = path.join(fakeSv, '_src', 'Wrapper', 'CoolMod');
    fs.mkdirSync(svSrc, { recursive: true });
    fs.writeFileSync(path.join(svSrc, 'manifest.json'), '{"Name":"CoolMod"}');
    fs.writeFileSync(path.join(svSrc, 'CoolMod.dll'), 'x');
    execFileSync(require('7zip-bin').path7za, ['a', '-tzip', path.join(fakeSv, 'coolmod.zip'), path.join(fakeSv, '_src', 'Wrapper')]);
    const sv = await mods.installFile('stardewvalley', path.join(fakeSv, 'coolmod.zip'), {});
    log('generic install', sv.mod?.type, mods.walk(mods.modDir('stardewvalley', sv.mod.id)));
    log('generic deploy', await mods.deploy('stardewvalley'), fs.existsSync(path.join(fakeSv, 'Mods', 'CoolMod', 'manifest.json')));
    log('generic purge', mods.purge('stardewvalley'), fs.existsSync(path.join(fakeSv, 'Mods', 'CoolMod')));
    Object.keys(svState).forEach((k) => delete svState[k]);
    Object.assign(svState, svSaved);
    mods.save('stardewvalley');
    fs.rmSync(fakeSv, { recursive: true, force: true });

    if (process.env.MODFORGE_TEST_LOCALAI) await localAiSelfTest(log);

    if (process.env.MODFORGE_TEST_GRADLE) {
      t0 = Date.now();
      const fm = await workshop.create('minecraft', 'Selftest Fabric', 'fabric-mod', { mcVersion: '1.21.1' });
      log('fabric template', fm.template.templateBranch, fm.template.files.length);
      const b = await mcx.gradleBuild(fm.dir);
      log('gradle', b.ok, b.exitCode, b.jars.map((j) => path.basename(j)), `${Math.round((Date.now() - t0) / 1000)}s`, b.ok ? '' : b.output);
      workshop.remove(fm.id);
    }
  } catch (e) {
    log('SELFTEST ERROR', e.stack);
  }
  fs.writeFileSync(path.join(app.getPath('userData'), 'selftest.log'), out.join('\n'));
  console.log(out.join('\n'));
}

// ---------- startup ----------
// Keep using the data folder from before the rename (settings, keys, staged mods, deployment records).
const legacyData = path.join(app.getPath('appData'), 'ModForge');
app.setPath('userData', fs.existsSync(legacyData) ? legacyData : path.join(app.getPath('appData'), 'Shuriken'));

const isSelfTest = process.argv.includes('--selftest');
const isCapture = process.argv.some((a) => a.startsWith('--capture=') || a.startsWith('--smoke='));
if (!isSelfTest && !isCapture && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = nxmFromArgv(argv);
    if (link) handleNxm(link);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    store.init(app.getPath('userData'), safeStorage);
    loadCore();
    if (isSelfTest) {
      await selfTest();
      app.quit();
      return;
    }
    registerIpc();
    if (settings().handleNxm) app.setAsDefaultProtocolClient('nxm');
    createWindow();
    globalShortcut.register('CommandOrControl+Shift+F12', async () => {
      try {
        const shot = await captureScreen(false);
        send('screenshot:captured', shot);
      } catch (e) {
        send('toast', { kind: 'error', text: `Screenshot failed: ${e.message}` });
      }
    });
    const captureArg = process.argv.find((a) => a.startsWith('--capture='));
    if (captureArg) {
      // Dev aid: screenshots every page into a folder, then quits.
      const dir = captureArg.slice('--capture='.length);
      fs.mkdirSync(dir, { recursive: true });
      win.webContents.once('did-finish-load', async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        await wait(2500);
        const pages = (process.env.MODFORGE_CAPTURE_PAGES || 'dashboard,mods,plugins,browse,ai,tools,diagnostics,settings').split(',');
        for (const p of pages) {
          const [gameId, page] = p.includes(':') ? p.split(':') : [null, p];
          if (gameId) await win.webContents.executeJavaScript(`selectGame(${JSON.stringify(gameId)})`);
          await win.webContents.executeJavaScript(`go(${JSON.stringify(page)})`);
          await wait(page === 'browse' ? 4000 : 1800);
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(dir, `${p.replace(':', '-')}.png`), img.toPNG());
        }
        app.quit();
      });
    }
    const smokeArg = process.argv.find((a) => a.startsWith('--smoke='));
    if (smokeArg) {
      // Dev aid: visits every page for several kinds of games, records console errors, crashed
      // pages and screenshots, then quits. Results go to <dir>/smoke.json.
      const dir = smokeArg.slice('--smoke='.length);
      fs.mkdirSync(dir, { recursive: true });
      const problems = [];
      let where = 'startup';
      win.webContents.on('console-message', (e) => {
        const level = e.level ?? e.params?.level;
        const message = e.message ?? e.params?.message;
        if (level === 'warning' || level === 'error' || level === 2 || level === 3) problems.push({ where, level, message: String(message).slice(0, 2000) });
      });
      win.webContents.on('render-process-gone', (_e, d) => problems.push({ where, level: 'crash', message: d.reason }));
      win.webContents.once('did-finish-load', async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        await wait(3000);
        await win.webContents.executeJavaScript(`console.error('SMOKE-PROBE')`);
        await wait(200);
        const games = (process.env.SHURIKEN_SMOKE_GAMES || 'fallout4,starfield,minecraft,sims4,valheim,cyberpunk2077,skyrimse').split(',');
        const pages = ['library', 'dashboard', 'mods', 'plugins', 'browse', 'downloads', 'ai', 'workshop', 'tools', 'diagnostics', 'settings'];
        for (const gameId of games) {
          for (const page of pages) {
            where = `${gameId}:${page}`;
            try {
              await win.webContents.executeJavaScript(`selectGame(${JSON.stringify(gameId)}).then(() => go(${JSON.stringify(page)}))`);
              await wait(page === 'browse' ? 3500 : 600);
              const text = await win.webContents.executeJavaScript(`document.querySelector('#content').innerText.slice(0, 400)`);
              if (/Something went wrong/.test(text)) problems.push({ where, level: 'page', message: text });
              if (process.env.SHURIKEN_SMOKE_SHOTS) fs.writeFileSync(path.join(dir, `${gameId}-${page}.png`), (await win.webContents.capturePage()).toPNG());
            } catch (e) {
              problems.push({ where, level: 'exception', message: e.message });
            }
          }
        }
        fs.writeFileSync(path.join(dir, 'smoke.json'), JSON.stringify(problems, null, 1));
        app.quit();
      });
    }
    const link = nxmFromArgv(process.argv);
    if (link) win.webContents.once('did-finish-load', () => handleNxm(link));
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    engine?.stop();
  });
  app.on('window-all-closed', () => app.quit());
}
