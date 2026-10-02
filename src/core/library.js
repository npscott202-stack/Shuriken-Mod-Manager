// Game library: every game Shuriken can manage beyond the original four.
//
// Bethesda-engine games reuse the plugin/load-order system. Everything else is a "generic" game:
//   base      where mods deploy: tokens {install} {docs} {local} {locallow} {appdata} {programdata}
//   strategy  how an archive becomes a mod:
//               root    - archive mirrors the game folder; descend wrapper folders until a marker appears
//               folder  - each mod is a folder (found by its manifest file) placed inside `base`
//               files   - files are routed by extension (`rules`), everything else keeps its relative path
//               copy    - the downloaded file itself is the mod (Factorio zips)
//   markers   top-level names that identify the game-root layout (root strategy)
//   manifest  file that marks a mod folder (folder strategy)
//   rules     { '.ext': 'relative/target/dir' } for loose files
//   logs      crash/log files or folders the AI should read
//   requires  loader/framework most mods need
const path = require('path');

const BETHESDA_CLASSIC = {
  skyrim: {
    id: 'skyrim', name: 'Skyrim (Legendary Edition)', short: 'Skyrim LE', kind: 'bethesda', steamAppId: '72850', exe: 'TESV.exe', loader: 'skse_loader.exe',
    scriptExtender: 'SKSE', nexusDomain: 'skyrim', xeditArg: '-tes5', xeditNames: ['TES5Edit.exe', 'xEdit.exe', 'xEdit64.exe'], myGamesName: 'Skyrim', pluginsDirName: 'Skyrim',
    iniFiles: ['Skyrim.ini', 'SkyrimPrefs.ini'], crashDirs: ['Skyrim\\SKSE'], implicitPlugins: ['Skyrim.esm', 'Update.esm'], lightFlag: 0, pluginStar: false,
    tools: ['TES5Edit', 'Creation Kit', 'LOOT', 'Wrye Bash', 'FNIS', 'BodySlide'], era: 'classic',
  },
  skyrimvr: {
    id: 'skyrimvr', name: 'Skyrim VR', short: 'Skyrim VR', kind: 'bethesda', steamAppId: '611670', exe: 'SkyrimVR.exe', loader: 'sksevr_loader.exe',
    scriptExtender: 'SKSEVR', nexusDomain: 'skyrimspecialedition', xeditArg: '-tes5vr', xeditNames: ['TES5VREdit.exe', 'xEdit.exe', 'xEdit64.exe'], myGamesName: 'Skyrim VR', pluginsDirName: 'Skyrim VR',
    iniFiles: ['SkyrimVR.ini', 'SkyrimPrefs.ini'], crashDirs: ['Skyrim VR\\SKSE'], implicitPlugins: ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', 'SkyrimVR.esm'], lightFlag: 0x200,
    tools: ['SSEEdit', 'LOOT', 'Nemesis/Pandora', 'BodySlide'], cccFile: null,
  },
  fallout4vr: {
    id: 'fallout4vr', name: 'Fallout 4 VR', short: 'Fallout 4 VR', kind: 'bethesda', steamAppId: '611660', exe: 'Fallout4VR.exe', loader: 'f4sevr_loader.exe',
    scriptExtender: 'F4SEVR', nexusDomain: 'fallout4', xeditArg: '-fo4vr', xeditNames: ['FO4VREdit.exe', 'xEdit.exe', 'xEdit64.exe'], myGamesName: 'Fallout4VR', pluginsDirName: 'Fallout4VR',
    iniFiles: ['Fallout4VR.ini', 'Fallout4Prefs.ini', 'Fallout4Custom.ini'], crashDirs: ['Fallout4VR\\F4SE'], implicitPlugins: ['Fallout4.esm', 'Fallout4_VR.esm'], lightFlag: 0,
    tools: ['FO4Edit', 'LOOT'], cccFile: null,
  },
  falloutnv: {
    id: 'falloutnv', name: 'Fallout: New Vegas', short: 'New Vegas', kind: 'bethesda', steamAppId: '22380', exe: 'FalloutNV.exe', loader: 'nvse_loader.exe',
    scriptExtender: 'NVSE', nexusDomain: 'newvegas', xeditArg: '-fnv', xeditNames: ['FNVEdit.exe', 'xEdit.exe', 'xEdit64.exe'], myGamesName: 'FalloutNV', pluginsDirName: 'FalloutNV',
    iniFiles: ['Fallout.ini', 'FalloutPrefs.ini'], crashDirs: [], implicitPlugins: ['FalloutNV.esm'], lightFlag: 0, pluginStar: false, timestampOrder: true,
    tools: ['FNVEdit', 'LOOT', 'Wrye Bash', 'GECK', 'NVSE'], era: 'classic',
  },
  fallout3: {
    id: 'fallout3', name: 'Fallout 3', short: 'Fallout 3', kind: 'bethesda', steamAppId: '22370', exe: 'Fallout3.exe', loader: 'fose_loader.exe',
    scriptExtender: 'FOSE', nexusDomain: 'fallout3', xeditArg: '-fo3', xeditNames: ['FO3Edit.exe', 'xEdit.exe', 'xEdit64.exe'], myGamesName: 'Fallout3', pluginsDirName: 'Fallout3',
    iniFiles: ['Fallout.ini', 'FalloutPrefs.ini'], crashDirs: [], implicitPlugins: ['Fallout3.esm'], lightFlag: 0, pluginStar: false, timestampOrder: true,
    tools: ['FO3Edit', 'LOOT', 'Wrye Bash', 'GECK'], era: 'classic',
  },
  oblivion: {
    id: 'oblivion', name: 'The Elder Scrolls IV: Oblivion', short: 'Oblivion', kind: 'bethesda', steamAppId: '22330', exe: 'Oblivion.exe', loader: 'obse_loader.exe',
    scriptExtender: 'OBSE', nexusDomain: 'oblivion', xeditArg: '-tes4', xeditNames: ['TES4Edit.exe', 'xEdit.exe', 'xEdit64.exe'], myGamesName: 'Oblivion', pluginsDirName: 'Oblivion',
    iniFiles: ['Oblivion.ini'], crashDirs: [], implicitPlugins: ['Oblivion.esm'], lightFlag: 0, pluginStar: false, timestampOrder: true, headerSize: 20,
    tools: ['TES4Edit', 'LOOT', 'Wrye Bash', 'Construction Set', 'OBSE'], era: 'classic',
  },
};

