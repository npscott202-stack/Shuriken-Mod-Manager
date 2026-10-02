// Game definitions and install detection (Steam libraries, Minecraft folder).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DOCS = () => require('electron').app.getPath('documents');
const LOCAL = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

const GAMES = {
  skyrimse: {
    id: 'skyrimse',
    name: 'Skyrim Special Edition',
    short: 'Skyrim SE',
    kind: 'bethesda',
    steamAppId: '489830',
    exe: 'SkyrimSE.exe',
    loader: 'skse64_loader.exe',
    scriptExtender: 'SKSE64',
    nexusDomain: 'skyrimspecialedition',
    xeditArg: '-sse',
    xeditNames: ['SSEEdit.exe', 'SSEEdit64.exe', 'xEdit.exe', 'xEdit64.exe'],
    myGames: () => path.join(DOCS(), 'My Games', 'Skyrim Special Edition'),
    pluginsDir: () => path.join(LOCAL(), 'Skyrim Special Edition'),
    iniFiles: ['Skyrim.ini', 'SkyrimPrefs.ini', 'SkyrimCustom.ini'],
    crashLogDirs: () => [
      path.join(DOCS(), 'My Games', 'Skyrim Special Edition', 'SKSE'),
      path.join(DOCS(), 'My Games', 'Skyrim Special Edition GOG', 'SKSE'),
    ],
    implicitPlugins: ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'],
    cccFile: 'Skyrim.ccc',
    lightFlag: 0x200,
    tools: ['SSEEdit', 'Creation Kit', 'LOOT', 'Bethesda Archive Extractor', 'Cathedral Assets Optimizer', 'Nemesis/Pandora'],
  },
  fallout4: {
    id: 'fallout4',
    name: 'Fallout 4',
    short: 'Fallout 4',
    kind: 'bethesda',
    steamAppId: '377160',
    exe: 'Fallout4.exe',
    loader: 'f4se_loader.exe',
    scriptExtender: 'F4SE',
    nexusDomain: 'fallout4',
    xeditArg: '-fo4',
    xeditNames: ['FO4Edit.exe', 'FO4Edit64.exe', 'xEdit.exe', 'xEdit64.exe'],
    myGames: () => path.join(DOCS(), 'My Games', 'Fallout4'),
    pluginsDir: () => path.join(LOCAL(), 'Fallout4'),
    iniFiles: ['Fallout4.ini', 'Fallout4Prefs.ini', 'Fallout4Custom.ini'],
    crashLogDirs: () => [path.join(DOCS(), 'My Games', 'Fallout4', 'F4SE')],
    implicitPlugins: [
      'Fallout4.esm', 'DLCRobot.esm', 'DLCworkshop01.esm', 'DLCCoast.esm', 'DLCworkshop02.esm',
      'DLCworkshop03.esm', 'DLCNukaWorld.esm', 'DLCUltraHighResolution.esm',
    ],
    cccFile: 'Fallout4.ccc',
    lightFlag: 0x200,
    tools: ['FO4Edit', 'Creation Kit', 'LOOT', 'Archive2', 'Bethesda Archive Extractor', 'CM Toolkit'],
  },
  starfield: {
    id: 'starfield',
    name: 'Starfield',
    short: 'Starfield',
    kind: 'bethesda',
    steamAppId: '1716740',
    exe: 'Starfield.exe',
    loader: 'sfse_loader.exe',
    scriptExtender: 'SFSE',
    nexusDomain: 'starfield',
    xeditArg: '-sf1',
    xeditNames: ['SF1Edit.exe', 'SF1Edit64.exe', 'xEdit.exe', 'xEdit64.exe'],
    myGames: () => path.join(DOCS(), 'My Games', 'Starfield'),
    pluginsDir: () => path.join(LOCAL(), 'Starfield'),
    iniFiles: ['StarfieldCustom.ini', 'StarfieldPrefs.ini'],
    crashLogDirs: () => [
      path.join(DOCS(), 'My Games', 'Starfield', 'SFSE', 'Logs'),
      path.join(DOCS(), 'My Games', 'Starfield', 'SFSE'),
    ],
    implicitPlugins: ['Starfield.esm', 'Constellation.esm', 'OldMars.esm', 'ShatteredSpace.esm', 'SFBGS003.esm', 'SFBGS004.esm', 'SFBGS006.esm', 'SFBGS007.esm', 'SFBGS008.esm', 'BlueprintShips-Starfield.esm'],
    cccFile: 'Starfield.ccc',
    lightFlag: 0x100,
    tools: ['SF1Edit', 'Creation Kit', 'LOOT', 'Bethesda Archive Extractor'],
  },
  minecraft: {
    id: 'minecraft',
    name: 'Minecraft: Java Edition',
    short: 'Minecraft',
    kind: 'minecraft',
    nexusDomain: null,
    defaultDir: () => path.join(ROAMING(), '.minecraft'),
    crashLogDirs: (dir) => [path.join(dir, 'crash-reports'), path.join(dir, 'logs')],
    tools: ['Forge installer', 'Fabric installer', 'NeoForge installer'],
  },
};

