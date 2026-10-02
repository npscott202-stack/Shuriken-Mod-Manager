// Minecraft mod loaders: Forge, NeoForge and Fabric installer lookup.
const UA = { 'User-Agent': 'Shuriken/0.1 (desktop mod manager)' };

async function json(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function text(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function forge(mcVersion) {
  const promos = await json('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
  const v = promos.promos[`${mcVersion}-recommended`] || promos.promos[`${mcVersion}-latest`];
  if (!v) throw new Error(`No Forge build for Minecraft ${mcVersion}`);
  const full = `${mcVersion}-${v}`;
  return {
    loader: 'forge',
    version: v,
    url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`,
    fileName: `forge-${full}-installer.jar`,
  };
}

async function neoforge(mcVersion) {
  const xml = await text('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
  const [, minor, patch = '0'] = mcVersion.split('.');
  const prefix = `${minor}.${patch}.`;
  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]).filter((v) => v.startsWith(prefix));
  const stable = all.filter((v) => !/beta|alpha/i.test(v));
  const v = (stable.length ? stable : all).pop();
  if (!v) throw new Error(`No NeoForge build for Minecraft ${mcVersion}`);
  return {
    loader: 'neoforge',
    version: v,
    url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`,
    fileName: `neoforge-${v}-installer.jar`,
  };
}

async function fabric(mcVersion) {
  const loaders = await json(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`);
  if (!loaders.length) throw new Error(`No Fabric loader for Minecraft ${mcVersion}`);
  const installers = await json('https://meta.fabricmc.net/v2/versions/installer');
  const inst = installers.find((i) => i.stable) || installers[0];
  return {
    loader: 'fabric',
    version: loaders[0].loader.version,
    url: inst.url,
    fileName: `fabric-installer-${inst.version}.jar`,
    // Fabric's installer can run headless: java -jar fabric-installer.jar client -mcversion X -noprofile? (we keep profile)
    cliArgs: ['client', '-mcversion', mcVersion, '-loader', loaders[0].loader.version],
  };
}

async function minecraftVersions() {
  const manifest = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  return manifest.versions.filter((v) => v.type === 'release').map((v) => v.id);
}

module.exports = { forge, neoforge, fabric, minecraftVersions };