const G = (def) => ({ kind: 'generic', ...def });

const GENERIC = {
  cyberpunk2077: G({ id: 'cyberpunk2077', name: 'Cyberpunk 2077', short: 'Cyberpunk', steamAppId: '1091500', exe: 'bin\\x64\\Cyberpunk2077.exe', nexusDomain: 'cyberpunk2077',
    base: '{install}', strategy: 'root', markers: ['archive', 'bin', 'r6', 'red4ext', 'mods', 'engine'], rules: { '.archive': 'archive\\pc\\mod', '.xl': 'archive\\pc\\mod' },
    logs: ['{install}\\red4ext\\logs', '{install}\\r6\\logs', '{install}\\bin\\x64\\plugins\\cyber_engine_tweaks', '{local}\\REDEngine\\ReportQueue'],
    requires: 'RED4ext, Cyber Engine Tweaks, ArchiveXL, TweakXL, Codeware (per mod)', tools: ['REDmod', 'WolvenKit', 'Cyber Engine Tweaks'], color: ['#fcee0a', '#00f0ff'] }),
  witcher3: G({ id: 'witcher3', name: 'The Witcher 3: Wild Hunt', short: 'Witcher 3', steamAppId: '292030', exe: 'bin\\x64\\witcher3.exe', nexusDomain: 'witcher3',
    base: '{install}', strategy: 'root', markers: ['mods', 'dlc', 'bin'], prefixDirs: { mod: 'mods', dlc: 'dlc' },
    logs: ['{docs}\\The Witcher 3'], requires: 'Script Merger for conflicting script mods', tools: ['Script Merger', 'WolvenKit'], color: ['#b8232f', '#2b2b2b'] }),
  baldursgate3: G({ id: 'baldursgate3', name: "Baldur's Gate 3", short: "Baldur's Gate 3", steamAppId: '1086940', exe: 'bin\\bg3.exe', nexusDomain: 'baldursgate3',
    base: '{local}\\Larian Studios\\Baldur\'s Gate 3', strategy: 'files', rules: { '.pak': 'Mods' },
    logs: ['{local}\\Larian Studios\\Baldur\'s Gate 3\\LevelCache', '{install}\\bin\\NativeMods'],
    requires: 'Activate .pak mods in the in-game Mod Manager or BG3 Mod Manager (modsettings.lsx)', tools: ['BG3 Mod Manager', 'Script Extender'], color: ['#7a4cc2', '#1b1022'] }),
  eldenring: G({ id: 'eldenring', name: 'Elden Ring', short: 'Elden Ring', steamAppId: '1245620', exe: 'Game\\eldenring.exe', nexusDomain: 'eldenring',
    base: '{install}\\Game', strategy: 'root', markers: ['mod', 'ModEngine', 'modengine2_launcher.exe', 'dinput8.dll', 'mods', 'regulation.bin'],
    logs: ['{install}\\Game\\ModEngine', '{appdata}\\EldenRing'], requires: 'ModEngine 2 (play offline: modded online play risks a ban)', tools: ['ModEngine 2', 'Smithbox'], color: ['#c9a227', '#14110b'] }),
  darksouls3: G({ id: 'darksouls3', name: 'Dark Souls III', short: 'Dark Souls III', steamAppId: '374320', exe: 'Game\\DarkSoulsIII.exe', nexusDomain: 'darksouls3',
    base: '{install}\\Game', strategy: 'root', markers: ['mod', 'dinput8.dll', 'modengine.ini'], logs: [], requires: 'Mod Engine (offline only)', tools: ['Mod Engine'], color: ['#d36b2b', '#120c09'] }),
  stardewvalley: G({ id: 'stardewvalley', name: 'Stardew Valley', short: 'Stardew Valley', steamAppId: '413150', exe: 'Stardew Valley.exe', nexusDomain: 'stardewvalley',
    base: '{install}\\Mods', strategy: 'folder', manifest: 'manifest.json', logs: ['{appdata}\\StardewValley\\ErrorLogs'], requires: 'SMAPI', tools: ['SMAPI'], color: ['#6cbf3f', '#1e3a5f'] }),
  rimworld: G({ id: 'rimworld', name: 'RimWorld', short: 'RimWorld', steamAppId: '294100', exe: 'RimWorldWin64.exe', nexusDomain: 'rimworld',
    base: '{install}\\Mods', strategy: 'folder', manifest: 'About\\About.xml', logs: ['{locallow}\\Ludeon Studios\\RimWorld by Ludeon Studios'], requires: 'Harmony (most mods)', tools: ['RimSort'], color: ['#c2a26b', '#2a2118'] }),
  valheim: G({ id: 'valheim', name: 'Valheim', short: 'Valheim', steamAppId: '892970', exe: 'valheim.exe', nexusDomain: 'valheim', thunderstore: 'valheim',
    base: '{install}', strategy: 'root', markers: ['BepInEx', 'doorstop_config.ini', 'winhttp.dll'], rules: { '.dll': 'BepInEx\\plugins' },
    logs: ['{install}\\BepInEx\\LogOutput.log', '{locallow}\\IronGate\\Valheim\\Player.log'], requires: 'BepInExPack Valheim', tools: ['r2modman'], color: ['#5c8a8a', '#101a1f'] }),
  lethalcompany: G({ id: 'lethalcompany', name: 'Lethal Company', short: 'Lethal Company', steamAppId: '1966720', exe: 'Lethal Company.exe', nexusDomain: 'lethalcompany', thunderstore: 'lethal-company',
    base: '{install}', strategy: 'root', markers: ['BepInEx', 'doorstop_config.ini', 'winhttp.dll'], rules: { '.dll': 'BepInEx\\plugins' },
    logs: ['{install}\\BepInEx\\LogOutput.log', '{locallow}\\ZeekerssRBLX\\Lethal Company\\Player.log'], requires: 'BepInExPack', tools: ['r2modman'], color: ['#e05a1f', '#0c0c0c'] }),
  riskofrain2: G({ id: 'riskofrain2', name: 'Risk of Rain 2', short: 'Risk of Rain 2', steamAppId: '632360', exe: 'Risk of Rain 2.exe', nexusDomain: 'riskofrain2', thunderstore: 'riskofrain2',
    base: '{install}', strategy: 'root', markers: ['BepInEx', 'doorstop_config.ini', 'winhttp.dll'], rules: { '.dll': 'BepInEx\\plugins' },
    logs: ['{install}\\BepInEx\\LogOutput.log'], requires: 'BepInExPack', tools: ['r2modman'], color: ['#3fa7d6', '#0d1b2a'] }),
  subnautica: G({ id: 'subnautica', name: 'Subnautica', short: 'Subnautica', steamAppId: '264710', exe: 'Subnautica.exe', nexusDomain: 'subnautica',
    base: '{install}', strategy: 'root', markers: ['BepInEx', 'QMods', 'doorstop_config.ini', 'winhttp.dll'], rules: { '.dll': 'BepInEx\\plugins' },
    logs: ['{install}\\BepInEx\\LogOutput.log'], requires: 'BepInEx + Nautilus', tools: [], color: ['#2bb3c0', '#06263a'] }),
  bannerlord: G({ id: 'bannerlord', name: 'Mount & Blade II: Bannerlord', short: 'Bannerlord', steamAppId: '261550', exe: 'bin\\Win64_Shipping_Client\\Bannerlord.exe', nexusDomain: 'mountandblade2bannerlord',
    base: '{install}\\Modules', strategy: 'folder', manifest: 'SubModule.xml', logs: ['{programdata}\\Mount and Blade II Bannerlord\\logs', '{programdata}\\Mount and Blade II Bannerlord\\crashes'],
    requires: 'Harmony, ButterLib, UIExtenderEx, MCM (most mods)', tools: ['BUTR Loader'], color: ['#a3742c', '#1d150c'] }),
  kenshi: G({ id: 'kenshi', name: 'Kenshi', short: 'Kenshi', steamAppId: '233860', exe: 'kenshi_x64.exe', nexusDomain: 'kenshi',
    base: '{install}\\mods', strategy: 'folder', manifestExt: '.mod', logs: ['{install}\\kenshi.log', '{install}\\kenshi_x64.log'], tools: ['FCS'], color: ['#b9a37a', '#2a241a'] }),
  sevendaystodie: G({ id: 'sevendaystodie', name: '7 Days to Die', short: '7 Days to Die', steamAppId: '251570', exe: '7DaysToDie.exe', nexusDomain: '7daystodie',
    base: '{install}\\Mods', strategy: 'folder', manifest: 'ModInfo.xml', logs: ['{appdata}\\7DaysToDie\\logs', '{install}\\7DaysToDie_Data'], tools: [], color: ['#9c2a1e', '#161616'] }),
  palworld: G({ id: 'palworld', name: 'Palworld', short: 'Palworld', steamAppId: '1623730', exe: 'Palworld.exe', nexusDomain: 'palworld',
    base: '{install}', strategy: 'files', markers: ['Pal'], rules: { '.pak': 'Pal\\Content\\Paks\\~mods', '.utoc': 'Pal\\Content\\Paks\\~mods', '.ucas': 'Pal\\Content\\Paks\\~mods' },
    logs: ['{install}\\Pal\\Binaries\\Win64\\ue4ss\\UE4SS.log', '{local}\\Pal\\Saved\\Logs'], requires: 'UE4SS for Lua/script mods', tools: ['UE4SS'], color: ['#4fb3ff', '#0b2440'] }),
  hogwartslegacy: G({ id: 'hogwartslegacy', name: 'Hogwarts Legacy', short: 'Hogwarts Legacy', steamAppId: '990080', exe: 'HogwartsLegacy.exe', nexusDomain: 'hogwartslegacy',
    base: '{install}', strategy: 'files', markers: ['Phoenix'], rules: { '.pak': 'Phoenix\\Content\\Paks\\~mods', '.utoc': 'Phoenix\\Content\\Paks\\~mods', '.ucas': 'Phoenix\\Content\\Paks\\~mods' },
    logs: ['{local}\\Hogwarts Legacy\\Saved\\Logs'], tools: ['UE4SS'], color: ['#c49a3a', '#1a1426'] }),
  oblivionremastered: G({ id: 'oblivionremastered', name: 'Oblivion Remastered', short: 'Oblivion Remastered', steamAppId: '2623190', exe: 'OblivionRemastered.exe', nexusDomain: 'oblivionremastered',
    base: '{install}', strategy: 'files', markers: ['OblivionRemastered'],
    rules: { '.pak': 'OblivionRemastered\\Content\\Paks\\~mods', '.utoc': 'OblivionRemastered\\Content\\Paks\\~mods', '.ucas': 'OblivionRemastered\\Content\\Paks\\~mods', '.esp': 'OblivionRemastered\\Content\\Dev\\ObvData\\Data', '.esm': 'OblivionRemastered\\Content\\Dev\\ObvData\\Data', '.bsa': 'OblivionRemastered\\Content\\Dev\\ObvData\\Data' },
    logs: ['{docs}\\My Games\\Oblivion Remastered'], requires: 'OBSE64 / UE4SS for script mods; add .esp names to Plugins.txt in ObvData\\Data', tools: ['UE4SS', 'OBSE64'], color: ['#7fa35a', '#141a10'] }),
  monsterhunterworld: G({ id: 'monsterhunterworld', name: 'Monster Hunter: World', short: 'MH World', steamAppId: '582010', exe: 'MonsterHunterWorld.exe', nexusDomain: 'monsterhunterworld',
    base: '{install}', strategy: 'root', markers: ['nativePC', 'loader.dll', 'dinput8.dll'], logs: ['{install}\\loader.log'], requires: "Stracker's Loader", tools: [], color: ['#d9a441', '#1c1608'] }),
  monsterhunterrise: G({ id: 'monsterhunterrise', name: 'Monster Hunter Rise', short: 'MH Rise', steamAppId: '1446780', exe: 'MonsterHunterRise.exe', nexusDomain: 'monsterhunterrise',
    base: '{install}', strategy: 'root', markers: ['natives', 'reframework', 'dinput8.dll'], logs: ['{install}\\re2_framework_log.txt'], requires: 'REFramework / Fluffy Mod Manager', tools: ['Fluffy Mod Manager'], color: ['#c5492f', '#170c0a'] }),
  kingdomcome: G({ id: 'kingdomcome', name: 'Kingdom Come: Deliverance', short: 'KCD', steamAppId: '379430', exe: 'Bin\\Win64\\KingdomCome.exe', nexusDomain: 'kingdomcomedeliverance',
    base: '{install}\\Mods', strategy: 'folder', manifest: 'mod.manifest', logs: ['{install}\\kcd.log'], tools: [], color: ['#8c6a3b', '#16110a'] }),
  kingdomcome2: G({ id: 'kingdomcome2', name: 'Kingdom Come: Deliverance II', short: 'KCD II', steamAppId: '1771300', exe: 'Bin\\Win64MasterMasterSteamPGO\\KingdomCome.exe', nexusDomain: 'kingdomcomedeliverance2',
    base: '{install}\\Mods', strategy: 'folder', manifest: 'mod.manifest', logs: ['{install}\\kcd.log'], tools: [], color: ['#9b7a46', '#15100a'] }),
  sims4: G({ id: 'sims4', name: 'The Sims 4', short: 'The Sims 4', steamAppId: '1222670', nexusDomain: 'thesims4', detectPath: '{docs}\\Electronic Arts\\The Sims 4',
    base: '{docs}\\Electronic Arts\\The Sims 4\\Mods', strategy: 'folder', keepTopFolder: true, logs: ['{docs}\\Electronic Arts\\The Sims 4'], logPattern: /(lastexception|lastuiexception|lastcrash).*\.txt$/i,
    requires: 'Enable "Custom Content and Mods" and "Script Mods" in game options', tools: ['Sims 4 Studio', 'Mod Conflict Detector'], color: ['#3bbf5c', '#0d2b17'] }),
  factorio: G({ id: 'factorio', name: 'Factorio', short: 'Factorio', steamAppId: '427520', nexusDomain: null, detectPath: '{appdata}\\Factorio',
    base: '{appdata}\\Factorio\\mods', strategy: 'copy', logs: ['{appdata}\\Factorio\\factorio-current.log', '{appdata}\\Factorio\\factorio-previous.log'], tools: [], color: ['#e8a33d', '#2b1d0e'] }),
  citiesskylines: G({ id: 'citiesskylines', name: 'Cities: Skylines', short: 'Cities: Skylines', steamAppId: '255710', exe: 'Cities.exe', nexusDomain: 'citiesskylines',
    base: '{local}\\Colossal Order\\Cities_Skylines\\Addons\\Mods', strategy: 'folder', keepTopFolder: true, logs: ['{install}\\Cities_Data\\output_log.txt'], tools: [], color: ['#2f9ee0', '#0b1e2e'] }),
  darkestdungeon: G({ id: 'darkestdungeon', name: 'Darkest Dungeon', short: 'Darkest Dungeon', steamAppId: '262060', exe: '_windows\\win64\\darkest.exe', nexusDomain: 'darkestdungeon',
    base: '{install}\\mods', strategy: 'folder', manifest: 'project.xml', logs: [], tools: [], color: ['#8a1c1c', '#0d0505'] }),
  satisfactory: G({ id: 'satisfactory', name: 'Satisfactory', short: 'Satisfactory', steamAppId: '526870', exe: 'FactoryGame.exe', nexusDomain: 'satisfactory',
    base: '{install}\\FactoryGame\\Mods', strategy: 'folder', manifestExt: '.uplugin', logs: ['{local}\\FactoryGame\\Saved\\Logs'], requires: 'Satisfactory Mod Loader (SML)', tools: ['Satisfactory Mod Manager'], color: ['#f7a21b', '#2a1a05'] }),
  rdr2: G({ id: 'rdr2', name: 'Red Dead Redemption 2', short: 'RDR2', steamAppId: '1174180', exe: 'RDR2.exe', nexusDomain: 'reddeadredemption2',
    base: '{install}', strategy: 'root', markers: ['lml', 'scripts', 'dinput8.dll', 'version.dll', 'ScriptHookRDR2.dll'], logs: ['{install}\\lml\\vfs.log', '{install}\\ScriptHookRDR2.log'],
    requires: 'Lenny\'s Mod Loader / ScriptHookRDR2 (story mode only; never take mods online)', tools: ["Lenny's Mod Loader"], color: ['#a3271f', '#140a08'] }),
  masseffectle: G({ id: 'masseffectle', name: 'Mass Effect Legendary Edition', short: 'Mass Effect LE', steamAppId: '1328670', nexusDomain: 'masseffectlegendaryedition',
    base: '{install}', strategy: 'tool', logs: [], requires: 'ME3Tweaks Mod Manager installs mods for this game', tools: ['ME3Tweaks Mod Manager', 'ALOT Installer'], color: ['#2c6cb0', '#081422'] }),
};

// Steam header art for covers.
function art(game) {
  if (!game.steamAppId) return null;
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}`;
  return { header: `${base}/header.jpg`, hero: `${base}/library_hero.jpg`, cover: `${base}/library_600x900.jpg` };
}

function expand(pattern, installDir) {
  const os = require('os');
  const home = os.homedir();
  const docs = (() => {
    try {
      return require('electron').app.getPath('documents');
    } catch {
      return path.join(home, 'Documents');
    }
  })();
  return pattern
    .replace('{install}', installDir || '')
    .replace('{docs}', docs)
    .replace('{local}', process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'))
    .replace('{locallow}', path.join(home, 'AppData', 'LocalLow'))
    .replace('{appdata}', process.env.APPDATA || path.join(home, 'AppData', 'Roaming'))
    .replace('{programdata}', process.env.ProgramData || 'C:\\ProgramData');
}

module.exports = { BETHESDA_CLASSIC, GENERIC, art, expand };
