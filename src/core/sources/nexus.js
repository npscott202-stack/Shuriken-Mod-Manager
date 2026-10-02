// Nexus Mods public API v1 (personal API key from nexusmods.com/users/myaccount?tab=api).
// Premium accounts can download directly; free accounts download through the
// "Mod Manager Download" button, which opens an nxm:// link that Shuriken handles.
const store = require('../store');

const API = 'https://api.nexusmods.com/v1';

function key() {
  return store.getSecret('nexusApiKey');
}

async function call(pathname, params) {
  const apikey = key();
  if (!apikey) throw new Error('Add your Nexus Mods API key in Settings first.');
  const url = `${API}${pathname}${params ? `?${new URLSearchParams(params)}` : ''}`;
  const res = await fetch(url, {
    headers: { apikey, 'Application-Name': 'Shuriken', 'Application-Version': '0.1.0', 'User-Agent': 'Shuriken/0.1' },
  });
  if (res.status === 403 && /download_link/.test(pathname)) {
    throw new Error('Nexus only allows direct downloads for Premium members. Use the "Mod Manager Download" button on the Nexus page instead; Shuriken will pick it up.');
  }
  if (!res.ok) throw new Error(`Nexus ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const validate = () => call('/users/validate.json');
const mod = (domain, id) => call(`/games/${domain}/mods/${id}.json`);
const files = (domain, id) => call(`/games/${domain}/mods/${id}/files.json`);
const list = (domain, kind) => call(`/games/${domain}/mods/${kind}.json`); // trending | latest_added | latest_updated
const md5 = (domain, hash) => call(`/games/${domain}/mods/md5_search/${hash}.json`);

async function downloadLinks(domain, modId, fileId, nxm) {
  const params = nxm ? { key: nxm.key, expires: nxm.expires } : undefined;
  return call(`/games/${domain}/mods/${modId}/files/${fileId}/download_link.json`, params);
}

// nxm://skyrimspecialedition/mods/266/files/1000172397?key=...&expires=...&user_id=...
function parseNxm(link) {
  const u = new URL(link);
  const m = u.pathname.match(/\/mods\/(\d+)\/files\/(\d+)/);
  if (u.protocol !== 'nxm:' || !m) throw new Error('Not a Nexus mod download link');
  return {
    domain: u.hostname,
    modId: m[1],
    fileId: m[2],
    key: u.searchParams.get('key'),
    expires: u.searchParams.get('expires'),
  };
}

// Accepts https://www.nexusmods.com/skyrimspecialedition/mods/266 style URLs.
function parseModUrl(url) {
  const m = String(url).match(/nexusmods\.com\/([^/]+)\/mods\/(\d+)/i);
  return m ? { domain: m[1], modId: m[2] } : null;
}

module.exports = { validate, mod, files, list, md5, downloadLinks, parseNxm, parseModUrl, hasKey: () => !!key() };
