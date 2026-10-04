// Free modding tools Shuriken (and its AI) can download from their official GitHub releases and
// register for a game. Anything else is requested from the user (request_tool).
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./store');
const mods = require('./mods');
const tools = require('./tools');
const archives = require('./archives');

// games: 'bethesda' | 'minecraft' | 'unity' | 'unreal' | 'dotnet' | 'any'
const CATALOG = [
  { id: 'xedit', name: 'xEdit', kind: 'xedit', games: 'bethesda', repo: 'TES5Edit/TES5Edit', asset: /^xEdit.*\.7z$/i, exe: /^xEdit\.exe$/i, about: 'Plugin editor/cleaner (SSEEdit/FO4Edit/SF1Edit). The AI uses it for cleaning, patches and generated scripts.' },
  { id: 'loot', name: 'LOOT', kind: 'loot', games: 'bethesda', repo: 'loot/loot', asset: /win64\.7z$/i, exe: /^LOOT\.exe$/i, about: 'Load order sorting and masterlist notes.' },
  { id: 'wryebash', name: 'Wrye Bash', kind: 'wryebash', games: 'bethesda', repo: 'wrye-bash/wrye-bash', asset: /Standalone\.Executable\.7z$/i, exe: /^Wrye Bash\.exe$/i, about: 'Bashed patches and save tools.' },
  { id: 'nifskope', name: 'NifSkope', kind: 'nifskope', games: 'bethesda', repo: 'niftools/nifskope', asset: /x64\.7z$/i, exe: /^NifSkope\.exe$/i, about: 'View and edit .nif meshes.' },
  { id: 'texconv', name: 'texconv', kind: 'texconv', games: 'any', repo: 'microsoft/DirectXTex', asset: /^texconv\.exe$/i, exe: /^texconv\.exe$/i, about: 'Command-line DDS texture converter/resizer (the AI can run it).' },
  { id: 'blockbench', name: 'Blockbench', kind: 'blockbench', games: 'minecraft', repo: 'JannisX11/blockbench', asset: /_portable\.exe$/i, exe: /\.exe$/i, about: 'Model and texture editor for Minecraft and low-poly game models.' },
  { id: 'assetripper', name: 'AssetRipper', kind: 'other', games: 'unity', repo: 'AssetRipper/AssetRipper', asset: /win_x64\.zip$/i, exe: /^AssetRipper.*\.exe$/i, about: 'Extracts models, textures and audio from Unity games.' },
  { id: 'uabea', name: 'UABEA', kind: 'other', games: 'unity', repo: 'nesrak1/UABEA', asset: /windows\.zip$/i, exe: /^UABEAvalonia\.exe$/i, about: 'Unity asset bundle editor (replace textures, edit MonoBehaviour data).' },
  { id: 'fmodel', name: 'FModel', kind: 'other', games: 'unreal', repo: '4sval/FModel', asset: /^FModel\.zip$/i, exe: /^FModel\.exe$/i, about: 'Browses and exports Unreal Engine .pak/.utoc game files.' },
  { id: 'dnspy', name: 'dnSpyEx', kind: 'other', games: 'dotnet', repo: 'dnSpyEx/dnSpy', asset: /net-win64\.zip$/i, exe: /^dnSpy\.exe$/i, about: 'Decompiler/debugger for .NET and Unity (Mono) game code, for writing code mods.' },
];

// Which tool families make sense for a game.
function familiesFor(g) {
  const f = new Set(['any']);
  if (g.kind === 'bethesda') f.add('bethesda');
  if (g.kind === 'minecraft') f.add('minecraft');
  if (g.thunderstore) { f.add('unity'); f.add('dotnet'); } // Thunderstore games are Unity/BepInEx
  // Engine from the install folder: Unity games ship <Name>_Data\Managed, Unreal games Engine\Binaries / Content\Paks.
  try {
    const top = g.installDir ? fs.readdirSync(g.installDir) : [];
    if (top.some((n) => /_Data$/i.test(n) && fs.existsSync(path.join(g.installDir, n, 'Managed'))) || top.some((n) => /^(GameAssembly\.dll|UnityPlayer\.dll)$/i.test(n))) { f.add('unity'); f.add('dotnet'); }
    if (top.some((n) => n.toLowerCase() === 'engine') || top.some((n) => fs.existsSync(path.join(g.installDir, n, 'Content', 'Paks')))) f.add('unreal');
  } catch {
    // folder not readable
  }
  return f;
}

function list(gameId) {
  const g = mods.game(gameId);
  const fam = familiesFor(g);
  const registered = tools.list(gameId).registered || [];
  return CATALOG.map((t) => ({
    id: t.id, name: t.name, about: t.about, suggested: fam.has(t.games),
    installed: registered.some((r) => t.exe.test(path.basename(r.path)) && (t.kind === 'other' ? true : r.kind === t.kind)),
  }));
}

async function install(gameId, id) {
  const t = CATALOG.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown tool "${id}". Known: ${CATALOG.map((x) => x.id).join(', ')}`);
  const res = await fetch(`https://api.github.com/repos/${t.repo}/releases/latest`, { headers: { 'User-Agent': 'Shuriken', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
  const rel = await res.json();
  const asset = rel.assets.find((a) => t.asset.test(a.name));
  if (!asset) throw new Error(`No Windows download in ${t.name} ${rel.tag_name}`);
  const dir = store.dataDir('tools', t.id, rel.tag_name.replace(/[^\w.-]+/g, '_'));
  const dl = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Shuriken' } });
  if (!dl.ok) throw new Error(`Download failed: HTTP ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  if (/\.exe$/i.test(asset.name)) {
    fs.writeFileSync(path.join(dir, asset.name), buf);
  } else {
    const tmp = path.join(os.tmpdir(), `shuriken-${t.id}-${Date.now()}-${asset.name}`);
    fs.writeFileSync(tmp, buf);
    try {
      await archives.extract(tmp, dir);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  const exe = mods.walk(dir).map((rel2) => path.join(dir, rel2)).filter((p) => t.exe.test(path.basename(p))).sort((a, b) => a.length - b.length)[0];
  if (!exe) throw new Error(`Downloaded ${t.name} but could not find its program file in ${dir}`);
  const entry = tools.add(gameId, { name: t.name, path: exe, kind: t.kind === 'other' ? undefined : t.kind });
  return { installed: t.name, version: rel.tag_name, path: exe, tool: entry, license: `Downloaded from https://github.com/${t.repo}` };
}

module.exports = { CATALOG, list, install };
