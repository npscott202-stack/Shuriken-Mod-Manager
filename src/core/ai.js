// AI troubleshooting assistant: a Claude tool-use agent that can inspect the user's setup,
// read crash logs / files / screenshots, and (with approval) change mods, plugins and INIs.
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');
const mods = require('./mods');
const plugins = require('./plugins');
const archives = require('./archives');
const diagnostics = require('./diagnostics');
const tools = require('./tools');
const modrinth = require('./sources/modrinth');
const nexus = require('./sources/nexus');
const downloads = require('./downloads');
const beth = require('./integrations/bethesda');
const mcx = require('./integrations/minecraft');
const workshop = require('./workshop');
const library = require('./library');
const engine = require('./engine');
const thunderstore = require('./sources/thunderstore');

// Does a tool apply to this game? games: undefined (all), a kind, a game id, or 'thunderstore'.
function toolFits(t, g) {
  if (!t.games) return true;
  if (t.games === 'thunderstore') return !!g.thunderstore;
  return t.games === g.kind || t.games === g.id;
}

const DEFAULT_MODEL = 'claude-opus-5-5';

const SYSTEM_PROMPT = `You are Shuriken's built-in modding engineer. You help players build stable mod setups, fix problems and create new mods for Bethesda games (Skyrim SE/LE/VR, Fallout 4/VR, Fallout 3, New Vegas, Oblivion, Starfield), Minecraft: Java Edition and many other moddable games (Cyberpunk 2077, Baldur's Gate 3, Elden Ring, Witcher 3, Stardew Valley, RimWorld, Valheim, The Sims 4, Bannerlord and more), working inside their mod manager with direct access to their setup through tools.

For games outside the Bethesda and Minecraft families, get_setup shows the game's mod folder, how mods are laid out, the framework most mods need (SMAPI, BepInEx, RED4ext/CET, ModEngine 2, UE4SS, Script Extender...) and where logs are. Check that framework first when something fails, read the framework's log, and keep each mod in the layout that game expects.

How to work:
- Investigate before answering. Use the tools to look at the actual mod list, load order, crash logs, INI files, plugin headers and archive contents instead of guessing. When the user describes a problem, form a hypothesis and check it.
- Screenshots: users attach screenshots of error dialogs, in-game bugs (purple/missing textures, floating objects, T-poses, black faces), crash popups, LOOT/xEdit output, mod pages or mod lists. Read them carefully, quote the relevant text you see, and connect it to evidence from their files. If a screenshot shows a list of mods to build, find each one with the search tools.
- Crash logs: for Buffout 4 / Crash Logger SSE / Crash Logger SF logs, read the exception, the probable call stack, the registers/stack for named objects (plugins, form IDs, nif/dds paths, DLLs) and match them to the user's mods with search_files. For Minecraft, read the crash report's "Caused by" chain and the mod ids involved; use minecraft_scan for missing dependencies, duplicate mods and loader mismatches.
- Explain the cause in plain language for a non-expert, say how confident you are, and cite the evidence (file and line, plugin, screenshot text).
- Fix things directly when a tool can do it: toggle or reorder mods, enable/disable or move plugins, sort the load order, set INI values, write small config files, install a missing dependency from Modrinth, run xEdit Quick Auto Clean, and deploy. Changes are approved by the user unless they turned on auto-fix. Prefer the smallest reversible change, make one logical fix at a time, and tell the user to test (and redeploy if needed) afterwards. Files you overwrite are backed up automatically.
- Modding tools you can drive directly (check list_tools; use scan_for_tools if one is missing and ask the user to add it on the Tools page):
  - xEdit (SSEEdit/FO4Edit/SF1Edit): run_xedit_clean, and run_xedit_script for anything xEdit can do — inspect records and conflicts, build compatibility/conflict-resolution patches, change record values, create new plugins and records. Pass "plugins" to load only what you need (masters load automatically); loading a big load order takes minutes.
  - Papyrus Compiler (from the Creation Kit): write .psc into a workshop project and compile_papyrus. Run prepare_papyrus_sources once if papyrus_status says base sources are missing.
  - Creation Kit (Fallout 4): generate_previs runs precombine + previs generation from the command line. Other Creation Kit work (navmesh, worldspace/cell editing, dialogue/quest authoring in the UI) has no command-line mode: do what you can with xEdit scripts, then give exact click-by-click Creation Kit steps and offer launch_tool.
  - BSArch / BSArchPro / Archive2: pack_archive, unpack_archive (to inspect or extract assets), list_archive.
  - LOOT: sort_plugins with method "loot", and loot_info to read LOOT's masterlist notes for a plugin (dirty edits to clean, requirements, incompatibilities).
  - BodySlide: bodyslide_info, bodyslide_build (outputs into a "BodySlide Output" mod).
  - CM Toolkit (Collective Modding Toolkit) checks for Fallout 4: fo4_archive_check (Old-Gen/Next-Gen BA2 versions, BA2 limits) and patch_ba2_versions (its archive patcher).
  - NifSkope-style checks: check_nif_textures finds textures/materials a mesh references that are missing (purple or invisible objects); check_assets checks any asset paths.
  - WorldPainter (Minecraft): call worldpainter_info first (map format IDs differ between WorldPainter versions), generate_heightmap for the terrain, then run_worldpainter_script with a script like: var hm = wp.getHeightMap().fromFile(argv[1]).go(); var fmt = wp.getMapFormat().withId('<id from worldpainter_info>').go(); var world = wp.createWorld().fromHeightMap(hm).fromLevels(0,255).toLevels(lo,hi).withWaterLevel(62).withMapFormat(fmt).withLowerBuildLimit(-64).withUpperBuildLimit(320).go(); world.setName('Name'); wp.applyTerrain(index).toWorld(world).withFilter(wp.createFilter().belowLevel(66).go()).applyToSurface().go(); wp.exportWorld(world).toDirectory(argv[2]).go(); — every operation ends with .go(). Pass the heightmap path and the Minecraft saves folder as args.
  - Any other registered tool (texconv, CAO, DynDOLOD, Wrye Bash, Nemesis/Pandora, MCreator, Blockbench, ...): run_tool with its command-line arguments when it has a CLI, otherwise launch_tool plus precise click-by-click steps. Wrye Bash's Bashed Patch, Nemesis/Pandora and DynDOLOD are GUI-driven: tell the user exactly what to click.
- Building mods from a prompt (the Workshop): create a project with workshop_create, write every file with workshop_write_file, build/compile, then deploy and tell the user how to test it in game.
  - Bethesda: prefer config-driven frameworks when the user has them installed (Skyrim: SPID _DISTR.ini, KID _KID.ini, Base Object Swapper _SWAP.ini, MCM Helper; Fallout 4: RobCo Patcher ini; script extender INI configs). For new records or overrides, run an xEdit script that creates the plugin (AddNewFileName(name, isESL)), copies records with wbCopyElementToFile/AddRequiredElementMasters, sets values with SetElementEditValues, and reports with AddMessage; then workshop_capture the new plugin from Data into the project. For behaviour, write Papyrus scripts and compile_papyrus. Pack assets with pack_archive when there are many loose files.
  - xEdit scripts must be a complete unit: "unit userscript; function Initialize: integer; begin ... Result := 0; end; end." Do all work in Initialize (files: FileCount/FileByIndex/GetFileName; records: GroupBySignature, MainRecordByEditorID, RecordByFormID, WinningOverride). xEdit may ask the user to confirm saving; tell them to click OK.
  - Minecraft: datapacks (mc-datapack: recipes, loot tables, advancements, functions, worldgen; needs pack.mcmeta with the right pack_format) installed into a world with workshop_package; resource packs (mc-resourcepack); KubeJS scripts or config overrides (mc-config, files relative to the instance folder such as kubejs/server_scripts/x.js or config/x.toml); real Java mods (fabric-mod: starts from the official Fabric example mod for the chosen version — rename the package, mod id and fabric.mod.json, then workshop_package builds it with Gradle and installs the jar).
  - Write complete files, not fragments. Build after writing, read the compiler/build output, fix errors and rebuild until it succeeds.
- Nexus Mods: free accounts cannot be downloaded from automatically. Give the user the mod page link and tell them to click "Mod Manager Download"; Shuriken will install it.
- Use web_search for known incompatibilities, version requirements or error strings you are unsure about, and mention where the information came from.
- Never tell the user to delete their save, reinstall the game, or verify game files unless the evidence actually points there, and say what will be lost.
- Keep answers focused: short summary first, then the steps or fixes. Use markdown lists for steps.`;

