// Research tools for the AI assistant: web search, reading pages, Nexus Mods search (metadata
// only), game wikis, GitHub and Reddit (through web search). Works for the free local AI and for
// Claude alike, no API keys needed.
const { GAMES } = require('./games');
const store = require('./store');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 Shuriken';
const TIMEOUT = 20000;

async function get(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(opts.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow' });
  return res;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const strip = (s) => decode(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// ---------- web search ----------
// DuckDuckGo first; when it rate-limits (it does after bursts of queries), Brave Search.
const searchCache = new Map();

function parseDdg(html, limit) {
  const results = [];
  const re = /class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/g;
  let m;
  while ((m = re.exec(html)) && results.length < limit) {
    let url = decode(m[1]);
    const u = url.match(/[?&]uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    if (/duckduckgo\.com\/y\.js|ad_domain/.test(url)) continue; // ads
    results.push({ title: strip(m[2]), url, snippet: strip(m[3]) });
  }
  return results;
}

function parseBrave(html, limit) {
  const results = [];
  const blocks = html.split('data-type="web"').slice(1);
  for (const blk of blocks) {
    if (results.length >= limit) break;
    const url = (blk.match(/<a href="(https?:\/\/[^"]+)"/) || [])[1];
    const title = (blk.match(/class="title search-snippet-title[^"]*"[^>]*title="([^"]*)"/) || [])[1];
    const snip = (blk.match(/<div class="content [^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
    if (url && title) results.push({ title: decode(title), url: decode(url), snippet: strip(snip) });
  }
  return results;
}

// Free search engines block bursts of automated queries, so space them out.
let lastScrape = 0;
async function politeDelay() {
  const wait = lastScrape + 2500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastScrape = Date.now();
}

// Optional: the user's free Brave Search API key (Settings) gives reliable results.
async function braveApi(q, limit, key) {
  const res = await get(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${limit}`, { headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
  if (!res.ok) throw new Error(`Brave Search API: HTTP ${res.status}${res.status === 401 || res.status === 422 ? ' (check the key in Settings)' : ''}`);
  const j = await res.json();
  return (j.web?.results || []).map((r) => ({ title: strip(r.title), url: r.url, snippet: strip(r.description || '') }));
}

async function webSearch(query, { site, limit = 8 } = {}) {
  const q = site ? `${query} site:${site}` : query;
  const cached = searchCache.get(q);
  if (cached && Date.now() - cached.at < 30 * 60000) return cached.value;
  let results = [];
  let engine = 'DuckDuckGo';
  const key = store.getSecret('braveSearchKey');
  if (key) {
    engine = 'Brave Search API';
    results = await braveApi(q, limit, key);
    const value = { query: q, engine, results, note: 'Open the most relevant results with read_web_page before relying on them, and cite where facts came from.' };
    searchCache.set(q, { at: Date.now(), value });
    return value;
  }
  await politeDelay();
  try {
    const res = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
    if (res.ok) results = parseDdg(await res.text(), limit);
  } catch {
    // fall through to Brave
  }
  if (!results.length) {
    engine = 'Brave';
    const res = await get(`https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`);
    if (!res.ok) throw new Error(`The free web search engines are rate-limiting (HTTP ${res.status}); wait a minute, or add a free Brave Search API key in Settings for reliable search. Meanwhile use search_nexus, search_wiki and search_github, which have their own sources.`);
    results = parseBrave(await res.text(), limit);
  }
  const value = { query: q, engine, results, note: results.length ? 'Open the most relevant results with read_web_page before relying on them, and cite where facts came from.' : 'No results. Try fewer or different words.' };
  if (results.length) searchCache.set(q, { at: Date.now(), value });
  return value;
}

// ---------- reading a page ----------
// Sites whose owners ask tools not to read their pages: link the user there instead.
const NO_READ = [/(^|\.)nexusmods\.com$/i];

function readable(html) {
  let h = html.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ');
  const main = h.match(/<(article|main)[\s\S]*?<\/\1>/i);
  if (main && main[0].length > 1500) h = main[0];
  h = h.replace(/<\/(p|div|li|h[1-6]|tr|br|pre|blockquote)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n${'#'.repeat(Number(n))} `);
  return decode(h.replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
}

async function readPage(url, { maxChars = 12000, find } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('Not a valid web address');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) pages can be read');
  if (NO_READ.some((re) => re.test(u.hostname))) {
    return { url, blocked: true, note: 'Nexus Mods does not allow tools to read its pages. Use search_nexus for the mod\'s name, summary, version and author, and give the user this link to read the description and requirements themselves.' };
  }
  // Reddit serves a readable JSON version of threads.
  if (/(^|\.)reddit\.com$/i.test(u.hostname) && /\/comments\//.test(u.pathname)) {
    try {
      return await readReddit(u);
    } catch {
      return { url, blocked: true, note: 'Reddit blocks automated reading right now. Use the search snippet, and give the user the link if the thread looks useful.' };
    }
  }
  const res = await get(u.href);
  if (!res.ok) throw new Error(`The page answered HTTP ${res.status}${res.status === 403 ? ' (it blocks automated readers)' : ''}`);
  const type = res.headers.get('content-type') || '';
  if (!/text|html|json|xml/.test(type)) throw new Error(`Not a text page (${type})`);
  const raw = await res.text();
  const title = strip((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  let text = /html/.test(type) ? readable(raw) : raw;
  if (find) {
    // Jump to the part of a long page that mentions what we are looking for.
    const i = text.toLowerCase().indexOf(String(find).toLowerCase());
    if (i > 0) text = `…${text.slice(Math.max(0, i - 1500))}`;
  }
  return { url: res.url, title, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

async function readReddit(u) {
  const res = await get(`https://www.reddit.com${u.pathname.replace(/\/$/, '')}.json?limit=40&raw_json=1`, { headers: { 'User-Agent': 'Shuriken/0.6 (desktop mod manager)' } });
  if (!res.ok) throw new Error(`Reddit answered HTTP ${res.status}`);
  const data = await res.json();
  const post = data?.[0]?.data?.children?.[0]?.data || {};
  const comments = (data?.[1]?.data?.children || []).map((c) => c.data).filter((c) => c?.body).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 15);
  return { url: u.href, title: post.title, text: [post.selftext || '', ...comments.map((c) => `[${c.score} points] ${c.body}`)].join('\n\n---\n\n').slice(0, 12000) };
}

// ---------- Nexus Mods (public GraphQL search: metadata only) ----------
async function searchNexus(gameId, query, { limit = 8 } = {}) {
  const domain = GAMES[gameId]?.nexusDomain;
  if (!domain) throw new Error('This game is not on Nexus Mods');
  const body = {
    query: 'query($d: String!, $q: String!, $n: Int!) { mods(filter: { gameDomainName: [{ value: $d }], name: [{ value: $q, op: WILDCARD }] }, sort: [{ endorsements: { direction: DESC } }], count: $n) { nodes { modId name summary version author endorsements downloads updatedAt } } }',
    variables: { d: domain, q: query, n: limit },
  };
  const res = await get('https://api.nexusmods.com/v2/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Nexus search failed (HTTP ${res.status})`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  const nodes = json.data?.mods?.nodes || [];
  return {
    results: nodes.map((n) => ({ ...n, url: `https://www.nexusmods.com/${domain}/mods/${n.modId}` })),
    note: 'Nexus asks tools not to read mod pages: rely on these fields and send the user the link for descriptions and requirements. Prefer mods with many endorsements and recent updates.',
  };
}

// ---------- wikis ----------
const WIKIS = {
  skyrimse: ['https://en.uesp.net/w/api.php', 'https://elderscrolls.fandom.com/api.php'],
  skyrim: ['https://en.uesp.net/w/api.php', 'https://elderscrolls.fandom.com/api.php'],
  skyrimvr: ['https://en.uesp.net/w/api.php'],
  oblivion: ['https://en.uesp.net/w/api.php'],
  oblivionremastered: ['https://en.uesp.net/w/api.php'],
  fallout4: ['https://fallout.fandom.com/api.php'],
  fallout4vr: ['https://fallout.fandom.com/api.php'],
  falloutnv: ['https://fallout.fandom.com/api.php'],
  fallout3: ['https://fallout.fandom.com/api.php'],
  starfield: ['https://starfield.fandom.com/api.php'],
  minecraft: ['https://minecraft.wiki/api.php'],
  stardewvalley: ['https://stardewvalleywiki.com/mediawiki/api.php'],
  cyberpunk2077: ['https://cyberpunk.fandom.com/api.php'],
  baldursgate3: ['https://bg3.wiki/w/api.php'],
};

function wikitextToText(w) {
  return w
    .replace(/\{\{[^{}]*\}\}/g, ' ').replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, ' ')
    .replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[https?:\/\/\S+ ([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '').replace(/<ref[\s\S]*?<\/ref>|<[^>]+>/g, ' ')
    .replace(/^\s*\{\|[\s\S]*?^\s*\|\}/gm, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function searchWiki(gameId, query, { page } = {}) {
  const apis = WIKIS[gameId];
  if (!apis) throw new Error('No wiki is linked for this game; use web_search instead.');
  if (page) {
    for (const api of apis) {
      const res = await get(`${api}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&redirects=1`);
      if (!res.ok) continue;
      const j = await res.json();
      const w = j.parse?.wikitext?.['*'];
      if (w) return { wiki: new URL(api).hostname, title: j.parse.title, text: wikitextToText(w).slice(0, 12000) };
    }
    throw new Error(`Wiki page "${page}" not found`);
  }
  const out = [];
  for (const api of apis) {
    try {
      const res = await get(`${api}?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=6`);
      if (!res.ok) continue;
      const j = await res.json();
      for (const r of j.query?.search || []) out.push({ wiki: new URL(api).hostname, title: r.title, snippet: strip(r.snippet || '') });
    } catch {
      // one wiki down is fine
    }
  }
  return { results: out, note: 'Read a page with search_wiki and page set to its title.' };
}

// ---------- GitHub ----------
async function searchGithub(query, { limit = 6 } = {}) {
  const res = await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=${limit}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub search failed (HTTP ${res.status})`);
  const j = await res.json();
  return { results: (j.items || []).map((r) => ({ repo: r.full_name, description: r.description, stars: r.stargazers_count, updated: r.pushed_at, url: r.html_url, license: r.license?.spdx_id || null })) };
}

module.exports = { webSearch, readPage, searchNexus, searchWiki, searchGithub, WIKIS };