// Library games: classic/VR Bethesda titles get the plugin system; the rest are generic.
const library = require('./library');
for (const def of Object.values(library.BETHESDA_CLASSIC)) {
  GAMES[def.id] = {
    ...def,
    myGames: () => path.join(DOCS(), 'My Games', def.myGamesName),
    pluginsDir: () => path.join(LOCAL(), def.pluginsDirName),
    crashLogDirs: () => def.crashDirs.map((d) => path.join(DOCS(), 'My Games', d)),
  };
}
for (const def of Object.values(library.GENERIC)) GAMES[def.id] = { ...def };
for (const g of Object.values(GAMES)) g.art = library.art(g);
const CORE = ['skyrimse', 'fallout4', 'starfield', 'minecraft'];

function regQuery(key, value) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', value], { encoding: 'utf8', windowsHide: true });
    const m = out.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function steamLibraries() {
  const roots = new Set();
  const steam =
    regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath') ||
    regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  const candidates = [steam, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean);
  for (const c of candidates) {
    const root = path.normalize(c.replace(/\//g, '\\'));
    if (!fs.existsSync(root)) continue;
    roots.add(root);
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    try {
      const text = fs.readFileSync(vdf, 'utf8');
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
        roots.add(path.normalize(m[1].replace(/\\\\/g, '\\')));
      }
    } catch {
      // no library file
    }
  }
  return [...roots];
}

function findSteamGame(appId) {
  for (const lib of steamLibraries()) {
    const manifest = path.join(lib, 'steamapps', `appmanifest_${appId}.acf`);
    if (!fs.existsSync(manifest)) continue;
    const text = fs.readFileSync(manifest, 'utf8');
    const m = text.match(/"installdir"\s+"([^"]+)"/);
    if (!m) continue;
    const dir = path.join(lib, 'steamapps', 'common', m[1]);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

// Detect Minecraft version/loader from the versions folder names.
function detectMinecraftProfiles(mcDir) {
  const versionsDir = path.join(mcDir, 'versions');
  const result = [];
  try {
    for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      let loader = 'vanilla';
      let mc = name;
      let m;
      if ((m = name.match(/^fabric-loader-[\d.]+-(.+)$/))) { loader = 'fabric'; mc = m[1]; }
      else if ((m = name.match(/^quilt-loader-[\d.]+-(.+)$/))) { loader = 'quilt'; mc = m[1]; }
      else if ((m = name.match(/^(.+?)-forge-?/i))) { loader = 'forge'; mc = m[1]; }
      else if ((m = name.match(/^neoforge-(\d+)\.(\d+)/i))) { loader = 'neoforge'; mc = `1.${m[1]}${m[2] !== '0' ? '.' + m[2] : ''}`; }
      result.push({ id: name, loader, mcVersion: mc });
    }
  } catch {
    // no versions folder
  }
  return result;
}

function detectAll() {
  const found = {};
  for (const game of Object.values(GAMES)) {
    if (game.kind === 'bethesda' || game.kind === 'generic') {
      const dir = game.steamAppId ? findSteamGame(game.steamAppId) : null;
      if (dir) found[game.id] = { installDir: dir, source: 'steam' };
      else if (game.detectPath && fs.existsSync(library.expand(game.detectPath, ''))) found[game.id] = { installDir: library.expand(game.detectPath, ''), source: 'documents' };
      else found[game.id] = null;
    } else if (game.kind === 'minecraft') {
      const dir = game.defaultDir();
      found[game.id] = fs.existsSync(dir)
        ? { installDir: dir, source: 'launcher', profiles: detectMinecraftProfiles(dir) }
        : null;
    }
  }
  return found;
}

function publicInfo(game) {
  const { myGames, pluginsDir, crashLogDirs, defaultDir, ...rest } = game;
  return rest;
}

module.exports = { GAMES, CORE, detectAll, detectMinecraftProfiles, steamLibraries, publicInfo };