// ---------- tool definitions ----------
const TOOL_DEFS = [
  { name: 'get_setup', write: false, description: 'Overview of the current game: install paths, profile, script extender, Minecraft version/loader, deployment status and the full mod list with ids, enabled state, priority and file conflicts.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_load_order', write: false, description: 'Bethesda games: the plugin load order (implicit masters first), with ESM/ESL flags, master lists, and detected problems (missing masters, wrong order, plugin limits).', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'health_check', write: false, description: 'Runs Shuriken\'s quick health check (undeployed changes, missing script extender/Address Library, plugin problems, Minecraft dependency/loader problems, new crash logs).', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_crash_logs', write: false, description: 'Lists the newest crash logs and game logs (Buffout 4, Crash Logger, NetScriptFramework, Minecraft crash-reports and latest.log) with full paths.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read_file', write: false, description: 'Reads a text file (crash log, INI, config, json, toml, txt, log, psc). Paths must be inside the game folder, mod staging, My Games, the plugins.txt folder, the Minecraft folder or downloads.', input_schema: { type: 'object', properties: { path: { type: 'string' }, max_chars: { type: 'integer', description: 'Default 60000' } }, required: ['path'], additionalProperties: false } },
  { name: 'list_directory', write: false, description: 'Lists files and folders in an allowed directory (same locations as read_file).', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'search_files', write: false, description: 'Finds which installed mod provides a file, searching loose files and inside BSA/BA2 archives. Use a fragment of a path such as "meshes\\\\actors\\\\character\\\\foo.nif" or a file name.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'inspect_plugin', write: false, description: 'Reads a plugin header (.esp/.esm/.esl) from the game Data folder: flags, author, description, masters and record count.', input_schema: { type: 'object', properties: { plugin: { type: 'string' } }, required: ['plugin'], additionalProperties: false } },
  { name: 'list_archive', write: false, description: 'Lists the files inside a BSA or BA2 archive, optionally filtered by a substring.', input_schema: { type: 'object', properties: { path: { type: 'string' }, filter: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'minecraft_scan', write: false, description: 'Minecraft: reads every jar in the mods folder (fabric.mod.json / mods.toml) and reports mod ids, loaders, dependencies, missing dependencies, duplicates and loader mismatches.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'search_modrinth', write: false, description: 'Searches Modrinth for Minecraft mods, modpacks, resource packs or shaders compatible with the current version/loader.', input_schema: { type: 'object', properties: { query: { type: 'string' }, project_type: { type: 'string', enum: ['mod', 'modpack', 'resourcepack', 'shader', 'datapack'] } }, required: ['query'], additionalProperties: false } },
  { name: 'nexus_mod_info', write: false, description: 'Gets details for a Nexus Mods mod id for the current game (name, version, summary, requirements text, files). Needs the user\'s Nexus API key.', input_schema: { type: 'object', properties: { mod_id: { type: 'string' } }, required: ['mod_id'], additionalProperties: false } },
  { name: 'list_tools', write: false, description: 'Lists registered and auto-detected modding tools (xEdit, Creation Kit, LOOT, Archive2, BAE, CAO, CM Toolkit, ...) with their ids.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },

  { name: 'set_mod_enabled', write: true, description: 'Enables or disables a mod (by id from get_setup) in the active profile. Requires deploy afterwards.', input_schema: { type: 'object', properties: { mod_id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['mod_id', 'enabled'], additionalProperties: false } },
  { name: 'set_mod_priority', write: true, description: 'Moves a mod to a new priority position (0 = lowest; higher priority wins file conflicts). Requires deploy afterwards.', input_schema: { type: 'object', properties: { mod_id: { type: 'string' }, position: { type: 'integer' } }, required: ['mod_id', 'position'], additionalProperties: false } },
  { name: 'set_plugin_enabled', write: true, description: 'Enables or disables a plugin in plugins.txt.', input_schema: { type: 'object', properties: { plugin: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['plugin', 'enabled'], additionalProperties: false } },
  { name: 'move_plugin', write: true, description: 'Moves a plugin so it loads directly after another plugin (or to the top with after = "").', input_schema: { type: 'object', properties: { plugin: { type: 'string' }, after: { type: 'string' } }, required: ['plugin', 'after'], additionalProperties: false } },
  { name: 'sort_plugins', write: true, description: 'Sorts the load order. method "loot" runs LOOT (if installed); "masters" does Shuriken\'s built-in sort that keeps the current order but fixes master dependencies.', input_schema: { type: 'object', properties: { method: { type: 'string', enum: ['loot', 'masters'] } }, required: ['method'], additionalProperties: false } },
  { name: 'set_ini_value', write: true, description: 'Sets a value in a game INI file (e.g. Skyrim.ini, SkyrimPrefs.ini, Fallout4Custom.ini, StarfieldCustom.ini) in My Games. Creates the section/key if missing. Backs up the file.', input_schema: { type: 'object', properties: { file: { type: 'string' }, section: { type: 'string' }, key: { type: 'string' }, value: { type: 'string' } }, required: ['file', 'section', 'key', 'value'], additionalProperties: false } },
  { name: 'write_text_file', write: true, description: 'Overwrites or creates a text config file in an allowed location (backs up the old file). Use for mod configs (json/toml/ini/txt). Never use for plugins or binary files.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'install_modrinth', write: true, description: 'Minecraft: downloads and installs a Modrinth project (plus its required dependencies) for the current version/loader.', input_schema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'], additionalProperties: false } },
  { name: 'deploy', write: true, description: 'Deploys the enabled mods to the game folder (hardlinks) and applies the profile\'s load order.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'run_xedit_clean', write: true, description: 'Runs xEdit Quick Auto Clean on a plugin to remove ITM records and undelete references. Takes a few minutes; xEdit backs up the plugin.', input_schema: { type: 'object', properties: { plugin: { type: 'string' } }, required: ['plugin'], additionalProperties: false } },
  { name: 'launch_tool', write: true, description: 'Opens a registered modding tool (id from list_tools) so the user can follow your instructions in it.', input_schema: { type: 'object', properties: { tool_id: { type: 'string' } }, required: ['tool_id'], additionalProperties: false } },
];

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const S = { type: 'string' };

TOOL_DEFS.push(
  // ---- workshop (all games) ----
  { name: 'workshop_list', write: false, description: 'Lists Workshop mod projects for this game (id, kind, folder, file count).', input_schema: obj({}) },
  { name: 'workshop_create', write: false, description: 'Creates a new Workshop mod project. kinds: bethesda-mod (live mod folder = Data root), mc-datapack, mc-resourcepack, mc-config (files relative to the Minecraft instance folder, e.g. kubejs/ or config/), fabric-mod (downloads the Fabric example mod for mc_version).', input_schema: obj({ name: S, kind: { type: 'string', enum: ['bethesda-mod', 'mc-datapack', 'mc-resourcepack', 'mc-config', 'fabric-mod', 'generic-mod'] }, mc_version: { type: 'string', description: 'fabric-mod only; defaults to the profile version' } }, ['name', 'kind']) },
  { name: 'workshop_list_files', write: false, description: 'Lists files in a Workshop project.', input_schema: obj({ project_id: S }) },
  { name: 'workshop_read_file', write: false, description: 'Reads a file from a Workshop project.', input_schema: obj({ project_id: S, path: S }) },
  { name: 'workshop_write_file', write: false, description: 'Creates or overwrites a file in a Workshop project (path relative to the project root). Use encoding "base64" for binary files.', input_schema: obj({ project_id: S, path: S, content: S, encoding: { type: 'string', enum: ['utf8', 'base64'] } }, ['project_id', 'path', 'content']) },
  { name: 'workshop_delete_file', write: false, description: 'Deletes a file or folder from a Workshop project.', input_schema: obj({ project_id: S, path: S }) },
  { name: 'workshop_capture', write: true, games: 'bethesda', description: 'Moves new files that a tool created in the game Data folder (e.g. a plugin made by an xEdit script, Creation Kit precombine/previs output) into a Workshop project so Shuriken manages them.', input_schema: obj({ project_id: S, paths: { type: 'array', items: S, description: 'Data-relative paths, e.g. "MyPatch.esp" or "meshes\\\\precombined"' } }) },
  { name: 'workshop_package', write: true, description: 'Builds/packages a project and installs it: fabric-mod builds with Gradle and installs the jar; mc-resourcepack zips and installs; mc-datapack installs into the given world folder. Bethesda and mc-config projects are already live (just deploy).', input_schema: obj({ project_id: S, world: { type: 'string', description: 'mc-datapack: world folder name from list_worlds' } }, ['project_id']) },
  { name: 'scan_for_tools', write: false, description: 'Scans this PC (game folder, Program Files, Desktop, Downloads, Documents, drive roots) for known modding tools that are not registered yet. Takes up to a minute.', input_schema: obj({}) },
  { name: 'run_tool', write: true, description: 'Runs a registered tool (id from list_tools) with command-line arguments and returns its output. Use for tools with a CLI (texconv, CAO, xLODGen, etc.).', input_schema: obj({ tool_id: S, args: { type: 'array', items: S }, wait: { type: 'boolean', description: 'Default true; false just starts it' } }, ['tool_id', 'args']) },

  // ---- Bethesda ----
  { name: 'run_xedit_script', write: true, games: 'bethesda', description: 'Runs an xEdit Pascal script headlessly (-script -autoload -autoexit) and returns the xEdit log (AddMessage output). Can read anything and create/modify plugins.', input_schema: obj({ script: { type: 'string', description: 'Complete Pascal unit' }, plugins: { type: 'array', items: S, description: 'Optional: only load these plugins (+ their masters)' } }, ['script']) },
  { name: 'papyrus_status', write: false, games: 'bethesda', description: 'Shows whether the Papyrus compiler, flags file and base game script sources are available, and which folder in a project holds .psc sources.', input_schema: obj({}) },
  { name: 'prepare_papyrus_sources', write: true, games: 'bethesda', description: 'Extracts the base game Papyrus sources that ship with the Creation Kit so scripts can compile.', input_schema: obj({}) },
  { name: 'compile_papyrus', write: false, games: 'bethesda', description: 'Compiles .psc files in a Workshop project (all, or the named scripts) into its Scripts folder and returns compiler output.', input_schema: obj({ project_id: S, scripts: { type: 'array', items: S } }, ['project_id']) },
  { name: 'pack_archive', write: false, games: 'bethesda', description: 'Packs a Workshop project\'s loose asset folders into BSA (Skyrim) or Main/Textures BA2 archives named after the plugin.', input_schema: obj({ project_id: S, archive_name: { type: 'string', description: 'Plugin base name without extension' }, remove_loose: { type: 'boolean' } }, ['project_id', 'archive_name']) },
  { name: 'unpack_archive', write: false, games: 'bethesda', description: 'Extracts a BSA/BA2 into a Shuriken scratch folder and returns its path and files (for inspecting meshes, scripts, textures).', input_schema: obj({ path: S }) },
  { name: 'loot_info', write: false, games: 'bethesda', description: 'Reads LOOT masterlist/userlist entries for a plugin: dirty records to clean, requirements, incompatibilities, notes.', input_schema: obj({ plugin: S }) },
  { name: 'check_nif_textures', write: false, games: 'bethesda', description: 'Lists textures/materials a .nif mesh references and which are missing from Data (loose or archived).', input_schema: obj({ path: S }) },
  { name: 'check_assets', write: false, games: 'bethesda', description: 'Checks whether Data-relative asset paths exist loose or inside any loaded archive.', input_schema: obj({ paths: { type: 'array', items: S } }) },
  { name: 'bodyslide_info', write: false, games: 'bethesda', description: 'Lists BodySlide presets and outfit groups.', input_schema: obj({}) },
  { name: 'bodyslide_build', write: true, games: 'bethesda', description: 'Batch-builds BodySlide groups with a preset into a "BodySlide Output" mod.', input_schema: obj({ groups: { type: 'array', items: S }, preset: S }) },
  { name: 'generate_previs', write: true, games: 'fallout4', description: 'Fallout 4: runs Creation Kit precombine + previs generation for a plugin (GeneratePrecombined, CompressPSG, BuildCDX, GeneratePreVisData). Takes a long time.', input_schema: obj({ plugin: S }) },
  { name: 'fo4_archive_check', write: false, games: 'fallout4', description: 'Fallout 4: game edition (Old-Gen/Next-Gen), BA2 counts vs limits, archives in the wrong BA2 version (CM Toolkit checks).', input_schema: obj({}) },
  { name: 'patch_ba2_versions', write: true, games: 'fallout4', description: 'Fallout 4: rewrites BA2 header versions (1 = works on Old-Gen and Next-Gen, 8 = Next-Gen). Logged for undo.', input_schema: obj({ to_version: { type: 'integer', enum: [1, 8] }, files: { type: 'array', items: S } }, ['to_version']) },

  // ---- Minecraft ----
  { name: 'list_worlds', write: false, games: 'minecraft', description: 'Lists Minecraft worlds in saves with name, version, game mode and installed/enabled datapacks.', input_schema: obj({}) },
  { name: 'generate_heightmap', write: false, games: 'minecraft', description: 'Generates a grayscale terrain heightmap PNG for WorldPainter. Returns the file path and the WorldPainter level mapping to use.', input_schema: obj({ style: { type: 'string', enum: mcx.STYLES }, width: { type: 'integer' }, height: { type: 'integer' }, seed: { type: 'integer' }, scale: { type: 'number', description: 'Feature size multiplier, default 1' }, roughness: { type: 'number', description: '0-1, default 0.5' }, sea_level: { type: 'number', description: 'Fraction of the range under water, default 0.35' }, height_range: { type: 'integer', description: 'Blocks from lowest to highest point, default 200' } }, ['style']) },
  { name: 'search_thunderstore', write: false, games: 'thunderstore', description: 'Searches Thunderstore (the mod site for BepInEx games like Valheim, Lethal Company and Risk of Rain 2), sorted by downloads.', input_schema: obj({ query: S }) },
  { name: 'install_thunderstore', write: true, games: 'thunderstore', description: 'Installs a Thunderstore package (full name Owner-Name) plus all of its dependencies, laid out like r2modman. Deploy afterwards.', input_schema: obj({ full_name: S }) },
  { name: 'worldpainter_info', write: false, games: 'minecraft', description: 'WorldPainter details: the map format IDs this installed version supports (with build limits) and terrain type indices. Call before writing a WorldPainter script.', input_schema: obj({}) },
  { name: 'run_worldpainter_script', write: true, games: 'minecraft', description: 'Runs a WorldPainter JavaScript with wpscript. args are available as argv[1..].', input_schema: obj({ script: S, args: { type: 'array', items: S } }, ['script']) },
);

const SCOPE = {
  get_load_order: 'bethesda', inspect_plugin: 'bethesda', list_archive: 'bethesda', set_plugin_enabled: 'bethesda', move_plugin: 'bethesda',
  sort_plugins: 'bethesda', set_ini_value: 'bethesda', run_xedit_clean: 'bethesda', nexus_mod_info: 'bethesda',
  minecraft_scan: 'minecraft', search_modrinth: 'minecraft', install_modrinth: 'minecraft',
};
for (const t of TOOL_DEFS) if (!t.games && SCOPE[t.name]) t.games = SCOPE[t.name];

const WRITE_TOOLS = new Set(TOOL_DEFS.filter((t) => t.write).map((t) => t.name));

// Only the tools that apply to the current game (keeps the tool list stable per game for caching).
function apiTools(g) {
  return [
    ...TOOL_DEFS.filter((t) => toolFits(t, g)).map(({ write, games, ...t }) => t),
    { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  ];
}

// ---------- path safety ----------
function allowedRoots(gameId) {
  const g = mods.game(gameId);
  const roots = [g.installDir, mods.stagingDir(gameId), downloads.downloadsDir(), store.dataDir('workshop'), store.dataDir('extracted'), store.dataDir('heightmaps')];
  if (g.kind === 'bethesda') roots.push(g.myGames(), g.pluginsDir());
  if (g.kind === 'generic') {
    roots.push(library.expand(g.base, g.installDir));
    for (const l of g.logs || []) roots.push(library.expand(l, g.installDir));
  }
  for (const t of mods.state(gameId).tools || []) roots.push(path.dirname(t.path));
  return roots.filter(Boolean).map((r) => path.resolve(r).toLowerCase());
}

function checkPath(gameId, p) {
  const resolved = path.resolve(p);
  let real = resolved;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    real = resolved;
  }
  const lower = real.toLowerCase();
  const ok = allowedRoots(gameId).some((r) => lower === r || lower.startsWith(r + path.sep));
  if (!ok) throw new Error(`Access denied: ${p} is outside the game, staging, My Games and Minecraft folders.`);
  return real;
}

const TEXT_EXT = /\.(txt|log|ini|json|json5|toml|cfg|conf|properties|yaml|yml|xml|psc|md|csv|js|mcmeta|snbt)$/i;

// ---------- tool implementations ----------
function setupSummary(gameId) {
  const g = mods.game(gameId);
  const s = mods.state(gameId);
  const list = mods.listMods(gameId);
  const nameOf = (id) => s.mods[id]?.name || id;
  return {
    summary: `${g.name}: ${list.filter((m) => m.enabled).length} of ${list.length} Shuriken-managed mods enabled, profile "${s.activeProfile}", changes ${s.deployment.dirty ? 'not deployed yet' : 'deployed'}.`,
    game: g.name,
    installDir: g.installDir,
    stagingDir: mods.stagingDir(gameId),
    profile: s.activeProfile,
    scriptExtenderInstalled: g.kind === 'bethesda' && g.installDir ? fs.existsSync(path.join(g.installDir, g.loader)) : undefined,
    minecraft: g.kind === 'minecraft' ? { version: s.mcVersion, loader: s.loader } : undefined,
    modFolder: g.kind === 'generic' ? library.expand(g.base, g.installDir) : undefined,
    modLayout: g.kind === 'generic' ? { strategy: g.strategy, manifest: g.manifest || g.manifestExt, rules: g.rules, markers: g.markers } : undefined,
    requires: g.requires,
    logLocations: g.kind === 'generic' ? (g.logs || []).map((l) => library.expand(l, g.installDir)) : undefined,
    recommendedTools: g.tools,
    myGamesDir: g.kind === 'bethesda' ? g.myGames() : undefined,
    pluginsTxt: g.kind === 'bethesda' ? path.join(g.pluginsDir(), 'plugins.txt') : undefined,
    tools: (s.tools || []).map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
    workshopProjects: workshop.list(gameId).map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    deployment: { lastDeployed: s.deployment.deployedAt, pendingChanges: !!s.deployment.dirty, deployedFiles: Object.keys(s.deployment.files || {}).length },
    mods: list.map((m) => ({
      id: m.id, name: m.name, version: m.version, enabled: m.enabled, priority: m.priority, type: m.type, source: m.source,
      sourceUrl: m.sourceUrl, overwrites: m.conflicts.wins.map(nameOf), overwrittenBy: m.conflicts.loses.map(nameOf),
    })),
  };
}

function currentPluginList(g) {
  return plugins.scan(g).plugins.map((p) => ({ name: p.name, enabled: p.enabled }));
}

async function runTool(gameId, name, input, ctx) {
  const g = mods.game(gameId);
  switch (name) {
    case 'get_setup':
      return setupSummary(gameId);
    case 'get_load_order': {
      if (g.kind !== 'bethesda') return 'Load order only applies to Bethesda games.';
      const scan = plugins.scan(g);
      const strip = (p) => ({ name: p.name, enabled: p.enabled, esm: p.isMaster, esl: p.isLight, masters: p.masters, error: p.error });
      // Summary, counts and problems first so they survive truncation of a long plugin list.
      const a = plugins.analyze(g, scan);
      const left = 254 - a.counts.full;
      const limit = left >= 0 ? `Uses ${a.counts.full} of the 254 allowed full plugins (${left} slots left) - within the limit.` : `OVER the limit: ${a.counts.full} full plugins but only 254 are allowed.`;
      const summary = `${a.counts.total} active plugins (${a.counts.full} full, ${a.counts.light} light; ${scan.implicit.length} are base game/Creation Club). ${limit} ${a.issues.length ? `${a.issues.length} problem(s): ${a.issues.slice(0, 5).map((i) => i.message).join(' ')}` : 'No load order problems found.'}`;
      return { summary, ...a, implicit: scan.implicit.map((p) => p.name), plugins: scan.plugins.map(strip) };
    }
    case 'health_check':
      return diagnostics.healthCheck(gameId);
    case 'list_crash_logs':
      return diagnostics.listCrashLogs(gameId);
    case 'read_file': {
      const p = checkPath(gameId, input.path);
      if (!TEXT_EXT.test(p)) throw new Error('Only text files can be read. Use inspect_plugin or list_archive for binary files.');
      return diagnostics.readText(p, input.max_chars || 60000);
    }
    case 'list_directory': {
      const p = checkPath(gameId, input.path);
      return fs.readdirSync(p, { withFileTypes: true }).slice(0, 500).map((e) => (e.isDirectory() ? `${e.name}\\` : e.name));
    }
    case 'search_files':
      return mods.findFile(gameId, input.query);
    case 'inspect_plugin': {
      const p = checkPath(gameId, path.join(g.installDir, 'Data', path.basename(input.plugin)));
      return plugins.readHeader(p);
    }
    case 'list_archive': {
      const p = checkPath(gameId, input.path);
      const res = archives.listArchive(p);
      const f = (input.filter || '').toLowerCase();
      const files = f ? res.files.filter((x) => x.toLowerCase().includes(f)) : res.files;
      return { format: res.format, fileCount: res.fileCount, files: files.slice(0, 1000), truncated: files.length > 1000 };
    }
    case 'minecraft_scan':
      return diagnostics.minecraftScan(gameId);
    case 'search_modrinth': {
      const s = mods.state(gameId);
      const res = await modrinth.search({ query: input.query, projectType: input.project_type || 'mod', mcVersion: s.mcVersion, loader: s.loader, limit: 10 });
      return res.hits.map((h) => ({ project_id: h.project_id, title: h.title, description: h.description, downloads: h.downloads, url: `https://modrinth.com/${h.project_type}/${h.slug}` }));
    }
    case 'nexus_mod_info': {
      const m = await nexus.mod(g.nexusDomain, input.mod_id);
      const f = await nexus.files(g.nexusDomain, input.mod_id).catch(() => ({ files: [] }));
      return {
        name: m.name, version: m.version, summary: m.summary, author: m.author, updated: m.updated_time,
        url: `https://www.nexusmods.com/${g.nexusDomain}/mods/${input.mod_id}`,
        description: String(m.description || '').replace(/\[[^\]]+\]/g, '').slice(0, 6000),
        files: (f.files || []).slice(-10).map((x) => ({ file_id: x.file_id, name: x.name, version: x.version, category: x.category_name })),
      };
    }
    case 'list_tools':
      return tools.list(gameId);

    case 'set_mod_enabled':
      mods.setEnabled(gameId, input.mod_id, input.enabled);
      return `Mod ${input.mod_id} ${input.enabled ? 'enabled' : 'disabled'}. Deploy to apply.`;
    case 'set_mod_priority': {
      const order = mods.profile(gameId).order.filter((id) => id !== input.mod_id);
      order.splice(Math.max(0, Math.min(order.length, input.position)), 0, input.mod_id);
      mods.setOrder(gameId, order);
      return `Moved to position ${input.position}. Deploy to apply.`;
    }
    case 'set_plugin_enabled': {
      const list = currentPluginList(g);
      const p = list.find((x) => x.name.toLowerCase() === input.plugin.toLowerCase());
      if (!p) throw new Error(`${input.plugin} is not in the Data folder (implicit masters cannot be toggled).`);
      p.enabled = input.enabled;
      mods.savePluginOrder(gameId, list);
      return `${p.name} ${input.enabled ? 'enabled' : 'disabled'}.`;
    }
    case 'move_plugin': {
      const list = currentPluginList(g);
      const idx = list.findIndex((x) => x.name.toLowerCase() === input.plugin.toLowerCase());
      if (idx < 0) throw new Error(`${input.plugin} not found in load order.`);
      const [item] = list.splice(idx, 1);
      const after = input.after ? list.findIndex((x) => x.name.toLowerCase() === input.after.toLowerCase()) : -1;
      if (input.after && after < 0) throw new Error(`${input.after} not found in load order.`);
      list.splice(after + 1, 0, item);
      mods.savePluginOrder(gameId, list);
      return `${item.name} now loads ${input.after ? `after ${input.after}` : 'first'}.`;
    }
    case 'sort_plugins': {
      if (input.method === 'loot') return tools.lootSort(gameId);
      const sorted = plugins.autoSort(plugins.scan(g).plugins);
      mods.savePluginOrder(gameId, sorted.map((p) => ({ name: p.name, enabled: p.enabled })));
      return { newOrder: sorted.map((p) => p.name) };
    }
    case 'set_ini_value': {
      if (!/\.ini$/i.test(input.file)) throw new Error('Only .ini files');
      const file = checkPath(gameId, diagnostics.iniPath(gameId, path.basename(input.file)));
      return diagnostics.setIniValue(file, input.section, input.key, input.value);
    }
    case 'write_text_file': {
      const p = checkPath(gameId, input.path);
      if (!TEXT_EXT.test(p)) throw new Error('Only text config files can be written.');
      if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.shuriken.bak`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, input.content);
      return `Wrote ${p}${fs.existsSync(`${p}.shuriken.bak`) ? ' (backup: .shuriken.bak)' : ''}.`;
    }
    case 'install_modrinth': {
      const s = mods.state(gameId);
      const installedIds = new Set(Object.values(s.mods).filter((m) => m.source === 'modrinth').map((m) => m.sourceId));
      const jobs = await modrinth.resolve(input.project_id, { mcVersion: s.mcVersion, loader: s.loader, skip: installedIds });
      const done = [];
      for (const job of jobs) {
        if (job.error) {
          done.push(`dependency ${job.projectId}: ${job.error}`);
          continue;
        }
        const { path: file, meta } = await modrinth.downloadJob(job);
        await mods.installFile(gameId, file, meta);
        done.push(`${meta.name} ${meta.version}`);
      }
      ctx.onChange?.();
      return { installed: done, note: 'Deploy to apply.' };
    }
    case 'deploy': {
      const res = await mods.deploy(gameId);
      ctx.onChange?.();
      return res;
    }
    case 'run_xedit_clean':
      return tools.xeditQuickClean(gameId, path.basename(input.plugin));
    case 'launch_tool':
      return tools.launch(gameId, input.tool_id);

    // ---- workshop ----
    case 'workshop_list':
      return workshop.list(gameId);
    case 'workshop_create': {
      const p = await workshop.create(gameId, input.name, input.kind, { mcVersion: input.mc_version });
      ctx.onChange?.();
      return p;
    }
    case 'workshop_list_files':
      return workshop.files(input.project_id);
    case 'workshop_read_file':
      return workshop.readFile(input.project_id, input.path);
    case 'workshop_write_file':
      return workshop.writeFile(input.project_id, input.path, input.content, input.encoding);
    case 'workshop_delete_file':
      return workshop.deleteFile(input.project_id, input.path);
    case 'workshop_capture':
      return workshop.capture(input.project_id, input.paths);
    case 'workshop_package': {
      const r = await workshop.packageProject(input.project_id, { world: input.world });
      ctx.onChange?.();
      return r;
    }
    case 'scan_for_tools':
      return tools.scanForGame(gameId).map(({ kind, name, path: p, ai: what }) => ({ kind, name, path: p, what }));
    case 'run_tool':
      return tools.runTool(gameId, input.tool_id, input.args || [], { wait: input.wait !== false });

    // ---- Bethesda ----
    case 'run_xedit_script':
      return tools.xeditScript(gameId, input.script, input.plugins);
    case 'papyrus_status':
      return beth.papyrusInfo(gameId);
    case 'prepare_papyrus_sources':
      return beth.preparePapyrusSources(gameId);
    case 'compile_papyrus':
      return beth.compilePapyrus(gameId, workshop.get(input.project_id).dir, input.scripts);
    case 'pack_archive':
      return beth.packArchive(gameId, workshop.get(input.project_id).dir, input.archive_name, { removeLoose: !!input.remove_loose });
    case 'unpack_archive':
      return beth.unpackArchive(gameId, checkPath(gameId, input.path));
    case 'loot_info':
      return beth.lootInfo(gameId, path.basename(input.plugin));
    case 'check_nif_textures':
      return beth.checkNif(gameId, checkPath(gameId, input.path));
    case 'check_assets':
      return beth.checkAssets(gameId, input.paths);
    case 'bodyslide_info':
      return beth.bodyslideInfo(gameId);
    case 'bodyslide_build': {
      const r = await beth.bodyslideBuild(gameId, input.groups, input.preset);
      ctx.onChange?.();
      return r;
    }
    case 'generate_previs':
      return beth.generatePrevis(gameId, path.basename(input.plugin));
    case 'fo4_archive_check':
      return beth.fo4ArchiveCheck(gameId);
    case 'patch_ba2_versions':
      return beth.patchBa2Versions(gameId, input.to_version, input.files);

    // ---- Minecraft ----
    case 'list_worlds':
      return mcx.listWorlds(gameId);
    case 'generate_heightmap':
      return mcx.generateHeightmap({
        style: input.style, width: input.width, height: input.height, seed: input.seed, scale: input.scale,
        roughness: input.roughness, seaLevel: input.sea_level, heightRange: input.height_range,
      });
    case 'search_thunderstore': {
      const hits = await thunderstore.search(g.thunderstore, input.query, 12);
      return hits.map((p) => ({ full_name: p.full, version: p.version, downloads: p.downloads, description: p.description, dependencies: p.deps.length, url: p.url }));
    }
    case 'install_thunderstore': {
      const r = await thunderstore.install(gameId, g.thunderstore, input.full_name);
      ctx.onChange?.();
      return { installed: r.filter((x) => x.mod && !x.skipped).map((x) => `${x.mod.name} ${x.mod.version}`), alreadyInstalled: r.filter((x) => x.skipped).map((x) => x.mod.name), errors: r.filter((x) => x.error).map((x) => x.error), note: 'Deploy to apply.' };
    }
    case 'worldpainter_info':
      return mcx.worldPainterInfo(gameId);
    case 'run_worldpainter_script':
      return mcx.runWorldPainterScript(gameId, input.script, input.args || []);
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

function describeAction(name, input) {
  switch (name) {
    case 'set_mod_enabled': return `${input.enabled ? 'Enable' : 'Disable'} mod "${input.mod_id}"`;
    case 'set_mod_priority': return `Move mod "${input.mod_id}" to priority ${input.position}`;
    case 'set_plugin_enabled': return `${input.enabled ? 'Enable' : 'Disable'} plugin ${input.plugin}`;
    case 'move_plugin': return `Load ${input.plugin} ${input.after ? `after ${input.after}` : 'first'}`;
    case 'sort_plugins': return input.method === 'loot' ? 'Sort load order with LOOT' : 'Fix load order (masters before dependants)';
    case 'set_ini_value': return `Set [${input.section}] ${input.key}=${input.value} in ${input.file}`;
    case 'write_text_file': return `Write ${input.path} (${input.content.length} characters, old file backed up)`;
    case 'install_modrinth': return `Install Modrinth project ${input.project_id} and its dependencies`;
    case 'deploy': return 'Deploy mods to the game folder';
    case 'run_xedit_clean': return `Run xEdit Quick Auto Clean on ${input.plugin}`;
    case 'launch_tool': return `Open tool ${input.tool_id}`;
    case 'workshop_capture': return `Move ${input.paths.join(', ')} from the Data folder into Workshop project ${input.project_id}`;
    case 'workshop_package': return `Build/package Workshop project ${input.project_id}${input.world ? ` into world "${input.world}"` : ''}`;
    case 'run_tool': return `Run tool ${input.tool_id} ${(input.args || []).join(' ')}`;
    case 'run_xedit_script': return `Run an xEdit script${input.plugins?.length ? ` on ${input.plugins.join(', ')}` : ' on the full load order'}`;
    case 'prepare_papyrus_sources': return 'Extract the base game Papyrus script sources';
    case 'bodyslide_build': return `BodySlide batch build ${input.groups.join(', ')} with preset "${input.preset}"`;
    case 'generate_previs': return `Generate precombines + previs for ${input.plugin} with the Creation Kit (long-running)`;
    case 'patch_ba2_versions': return `Patch ${input.files?.length ? input.files.join(', ') : 'all BA2 archives'} to BA2 version ${input.to_version}`;
    case 'run_worldpainter_script': return 'Run a WorldPainter script (creates/exports a world)';
    default: return name;
  }
}

// ---------- conversation loop ----------
const chats = new Map();

function settings() {
  return store.load('settings', {});
}

function client() {
  const apiKey = store.getSecret('anthropicApiKey') || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Add your Claude API key in Settings to use the AI assistant (console.anthropic.com → API Keys).');
  return new Anthropic({ apiKey });
}

function contextLine(gameId) {
  const g = mods.game(gameId);
  const s = mods.state(gameId);
  const enabled = Object.values(mods.profile(gameId).enabled).filter(Boolean).length;
  const mc = g.kind === 'minecraft' ? `, Minecraft ${s.mcVersion || '?'} with ${s.loader}` : '';
  return `[Shuriken context: game=${g.name}${mc}, profile=${s.activeProfile}, ${enabled} of ${Object.keys(s.mods).length} mods enabled, changes ${s.deployment.dirty ? 'NOT deployed' : 'deployed'}.]`;
}

// Validates, approves (for write tools) and runs one tool call. Shared by both AI engines.
async function executeTool({ gameId, name, input: rawInput, id, cfg, emit, approve, ctx, maxChars = 100000 }) {
  const def = TOOL_DEFS.find((t) => t.name === name);
  let input = rawInput;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      input = {};
    }
  }
  if (!input || typeof input !== 'object') input = {};
  const missing = (def?.input_schema.required || []).filter((k) => input[k] === undefined);
  if (!def || missing.length) return { isError: true, content: def ? `Missing parameters: ${missing.join(', ')}` : `Unknown tool "${name}"` };
  const label = WRITE_TOOLS.has(name) ? describeAction(name, input) : name.replace(/_/g, ' ');
  if (WRITE_TOOLS.has(name) && !cfg.aiAutoApprove) {
    emit({ type: 'tool', id, name, status: 'awaiting', label });
    const ok = await approve({ id, tool: name, label, input });
    if (!ok) {
      emit({ type: 'tool', id, name, status: 'denied', label });
      return { isError: false, content: 'The user declined this change. Ask what they would prefer or suggest an alternative.' };
    }
  }
  emit({ type: 'tool', id, name, status: 'running', label });
  try {
    const out = await runTool(gameId, name, input, ctx);
    let textOut = typeof out === 'string' ? out : JSON.stringify(out, null, 1);
    if (textOut.length > maxChars) textOut = `${textOut.slice(0, maxChars)}\n...[truncated]`;
    emit({ type: 'tool', id, name, status: 'done', label });
    if (WRITE_TOOLS.has(name)) emit({ type: 'state-changed' });
    return { isError: false, content: textOut };
  } catch (e) {
    emit({ type: 'tool', id, name, status: 'error', label: `${label}: ${e.message}` });
    return { isError: true, content: e.message };
  }
}

function provider(cfg) {
  if (cfg.aiProvider) return cfg.aiProvider;
  return store.getSecret('anthropicApiKey') || process.env.ANTHROPIC_API_KEY ? 'claude' : 'local';
}

// emit(event) sends UI events; approve(request) resolves to true/false.
async function send({ chatId, gameId, text, images = [] }, emit, approve) {
  if (!chats.has(chatId)) chats.set(chatId, { gameId, messages: [] });
  const chat = chats.get(chatId);
  chat.abort = new AbortController();
  const cfgAll = settings();
  if (provider(cfgAll) === 'local') return sendLocal({ chat, gameId, text, images }, emit, approve, cfgAll);
  const content = [];
  for (const img of images) content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
  content.push({ type: 'text', text: `${contextLine(gameId)}\n\n${text || '(see screenshots)'}` });
  chat.messages.push({ role: 'user', content });

  const anthropic = client();
  const cfg = settings();
  const ctx = { onChange: () => emit({ type: 'state-changed' }) };

  for (let turn = 0; turn < 40; turn++) {
    const stream = anthropic.beta.messages.stream({
      model: cfg.aiModel || DEFAULT_MODEL,
      max_tokens: 64000,
      system: SYSTEM_PROMPT,
      tools: apiTools(mods.game(gameId)),
      messages: chat.messages,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: cfg.aiEffort || 'high' },
      cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }, { signal: chat.abort.signal });
    stream.on('streamEvent', (ev) => {
      if (ev.type === 'content_block_start') {
        const b = ev.content_block;
        if (b.type === 'server_tool_use') emit({ type: 'tool', name: b.name, status: 'running', label: 'Searching the web' });
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') emit({ type: 'text', delta: ev.delta.text });
        else if (ev.delta.type === 'thinking_delta') emit({ type: 'thinking', delta: ev.delta.thinking });
      }
    });

    const message = await stream.finalMessage();
    const toolUses = message.content.filter((b) => b.type === 'tool_use');
    if (message.stop_reason === 'max_tokens' && toolUses.length) {
      // A cut-off tool call cannot be answered; drop it so the conversation stays valid.
      throw new Error('The response was cut off mid-action. Try asking a narrower question.');
    }
    chat.messages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason === 'refusal') {
      emit({ type: 'text', delta: '\n\n_The request was declined by the model. Try rephrasing it._' });
      break;
    }
    if (message.stop_reason === 'pause_turn') continue;
    if (message.stop_reason !== 'tool_use' || !toolUses.length) break;

    const results = [];
    for (const tu of toolUses) {
      if (chat.abort.signal.aborted) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Stopped by the user.' });
        continue;
      }
      const r = await executeTool({ gameId, name: tu.name, input: tu.input, id: tu.id, cfg, emit, approve, ctx });
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
    }
    chat.messages.push({ role: 'user', content: results });
    if (chat.abort.signal.aborted) break;
    emit({ type: 'turn' });
  }
  emit({ type: 'done' });
}

// ---------- Shuriken Local AI (Ollama, runs on the user's GPU) ----------
const LOCAL_PROMPT = `You are Shuriken AI, the modding assistant built into the Shuriken mod manager. You run locally on the user's PC.
You help with Bethesda games (Skyrim, Fallout, Oblivion, Starfield), Minecraft and other moddable games: fixing crashes, load order and mod problems, building modpacks and making mods.

Rules:
- Use the tools to look at the real setup (get_setup, list_crash_logs, read_file, get_load_order, health_check, search_files, minecraft_scan) before answering. Never invent mod names, file paths or log contents.
- Work step by step: call one or two tools, read the results, then decide the next step.
- For crashes: list_crash_logs, read the newest log, find the plugin/mod/file named near the error, match it to a mod with search_files, then explain and fix.
- When you change something (enable/disable mods, plugin order, INI values, files, deploy) use the matching tool; the user approves each change. Make the smallest fix first, then tell the user to test.
- To build a mod: workshop_create, workshop_write_file for every file (complete files), then compile/build/package, then deploy.
- If a screenshot is attached, read the text in it and use it as evidence.
- Answer in plain language for a non-expert. Short summary first, then numbered steps.`;

// A smaller toolset with one-line descriptions, sized for an 8K-token local context.
const LOCAL_TOOLSET = new Set([
  'get_setup', 'get_load_order', 'health_check', 'list_crash_logs', 'read_file', 'list_directory', 'search_files', 'inspect_plugin',
  'minecraft_scan', 'search_modrinth', 'install_modrinth', 'set_mod_enabled', 'set_mod_priority', 'set_plugin_enabled', 'move_plugin',
  'sort_plugins', 'set_ini_value', 'write_text_file', 'deploy', 'list_tools', 'launch_tool', 'run_xedit_clean', 'loot_info',
  'check_nif_textures', 'workshop_create', 'workshop_write_file', 'workshop_list_files', 'workshop_package', 'list_worlds',
  'search_thunderstore', 'install_thunderstore',
]);

function slimSchema(schema) {
  const properties = {};
  for (const [k, v] of Object.entries(schema.properties || {})) {
    const { description, ...rest } = v;
    properties[k] = rest.items ? { ...rest, items: { type: rest.items.type } } : rest;
  }
  return { type: 'object', properties, required: schema.required || [] };
}

function localTools(g) {
  const ok = (t) => toolFits(t, g) && LOCAL_TOOLSET.has(t.name);
  return TOOL_DEFS.filter(ok).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description.split(/(?<=\.)\s/)[0].slice(0, 160), parameters: slimSchema(t.input_schema) },
  }));
}

// Keeps the conversation inside the local model's context window.
function trimLocalHistory(messages, budget = 24000) {
  const len = (m) => (typeof m.content === 'string' ? m.content.length : (m.content || []).reduce((n, p) => n + (p.text?.length || 2000), 0));
  let size = messages.reduce((n, m) => n + len(m), 0);
  for (let i = 1; i < messages.length - 4 && size > budget; i++) {
    const m = messages[i];
    if (Array.isArray(m.content)) {
      // Drop old screenshots but keep the words.
      size -= len(m);
      m.content = `${m.content.filter((p) => p.type === 'text').map((p) => p.text).join(' ')} [screenshot removed to save memory]`;
      size += len(m);
    } else if (m.role === 'tool' && m.content && m.content.length > 300) {
      size -= m.content.length - 60;
      m.content = '[older result trimmed to save memory]';
    }
  }
}

// Smaller images are much faster for a local vision model and still readable.
function shrinkForLocal(base64) {
  try {
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
    if (img.getSize().width > 1280) img = img.resize({ width: 1280, quality: 'good' });
    return img.toJPEG(80).toString('base64');
  } catch {
    return base64;
  }
}

async function sendLocal({ chat, gameId, text, images }, emit, approve, cfg) {
  const modelId = engine.MODELS[cfg.localModel] ? cfg.localModel : engine.DEFAULT_MODEL;
  const st = await engine.status(modelId);
  if (!st.ready) throw new Error('Shuriken AI is not set up yet. Open Settings → AI assistant and click "Set up Shuriken AI" (one-time download).');
  if (!st.running) emit({ type: 'status', text: 'Starting Shuriken AI (first answer takes a little longer)…' });
  if (!chat.local) chat.local = [{ role: 'system', content: LOCAL_PROMPT }];
  const parts = [{ type: 'text', text: `${contextLine(gameId)}\n\n${text || '(see screenshots)'}` }];
  for (const img of images) parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shrinkForLocal(img.data)}` } });
  chat.local.push({ role: 'user', content: images.length ? parts : parts[0].text });
  const g = mods.game(gameId);
  const tools = localTools(g);
  const ctx = { onChange: () => emit({ type: 'state-changed' }) };

  for (let turn = 0; turn < 25; turn++) {
    if (chat.abort?.signal.aborted) break;
    trimLocalHistory(chat.local);
    const msg = await engine.chatTurn({ modelId, messages: chat.local, tools, signal: chat.abort?.signal }, emit);
    chat.local.push({ role: 'assistant', content: msg.content || '', ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) break;
    for (const call of msg.tool_calls) {
      if (chat.abort?.signal.aborted) {
        chat.local.push({ role: 'tool', tool_call_id: call.id, content: 'Stopped by the user.' });
        continue;
      }
      const name = call.function?.name;
      const r = await executeTool({ gameId, name, input: call.function?.arguments, id: call.id, cfg, emit, approve, ctx, maxChars: 6000 });
      chat.local.push({ role: 'tool', tool_call_id: call.id, content: r.isError ? `ERROR: ${r.content}` : r.content });
    }
    emit({ type: 'turn' });
  }
  emit({ type: 'done' });
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Your Claude API key was rejected. Check it in Settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key does not have access to that model.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the Claude API. Wait a moment and try again.';
  if (e instanceof Anthropic.BadRequestError) return `The request was rejected: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your internet connection.';
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status}: ${e.message}`;
  return e.message || String(e);
}

function stop(chatId) {
  chats.get(chatId)?.abort?.abort();
}

function reset(chatId) {
  stop(chatId);
  chats.delete(chatId);
}

module.exports = { send, stop, reset, friendlyError, TOOL_DEFS, provider };
