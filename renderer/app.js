/* Shuriken renderer – single-page UI. */
const api = window.shuriken;

// ---------- helpers ----------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $ = (sel) => document.querySelector(sel);
const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : 'never');
const fmtNum = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

function toast(text, kind = 'info', ms = 4500) {
  const t = h('div', { class: `toast ${kind}` }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

async function run(fn, okText) {
  try {
    const r = await fn();
    if (okText) toast(okText, 'success');
    return r;
  } catch (e) {
    toast(e.message, 'error', 8000);
    throw e;
  }
}

function toggle(checked, onChange, title) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle', title }, input, h('span'));
}

const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  mods: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  plugins: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  browse: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  downloads: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>',
  ai: '<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  diagnostics: '<path d="M22 12h-4l-3 8-6-16-3 8H2"/>',
  workshop: '<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>',
  library: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17 5 3.5 14.5"/>',
  mods2: '<path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  saves: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  precomb: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/><path d="M12 11v10" opacity=".5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = ICONS[name];
  return s;
};

// The Shuriken mark (same geometry as assets/icon.png).
const SHURIKEN_PATH = 'M 206.5 206.5 C 177.1 107.7 233.6 43.2 256 18 C 262.1 80.1 296.3 173.3 305.5 206.5 C 404.3 177.1 468.8 233.6 494 256 C 431.9 262.1 338.7 296.3 305.5 305.5 C 334.9 404.3 278.4 468.8 256 494 C 249.9 431.9 215.7 338.7 206.5 305.5 C 107.7 334.9 43.2 278.4 18 256 C 80.1 249.9 173.3 215.7 206.5 206.5 Z';
function logo(cls = 'logo') {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="${cls}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="sg-${cls}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6e7c"/><stop offset="1" stop-color="#8c081c"/></linearGradient></defs>
    <path d="${SHURIKEN_PATH}" fill="url(#sg-${cls})" stroke="#ffe2e6" stroke-width="10" stroke-linejoin="round"/>
    <circle cx="256" cy="256" r="46" fill="#e8ecf2"/><circle cx="256" cy="256" r="26" fill="#0c0a10"/></svg>`;
  return wrap.firstChild;
}

function gameColors(g) {
  const [c1, c2] = g.color || ({ skyrimse: ['#6b7a8f', '#141a22'], fallout4: ['#2fae5f', '#0e2416'], starfield: ['#4a7bd8', '#0d1530'], minecraft: ['#6fbf3a', '#3b2a14'] }[g.id] || (g.kind === 'bethesda' ? ['#8a8f99', '#14161b'] : ['#ff3b4f', '#1a0a10']));
  return { c1, c2 };
}

function artStyle(g, which = 'header') {
  const { c1, c2 } = gameColors(g);
  const url = g.art?.[which];
  return {
    '--c1': c1, '--c2': c2,
    backgroundImage: url ? `url("${url}"), linear-gradient(135deg, ${c1}, ${c2})` : `linear-gradient(135deg, ${c1}, ${c2})`,
  };
}

const initials = (g) => g.short.split(/[\s:]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

// ---------- state ----------
const state = {
  games: [],
  gameId: null,
  page: 'dashboard',
  settings: {},
  keys: {},
  cloudProviders: [],
  mods: [],
  selectedMod: null,
  downloads: new Map(),
  chats: {},
};

const PAGES = [
  { id: 'library', label: 'Game Library', icon: 'library' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'mods', label: 'Mods', icon: 'mods' },
  { id: 'plugins', label: 'Load Order', icon: 'plugins', only: 'bethesda' },
  { id: 'saves', label: 'Saves', icon: 'saves', only: 'bethesda' },
  { id: 'precombines', label: 'Precombines', icon: 'precomb', only: (g) => g.id === 'fallout4' || g.id === 'fallout4vr' },
  { id: 'browse', label: 'Get Mods', icon: 'browse' },
  { id: 'downloads', label: 'Downloads', icon: 'downloads' },
  { id: 'ai', label: 'AI Assistant', icon: 'ai' },
  { id: 'workshop', label: 'Workshop', icon: 'workshop' },
  { id: 'tools', label: 'Tools', icon: 'tools' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const game = () => state.games.find((g) => g.id === state.gameId);
const pageHidden = (p, g) => !!p.only && (typeof p.only === 'function' ? !g || !p.only(g) : g?.kind !== p.only);
const aiProvider = () => state.settings.aiProvider || (state.keys.anthropic ? 'claude' : 'local');
const managedGames = () => (state.settings.managedGames || []).map((id) => state.games.find((g) => g.id === id)).filter(Boolean);

async function setManaged(gameId, on) {
  const list = new Set(state.settings.managedGames || []);
  if (on) list.add(gameId);
  else list.delete(gameId);
  state.settings = await api.call('settings:set', { managedGames: [...list] });
  if (!on && state.gameId === gameId) state.gameId = managedGames()[0]?.id || state.gameId;
  renderChrome();
}

// Lets the user pick a game folder; returns true only if a folder was actually chosen.
async function pickGameFolder(g) {
  const view = await run(() => api.call('game:pickFolder', g.id));
  if (!view) return false;
  state.games = state.games.map((x) => (x.id === view.id ? view : x));
  toast(`${g.short} folder set`, 'success');
  renderChrome();
  return true;
}

async function refreshGame() {
  const g = await api.call('game:get', state.gameId);
  state.games = state.games.map((x) => (x.id === g.id ? g : x));
  renderChrome();
  return g;
}

// ---------- chrome ----------
function renderSidebar() {
  const list = $('#gameList');
  const managed = managedGames();
  list.replaceChildren(
    ...managed.map((g) =>
      h('div', { class: `game-item ${g.id === state.gameId ? 'active' : ''}`, onClick: () => selectGame(g.id), title: g.name },
        h('div', { class: 'thumb', style: artStyle(g, 'header') }, g.art ? '' : initials(g)),
        h('div', { class: 'gname' }, g.short, h('div', { class: 'gsub' }, g.installDir ? `${g.modCount} mods` : 'Not found')),
      ),
    ),
    ...(managed.length ? [] : [h('div', { class: 'faint small', style: { padding: '6px 10px' } }, 'Pick games in the Library.')]),
  );
  const g = game();
  $('#nav').replaceChildren(
    ...PAGES.map((p) =>
      h('div', { class: `nav-item ${p.id === state.page ? 'active' : ''} ${pageHidden(p, g) ? 'hidden' : ''}`, onClick: () => go(p.id) },
        icon(p.icon), p.label,
        p.id === 'downloads' && [...state.downloads.values()].some((d) => d.status === 'downloading') ? h('span', { class: 'count' }, '•') : null,
      ),
    ),
  );
}

function renderTopbar() {
  const g = game();
  const page = PAGES.find((p) => p.id === state.page);
  $('#pageTitle').textContent = page.label;
  $('#pageSub').textContent = g ? `${g.name}${g.installDir ? '' : ' (folder not set)'}` : '';
  const inst = $('#instanceSelect');
  inst.replaceChildren(
    ...g.instances.list.map((n) => h('option', { value: n, selected: n === g.instances.active }, `Instance: ${n}`)),
    h('option', { value: '__new' }, '+ New instance…'),
    g.instances.active !== 'Default' ? h('option', { value: '__del' }, `− Delete "${g.instances.active}"`) : null,
  );
  const sel = $('#profileSelect');
  sel.replaceChildren(
    ...g.profiles.names.map((n) => h('option', { value: n, selected: n === g.profiles.active }, `Profile: ${n}`)),
    h('option', { value: '__new' }, '+ New profile…'),
    h('option', { value: '__manage' }, '⚙ Manage profiles…'),
  );
  const pill = $('#deployPill');
  const text = $('#deployText');
  if (!g.installDir) { pill.className = 'pill err'; text.textContent = 'Game folder not set'; }
  else if (g.deployMode === 'virtual') { pill.className = 'pill ok'; text.textContent = g.deployment.dirty ? 'Virtual · applies at launch' : 'Virtual · game folder clean'; }
  else if (g.deployment.dirty) { pill.className = 'pill warn'; text.textContent = 'Changes not deployed'; }
  else if (g.deployment.deployedAt) { pill.className = 'pill ok'; text.textContent = `Deployed · ${g.deployment.files} files`; }
  else { pill.className = 'pill'; text.textContent = 'Nothing deployed'; }
}

function renderChrome() {
  renderSidebar();
  renderTopbar();
}

async function selectGame(id) {
  state.gameId = id;
  state.selectedMod = null;
  localStorage.setItem('shuriken.game', id);
  if (pageHidden(PAGES.find((p) => p.id === state.page) || {}, game())) state.page = 'dashboard';
  renderChrome();
  return renderPage();
}

function go(page) {
  state.page = page;
  localStorage.setItem('shuriken.page', page);
  renderChrome();
  return renderPage();
}

async function renderPage() {
  const content = $('#content');
  content.className = state.page === 'ai' ? 'content flush' : 'content';
  const fn = { library: pageLibrary, dashboard: pageDashboard, mods: pageMods, plugins: pagePlugins, saves: pageSaves, precombines: pagePrecombines, browse: pageBrowse, downloads: pageDownloads, ai: pageAi, workshop: pageWorkshop, tools: pageTools, diagnostics: pageDiagnostics, settings: pageSettings }[state.page];
  const page = state.page;
  const gameId = state.gameId;
  try {
    const el = await fn();
    if (page === state.page && gameId === state.gameId) content.replaceChildren(el);
  } catch (e) {
    console.error(`[page ${page}] ${e.stack || e.message}`);
    content.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, 'Something went wrong'), e.message));
  }
}

function needFolder(g) {
  return h('div', { class: 'card empty' },
    h('div', { class: 'big' }, `${g.name} wasn't found automatically`),
    h('p', { class: 'muted' }, g.kind === 'minecraft' ? 'Pick your .minecraft folder or a modpack instance folder.' : `Pick the folder that contains ${g.exe}.`),
    h('button', { class: 'btn primary', onClick: async () => { if (await pickGameFolder(g)) renderPage(); } }, 'Choose folder…'),
  );
}

// ---------- install flow (incl. FOMOD) ----------
async function handleInstallResults(results) {
  let installed = 0;
  for (const r of results || []) {
    if (r.error) toast(r.error, 'error', 9000);
    else if (r.mod) installed++;
    else if (r.fomod) {
      const mod = await fomodWizard(r.fomod);
      if (mod) installed++;
    }
  }
  if (installed) toast(`Installed ${installed} mod${installed > 1 ? 's' : ''}. Deploy to apply.`, 'success');
  await refreshGame();
  if (['mods', 'dashboard', 'downloads'].includes(state.page)) renderPage();
}

function fomodWizard(info) {
  return new Promise((resolve) => {
    const selections = {};
    const history = [];
    let current = null;
    const back = h('div', { class: 'modal-back' });
    const body = h('div', { class: 'mbody' });
    const title = h('span');
    const btnBack = h('button', { class: 'btn', onClick: () => goBack() }, 'Back');
    const btnNext = h('button', { class: 'btn primary', onClick: () => next() }, 'Next');
    const close = (value) => { back.remove(); resolve(value); };
    const modal = h('div', { class: 'modal' },
      h('header', {}, h('span', { class: 'badge src' }, 'FOMOD'), info.name, h('span', { class: 'muted small' }, ' · '), title),
      body,
      h('footer', {}, h('button', { class: 'btn ghost', onClick: async () => { await api.call('fomod:cancel', info.token); close(null); } }, 'Cancel'), btnBack, btnNext),
    );
    back.append(modal);
    document.body.append(back);

    async function show(stepInfo) {
      current = stepInfo;
      const step = info.steps[stepInfo.index];
      title.textContent = step.name;
      const sel = (selections[stepInfo.index] = selections[stepInfo.index] || {});
      const preview = h('div', { class: 'fomod-preview' });
      const setPreview = async (p) => {
        preview.replaceChildren(h('h4', {}, p.name));
        if (p.image) {
          const url = await api.call('fomod:image', p.image).catch(() => null);
          if (url) preview.prepend(h('img', { src: url }));
        }
        preview.append(h('div', { class: 'desc' }, p.description || 'No description.'));
      };
      const groups = step.groups.map((grp, gi) => {
        const types = stepInfo.types[gi];
        const radio = grp.type === 'SelectExactlyOne' || grp.type === 'SelectAtMostOne';
        if (!sel[gi]) {
          sel[gi] = grp.plugins.map((_, pi) => pi).filter((pi) => types[pi] === 'Required' || types[pi] === 'Recommended' || grp.type === 'SelectAll');
          if (grp.type === 'SelectExactlyOne' && !sel[gi].length) {
            const first = grp.plugins.findIndex((_, pi) => types[pi] !== 'NotUsable');
            if (first >= 0) sel[gi] = [first];
          }
          if (radio) sel[gi] = sel[gi].slice(0, 1);
        }
        return h('div', { class: 'fomod-group' },
          h('h4', {}, grp.name, h('span', { class: 'faint small' }, `  ${grp.type.replace(/([A-Z])/g, ' $1').trim()}`)),
          grp.plugins.map((p, pi) => {
            const disabled = types[pi] === 'NotUsable' || types[pi] === 'Required' || grp.type === 'SelectAll';
            const input = h('input', { type: radio ? 'radio' : 'checkbox', name: `g${stepInfo.index}-${gi}`, disabled });
            input.checked = sel[gi].includes(pi);
            input.addEventListener('change', () => {
              if (radio) sel[gi] = [pi];
              else sel[gi] = input.checked ? [...new Set([...sel[gi], pi])] : sel[gi].filter((x) => x !== pi);
            });
            return h('label', { class: `fomod-opt ${types[pi] === 'NotUsable' ? 'disabled' : ''}`, onMouseenter: () => setPreview(p) },
              input, h('span', { class: 'grow' }, p.name),
              types[pi] !== 'Optional' ? h('span', { class: 'badge' }, types[pi]) : null);
          }),
        );
      });
      const firstPlugin = step.groups[0]?.plugins[0];
      if (firstPlugin) setPreview(firstPlugin);
      body.replaceChildren(h('div', { class: 'fomod-grid' }, h('div', {}, groups), preview));
      btnBack.disabled = !history.length;
      const nextInfo = await api.call('fomod:step', info.token, stepInfo.index + 1, selections);
      btnNext.textContent = nextInfo.index === -1 ? 'Install' : 'Next';
    }

    async function next() {
      if (current) {
        const step = info.steps[current.index];
        const missing = step.groups.find((grp, gi) => ['SelectExactlyOne', 'SelectAtLeastOne'].includes(grp.type) && !(selections[current.index]?.[gi] || []).length);
        if (missing) return toast(`Choose an option in "${missing.name}" first.`, 'error');
      }
      const nextInfo = await api.call('fomod:step', info.token, (current?.index ?? -1) + 1, selections);
      if (nextInfo.index === -1) {
        btnNext.disabled = true;
        btnNext.textContent = 'Installing…';
        try {
          const mod = await api.call('fomod:complete', info.token, selections);
          close(mod);
        } catch (e) {
          toast(e.message, 'error');
          close(null);
        }
        return;
      }
      if (current) history.push(current);
      show(nextInfo);
    }
    function goBack() {
      const prev = history.pop();
      if (prev) show(prev);
    }
    if (!info.steps.length) next();
    else api.call('fomod:step', info.token, 0, selections).then((s) => (s.index === -1 ? next() : show(s)));
  });
}

// ---------- Dashboard ----------
async function pageDashboard() {
  const g = game();
  if (!g.installDir) return h('div', {}, hero(g), needFolder(g));
  const [health, logs, mods] = await Promise.all([
    api.call('diag:health', g.id).catch((e) => ({ issues: [{ severity: 'error', message: e.message }] })),
    api.call('diag:crashLogs', g.id).catch(() => []),
    api.call('mods:list', g.id),
  ]);
  state.mods = mods;
  const enabled = mods.filter((m) => m.enabled).length;
  const conflicts = mods.reduce((n, m) => n + m.conflicts.loses.length, 0);

  const issues = health.issues.length
    ? health.issues.map((i) => h('div', { class: `issue ${i.severity}` }, h('span', { class: 'sev' }), h('div', { class: 'txt' }, i.message)))
    : [h('div', { class: 'issue info' }, h('span', { class: 'sev', style: { background: 'var(--ok)' } }), h('div', { class: 'txt' }, 'No problems found.'))];

  return h('div', {},
    hero(g),
    h('div', { class: 'grid cols-3', style: { marginBottom: '16px' } },
      statCard('mods2', `${enabled}/${mods.length}`, 'mods enabled'),
      statCard('bolt', String(conflicts), 'file conflicts'),
      statCard('clock', g.deployment.deployedAt ? new Date(g.deployment.deployedAt).toLocaleDateString() : '—', g.deployment.dirty ? 'last deployed · changes pending' : 'last deployed'),
    ),
    g.kind === 'minecraft' ? minecraftCard(g) : deploymentCard(g),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' },
        h('h3', {}, 'Health check', h('button', { class: 'btn small right', onClick: () => askAi('Run a health check on my setup and fix whatever you can. Explain each problem first.') }, '✦ Fix with AI')),
        issues),
      h('div', { class: 'card' },
        h('h3', {}, 'Recent crash & game logs'),
        logs.length
          ? logs.slice(0, 6).map((l) => h('div', { class: 'issue info' },
              h('div', { class: 'txt' }, h('div', { class: 'name' }, l.name), h('div', { class: 'faint small' }, fmtDate(l.date))),
              h('button', { class: 'btn small', onClick: () => askAi(`My game crashed. Analyze this crash log and tell me what caused it and how to fix it: ${l.path}`) }, '✦ Analyze')))
          : h('div', { class: 'muted' }, 'No crash logs found. Install Buffout 4 / Crash Logger to get detailed crash logs.')),
    ),
  );
}

function deploymentCard(g) {
  const choose = async (mode) => {
    if (mode === g.deployMode) return;
    const msg = mode === 'virtual'
      ? 'Switch to Virtual mode (like Mod Organizer 2)?\n\nShuriken removes the mod files it put in the game folder, and from now on mods are shown to the game through a virtual file system when you press Play or launch a tool from Shuriken. Only script extender loaders / ENB / DLL plugins are placed in the game folder.\n\nImportant: start the game and tools from Shuriken, otherwise they only see the vanilla game.'
      : 'Switch to Hardlink mode (like Vortex)?\n\nMods will be linked into the game folder when you click Deploy, so the game and tools see them however you start them.';
    if (!await askConfirm(msg)) return;
    await run(() => api.call('mode:set', g.id, mode), mode === 'virtual' ? 'Virtual mode on: your game folder is clean.' : 'Hardlink mode on: click Deploy to apply your mods.');
    await refreshGame();
    renderPage();
  };
  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('h3', {}, 'How mods are applied', h('span', { class: 'right faint small' }, `Instance: ${g.instances.active} · Profile: ${g.profiles.active}`)),
    h('div', { class: 'grid cols-2' },
      ...[['hardlink', 'Hardlink (Vortex-style)', 'Mods are linked into the game folder when you Deploy. Works no matter how you start the game.'],
        ['virtual', 'Virtual (MO2-style)', 'The game folder stays untouched. Mods are layered in virtually when you start the game or a tool from Shuriken. Switch profiles and instances instantly; per-profile INIs and saves.']]
        .map(([mode, title, text]) => h('div', { class: `fomod-opt ${g.deployMode === mode ? 'selected' : ''}`, style: { alignItems: 'flex-start', cursor: 'pointer', borderColor: g.deployMode === mode ? 'var(--accent)' : '' }, onClick: () => choose(mode) },
          h('input', { type: 'radio', checked: g.deployMode === mode, style: { marginTop: '4px' } }),
          h('div', {}, h('div', { class: 'name' }, title), h('div', { class: 'muted small' }, text))))),
    g.deployMode === 'virtual' && g.overwriteCount ? h('div', { class: 'small muted', style: { marginTop: '10px' } }, `Overwrite holds ${g.overwriteCount} file(s) created by the game or tools. Manage them on the Mods page.`) : null,
  );
}

function hero(g) {
  const { c1, c2 } = gameColors(g);
  const chips = [
    h('span', { class: `chip ${g.installDir ? 'ok' : 'warn'}` }, g.installDir ? '● Installed' : '● Folder not set'),
    g.kind === 'bethesda' && g.installDir ? h('span', { class: `chip ${g.scriptExtender ? 'ok' : 'warn'}` }, `${g.scriptExtenderName || 'Script extender'} ${g.scriptExtender ? 'ready' : 'missing'}`) : null,
    g.kind === 'minecraft' ? h('span', { class: 'chip' }, `${g.mcVersion || 'version not set'} · ${g.loader}`) : null,
    g.kind === 'generic' && g.requires ? h('span', { class: 'chip' }, `Needs: ${g.requires.split(/[(;]/)[0].trim()}`) : null,
    h('span', { class: 'chip red' }, `${g.modCount} mods`),
  ];
  return h('div', { class: 'hero', style: { '--c1': c1, '--c2': c2 } },
    g.art ? h('div', { class: 'art', style: { backgroundImage: `url("${g.art.hero}"), url("${g.art.header}")` } }) : null,
    h('div', { class: 'inner' },
      h('div', { class: 'cover', style: artStyle(g, 'cover') }, g.art ? '' : initials(g)),
      h('div', { class: 'grow' },
        h('h2', {}, g.name),
        h('div', { class: 'chips' }, chips),
        h('div', { class: 'faint small mono selectable' }, g.installDir || 'Choose the game folder to start modding'),
      ),
      h('div', { class: 'row' },
        g.installDir ? h('button', { class: 'btn', onClick: () => api.call('game:openFolder', g.id, 'install') }, 'Open folder') : null,
        h('button', { class: 'btn', onClick: () => go('browse') }, 'Get mods'),
        h('button', { class: 'btn primary', onClick: () => go('ai') }, '✦ Ask AI'),
      ),
    ),
  );
}

function statCard(iconName, value, label) {
  return h('div', { class: 'card stat-card' }, h('div', { class: 'ico' }, icon(iconName)), h('div', {}, h('div', { class: 'stat' }, value), h('div', { class: 'stat-label' }, label)));
}

// ---------- Library ----------
const LIB_KIND = { bethesda: 'Plugins + load order', minecraft: 'Modrinth + loaders', generic: 'Mod folder' };

async function pageLibrary() {
  let filter = state.libFilter || 'all';
  const q = h('input', { class: 'input', placeholder: 'Search games…', style: { width: '260px' }, value: state.libQuery || '' });
  const grid = h('div', { class: 'lib-grid' });
  const seg = h('div', { class: 'seg' });
  const draw = () => {
    const query = q.value.toLowerCase();
    state.libQuery = q.value;
    const managed = new Set(state.settings.managedGames || []);
    const games = state.games
      .filter((g) => filter === 'all' || (filter === 'installed' ? g.installDir : managed.has(g.id)))
      .filter((g) => !query || g.name.toLowerCase().includes(query))
      .sort((a, b) => (!!b.installDir - !!a.installDir) || a.name.localeCompare(b.name));
    seg.replaceChildren(...[['all', `All (${state.games.length})`], ['installed', `Installed (${state.games.filter((g) => g.installDir).length})`], ['mine', `My games (${managed.size})`]]
      .map(([k, l]) => h('button', { class: filter === k ? 'on' : '', onClick: () => { filter = state.libFilter = k; draw(); } }, l)));
    grid.replaceChildren(...games.map((g) => {
      const on = managed.has(g.id);
      const pin = h('div', { class: `pin ${on ? 'on' : ''}`, title: on ? 'Remove from My games' : 'Add to My games' }, on ? '✓' : '+');
      pin.addEventListener('click', async (e) => { e.stopPropagation(); await setManaged(g.id, !on); draw(); });
      const open = async () => {
        if (!on) await setManaged(g.id, true);
        if (!g.installDir) await pickGameFolder(g);
        state.page = 'dashboard';
        selectGame(g.id);
      };
      return h('div', { class: `lib-card ${g.installDir ? '' : 'missing'}`, onClick: open, title: g.name },
        h('div', { class: 'cover', style: artStyle(g, 'cover') }, g.art ? '' : initials(g)),
        h('span', { class: 'kind badge' }, LIB_KIND[g.kind]),
        pin,
        h('div', { class: 'meta' },
          h('div', { class: 'title' }, g.name),
          h('div', { class: 'status' },
            h('span', { class: `chip ${g.installDir ? 'ok' : ''}` }, g.installDir ? 'Installed' : 'Not found'),
            g.modCount ? h('span', { class: 'chip red' }, `${g.modCount} mods`) : null)));
    }));
  };
  q.addEventListener('input', draw);
  draw();
  return h('div', {},
    h('div', { class: 'lib-head' }, seg, h('div', { class: 'grow' }), q,
      h('button', { class: 'btn', onClick: async () => { const r = await run(() => api.call('games:rescan')); state.games = r.games; renderChrome(); draw(); toast('Rescanned your Steam libraries', 'success'); } }, 'Rescan PC')),
    h('p', { class: 'muted small', style: { marginTop: '-6px', marginBottom: '18px' } }, 'Click a game to manage it. Shuriken finds Steam installs automatically; for other stores, click the game and choose its folder. Pinned games (✓) appear in the sidebar.'),
    grid);
}

function minecraftCard(g) {
  const versionSel = h('select', { class: 'input' }, h('option', { value: g.mcVersion }, g.mcVersion || 'Select version'));
  const loaderSel = h('select', { class: 'input' }, ...['fabric', 'forge', 'neoforge', 'quilt'].map((l) => h('option', { value: l, selected: l === g.loader }, l)));
  api.call('mc:versions').then((vs) => {
    versionSel.replaceChildren(...vs.slice(0, 80).map((v) => h('option', { value: v, selected: v === g.mcVersion }, v)));
    if (!g.mcVersion) versionSel.value = '';
  }).catch(() => {});
  const loaderBtn = h('button', { class: 'btn', onClick: async () => {
    if (!versionSel.value) return toast('Pick a Minecraft version first', 'error');
    loaderBtn.disabled = true;
    try {
      const r = await run(() => api.call('loader:install', loaderSel.value, versionSel.value));
      toast(r.note, 'success', 10000);
    } finally {
      loaderBtn.disabled = false;
    }
  } }, `Install ${g.loader} loader`);
  const save = async () => {
    loaderBtn.textContent = `Install ${loaderSel.value} loader`;
    await run(() => api.call('game:setMinecraft', g.id, { mcVersion: versionSel.value, loader: loaderSel.value }), 'Saved');
    refreshGame();
  };
  versionSel.addEventListener('change', save);
  loaderSel.addEventListener('change', save);
  const detected = g.mcProfiles.filter((p) => p.loader !== 'vanilla');
  return h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('h3', {}, 'Minecraft setup'),
    h('div', { class: 'row wrap' },
      h('label', { class: 'field' }, 'Minecraft version', versionSel),
      h('label', { class: 'field' }, 'Mod loader', loaderSel),
      h('div', { class: 'grow' }),
      loaderBtn,
    ),
    detected.length ? h('div', { class: 'small muted', style: { marginTop: '10px' } }, 'Installed loader profiles: ', detected.map((p) => h('span', { class: 'badge' }, `${p.loader} ${p.mcVersion}`))) : null,
  );
}

// ---------- Mods ----------
async function pageMods() {
  const g = game();
  if (!g.installDir) return needFolder(g);
  state.mods = await api.call('mods:list', g.id);
  const filter = h('input', { class: 'input', placeholder: 'Filter mods…', style: { width: '240px' } });
  const tbody = h('tbody');
  const detail = h('div', { class: 'detail' });

  const nameOf = (id) => state.mods.find((m) => m.id === id)?.name || id;
  function rows() {
    const q = filter.value.toLowerCase();
    tbody.replaceChildren(
      ...state.mods.filter((m) => !q || m.name.toLowerCase().includes(q)).map((m) => {
        const tr = h('tr', { class: `${m.enabled ? '' : 'disabled'} ${state.selectedMod === m.id ? 'selected' : ''}`, draggable: 'true', 'data-id': m.id, onClick: () => { state.selectedMod = m.id; rows(); showDetail(); } },
          h('td', { class: 'handle' }, '⋮⋮'),
          h('td', { onClick: (e) => e.stopPropagation() }, toggle(m.enabled, async (v) => { await api.call('mods:setEnabled', g.id, m.id, v); m.enabled = v; await refreshGame(); rows(); })),
          h('td', { class: 'name' }, m.name, m.uncertain ? h('span', { class: 'badge warn', title: 'Unusual folder layout' }, '?') : null),
          h('td', { class: 'muted' }, m.version || ''),
          h('td', {}, h('span', { class: 'badge src' }, m.source), m.fomod ? h('span', { class: 'badge' }, 'fomod') : null),
          h('td', {},
            m.conflicts.wins.length ? h('span', { class: 'badge win', title: `Overwrites: ${m.conflicts.wins.map(nameOf).join(', ')}` }, `▲ ${m.conflicts.wins.length}`) : null,
            m.conflicts.loses.length ? h('span', { class: 'badge lose', title: `Overwritten by: ${m.conflicts.loses.map(nameOf).join(', ')}` }, `▼ ${m.conflicts.loses.length}`) : null),
          h('td', { class: 'faint small' }, String(m.priority)),
        );
        dragRow(tr, async (fromId, toId, after) => {
          const order = state.mods.map((x) => x.id).filter((id) => id !== fromId);
          const idx = order.indexOf(toId) + (after ? 1 : 0);
          order.splice(idx, 0, fromId);
          await api.call('mods:setOrder', g.id, order);
          state.mods = await api.call('mods:list', g.id);
          await refreshGame();
          rows();
        });
        return tr;
      }),
    );
    if (!state.mods.length) tbody.append(h('tr', {}, h('td', { colspan: 7 }, h('div', { class: 'empty' }, h('div', { class: 'big' }, 'No mods yet'), 'Drag archives onto this window, use "Install from file", or get mods from Modrinth / Nexus.'))));
  }

  async function showDetail() {
    const m = state.mods.find((x) => x.id === state.selectedMod);
    if (!m) return detail.replaceChildren();
    const files = await api.call('mods:files', g.id, m.id).catch(() => []);
    const nameInput = h('input', { class: 'input', value: m.name });
    nameInput.addEventListener('change', async () => { await api.call('mods:rename', g.id, m.id, nameInput.value); m.name = nameInput.value; rows(); });
    detail.replaceChildren(h('div', { class: 'card' },
      h('label', { class: 'field' }, 'Name', nameInput),
      h('div', { class: 'kv', style: { margin: '12px 0' } },
        h('div', { class: 'k' }, 'Version'), h('div', {}, m.version || '—'),
        h('div', { class: 'k' }, 'Type'), h('div', {}, m.type),
        h('div', { class: 'k' }, 'Installed'), h('div', {}, fmtDate(m.installedAt)),
        h('div', { class: 'k' }, 'Files'), h('div', {}, String(files.length)),
      ),
      m.conflicts.wins.length ? h('div', { class: 'small', style: { marginBottom: '6px' } }, h('span', { class: 'badge win' }, 'Overwrites'), m.conflicts.wins.map(nameOf).join(', ')) : null,
      m.conflicts.loses.length ? h('div', { class: 'small', style: { marginBottom: '6px' } }, h('span', { class: 'badge lose' }, 'Overwritten by'), m.conflicts.loses.map(nameOf).join(', ')) : null,
      h('div', { class: 'file-list selectable' }, files.slice(0, 400).join('\n') || '(empty)'),
      h('div', { class: 'row wrap', style: { marginTop: '12px' } },
        m.sourceUrl ? h('button', { class: 'btn small', onClick: () => api.call('shell:open', m.sourceUrl) }, 'Mod page') : null,
        h('button', { class: 'btn small', onClick: () => api.call('mods:openFolder', g.id, m.id) }, 'Open folder'),
        h('button', { class: 'btn small', onClick: () => askAi(`Tell me about the mod "${m.name}" (id ${m.id}) in my setup: is it set up correctly, what does it conflict with, and does it need anything else?`) }, '✦ Ask AI'),
        h('button', { class: 'btn small danger', onClick: async () => {
          if (!await askConfirm(`Remove "${m.name}"? Its staged files will be deleted.`)) return;
          await run(() => api.call('mods:remove', g.id, m.id), 'Mod removed');
          state.selectedMod = null;
          renderPage();
          refreshGame();
        } }, 'Remove'),
      ),
    ));
  }

  async function setAll(on) {
    const targets = state.mods.filter((m) => m.enabled !== on);
    if (!targets.length) return;
    if (!on && !await askConfirm(`Disable all ${targets.length} enabled mods?`)) return;
    for (const m of targets) await api.call('mods:setEnabled', g.id, m.id, on);
    state.mods = await api.call('mods:list', g.id);
    await refreshGame();
    rows();
    toast(`${on ? 'Enabled' : 'Disabled'} ${targets.length} mods. Deploy to apply.`, 'success');
  }
  filter.id = 'modFilter';
  filter.addEventListener('input', rows);
  rows();
  showDetail();
  return h('div', {},
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', onClick: async () => handleInstallResults(await run(() => api.call('mods:installDialog', g.id))) }, '+ Install from file'),
      filter,
      h('button', { class: 'btn ghost', title: 'Enable every mod in this profile', onClick: () => setAll(true) }, 'Enable all'),
      h('button', { class: 'btn ghost', title: 'Disable every mod in this profile', onClick: () => setAll(false) }, 'Disable all'),
      h('div', { class: 'grow' }),
      g.kind === 'minecraft'
        ? h('button', { class: 'btn', onClick: async () => { const r = await run(() => api.call('mrpack:export', g.id)); if (r) toast(`Exported ${r.fileCount} Modrinth files to ${r.outFile}`, 'success', 8000); } }, 'Export .mrpack')
        : h('button', { class: 'btn', onClick: async () => { const r = await run(() => api.call('collection:export', g.id)); if (r) toast(`Saved ${r}`, 'success'); } }, 'Export mod list'),
      h('button', { class: 'btn', title: 'Remove all deployed mod files from the game folder and restore originals', onClick: async () => {
        if (!await askConfirm(`Purge ${g.short}? All deployed mod files are removed from the game folder and original files are restored. Your installed mods stay in Shuriken; click Deploy to put them back.`)) return;
        await run(() => api.call('purge', g.id), 'All mods removed from the game folder');
        await refreshGame();
        renderPage();
      } }, 'Purge'),
    ),
    g.deployMode === 'virtual' ? overwritePanel(g) : null,
    h('div', { class: 'split' },
      h('div', { class: 'grow' },
        h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'On'), h('th', {}, 'Mod'), h('th', {}, 'Version'), h('th', {}, 'Source'), h('th', {}, 'Conflicts'), h('th', {}, 'Priority'))),
          tbody)),
      detail),
    h('p', { class: 'faint small' }, 'Drag rows to change priority. Mods lower in the list win file conflicts (▲ overwrites others, ▼ is overwritten).'),
  );
}

// Overwrite: files the game/tools created while running in virtual mode (like MO2's Overwrite).
function overwritePanel(g) {
  const box = h('div', { class: 'issue info', style: { marginBottom: '14px' } }, h('span', { class: 'sev' }), h('div', { class: 'txt' }, 'Overwrite: checking…'));
  api.call('overwrite:list', g.id).then((files) => {
    box.replaceChildren(h('span', { class: 'sev', style: { background: files.length ? 'var(--warn)' : 'var(--ok)' } }),
      h('div', { class: 'txt' }, h('div', { class: 'name' }, `Overwrite · ${files.length} file${files.length === 1 ? '' : 's'}`),
        h('div', { class: 'faint small' }, files.length ? files.slice(0, 4).join(', ') + (files.length > 4 ? ' …' : '') : 'New files from the game and tools (configs, generated plugins, logs) land here, never in the game folder.')),
      h('button', { class: 'btn small', onClick: () => api.call('overwrite:open', g.id) }, 'Open'),
      files.length ? h('button', { class: 'btn small primary', onClick: async () => { const name = await askText('Create a mod from Overwrite', 'e.g. My generated patches'); if (name) { await run(() => api.call('overwrite:toMod', g.id, name), 'Mod created from Overwrite'); await refreshGame(); renderPage(); } } }, 'Create mod') : null,
      files.length ? h('button', { class: 'btn small ghost danger', onClick: async () => { if (await askConfirm(`Delete all ${files.length} files in Overwrite?`)) { await run(() => api.call('overwrite:clear', g.id), 'Overwrite cleared'); renderPage(); } } }, 'Clear') : null);
  }).catch(() => {});
  return box;
}

function dragRow(tr, onDrop) {
  tr.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/row', tr.dataset.id); tr.classList.add('dragging'); });
  tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
  tr.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/row')) return;
    e.preventDefault();
    const after = e.offsetY > tr.offsetHeight / 2;
    tr.classList.toggle('drop-after', after);
    tr.classList.toggle('drop-before', !after);
  });
  tr.addEventListener('dragleave', () => tr.classList.remove('drop-after', 'drop-before'));
  tr.addEventListener('drop', (e) => {
    const from = e.dataTransfer.getData('text/row');
    if (!from) return;
    e.preventDefault();
    e.stopPropagation();
    const after = tr.classList.contains('drop-after');
    tr.classList.remove('drop-after', 'drop-before');
    if (from !== tr.dataset.id) onDrop(from, tr.dataset.id, after);
  });
}

// ---------- Load order ----------
async function pagePlugins() {
  const g = game();
  if (!g.installDir) return needFolder(g);
  const data = await api.call('plugins:get', g.id);
  let list = data.plugins.map((p) => ({ ...p }));
  const tbody = h('tbody');
  const saveBtn = h('button', { class: 'btn primary', disabled: true, onClick: save }, 'Save load order');
  const issueBox = h('div');
  let dirty = false;
  const markDirty = () => { dirty = true; saveBtn.disabled = false; };

  async function save() {
    await run(() => api.call('plugins:save', g.id, list.map((p) => ({ name: p.name, enabled: p.enabled }))), 'Load order saved');
    dirty = false;
    renderPage();
  }

  function badges(p) {
    return [p.isMaster ? h('span', { class: 'badge esm' }, 'ESM') : null, p.isLight ? h('span', { class: 'badge esl' }, 'ESL') : null, p.isMedium ? h('span', { class: 'badge' }, 'MED') : null];
  }

  let index = 0;
  let lightIndex = 0;
  function rows() {
    index = 0;
    lightIndex = 0;
    const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
    const idxLabel = (p) => {
      if (!p.enabled && !p.implicit) return '--';
      return p.isLight ? `FE ${hex(lightIndex++, 3)}` : hex(index++, 2);
    };
    tbody.replaceChildren(
      ...data.implicit.map((p) => h('tr', {}, h('td', {}), h('td', { class: 'faint' }, '🔒'), h('td', { class: 'mono faint' }, idxLabel(p)), h('td', { class: 'name' }, p.name), h('td', {}, badges(p)), h('td', { class: 'faint small' }, 'Base game'), h('td'))),
      ...list.map((p) => {
        const tr = h('tr', { class: p.enabled ? '' : 'disabled', draggable: 'true', 'data-id': p.name },
          h('td', { class: 'handle' }, '⋮⋮'),
          h('td', {}, toggle(p.enabled, (v) => { p.enabled = v; markDirty(); rows(); })),
          h('td', { class: 'mono faint' }, idxLabel(p)),
          h('td', { class: 'name', title: p.description || '' }, p.name, p.isNew ? h('span', { class: 'badge warn' }, 'new') : null),
          h('td', {}, badges(p)),
          h('td', { class: 'faint small', title: (p.masters || []).join('\n') }, p.masters?.length ? `${p.masters.length} master${p.masters.length > 1 ? 's' : ''}` : ''),
          h('td', {}, h('button', { class: 'btn small ghost', title: 'Quick Auto Clean with xEdit', onClick: async () => {
            if (!await askConfirm(`Run xEdit Quick Auto Clean on ${p.name}? xEdit will open and close by itself.`)) return;
            const r = await run(() => api.call('tools:xeditClean', g.id, p.name));
            showModal(`xEdit log – ${p.name}`, h('div', { class: 'log-view' }, r.log));
          } }, 'Clean')),
        );
        dragRow(tr, (from, to, after) => {
          const item = list.find((x) => x.name === from);
          list = list.filter((x) => x.name !== from);
          list.splice(list.findIndex((x) => x.name === to) + (after ? 1 : 0), 0, item);
          markDirty();
          rows();
        });
        return tr;
      }),
    );
  }
  rows();
  issueBox.replaceChildren(
    ...data.issues.map((i) => h('div', { class: `issue ${i.severity}` }, h('span', { class: 'sev' }), h('div', { class: 'txt' }, i.message))),
    ...(data.issues.length ? [h('button', { class: 'btn small', style: { marginBottom: '12px' }, onClick: () => askAi('Look at my load order problems and fix them.') }, '✦ Fix load order with AI')] : []),
  );
  return h('div', {},
    h('div', { class: 'toolbar' },
      saveBtn,
      h('button', { class: 'btn', onClick: async () => { await run(() => api.call('plugins:autosort', g.id), 'Masters sorted'); renderPage(); } }, 'Fix master order'),
      h('button', { class: 'btn', onClick: async () => { await run(() => api.call('plugins:loot', g.id), 'LOOT finished sorting'); renderPage(); } }, 'Sort with LOOT'),
      h('div', { class: 'grow' }),
      h('span', { class: 'muted small' }, `${data.counts.full ?? 0} full · ${data.counts.light ?? 0} light · ${data.counts.total ?? 0} active`),
    ),
    issueBox,
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'On'), h('th', {}, 'Index'), h('th', {}, 'Plugin'), h('th', {}, 'Flags'), h('th', {}, 'Masters'), h('th', {}))),
      tbody),
    h('p', { class: 'faint small' }, 'This list shows plugins currently in the Data folder. Deploy first so new mods appear here.'),
  );
}

// ---------- Browse ----------
async function pageBrowse() {
  const g = game();
  if (g.kind === 'minecraft') return browseModrinth(g);
  if (g.thunderstore) {
    const wrap = h('div');
    const tabs = h('div', { class: 'tabs' });
    const body = h('div');
    const show = (which) => {
      state.browseTab = which;
      tabs.replaceChildren(...[['thunderstore', 'Thunderstore'], ['nexus', 'Nexus Mods']].map(([k, l]) => h('div', { class: `tab ${k === which ? 'active' : ''}`, onClick: () => show(k) }, l)));
      body.replaceChildren(which === 'nexus' ? browseNexus(g) : browseThunderstore(g));
    };
    show(state.browseTab === 'nexus' ? 'nexus' : 'thunderstore');
    wrap.append(tabs, body);
    return wrap;
  }
  return browseNexus(g);
}

function browseThunderstore(g) {
  const q = h('input', { class: 'input grow', placeholder: `Search Thunderstore for ${g.short} mods…` });
  const results = h('div', { class: 'results' });
  const search = async () => {
    results.replaceChildren(h('div', { class: 'muted' }, 'Searching… (the first search downloads the catalog, about 20 MB)'));
    try {
      const hits = await api.call('thunderstore:search', g.id, q.value);
      results.replaceChildren(...hits.map((p) => resultCard({
        icon: p.icon, title: p.name.replace(/_/g, ' '), desc: p.description,
        meta: `${fmtNum(p.downloads)} downloads · ${p.owner}${p.deps.length ? ` · ${p.deps.length} deps` : ''}`,
        url: p.url,
        action: async (btn) => {
          btn.disabled = true;
          btn.textContent = 'Installing…';
          try {
            await handleInstallResults(await api.call('thunderstore:install', g.id, p.full));
            btn.textContent = 'Installed';
          } catch (e) {
            toast(e.message, 'error', 8000);
            btn.disabled = false;
            btn.textContent = 'Install';
          }
        },
      })));
      if (!hits.length) results.replaceChildren(h('div', { class: 'muted' }, 'No results.'));
    } catch (e) {
      results.replaceChildren(h('div', { class: 'muted' }, e.message));
    }
  };
  q.addEventListener('keydown', (e) => e.key === 'Enter' && search());
  search();
  return h('div', {},
    h('div', { class: 'toolbar' }, q, h('button', { class: 'btn primary', onClick: search }, 'Search')),
    h('p', { class: 'muted small' }, 'Dependencies (including BepInExPack) install automatically, in the same layout r2modman uses. Deploy afterwards.'),
    results);
}

function browseModrinth(g) {
  const q = h('input', { class: 'input grow', placeholder: 'Search Modrinth (e.g. sodium, create, shaders)…' });
  const type = h('select', { class: 'input' }, ...[['mod', 'Mods'], ['modpack', 'Modpacks'], ['resourcepack', 'Resource packs'], ['shader', 'Shaders'], ['datapack', 'Data packs']].map(([v, l]) => h('option', { value: v }, l)));
  const sort = h('select', { class: 'input' }, ...[['relevance', 'Relevance'], ['downloads', 'Downloads'], ['follows', 'Follows'], ['updated', 'Updated'], ['newest', 'Newest']].map(([v, l]) => h('option', { value: v }, l)));
  const results = h('div', { class: 'results' });
  const search = async () => {
    results.replaceChildren(h('div', { class: 'muted' }, 'Searching…'));
    try {
      const r = await api.call('modrinth:search', { query: q.value, projectType: type.value, mcVersion: type.value === 'modpack' ? g.mcVersion : g.mcVersion, loader: g.loader, index: sort.value, limit: 30 });
      results.replaceChildren(...r.hits.map((hit) => resultCard({
        icon: hit.icon_url, title: hit.title, desc: hit.description, meta: `${fmtNum(hit.downloads)} downloads · ${hit.author}`,
        url: `https://modrinth.com/${hit.project_type}/${hit.slug}`,
        action: hit.project_type === 'modpack' ? null : async (btn) => {
          btn.disabled = true; btn.textContent = 'Installing…';
          try { await handleInstallResults(await api.call('modrinth:install', g.id, hit.project_id)); btn.textContent = 'Installed'; }
          catch (e) { toast(e.message, 'error', 8000); btn.disabled = false; btn.textContent = 'Install'; }
        },
      })));
      if (!r.hits.length) results.replaceChildren(h('div', { class: 'muted' }, 'No results for this version/loader.'));
    } catch (e) {
      results.replaceChildren(h('div', { class: 'muted' }, e.message));
    }
  };
  q.addEventListener('keydown', (e) => e.key === 'Enter' && search());
  [type, sort].forEach((s) => s.addEventListener('change', search));
  search();
  return h('div', {},
    h('div', { class: 'toolbar' }, q, type, sort, h('button', { class: 'btn primary', onClick: search }, 'Search')),
    !g.mcVersion ? h('div', { class: 'issue warning' }, h('span', { class: 'sev' }), h('div', { class: 'txt' }, 'Set your Minecraft version and loader on the Dashboard so results match.')) : h('p', { class: 'muted small' }, `Showing results for ${g.mcVersion} · ${g.loader}. Required dependencies are installed automatically. Modpacks: download the .mrpack and drop it on this window.`),
    results,
  );
}

function resultCard({ icon: iconUrl, title, desc, meta, url, action, actionLabel = 'Install' }) {
  const btn = action ? h('button', { class: 'btn small primary' }, actionLabel) : null;
  if (btn) btn.addEventListener('click', () => action(btn));
  return h('div', { class: 'result' },
    iconUrl ? h('img', { src: iconUrl, loading: 'lazy' }) : h('div', { class: 'ph' }),
    h('div', { class: 'grow' },
      h('div', { class: 'title' }, title),
      h('div', { class: 'desc' }, desc || ''),
      h('div', { class: 'meta' }, h('span', { class: 'faint small grow' }, meta || ''), url ? h('button', { class: 'btn small ghost', onClick: () => api.call('shell:open', url) }, 'Page') : null, btn),
    ),
  );
}

function browseNexus(g) {
  const wrap = h('div');
  if (!g.nexusDomain) {
    return h('div', { class: 'card empty' }, h('div', { class: 'big' }, `${g.short} mods aren't on Nexus Mods`),
      h('p', { class: 'muted' }, g.id === 'factorio' ? 'Download mods from mods.factorio.com and drop the .zip files onto this window.' : 'Download mods from the game\'s mod site and drop the archives onto this window.'));
  }
  if (!state.keys.nexus) {
    wrap.append(h('div', { class: 'card empty' },
      h('div', { class: 'big' }, 'Connect Nexus Mods'),
      h('p', { class: 'muted' }, 'Add your personal Nexus API key in Settings to browse mods here. Get it from nexusmods.com → Site preferences → API Keys.'),
      h('button', { class: 'btn primary', onClick: () => go('settings') }, 'Open Settings')));
  }
  const results = h('div', { class: 'results' });
  const lookup = h('input', { class: 'input grow', placeholder: 'Paste a Nexus mod URL or mod ID…' });
  let kind = 'trending';
  const tabs = h('div', { class: 'tabs' });
  const drawTabs = () => tabs.replaceChildren(...[['trending', 'Trending'], ['latest_added', 'Latest added'], ['latest_updated', 'Recently updated']].map(([k, l]) => h('div', { class: `tab ${k === kind ? 'active' : ''}`, onClick: () => { kind = k; drawTabs(); load(); } }, l)));

  const card = (m) => resultCard({
    icon: m.picture_url, title: m.name, desc: m.summary?.replace(/<br\s*\/?>/g, ' '), meta: `v${m.version || '?'} · ${m.author || ''}`,
    url: `https://www.nexusmods.com/${g.nexusDomain}/mods/${m.mod_id}`, actionLabel: 'Files',
    action: () => nexusFiles(g, m),
  });
  async function load() {
    if (!state.keys.nexus) return;
    results.replaceChildren(h('div', { class: 'muted' }, 'Loading…'));
    try {
      const list = await api.call('nexus:list', g.id, kind);
      results.replaceChildren(...list.filter((m) => m.available !== false && m.name).map(card));
    } catch (e) {
      results.replaceChildren(h('div', { class: 'muted' }, e.message));
    }
  }
  async function doLookup() {
    try {
      const m = await api.call('nexus:mod', g.id, lookup.value.trim());
      results.replaceChildren(card(m));
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  lookup.addEventListener('keydown', (e) => e.key === 'Enter' && doLookup());
  drawTabs();
  load();
  wrap.append(
    h('div', { class: 'toolbar' }, lookup, h('button', { class: 'btn', onClick: doLookup }, 'Look up'), h('button', { class: 'btn', onClick: () => api.call('shell:open', `https://www.nexusmods.com/${g.nexusDomain}/mods/`) }, 'Open Nexus')),
    h('p', { class: 'muted small' }, state.settings.handleNxm ? 'Nexus "Mod Manager Download" buttons will install straight into Shuriken.' : 'Tip: turn on "Handle Nexus downloads" in Settings so the "Mod Manager Download" button on Nexus installs into Shuriken.'),
    tabs, results);
  return wrap;
}

async function nexusFiles(g, m) {
  const res = await run(() => api.call('nexus:files', g.id, m.mod_id));
  const files = res.files.filter((f) => f.category_name !== 'ARCHIVED' && f.category_name !== 'OLD_VERSION').reverse();
  showModal(`${m.name} – files`, h('div', {},
    files.map((f) => h('div', { class: 'issue info' },
      h('div', { class: 'txt' }, h('div', { class: 'name' }, f.name), h('div', { class: 'faint small' }, `${f.category_name} · v${f.version} · ${fmtBytes((f.size_kb || 0) * 1024)}`)),
      h('button', { class: 'btn small primary', onClick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Downloading…';
        try { await handleInstallResults([await api.call('nexus:download', g.id, m.mod_id, f.file_id)]); closeModal(); }
        catch (err) {
          toast(err.message, 'error', 10000);
          api.call('shell:open', `https://www.nexusmods.com/${g.nexusDomain}/mods/${m.mod_id}?tab=files&file_id=${f.file_id}`);
          e.target.disabled = false; e.target.textContent = 'Download';
        }
      } }, 'Download'))),
  ));
}

// ---------- Downloads ----------
async function pageDownloads() {
  const g = game();
  const files = await api.call('downloads:list');
  const active = [...state.downloads.values()].filter((d) => d.status === 'downloading');
  return h('div', {},
    active.length ? h('div', { class: 'card', style: { marginBottom: '16px' } }, h('h3', {}, 'Active'),
      active.map((d) => h('div', { style: { marginBottom: '10px' }, 'data-dl': String(d.id) }, h('div', { class: 'row' }, h('span', { class: 'grow' }, d.name), h('span', { class: 'faint small dl-size' }, d.total ? `${fmtBytes(d.received)} / ${fmtBytes(d.total)}` : fmtBytes(d.received))),
        h('div', { class: 'progress' }, h('div', { style: { width: d.total ? `${(100 * d.received) / d.total}%` : '30%' } }))))) : null,
    h('div', { class: 'toolbar' }, h('button', { class: 'btn', onClick: () => api.call('game:openFolder', g.id, 'downloads') }, 'Open downloads folder')),
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Size'), h('th', {}, 'Date'), h('th', {}))),
      h('tbody', {}, files.length ? files.map((f) => h('tr', {},
        h('td', { class: 'name' }, f.name), h('td', { class: 'muted' }, fmtBytes(f.size)), h('td', { class: 'muted' }, fmtDate(f.date)),
        h('td', {}, h('div', { class: 'row' },
          h('button', { class: 'btn small primary', onClick: async () => handleInstallResults(await run(() => api.call('mods:installPaths', g.id, [f.path]))) }, `Install to ${g.short}`),
          h('button', { class: 'btn small ghost danger', onClick: async () => { if (!await askConfirm(`Delete the downloaded file ${f.name}?`)) return; await api.call('downloads:remove', f.path); renderPage(); } }, 'Delete'))))) : h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'No downloads yet.'))),
    ),
  );
}

// ---------- AI Assistant ----------
function chatFor(gameId) {
  if (!state.chats[gameId]) state.chats[gameId] = { id: `${gameId}-${Date.now()}`, items: [], busy: false, attachments: [], draft: '' };
  return state.chats[gameId];
}

function askAi(text) {
  const chat = chatFor(state.gameId);
  chat.draft = text;
  go('ai');
  setTimeout(() => sendChat(), 50);
}

let chatDom = null;

function pageAi() {
  const g = game();
  const chat = chatFor(g.id);
  const log = h('div', { class: 'chat-log' });
  const textarea = h('textarea', { rows: 1, placeholder: `Describe the problem, paste a screenshot (Ctrl+V), or ask for a modpack… (Ctrl+Shift+F12 captures the screen in-game)` });
  textarea.value = chat.draft || '';
  const attachments = h('div', { class: 'attachments' });
  const sendBtn = h('button', { class: 'btn primary', onClick: () => sendChat() }, 'Send');
  const stopBtn = h('button', { class: 'btn danger', style: { display: chat.busy ? '' : 'none' }, onClick: () => stopChat(chat) }, '■ Stop');
  if (chat.busy) { sendBtn.textContent = 'Tell AI'; sendBtn.title = 'The assistant reads this after its current step'; }
  const setupBanner = h('div');
  const upgradeBox = h('div');
  aiUpgradeBanner(upgradeBox);
  if (aiProvider() === 'local') {
    api.call('engine:status').then((st) => {
      if (st.ready && !st.running) api.call('engine:warm').catch(() => {});
      if (!st.ready) {
        // Portable build (no AI inside): one click fetches the engine and the model that fits this PC.
        const rec = st.models.find((m) => m.id === st.recommendedModel) || st.models[0];
        const draw = () => {
          const dl = state.aiDl;
          setupBanner.replaceChildren(h('div', { class: 'issue warning', style: { margin: '12px 24px 0' } }, h('span', { class: 'sev' }),
            h('div', { class: 'txt' },
              h('div', {}, dl ? `Downloading the AI… ${dl.label}: ${fmtBytes(dl.done)}${dl.total ? ` / ${fmtBytes(dl.total)}` : ''}` : `Shuriken AI needs a one-time free download: the engine plus ${rec.label.split(' ·')[0]} (${rec.sizeGB} GB, picked for your PC).`),
              dl?.total ? h('div', { class: 'progress', style: { marginTop: '6px' } }, h('div', { style: { width: `${Math.round((100 * dl.done) / dl.total)}%` } })) : null),
            dl ? h('button', { class: 'btn small ghost', onClick: () => api.call('engine:cancelDownload') }, 'Cancel') : [
              h('button', { class: 'btn small primary', onClick: () => startModelDownload(rec, draw) }, 'Download now'),
              h('button', { class: 'btn small', onClick: () => go('settings') }, 'Choose another / install by hand')]));
        };
        draw();
        watchAiDownload(setupBanner, (ev) => { if (ev.finished) setupBanner.replaceChildren(); else draw(); });
      }
    }).catch(() => {});
  }
  const autoFix = toggle(state.settings.aiAutoApprove, async (v) => {
    state.settings = await api.call('settings:set', { aiAutoApprove: v });
    toast(v ? 'Auto-fix on: the AI will apply changes without asking (backups are still made).' : 'Auto-fix off: you approve every change.', 'info');
  }, 'Let the AI apply fixes without asking');

  textarea.addEventListener('input', () => {
    chat.draft = textarea.value;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(200, textarea.scrollHeight)}px`;
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  textarea.addEventListener('paste', async (e) => {
    for (const item of e.clipboardData.items) {
      if (!item.type.startsWith('image/')) continue;
      e.preventDefault();
      const blob = item.getAsFile();
      const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      chat.attachments.push({ ...(await api.call('screenshot:fromDataUrl', dataUrl)), name: 'pasted image' });
      drawAttachments();
    }
  });

  function drawAttachments() {
    attachments.replaceChildren(...chat.attachments.map((a, i) => h('div', { class: 'att' },
      h('img', { src: `data:${a.mediaType};base64,${a.data}`, title: a.name }),
      h('button', { onClick: () => { chat.attachments.splice(i, 1); drawAttachments(); } }, '×'))));
  }

  const playtestSlot = h('span');
  api.call('playtest:status', g.id).then((st) => {
    if (st?.running) playtestSlot.replaceChildren(h('span', { class: 'chip ok', style: { marginRight: '6px' } }, '● Game running'), h('button', { class: 'btn small ghost', onClick: async () => { await run(() => api.call('playtest:stop', g.id), 'Game closed'); playtestSlot.replaceChildren(); } }, 'Close game'));
  }).catch(() => {});
  chatDom = { log, textarea, sendBtn, stopBtn, drawAttachments, chat };
  drawAttachments();
  drawChat();

  return h('div', { class: 'chat' },
    h('div', { class: 'chat-head' },
      logo('avatar'),
      h('div', {}, h('div', { class: 'name' }, `Shuriken AI · ${g.short}`), h('div', { class: 'faint small' }, `${aiLabel()} · reads your mods, load order, logs and screenshots`)),
      h('div', { class: 'grow' }),
      playtestSlot,
      h('button', { class: 'btn small', title: 'Let the AI launch the game, go to a place and look for a problem', onClick: () => startPlaytest(g) }, '🎮 Playtest'),
      h('span', { class: 'small muted' }, 'Auto-fix'), autoFix,
      h('button', { class: 'btn small', onClick: async () => { await api.call('ai:reset', chat.id); state.chats[g.id] = null; renderPage(); } }, chat.busy ? 'Stop & new chat' : 'New chat'),
    ),
    setupBanner,
    upgradeBox,
    log,
    h('div', { class: 'composer' },
      attachments,
      h('div', { class: 'box' },
        h('button', { class: 'btn icon ghost', title: 'Attach screenshots', onClick: async () => { chat.attachments.push(...(await run(() => api.call('screenshot:pick')))); drawAttachments(); } }, '📎'),
        h('button', { class: 'btn icon ghost', title: 'Capture the screen (hides Shuriken for a moment)', onClick: async () => { chat.attachments.push(await run(() => api.call('screenshot:capture', true))); drawAttachments(); } }, '📸'),
        textarea,
        sendBtn,
        stopBtn,
      ),
      aiNeedsKey() ? h('div', { class: 'small', style: { color: 'var(--warn)', marginTop: '8px' } }, 'Add the API key for the selected AI in Settings → AI assistant, or switch to the free built-in Shuriken AI.') : null,
    ),
  );
}

const SUGGESTIONS = {
  bethesda: [
    ['Analyze my latest crash', 'Find my newest crash log, work out which mod caused it, and fix it.'],
    ['Check my load order', 'Check my load order and mod list for missing masters, wrong order, conflicts and missing requirements, then fix what you can.'],
    ['Game won\'t start', 'My game doesn\'t start or closes right away when I click Play. Find out why and fix it.'],
    ['Build a modpack', 'Help me build a stable modpack. Ask me what kind of experience I want first.'],
    ['Make a mod for me', 'I want to make my own mod. Ask me what it should do, then build it in the Workshop with xEdit scripts, Papyrus or config files and deploy it.'],
    ['Purple / missing textures', 'Something in my game has purple or missing textures. Find which mesh and mod are responsible and fix it.'],
  ],
  generic: [
    ['Analyze my latest crash', 'My game crashed. Read the newest logs, find the mod responsible, and fix it.'],
    ['Check my mod setup', 'Check my installed mods for missing requirements (loaders/frameworks), wrong install locations and conflicts, then fix what you can.'],
    ['Build a modpack', 'Help me build a stable modpack for this game. Ask me what kind of experience I want first.'],
    ['Make a mod for me', 'I want to make my own mod for this game. Ask me what it should do, then build it in the Workshop and install it.'],
  ],
  minecraft: [
    ['Analyze my latest crash', 'Minecraft crashed. Read the newest crash report and logs, find the mod responsible, and fix it.'],
    ['Check my mods', 'Scan my mods for missing dependencies, duplicates and wrong-loader mods, then fix them.'],
    ['Build a modpack', 'Build me a performance-friendly modpack for my Minecraft version and loader. Ask me what I like first.'],
    ['Mods from a screenshot', 'I attached a screenshot of a mod list. Find each mod on Modrinth for my version and install them.'],
    ['Make a mod for me', 'I want my own Minecraft mod. Ask me what it should do, then build it in the Workshop (datapack, KubeJS or a real Fabric mod) and install it.'],
    ['Generate a custom world', 'Create a custom world with WorldPainter. Ask me what terrain I want (islands, mountains, continent...), then generate and export it to my saves.'],
  ],
};

function drawChat() {
  if (!chatDom || state.page !== 'ai') return;
  const { log, chat } = chatDom;
  if (!chat.items.length) {
    log.replaceChildren(h('div', { class: 'chat-empty' },
      logo('mark'),
      h('div', { class: 'big', style: { fontSize: '18px', fontWeight: 800, marginBottom: '6px' } }, `What should we fix or build in ${game().short}?`),
      h('div', { class: 'muted' }, 'I read your crash logs, load order, configs and screenshots, drive your modding tools, and build mods in the Workshop. You approve every change.')),
      h('div', { class: 'suggestions' }, SUGGESTIONS[game().kind].map(([t, p]) => h('div', { class: 'suggestion', onClick: () => { chat.draft = p; chatDom.textarea.value = p; if (!t.includes('screenshot')) sendChat(); else chatDom.textarea.focus(); } }, h('b', {}, t), h('span', { class: 'muted small' }, p)))));
    return;
  }
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  log.replaceChildren(...chat.items.map(renderItem));
  if (nearBottom || chat.forceScroll) log.scrollTop = log.scrollHeight;
  chat.forceScroll = false;
}

function renderItem(item) {
  if (item.role === 'user') {
    return h('div', { class: 'msg user' },
      item.images?.length ? h('div', { class: 'imgs' }, item.images.map((im) => h('img', { src: im, onClick: () => lightbox(im) }))) : null,
      item.text);
  }
  const parts = [];
  if (item.thinking) {
    parts.push(h('span', { class: 'thinking-toggle', onClick: () => { item.showThinking = !item.showThinking; drawChat(); } }, item.showThinking ? '▾ Reasoning' : '▸ Reasoning'));
    if (item.showThinking) parts.push(h('div', { class: 'thinking' }, item.thinking));
  }
  for (const block of item.blocks) {
    if (block.type === 'text') parts.push(h('div', { class: 'body', html: window.renderMarkdown(block.text) }));
    else if (block.type === 'tool') parts.push(h('span', { class: `tool-chip ${block.status}` }, h('span', { class: 'st' }), block.label));
    else if (block.type === 'approval') {
      const r = block.request;
      parts.push(h('div', { class: 'approval' },
        h('div', { class: 'what' }, `The assistant wants to: ${r.label}`),
        r.tool === 'write_text_file' ? h('pre', {}, r.input.content.slice(0, 3000)) : null,
        r.input.script ? h('details', {}, h('summary', { class: 'small muted', style: { cursor: 'pointer' } }, 'Show script'), h('pre', {}, r.input.script.slice(0, 20000))) : null,
        block.decided
          ? h('div', { class: 'small muted' }, block.decided === 'yes' ? '✓ Approved' : '✗ Declined')
          : h('div', { class: 'row' },
              h('button', { class: 'btn small primary', onClick: () => decide(block, true) }, 'Approve'),
              h('button', { class: 'btn small', onClick: () => decide(block, false) }, 'Decline')),
      ));
    } else if (block.type === 'error') parts.push(h('div', { class: 'issue error' }, h('span', { class: 'sev' }), h('div', { class: 'txt' }, block.text)));
    else if (block.type === 'shot') parts.push(h('img', { class: 'game-shot', src: block.dataUrl, title: 'What the AI sees in the game', onClick: () => lightbox(block.dataUrl) }));
    else if (block.type === 'toolreq') parts.push(toolRequestCard(block));
    else if (block.type === 'plan') parts.push(h('div', { class: 'ai-plan' }, h('div', { class: 'faint small', style: { fontWeight: 700, marginBottom: '4px' } }, 'PLAN'),
      block.steps.map((st) => h('div', { class: `step ${st.status}` }, h('span', { class: 'mark' }, { done: '✓', doing: '▸', skipped: '–' }[st.status] || '○'), st.text))));
  }
  if (item.stopped) parts.push(h('div', { class: 'faint small' }, '■ Stopped'));
  if (item.pending) parts.push(h('span', { class: 'cursor muted small' }, item.status || (item.blocks.length ? '' : 'Working')));
  const text = item.blocks.filter((b) => b.type === 'text').map((b) => b.text).join(String.fromCharCode(10, 10));
  if (!item.pending && text) {
    parts.push(h('div', { class: 'msg-actions' }, h('button', { class: 'btn small ghost', onClick: (e) => { navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } }, 'Copy')));
  }
  return h('div', { class: 'msg assistant' }, parts);
}

async function decide(block, ok) {
  block.decided = ok ? 'yes' : 'no';
  await api.call('ai:approve', block.request.id, ok);
  drawChat();
}

async function sendChat() {
  const chat = chatFor(state.gameId);
  const text = (chat.draft || '').trim();
  if (!text && !chat.attachments.length) return;
  if (chat.busy) {
    // The assistant is still working (e.g. playing the game): pass the message to it right away.
    const images = chat.attachments.map((a) => ({ mediaType: a.mediaType, data: a.data }));
    if (!await api.call('ai:steer', chat.id, text, images).catch(() => false)) return;
    const old = chat.reply;
    chat.items.push({ role: 'user', text, images: chat.attachments.map((a) => `data:${a.mediaType};base64,${a.data}`) });
    const next = { role: 'assistant', blocks: [], thinking: '', pending: true, status: 'Will read this after the current step…' };
    chat.items.push(next);
    if (old) { old.pending = false; old.status = ''; }
    chat.reply = next;
    chat.attachments = [];
    chat.draft = '';
    chat.forceScroll = true;
    if (chatDom?.chat === chat) { chatDom.textarea.value = ''; chatDom.drawAttachments(); }
    drawChat();
    return;
  }
  if (aiNeedsKey()) {
    toast('Add the API key for the selected AI in Settings → AI assistant, or switch to the free built-in Shuriken AI.', 'error');
    return;
  }
  const images = chat.attachments.map((a) => ({ mediaType: a.mediaType, data: a.data }));
  chat.items.push({ role: 'user', text, images: chat.attachments.map((a) => `data:${a.mediaType};base64,${a.data}`) });
  const reply = { role: 'assistant', blocks: [], thinking: '', pending: true };
  chat.items.push(reply);
  chat.attachments = [];
  chat.draft = '';
  chat.busy = true;
  chat.reply = reply;
  chat.forceScroll = true;
  if (chatDom?.chat === chat) {
    chatDom.textarea.value = '';
    chatDom.drawAttachments();
    setBusyUi(true);
  }
  drawChat();
  try {
    await api.call('ai:send', { chatId: chat.id, gameId: state.gameId, text, images });
  } catch (e) {
    chat.reply.blocks.push({ type: 'error', text: e.message });
  }
  chat.reply.pending = false;
  chat.reply.status = '';
  chat.busy = false;
  if (chatDom?.chat === chat) setBusyUi(false);
  drawChat();
}

function setBusyUi(busy) {
  chatDom.sendBtn.textContent = busy ? 'Tell AI' : 'Send';
  chatDom.sendBtn.title = busy ? 'The assistant reads this after its current step' : '';
  chatDom.stopBtn.style.display = busy ? '' : 'none';
}

async function stopChat(chat) {
  chatDom?.stopBtn && (chatDom.stopBtn.disabled = true);
  await api.call('ai:stop', chat.id).catch(() => {});
  if (chat.reply) chat.reply.stopped = true;
  if (chatDom?.stopBtn) chatDom.stopBtn.disabled = false;
}

let drawQueued = false;
function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawChat(); });
}

api.onAiEvent((ev) => {
  const chat = Object.values(state.chats).find((c) => c && c.id === ev.chatId);
  if (!chat || !chat.reply) return;
  const reply = chat.reply;
  const last = reply.blocks[reply.blocks.length - 1];
  if (ev.type === 'text') {
    if (last?.type === 'text') last.text += ev.delta;
    else reply.blocks.push({ type: 'text', text: ev.delta });
  } else if (ev.type === 'thinking') {
    reply.thinking += ev.delta;
  } else if (ev.type === 'tool') {
    const existing = ev.id && reply.blocks.find((b) => b.type === 'tool' && b.id === ev.id);
    if (existing) Object.assign(existing, { status: ev.status, label: ev.label });
    else if (ev.status !== 'awaiting') reply.blocks.push({ type: 'tool', id: ev.id, status: ev.status, label: ev.label });
  } else if (ev.type === 'approval') {
    reply.blocks.push({ type: 'approval', request: ev.request });
    if (state.page !== 'ai' || state.gameId !== chat.id.split('-')[0]) toast('The AI assistant is waiting for your approval.', 'info');
  } else if (ev.type === 'error') {
    reply.blocks.push({ type: 'error', text: ev.message });
  } else if (ev.type === 'shot') {
    // Keep only the last few game screenshots in the chat to save memory.
    reply.blocks.push({ type: 'shot', dataUrl: ev.dataUrl });
    const shots = chat.items.flatMap((it) => it.blocks || []).filter((b) => b.type === 'shot');
    for (const b of shots.slice(0, -8)) { b.type = 'tool'; b.status = 'done'; b.label = 'game screenshot'; delete b.dataUrl; }
  } else if (ev.type === 'plan') {
    // One live checklist per answer: update it in place.
    const existing = reply.blocks.find((b) => b.type === 'plan');
    if (existing) existing.steps = ev.steps;
    else reply.blocks.push({ type: 'plan', steps: ev.steps });
  } else if (ev.type === 'toolreq') {
    reply.blocks.push({ type: 'toolreq', name: ev.name, reason: ev.reason, url: ev.url });
  } else if (ev.type === 'status') {
    reply.status = ev.text;
  } else if (ev.type === 'stopped') {
    reply.stopped = true;
  } else if (ev.type === 'state-changed') {
    refreshGame();
  }
  queueDraw();
});

function lightbox(src) {
  const lb = h('div', { class: 'lightbox', onClick: () => lb.remove() }, h('img', { src }));
  document.body.append(lb);
}

// ---------- Tools ----------
function getToolsCard(g) {
  const box = h('div', { class: 'card', style: { marginBottom: '20px' } }, h('h3', {}, 'Get free tools'), h('div', { class: 'muted small' }, 'Loading…'));
  const showAll = { on: false };
  const draw = (list) => {
    const shown = showAll.on ? list : list.filter((t) => t.suggested);
    box.replaceChildren(
      h('h3', {}, 'Get free tools', h('span', { class: 'right' }, h('button', { class: 'btn small ghost', onClick: () => { showAll.on = !showAll.on; draw(list); } }, showAll.on ? 'Only for this game' : 'Show all'))),
      h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Downloaded from each tool\'s official GitHub release and added for this game. The AI can also do this when it needs a tool.'),
      shown.map((t) => h('div', { class: 'issue info' },
        h('span', { class: 'sev', style: { background: t.installed ? 'var(--ok)' : 'var(--line-2)' } }),
        h('div', { class: 'txt' }, h('div', { class: 'name' }, t.name), h('div', { class: 'muted small' }, t.about)),
        t.installed ? h('span', { class: 'badge win' }, 'added') : h('button', { class: 'btn small primary', onClick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Downloading…';
          const r = await run(() => api.call('toolstore:install', g.id, t.id));
          if (r) { toast(`${r.installed} ${r.version} added`, 'success'); renderPage(); } else { e.target.disabled = false; e.target.textContent = 'Get'; }
        } }, 'Get'))),
      shown.length ? null : h('div', { class: 'muted small' }, 'Nothing specific for this game. Click "Show all".'));
  };
  api.call('toolstore:list', g.id).then(draw).catch((e) => box.replaceChildren(h('h3', {}, 'Get free tools'), h('div', { class: 'muted small' }, e.message)));
  return box;
}

async function pageTools() {
  const g = game();
  if (!g.installDir) return needFolder(g);
  const t = await api.call('tools:list', g.id);
  const archivePath = h('input', { class: 'input grow', placeholder: 'Path to a .bsa or .ba2 file' });
  const archiveFilter = h('input', { class: 'input', placeholder: 'Filter', style: { width: '160px' } });
  const archiveOut = h('div');
  const listArchive = async () => {
    const r = await run(() => api.call('archive:list', archivePath.value.trim()));
    const f = archiveFilter.value.toLowerCase();
    const files = f ? r.files.filter((x) => x.toLowerCase().includes(f)) : r.files;
    archiveOut.replaceChildren(h('div', { class: 'small muted', style: { margin: '8px 0' } }, `${r.format} · ${r.fileCount} files${f ? ` · ${files.length} match` : ''}`), h('div', { class: 'file-list selectable' }, files.slice(0, 5000).join('\n')));
  };
  const toolCard = (tool, registered) => h('div', { class: 'result' },
    h('div', { class: 'ph', style: { display: 'grid', placeItems: 'center', fontWeight: 800, color: 'var(--accent-2)' } }, tool.name.slice(0, 2).toUpperCase()),
    h('div', { class: 'grow' },
      h('div', { class: 'title' }, tool.name),
      h('div', { class: 'desc' }, tool.ai ? `✦ ${tool.ai}` : ''),
      h('div', { class: 'faint small mono', style: { marginTop: '4px', wordBreak: 'break-all' } }, tool.path),
      h('div', { class: 'meta' },
        h('span', { class: 'badge' }, tool.kind),
        h('div', { class: 'grow' }),
        registered
          ? [h('button', { class: 'btn small ghost danger', onClick: async () => { await api.call('tools:remove', g.id, tool.id); renderPage(); } }, 'Remove'),
             h('button', { class: 'btn small primary', onClick: () => run(() => api.call('tools:launch', g.id, tool.id), `${tool.name} launched`) }, 'Launch')]
          : h('button', { class: 'btn small primary', onClick: async () => { await api.call('tools:add', g.id, tool); renderPage(); } }, 'Add'),
      ),
    ),
  );
  const scanOut = h('div');
  const scan = async (btn) => {
    btn.disabled = true;
    btn.textContent = 'Scanning your PC…';
    try {
      const found = await api.call('tools:scan', g.id);
      scanOut.replaceChildren(found.length
        ? h('div', {}, h('h3', {}, `Found ${found.length} more tool${found.length > 1 ? 's' : ''}`),
            h('div', { class: 'row', style: { marginBottom: '10px' } }, h('button', { class: 'btn small primary', onClick: async () => { for (const x of found) await api.call('tools:add', g.id, x); renderPage(); } }, 'Add all')),
            h('div', { class: 'results', style: { marginBottom: '20px' } }, found.map((x) => toolCard(x, false))))
        : h('div', { class: 'card muted', style: { marginBottom: '20px' } }, 'No other known tools found. Install the ones you need (links below), or add any program with "+ Add tool".'));
    } catch (e) {
      toast(e.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Scan PC for tools';
  };
  const installed = new Set([...t.registered, ...t.suggested].map((x) => x.kind));
  const scanBtn = h('button', { class: 'btn' }, 'Scan PC for tools');
  scanBtn.addEventListener('click', () => scan(scanBtn));
  return h('div', {},
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', onClick: async () => { await run(() => api.call('tools:addDialog', g.id)); renderPage(); } }, '+ Add tool'),
      scanBtn,
      h('span', { class: 'muted small grow' }, g.kind === 'bethesda' ? 'Tools see deployed mods because Shuriken links them into the real Data folder. The AI assistant can use every tool added here.' : 'The AI assistant can use every tool added here. Minecraft loaders are installed from the Dashboard.'),
    ),
    t.registered.length ? h('div', { class: 'results', style: { marginBottom: '20px' } }, t.registered.map((x) => toolCard(x, true))) : h('div', { class: 'card empty', style: { marginBottom: '20px' } }, 'No tools added yet. Click "Scan PC for tools".'),
    t.suggested.length ? [h('h3', {}, 'Found in the game folder'), h('div', { class: 'results', style: { marginBottom: '20px' } }, t.suggested.map((x) => toolCard(x, false)))] : null,
    scanOut,
    getToolsCard(g),
    h('div', { class: 'card', style: { marginBottom: '20px' } },
      h('h3', {}, `What the AI can do with ${g.short} tools`),
      t.catalog.map((c) => h('div', { class: 'issue info' },
        h('span', { class: 'sev', style: { background: installed.has(c.kind) ? 'var(--ok)' : 'var(--line-2)' } }),
        h('div', { class: 'txt' }, h('div', { class: 'name' }, c.name, installed.has(c.kind) ? h('span', { class: 'badge win', style: { marginLeft: '8px' } }, 'found') : null), h('div', { class: 'muted small' }, c.ai))))),
    g.kind === 'bethesda' ? h('div', { class: 'card' },
      h('h3', {}, 'Archive browser (BSA / BA2)'),
      h('div', { class: 'row' }, archivePath, h('button', { class: 'btn', onClick: async () => { const p = await api.call('dialog:openFile', [{ name: 'Bethesda archives', extensions: ['bsa', 'ba2'] }]); if (p) { archivePath.value = p; listArchive(); } } }, 'Browse…'), archiveFilter, h('button', { class: 'btn primary', onClick: listArchive }, 'List files')),
      archiveOut) : null,
  );
}

// ---------- Workshop ----------
async function pageWorkshop() {
  const g = game();
  if (!g.installDir) return needFolder(g);
  const [projects, kinds] = await Promise.all([api.call('workshop:list', g.id), api.call('workshop:kinds', g.id)]);
  if (state.workshopSel && !projects.some((p) => p.id === state.workshopSel)) state.workshopSel = null;
  const kindSel = () => h('select', { class: 'input' }, kinds.map((k) => h('option', { value: k.id }, k.label)));

  // "Build with AI" from a description.
  const idea = h('textarea', { class: 'input', rows: 4, style: { width: '100%', resize: 'vertical' }, placeholder: g.kind === 'bethesda'
    ? 'Describe the mod, e.g. "Make laser rifles do 25% more damage and cost half as much", "Add a vendor in Sanctuary who sells ammo", "A spell that slows time for 10 seconds"…'
    : 'Describe the mod, e.g. "A recipe to craft saddles from leather", "Diamond ore drops 2 diamonds", "A Fabric mod that adds a copper hammer that mines 3x3", "A volcanic island world with WorldPainter"…' });
  const ideaKind = kindSel();
  const startIdea = () => {
    if (!idea.value.trim()) return toast('Describe the mod first', 'error');
    askAi(`Build a new mod for me in the Workshop. Create a ${ideaKind.value} project (pick a short name), write all the files, build/compile it, install or deploy it, and tell me how to test it in game.\n\nWhat I want: ${idea.value.trim()}`);
  };

  const list = h('div', {}, projects.length
    ? projects.map((p) => h('div', { class: `issue info ${p.id === state.workshopSel ? 'selected' : ''}`, style: { cursor: 'pointer', borderColor: p.id === state.workshopSel ? 'var(--accent)' : '' }, onClick: () => { state.workshopSel = p.id; state.workshopFile = null; renderPage(); } },
        h('div', { class: 'txt' }, h('div', { class: 'name' }, p.name), h('div', { class: 'faint small' }, `${p.kindLabel} · ${p.fileCount} files`))))
    : h('div', { class: 'muted small' }, 'No projects yet.'));

  const newName = h('input', { class: 'input grow', placeholder: 'Project name' });
  const newKind = kindSel();
  const create = async () => {
    if (!newName.value.trim()) return toast('Name the project first', 'error');
    const p = await run(() => api.call('workshop:create', g.id, newName.value.trim(), newKind.value), 'Project created');
    state.workshopSel = p.id;
    refreshGame();
    renderPage();
  };

  const left = h('div', { style: { width: '320px', flex: 'none' } },
    h('div', { class: 'card', style: { marginBottom: '16px' } }, h('h3', {}, 'Projects'), list),
    h('div', { class: 'card' }, h('h3', {}, 'New empty project'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, newName, newKind, h('button', { class: 'btn', onClick: create }, 'Create'))),
  );

  const sel = projects.find((p) => p.id === state.workshopSel);
  let right;
  if (!sel) {
    right = h('div', { class: 'card' },
      h('h3', {}, '✦ Build a mod with AI'),
      h('p', { class: 'muted small' }, g.kind === 'bethesda'
        ? 'The AI writes plugins (through xEdit scripts), Papyrus scripts, config-framework INIs and packs archives, then deploys the result. Add xEdit, the Creation Kit (Papyrus compiler) and BSArch on the Tools page for the full toolset.'
        : 'The AI writes datapacks, resource packs, KubeJS/config scripts, complete Fabric mods (built with Gradle) and WorldPainter worlds, then installs them.'),
      idea,
      h('div', { class: 'row', style: { marginTop: '10px' } }, ideaKind, h('div', { class: 'grow' }), h('button', { class: 'btn primary', onClick: startIdea }, '✦ Build it')),
    );
  } else {
    const files = await api.call('workshop:files', sel.id).catch(() => []);
    const editor = h('textarea', { class: 'input mono selectable', style: { width: '100%', minHeight: '340px', resize: 'vertical', userSelect: 'text' }, spellcheck: 'false' });
    const fileLabel = h('div', { class: 'name small' }, state.workshopFile || 'Select a file');
    const saveBtn = h('button', { class: 'btn small primary', disabled: !state.workshopFile, onClick: async () => { await run(() => api.call('workshop:write', sel.id, state.workshopFile, editor.value), 'Saved'); } }, 'Save');
    const openFile = async (f) => {
      state.workshopFile = f;
      fileLabel.textContent = f;
      editor.value = await api.call('workshop:read', sel.id, f).catch((e) => e.message);
      saveBtn.disabled = false;
    };
    if (state.workshopFile) openFile(state.workshopFile);
    const ask = h('textarea', { class: 'input', rows: 3, style: { width: '100%', resize: 'vertical' }, placeholder: 'Tell the AI what to add or change in this project…' });
    const worldSel = h('select', { class: 'input' });
    if (sel.kind === 'mc-datapack') api.call('mc:worlds', g.id).then((ws) => worldSel.replaceChildren(...ws.map((w) => h('option', { value: w.folder }, `${w.name || w.folder} (${w.version || '?'})`)))).catch(() => {});
    const live = sel.kind === 'bethesda-mod' || sel.kind === 'mc-config';
    const pkg = async (btn) => {
      btn.disabled = true;
      btn.textContent = 'Working…';
      try {
        const r = await api.call('workshop:package', sel.id, worldSel.value || undefined);
        if (r.built === false) showModal('Build failed', h('div', { class: 'log-view' }, r.output));
        else toast(r.note || 'Done', 'success', 8000);
        refreshGame();
      } catch (e) {
        toast(e.message, 'error', 9000);
      }
      btn.disabled = false;
      btn.textContent = sel.kind === 'fabric-mod' ? 'Build & install' : 'Package & install';
    };
    const pkgBtn = live ? null : h('button', { class: 'btn primary' }, sel.kind === 'fabric-mod' ? 'Build & install' : 'Package & install');
    pkgBtn?.addEventListener('click', () => pkg(pkgBtn));
    right = h('div', {},
      h('div', { class: 'card', style: { marginBottom: '16px' } },
        h('h3', {}, sel.name, h('span', { class: 'badge', style: { marginLeft: '8px' } }, sel.kind),
          h('span', { class: 'right row' },
            sel.kind === 'mc-datapack' ? worldSel : null,
            pkgBtn,
            live ? h('span', { class: 'muted small' }, 'Live mod: click Deploy to apply') : null,
            h('button', { class: 'btn', onClick: () => api.call('workshop:open', sel.id) }, 'Open folder'),
            h('button', { class: 'btn ghost danger', onClick: async () => { if (!await askConfirm(`Delete project "${sel.name}" and its files?`)) return; await run(() => api.call('workshop:remove', sel.id), 'Project deleted'); state.workshopSel = null; refreshGame(); renderPage(); } }, 'Delete'))),
        ask,
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('div', { class: 'grow' }),
          h('button', { class: 'btn primary', onClick: () => { if (ask.value.trim()) askAi(`Work on Workshop project "${sel.name}" (project_id ${sel.id}, kind ${sel.kind}). ${ask.value.trim()}\n\nWrite the files, build/compile and test-check the result, then tell me what changed.`); } }, '✦ Ask AI'))),
      h('div', { class: 'split' },
        h('div', { class: 'card', style: { width: '300px', flex: 'none' } }, h('h3', {}, `Files (${files.length})`),
          h('div', { style: { maxHeight: '420px', overflow: 'auto' } }, files.length
            ? files.map((f) => h('div', { class: `small mono`, style: { padding: '4px 6px', borderRadius: '6px', cursor: 'pointer', background: f === state.workshopFile ? 'var(--accent-soft)' : '' }, onClick: () => { state.workshopFile = f; renderPage(); } }, f))
            : h('div', { class: 'muted small' }, 'Empty. Ask the AI to build something.'))),
        h('div', { class: 'card grow' }, h('div', { class: 'row', style: { marginBottom: '8px' } }, fileLabel, h('div', { class: 'grow' }), saveBtn), editor)),
    );
  }
  return h('div', { class: 'split' }, left, h('div', { class: 'grow' }, right));
}

// ---------- Diagnostics ----------
async function pageDiagnostics() {
  const g = game();
  if (!g.installDir) return needFolder(g);
  const [logs, health] = await Promise.all([api.call('diag:crashLogs', g.id), api.call('diag:health', g.id)]);
  const viewer = h('div');
  const open = async (l) => {
    const text = await run(() => api.call('diag:read', l.path));
    viewer.replaceChildren(h('div', { class: 'card' },
      h('h3', {}, l.name, h('span', { class: 'right row' },
        h('button', { class: 'btn small', onClick: () => api.call('shell:showItem', l.path) }, 'Show in folder'),
        h('button', { class: 'btn small primary', onClick: () => askAi(`Analyze this log, explain the cause in plain language and fix it: ${l.path}`) }, '✦ Analyze with AI'))),
      h('div', { class: 'log-view' }, text)));
  };
  return h('div', {},
    h('div', { class: 'grid cols-2', style: { marginBottom: '16px' } },
      h('div', { class: 'card' }, h('h3', {}, 'Health check'),
        health.issues.length ? health.issues.map((i) => h('div', { class: `issue ${i.severity}` }, h('span', { class: 'sev' }), h('div', { class: 'txt' }, i.message))) : h('div', { class: 'muted' }, 'No problems found.')),
      h('div', { class: 'card' }, h('h3', {}, 'Logs'),
        logs.length ? logs.map((l) => h('div', { class: 'issue info', style: { cursor: 'pointer' }, onClick: () => open(l) },
          h('div', { class: 'txt' }, h('div', { class: 'name' }, l.name), h('div', { class: 'faint small' }, `${fmtDate(l.date)} · ${fmtBytes(l.size)}`)))) : h('div', { class: 'muted' }, g.kind === 'bethesda' ? 'No crash logs. Install Buffout 4 (FO4), Crash Logger SSE/SF to get them.' : 'No crash reports or logs yet.')),
    ),
    viewer,
  );
}



// ---------- Cloud AI providers (Gemini, Groq, OpenRouter, Cerebras, Mistral, OpenAI, custom) ----------
function cloudBox(id) {
  const p = state.cloudProviders.find((c) => c.id === id);
  if (!p) return h('div');
  const box = h('div');
  const keyIn = h('input', { class: 'input grow', type: 'password', placeholder: p.hasKey ? '•••••••• saved (enter a new key to replace)' : p.keyOptional ? 'API key (optional for local servers)' : `${p.label} API key` });
  const urlIn = id === 'custom' ? h('input', { class: 'input', style: { width: '100%', marginBottom: '8px' }, value: state.settings.customBaseUrl || '', placeholder: 'Server address, e.g. http://localhost:1234/v1 (LM Studio) or http://localhost:11434/v1 (Ollama)' }) : null;
  const modelSel = h('select', { class: 'input grow' }, h('option', {}, p.hasKey || p.keyOptional ? 'Loading models…' : 'Save your key to see the models'));
  const out = h('div', { class: 'small', style: { marginTop: '8px' } });
  const loadModels = async (refresh) => {
    if (!(p.hasKey || p.keyOptional)) return;
    try {
      const r = await api.call('cloud:models', id, refresh);
      modelSel.replaceChildren(...r.list.map((m) => h('option', { value: m.id, selected: m.id === r.current }, `${m.name || m.id}${m.note ? ` · ${m.note}` : ''}${m.vision ? '' : ' · text only'}`)));
      if (!r.list.length) modelSel.replaceChildren(h('option', {}, 'No usable models for this key'));
    } catch (e) {
      modelSel.replaceChildren(h('option', {}, 'Could not load models'));
      out.replaceChildren(h('span', { style: { color: 'var(--err)' } }, e.message));
    }
  };
  modelSel.addEventListener('change', async () => {
    const cloudModels = { ...(state.settings.cloudModels || {}), [id]: modelSel.value };
    state.settings = await api.call('settings:set', { cloudModels });
    toast(`${p.label}: using ${modelSel.value}`, 'success');
  });
  const save = async () => {
    if (urlIn) state.settings = await api.call('settings:set', { customBaseUrl: urlIn.value.trim() });
    if (keyIn.value.trim()) {
      await run(() => api.call('secrets:set', keyNameOf(id), keyIn.value.trim()), 'Key saved');
      p.hasKey = true;
    }
    keyIn.value = '';
    renderPage();
  };
  box.append(...[
    h('p', { class: 'muted small', style: { marginTop: 0 } }, p.about),
    urlIn,
    h('div', { class: 'row' }, keyIn),
    h('div', { class: 'row wrap', style: { margin: '8px 0 12px' } },
      h('button', { class: 'btn primary', onClick: save }, 'Save'),
      p.keyUrl ? h('button', { class: 'btn ghost', onClick: () => api.call('shell:open', p.keyUrl) }, p.tag === 'paid' ? 'Get a key' : 'Get a free key') : null,
      p.hasKey && !p.keyOptional ? h('button', { class: 'btn ghost danger', onClick: async () => { await api.call('secrets:set', keyNameOf(id), ''); p.hasKey = false; renderPage(); } }, 'Remove key') : null),
    h('div', { class: 'faint small', style: { marginBottom: '4px' } }, 'Model'),
    h('div', { class: 'row' }, modelSel,
      h('button', { class: 'btn small', title: 'Reload the list from the provider', onClick: () => loadModels(true) }, '↻'),
      h('button', { class: 'btn small', onClick: async () => {
        out.replaceChildren(h('span', { class: 'muted' }, 'Testing…'));
        try {
          const r = await api.call('cloud:test', id);
          out.replaceChildren(h('span', { style: { color: 'var(--ok)' } }, `✓ ${r.model} answered: "${r.reply}"`));
        } catch (e) {
          out.replaceChildren(h('span', { style: { color: 'var(--err)' } }, e.message));
        }
      } }, 'Test')),
    out,
    h('p', { class: 'faint small', style: { marginTop: '10px' } }, p.tag === 'paid'
      ? 'Billed by the provider per use. Your key is stored encrypted on this PC and only sent to the provider.'
      : 'Free tiers have rate limits (requests per minute/day). If you hit one, Shuriken tells you; wait a bit or switch model/provider. Your messages, screenshots and tool results are sent to this provider. Your key is stored encrypted on this PC.')].filter(Boolean));
  loadModels(false);
  return box;
}

const keyNameOf = (id) => ({ gemini: 'geminiApiKey', groq: 'groqApiKey', openrouter: 'openrouterApiKey', cerebras: 'cerebrasApiKey', mistral: 'mistralApiKey', openai: 'openaiApiKey', custom: 'customApiKey' }[id]);

function aiLabel() {
  const prov = aiProvider();
  if (prov === 'local') return 'Built-in AI · runs on your PC';
  if (prov === 'claude') return `Claude · ${state.settings.aiModel || 'claude-opus-5-5'}`;
  const p = state.cloudProviders.find((c) => c.id === prov);
  const model = state.settings.cloudModels?.[prov];
  return `${p ? p.label : prov}${model ? ` · ${model}` : ''}`;
}

function aiNeedsKey() {
  const prov = aiProvider();
  if (prov === 'claude') return !state.keys.anthropic;
  const p = state.cloudProviders.find((c) => c.id === prov);
  return !!p && !p.hasKey && !p.keyOptional;
}

// ---------- AI models: download, switch, manual install ----------
// Downloads keep running in the background (main process); every open view follows the progress.
const aiDlWatchers = new Set();
api.onEngineProgress((ev) => {
  if (!ev.modelId) return;
  state.aiDl = ev.finished || ev.cancelled || ev.error ? null : ev;
  if (ev.finished) refreshGame();
  for (const fn of [...aiDlWatchers]) {
    if (!fn.el?.isConnected && fn.el) { aiDlWatchers.delete(fn); continue; }
    fn(ev);
  }
});

function watchAiDownload(el, fn) {
  fn.el = el;
  aiDlWatchers.add(fn);
}

async function startModelDownload(m, after) {
  const ok = await askConfirm(`Download ${m.label.split(' ·')[0]} (${m.sizeGB} GB)?\n\nIt downloads in the background, so you can keep using Shuriken, and resumes if it gets interrupted. When it finishes, the AI assistant switches to it automatically.\n\nSource: ${m.page}`, { title: 'Download AI model', ok: 'Download' });
  if (!ok) return;
  const r = await run(() => api.call('engine:download', m.id));
  if (r) { state.aiDl = { modelId: m.id, label: 'Starting', done: 0, total: 0 }; after?.(); }
}

// Model rows for Settings and the upgrade prompt. redraw() re-renders the owner when a download ends.
function aiModelList(st, redraw, { compact = false } = {}) {
  const list = h('div');
  const rows = st.models.filter((m) => !compact || !m.installed).map((m) => {
    const bar = h('div', { class: 'progress', style: { display: 'none', margin: '8px 0 2px' } }, h('div', { style: { width: '0%' } }));
    const txt = h('div', { class: 'faint small' });
    const actions = h('div', { class: 'row' });
    const paint = () => {
      const dl = state.aiDl && state.aiDl.modelId === m.id ? state.aiDl : null;
      bar.style.display = dl ? '' : 'none';
      if (dl?.total) bar.firstChild.style.width = `${Math.round((100 * dl.done) / dl.total)}%`;
      txt.textContent = dl ? `${dl.label}: ${fmtBytes(dl.done)}${dl.total ? ` / ${fmtBytes(dl.total)}` : ''}` : '';
      actions.replaceChildren(
        m.id === st.recommendedModel && !compact ? h('span', { class: 'badge win' }, 'best for your GPU') : null,
        m.builtIn ? h('span', { class: 'badge win' }, 'built in') : m.installed ? h('span', { class: 'badge' }, 'downloaded') : null,
        dl ? h('button', { class: 'btn small ghost', onClick: async (e) => { e.preventDefault(); await api.call('engine:cancelDownload'); } }, 'Cancel')
          : !m.installed ? h('button', { class: 'btn small primary', disabled: !!state.aiDl, onClick: (e) => { e.preventDefault(); startModelDownload(m, paint); } }, `Download ${m.sizeGB} GB`) : null,
        m.installed && !m.builtIn && m.id !== st.model && !compact ? h('button', { class: 'btn small ghost danger', onClick: async (e) => { e.preventDefault(); if (await askConfirm(`Delete the ${m.label} files (${m.sizeGB} GB)?`, { title: 'Delete model', ok: 'Delete', danger: true })) { await api.call('engine:remove', m.id); redraw(); } } }, 'Delete') : null);
    };
    paint();
    const row = h('label', { class: 'fomod-opt', style: { margin: '0 0 6px', alignItems: 'flex-start' } },
      compact ? null : h('input', { type: 'radio', name: 'localModel', checked: m.id === st.model, disabled: !m.installed, title: m.installed ? '' : 'Download it first', onChange: async () => { state.settings = await api.call('settings:set', { localModel: m.id }); await api.call('engine:stop'); redraw(); } }),
      h('div', { class: 'grow' },
        h('div', {}, m.label, h('span', { class: 'faint small' }, ` · ${m.sizeGB} GB`)),
        m.about ? h('div', { class: 'faint small' }, m.about) : null,
        bar, txt),
      actions);
    watchAiDownload(row, (ev) => { if (ev.modelId === m.id && (ev.finished || ev.cancelled || ev.error)) redraw(); else paint(); });
    return row;
  });
  list.append(...rows);
  return list;
}

function aiManualSteps(st) {
  const bigger = st.models.filter((m) => !m.builtIn);
  return h('details', { style: { marginTop: '10px' } },
    h('summary', { class: 'small muted', style: { cursor: 'pointer' } }, 'How to install a model by hand (slow or blocked downloads)'),
    h('ol', { class: 'small muted', style: { paddingLeft: '18px', lineHeight: 1.6 } },
      h('li', {}, 'Open the model page and go to "Files and versions":',
        bigger.map((m) => h('div', {}, h('a', { href: '#', onClick: (e) => { e.preventDefault(); api.call('shell:open', m.page); } }, m.label.split(' ·')[0]), ` - download both files: ${m.files.join(' and ')}`))),
      h('li', {}, 'Wait until both files have finished downloading (check the sizes).'),
      h('li', {}, 'Click "Import downloaded files…" below and select both files, or copy them into the models folder yourself.'),
      h('li', {}, 'Pick the model in the list above. Shuriken uses it for the next question.')),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn small', onClick: async () => {
        const r = await run(() => api.call('engine:import'));
        if (!r) return;
        if (r.unknown.length) toast(`Not a Shuriken model file: ${r.unknown.join(', ')}`, 'error', 8000);
        if (r.complete.length) toast('Model added and selected.', 'success');
        else if (r.added.length) toast(`Added ${r.added.join(', ')}. Import the other file of the pair too.`, 'info', 8000);
        renderPage();
      } }, 'Import downloaded files…'),
      h('button', { class: 'btn small ghost', onClick: () => api.call('engine:openModels') }, 'Open models folder')));
}

// AI page: offer the bigger model when the PC can run it and only the small built-in one is there.
function aiUpgradeBanner(box, status = null) {
  if (aiProvider() !== 'local' || state.settings.aiUpgradeDismissed) return;
  (status ? Promise.resolve(status) : api.call('engine:status')).then((st) => {
    const rec = st.models.find((m) => m.id === st.recommendedModel);
    const cur = st.models.find((m) => m.id === st.model);
    if (!st.ready || !rec || rec.installed || !cur?.builtIn) return;
    const draw = () => {
      const dl = state.aiDl;
      box.replaceChildren(h('div', { class: 'card', style: { margin: '10px 16px 0', padding: '12px 14px', borderColor: 'rgba(61,220,151,.35)' } },
        h('div', { class: 'row wrap' },
          h('div', { class: 'grow' },
            h('div', { class: 'name' }, dl ? `Downloading ${engineLabel(st, dl.modelId)}…` : `Upgrade the AI: your graphics card can run ${rec.label.split(' ·')[0]}`),
            h('div', { class: 'faint small' }, dl
              ? `${dl.label}: ${fmtBytes(dl.done)}${dl.total ? ` / ${fmtBytes(dl.total)}` : ''}. Keep chatting; it switches automatically when done.`
              : `You're using the small built-in model. ${rec.about} One-time ${rec.sizeGB} GB download, free, runs on your PC.`)),
          dl ? h('button', { class: 'btn small ghost', onClick: () => api.call('engine:cancelDownload') }, 'Cancel') : [
            h('button', { class: 'btn small primary', onClick: () => startModelDownload(rec, draw) }, 'Download & switch automatically'),
            h('button', { class: 'btn small', onClick: () => go('settings') }, 'Other options'),
            h('button', { class: 'btn small ghost', onClick: async () => { state.settings = await api.call('settings:set', { aiUpgradeDismissed: true }); box.replaceChildren(); } }, 'Not now')]),
        dl?.total ? h('div', { class: 'progress', style: { marginTop: '8px' } }, h('div', { style: { width: `${Math.round((100 * dl.done) / dl.total)}%` } })) : null));
    };
    draw();
    watchAiDownload(box, (ev) => { if (ev.finished) box.replaceChildren(); else draw(); });
  }).catch(() => {});
}

function engineLabel(st, id) {
  return (st.models.find((m) => m.id === id)?.label || id).split(' ·')[0];
}

// ---------- Playtest ----------
async function startPlaytest(g) {
  const bethesda = g.kind === 'bethesda';
  const issue = h('textarea', { class: 'input', rows: 3, placeholder: 'What should the AI look for? e.g. "The bridge in Sanctuary flickers", "Purple textures on the armor in Diamond City market"', style: { width: '100%', resize: 'vertical' } });
  const where = h('input', { class: 'input', placeholder: bethesda ? 'Where? (place name, e.g. Sanctuary, Whiterun) - optional' : 'Where in the game? - optional', style: { width: '100%', marginTop: '8px' } });
  const saveSel = h('select', { class: 'input', style: { width: '100%', marginTop: '8px' } }, h('option', { value: '' }, bethesda ? 'Start from: travel there with the console (new test character)' : 'Start from: main menu'));
  if (bethesda) {
    api.call('saves:list', g.id).then((r) => {
      for (const sv of r.saves.filter((x) => !x.issues.some((i) => i.level === 'err')).slice(0, 25)) saveSel.append(h('option', { value: sv.file }, `Load save: ${sv.name || ''} Lv ${sv.level || '?'} · ${sv.location || sv.file} · ${fmtDate(sv.savedAt || sv.modified)}`));
    }).catch(() => {});
  }
  const err = h('div', { class: 'small', style: { color: 'var(--err)', minHeight: '18px', marginTop: '6px' } });
  const body = h('div', {},
    h('p', { class: 'muted small', style: { marginTop: 0 } }, `The AI launches ${g.short} with your current mods, goes to the place, takes screenshots, moves the camera, ${bethesda ? 'uses the console and inspects objects' : 'presses keys'}, then fixes what it finds with its other tools. Keep typing in the chat while it plays to steer it. Don't use the mouse or keyboard in the game while it works.`),
    issue, where, saveSel, err,
    bethesda ? h('p', { class: 'faint small' }, 'Tip: the game must run windowed or borderless for screenshots. The AI can switch that for you.') : null);
  const go2 = await dialog('Playtest', body, (done) => [
    h('button', { class: 'btn ghost', onClick: () => done(null) }, 'Cancel'),
    h('button', { class: 'btn primary', onClick: () => { if (!issue.value.trim()) { err.textContent = 'Describe the problem first.'; return; } done(true); } }, 'Start playtest'),
  ], { width: '560px' });
  if (!go2) return;
  const chat = chatFor(g.id);
  const saveText = saveSel.value ? `Load my save "${saveSel.value}".` : bethesda && where.value.trim() ? 'Use playtest_find_location to get the cell ID and travel there with coc.' : '';
  chat.draft = `Playtest: ${issue.value.trim()}${where.value.trim() ? `\nWhere: ${where.value.trim()}` : ''}\n${saveText}\nStart the game with playtest_start, go there, look for the problem, find the cause (which mod/plugin/file) and fix it. Show me what you see as you go.`;
  if (state.page !== 'ai') await go('ai');
  else renderPage();
  setTimeout(() => sendChat(), 100);
}

function toolRequestCard(block) {
  const g = game();
  return h('div', { class: 'approval' },
    h('div', { class: 'what' }, `The assistant needs a tool: ${block.name}`),
    h('div', { class: 'small muted', style: { marginBottom: '8px' } }, block.reason),
    block.added ? h('div', { class: 'small muted' }, '✓ Added') : h('div', { class: 'row wrap' },
      block.url ? h('button', { class: 'btn small', onClick: () => api.call('shell:open', block.url) }, 'Open download page') : null,
      h('button', { class: 'btn small primary', onClick: async () => { const r = await run(() => api.call('tools:addDialog', g.id)); if (r) { block.added = true; drawChat(); toast('Tool added. Tell the assistant to continue.', 'success'); } } }, 'I have it: add tool…')));
}

// ---------- Saves ----------
const SEV = { err: 'error', warn: 'warning', info: 'info', ok: 'info' };
const issueRow = (i) => h('div', { class: `issue ${SEV[i.level] || 'info'}` }, h('span', { class: 'sev', style: i.level === 'ok' ? { background: 'var(--ok)' } : null }), h('div', { class: 'txt' }, i.text));

async function pageSaves() {
  const g = game();
  const data = await api.call('saves:list', g.id);
  state.savesFilter ??= '';
  const thumbs = (state.saveThumbs ??= new Map());
  const detail = h('div', { class: 'save-detail' });
  const listEl = h('div', { class: 'save-list' });
  const chars = [...new Set(data.saves.map((s) => s.name).filter(Boolean))];
  let charFilter = state.savesChar && chars.includes(state.savesChar) ? state.savesChar : '';
  let selected = data.saves.find((s) => s.file === state.saveSel) || data.saves[0] || null;

  const loadThumb = async (s, img) => {
    if (!s.hasShot) return;
    const key = `${g.id}|${s.file}|${s.modified}`;
    if (!thumbs.has(key)) thumbs.set(key, api.call('saves:thumb', g.id, s.file).catch(() => null));
    const url = await thumbs.get(key);
    if (url) { img.src = url; img.classList.add('loaded'); }
  };

  const showDetail = (s) => {
    state.saveSel = s?.file;
    listEl.querySelectorAll('.save-item').forEach((el) => el.classList.toggle('active', el.dataset.file === s?.file));
    if (!s) { detail.replaceChildren(h('div', { class: 'empty' }, 'No saves yet.')); return; }
    const img = h('img', { class: 'save-shot' });
    loadThumb(s, img);
    const result = h('div');
    const check = async () => {
      result.replaceChildren(h('div', { class: 'muted small', style: { padding: '8px 0' } }, 'Checking the save… (first time: Shuriken may download Java, about 190 MB)'));
      const r = await run(() => api.call('saves:analyze', g.id, s.file));
      if (!r) { result.replaceChildren(); return; }
      const p = r.papyrus || {};
      result.replaceChildren(
        h('h4', { style: { margin: '14px 0 8px' } }, 'Save check'),
        ...r.issues.map(issueRow),
        h('div', { class: 'save-stats' },
          [['Script instances', p.instances], ['Active threads', p.activeScripts], ['Suspended stacks', p.suspendedStacks], ['Unattached', p.unattachedInstances], ['Undefined', p.undefinedElements], ['Changed forms', r.changeForms]]
            .map(([l, v]) => h('div', {}, h('div', { class: 'stat', style: { fontSize: '18px' } }, fmtNum(v || 0)), h('div', { class: 'stat-label' }, l)))),
        p.topScripts?.length ? h('details', {}, h('summary', { class: 'small muted' }, 'Scripts with the most instances'),
          h('div', { class: 'faint small', style: { columns: 2, marginTop: '6px' } }, p.topScripts.map((t) => h('div', {}, `${t.script}: ${fmtNum(t.instances)}`)))) : null,
        h('div', { class: 'row wrap', style: { marginTop: '12px' } },
          r.canClean ? h('button', { class: 'btn primary', onClick: () => clean() }, '✦ Clean this save') : null,
          h('button', { class: 'btn', onClick: () => askAi(`Check my ${g.short} save "${s.file}" (use analyze_save) and tell me if it is healthy, what caused any problems, and whether I should clean it.`) }, 'Ask AI about it')));
    };
    const clean = async () => {
      const ok = await askConfirm(`Clean "${s.name || s.file}"?\n\nShuriken removes leftover script data from removed or changed mods (unattached instances, undefined scripts and their stuck threads) using the ReSaver engine.\n\nThe original save is backed up first and can be restored from this page.`, { title: 'Clean save', ok: 'Back up and clean' });
      if (!ok) return;
      result.replaceChildren(h('div', { class: 'muted small', style: { padding: '8px 0' } }, 'Cleaning… this takes a few seconds.'));
      const r = await run(() => api.call('saves:clean', g.id, s.file));
      if (!r) { result.replaceChildren(); return; }
      const removed = Object.values(r.removed || {}).reduce((a, b) => a + b, 0);
      toast(`Cleaned: removed ${removed} script element${removed === 1 ? '' : 's'}. Backup saved.`, 'success', 7000);
      result.replaceChildren(h('h4', { style: { margin: '14px 0 8px' } }, 'After cleaning'), ...r.issues.map(issueRow),
        h('div', { class: 'faint small' }, `Backup: ${r.backup}`),
        h('p', { class: 'muted small' }, 'Load the save, wait a minute in game, then make a new save. If something is off, restore the backup below.'));
    };
    detail.replaceChildren(
      h('div', { class: 'card' },
        img,
        h('h3', { style: { marginTop: '12px' } }, s.name || s.file, s.level ? h('span', { class: 'badge', style: { marginLeft: '8px' } }, `Level ${s.level}`) : null),
        h('div', { class: 'muted small' }, [s.location, s.gameDate ? `in-game ${s.gameDate.split('.').slice(0, 3).join(' ')}` : null].filter(Boolean).join(' · ')),
        h('div', { class: 'faint small', style: { margin: '4px 0 10px' } }, `${fmtDate(s.savedAt || s.modified)} · ${fmtBytes(s.size)}${s.pluginCount ? ` · ${s.pluginCount} plugins` : ''}${s.cosave ? ' · co-save ✓' : ''}${s.gameVersion ? ` · game ${s.gameVersion}` : ''}`),
        s.issues.length ? s.issues.map(issueRow) : h('div', { class: 'issue info' }, h('span', { class: 'sev', style: { background: 'var(--ok)' } }), h('div', { class: 'txt' }, 'Header and plugin list look fine.')),
        s.missing?.length ? h('details', {}, h('summary', { class: 'small muted' }, `Missing plugins (${s.missing.length})`), h('div', { class: 'faint small', style: { marginTop: '6px' } }, s.missing.join(', '))) : null,
        h('div', { class: 'row wrap', style: { marginTop: '12px' } },
          data.cleanable ? h('button', { class: 'btn primary', onClick: check }, 'Check for problems') : h('span', { class: 'muted small' }, 'Deep checks and cleaning: Skyrim and Fallout 4 for now.'),
          h('button', { class: 'btn ghost danger', onClick: async () => {
            if (!await askConfirm(`Move "${s.file}"${s.cosave ? ' and its co-save' : ''} to the Recycle Bin?`, { title: 'Delete save', ok: 'Move to Recycle Bin', danger: true })) return;
            await run(() => api.call('saves:trash', g.id, [s.file]), 'Moved to the Recycle Bin');
            renderPage();
          } }, 'Delete')),
        result));
  };

  const renderList = () => {
    const q = state.savesFilter.toLowerCase();
    const shown = data.saves.filter((s) => (!charFilter || s.name === charFilter) && (!q || `${s.file} ${s.name} ${s.location}`.toLowerCase().includes(q)));
    listEl.replaceChildren(...shown.slice(0, 300).map((s) => {
      const worst = s.issues.find((i) => i.level === 'err') ? 'err' : s.issues.find((i) => i.level === 'warn') ? 'warn' : null;
      return h('div', { class: `save-item ${s.file === selected?.file ? 'active' : ''}`, 'data-file': s.file, onClick: () => { selected = s; showDetail(s); } },
        h('div', { class: 'grow', style: { minWidth: 0 } },
          h('div', { class: 'name ellipsis' }, s.name || s.file, s.level ? h('span', { class: 'faint small' }, `  Lv ${s.level}`) : null),
          h('div', { class: 'faint small ellipsis' }, `${s.location || s.file} · ${fmtDate(s.savedAt || s.modified)}`)),
        worst ? h('span', { class: `badge ${worst === 'err' ? 'lose' : 'warn'}` }, worst === 'err' ? 'corrupt' : `${s.missing?.length || '!'} missing`) : null);
    }), shown.length > 300 ? h('div', { class: 'faint small', style: { padding: '8px' } }, `Showing 300 of ${shown.length}. Search to narrow down.`) : null);
  };

  const search = h('input', { class: 'input grow', placeholder: 'Search saves…', value: state.savesFilter });
  search.addEventListener('input', () => { state.savesFilter = search.value; renderList(); });
  const charSel = h('select', { class: 'input' }, h('option', { value: '' }, `All characters (${chars.length})`), ...chars.map((c) => h('option', { value: c, selected: c === charFilter }, c)));
  charSel.addEventListener('change', () => { charFilter = charSel.value; state.savesChar = charFilter; renderList(); });

  const backups = data.backups ? h('button', { class: 'btn', onClick: () => showBackups(g) }, `Backups (${data.backups})`) : null;
  const junkTotal = data.junk.reduce((n, j) => n + j.size, 0);
  const el = h('div', {},
    h('div', { class: 'card row wrap', style: { marginBottom: '14px', gap: '10px' } },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, `${data.saves.length} saves`), h('div', { class: 'faint small ellipsis', title: data.dir }, data.dir)),
      h('button', { class: 'btn', onClick: () => api.call('saves:open', g.id) }, 'Open folder'),
      h('button', { class: 'btn', onClick: async () => { const r = await run(() => api.call('saves:backupAll', g.id)); if (r) { toast(`Backed up ${r.files} files`, 'success'); renderPage(); } } }, 'Back up all'),
      backups),
    data.junk.length ? h('div', { class: 'card', style: { marginBottom: '14px', borderColor: 'rgba(255,181,71,.35)' } },
      h('div', { class: 'row wrap' },
        h('div', { class: 'grow' },
          h('div', { class: 'name' }, `${data.junk.length} broken or leftover file${data.junk.length > 1 ? 's' : ''} (${fmtBytes(junkTotal)})`),
          h('div', { class: 'faint small' }, 'Unfinished saves (.tmp), empty saves and co-saves without a save. They can confuse the load menu and waste space.')),
        h('button', { class: 'btn primary', onClick: async () => {
          if (!await askConfirm(`Move these ${data.junk.length} files to the Recycle Bin?\n\n${data.junk.slice(0, 12).map((j) => `• ${j.file}`).join('\n')}${data.junk.length > 12 ? '\n…' : ''}`, { title: 'Clean up save folder', ok: 'Move to Recycle Bin' })) return;
          const r = await run(() => api.call('saves:cleanupJunk', g.id));
          if (r) { toast(`Moved ${r.removed.length} files to the Recycle Bin`, 'success'); renderPage(); }
        } }, 'Clean up'))) : null,
    data.saves.length ? h('div', { class: 'saves-layout' },
      h('div', { class: 'card', style: { padding: '12px' } }, h('div', { class: 'row', style: { marginBottom: '10px' } }, search, chars.length > 1 ? charSel : null), listEl),
      detail) : h('div', { class: 'card empty' }, h('div', { class: 'big' }, 'No saves found'), h('p', { class: 'muted' }, `Shuriken looks in ${data.dir}`)));
  renderList();
  showDetail(selected);
  return el;
}

async function showBackups(g) {
  const list = await run(() => api.call('saves:backups', g.id));
  if (!list) return;
  const body = h('div', {},
    h('p', { class: 'muted small' }, 'Backups live in the "Shuriken Backups" folder inside your saves folder. Restoring copies the files back (the current version is backed up first).'),
    list.map((b) => h('div', { class: 'issue info' },
      h('div', { class: 'txt' }, h('div', { class: 'name' }, b.id), h('div', { class: 'faint small ellipsis' }, `${b.files.length} files · ${fmtBytes(b.size)} · ${b.files.slice(0, 2).join(', ')}`)),
      h('button', { class: 'btn small', onClick: async () => {
        if (!await askConfirm(`Restore ${b.files.length} file(s) from "${b.id}"?`, { title: 'Restore backup', ok: 'Restore' })) return;
        const r = await run(() => api.call('saves:restore', g.id, b.id), 'Restored');
        if (r) { closeModal(); renderPage(); }
      } }, 'Restore'))));
  showModal(`Save backups · ${g.short}`, body);
}

// ---------- Precombines / previs (Fallout 4) ----------
async function pagePrecombines() {
  const g = game();
  if (!g.installDir) return needFolder(g);
  const out = h('div');
  const runIt = async () => {
    out.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'ring-spin' }), h('div', {}, h('div', { class: 'name' }, 'Reading your load order…'), h('div', { class: 'faint small' }, 'Every active plugin is scanned for precombined cells. The first scan takes 10-30 seconds; later scans are faster.')))));
    const r = await run(() => api.call('precombines:analyze', g.id));
    state.precombines = r ? { gameId: g.id, at: Date.now(), r } : null;
    show();
  };
  const show = () => {
    const r = state.precombines?.gameId === g.id ? state.precombines.r : null;
    if (!r) {
      out.replaceChildren(h('div', { class: 'card empty' }, h('div', { class: 'big' }, 'Check precombines'), h('p', { class: 'muted' }, 'Find mods that break precombined meshes and previs (the cause of big FPS drops and flickering or invisible objects in Fallout 4).'), h('button', { class: 'btn primary', onClick: runIt }, 'Scan load order')));
      return;
    }
    const bad = r.brokenCells + r.disabledCells + r.revertedCells;
    const stat = (n, label, warn) => h('div', { class: 'card stat-card' }, h('div', {}, h('div', { class: 'stat', style: warn && n ? { color: 'var(--warn)' } : null }, fmtNum(n)), h('div', { class: 'stat-label' }, label)));
    const reason = { broken: 'A mod edits objects baked into this cell\'s precombined meshes after they were built, so the game turns the cell\'s precombines off.', disabled: 'A mod\'s version of this cell has no precombine data, which turns them off.', reverted: 'A mod loaded later carries older precombine data than the previs patch that rebuilt this cell.' };
    out.replaceChildren(
      h('div', { class: 'grid cols-3', style: { marginBottom: '14px' } },
        stat(r.cellsWithPrecombines, 'cells with precombines'),
        stat(r.brokenCells, 'broken by a mod', true),
        stat(r.disabledCells, 'precombines turned off', true),
        stat(r.revertedCells, 'previs patch overridden', true),
        stat(r.repairedCells, 'edits fixed by a previs patch')),
      h('div', { class: 'card', style: { marginBottom: '14px' } },
        h('h3', {}, bad ? 'What to do' : 'Looks good'),
        !r.prpInstalled ? h('div', { class: 'issue warning' }, h('span', { class: 'sev' }), h('div', { class: 'txt' },
          h('div', { class: 'name' }, `Install ${r.prp.name}`),
          h('div', { class: 'small' }, 'PRP rebuilds precombines and previs for the whole game and fixes the ones the base game and popular mods break. It is the standard fix. Load it late, after the mods it patches.')),
          h('button', { class: 'btn small primary', onClick: () => api.call('shell:open', `https://www.nexusmods.com/fallout4/mods/${r.prp.id}`) }, 'Open on Nexus')) : h('div', { class: 'issue info' }, h('span', { class: 'sev', style: { background: 'var(--ok)' } }), h('div', { class: 'txt' }, 'Previsibines Repair Pack (PRP) is active.')),
        r.suggestions.length ? h('div', { class: 'issue warning' }, h('span', { class: 'sev' }), h('div', { class: 'txt' },
          h('div', { class: 'name' }, 'Load-order fix available'),
          r.suggestions.map((s) => h('div', { class: 'small' }, `Move ${s.move} below ${s.after} (${s.cells} cell${s.cells > 1 ? 's' : ''})`))),
          h('button', { class: 'btn small primary', onClick: async () => {
            if (!await askConfirm(`Apply ${r.suggestions.length} load-order change(s)?\n\n${r.suggestions.map((s) => `• ${s.move} → below ${s.after}`).join('\n')}`, { title: 'Fix load order', ok: 'Apply' })) return;
            const res = await run(() => api.call('precombines:apply', g.id, r.suggestions));
            if (res) { toast(res.moved.length ? `Moved ${res.moved.length} plugin(s)` : 'Nothing to move', 'success'); runIt(); }
          } }, 'Apply')) : null,
        r.offenders.length ? h('div', { class: 'issue info' }, h('span', { class: 'sev' }), h('div', { class: 'txt' },
          h('div', { class: 'name' }, 'For the mods listed below'),
          h('div', { class: 'small' }, 'Look for a PRP or previs patch for each (search "<mod name> PRP" or "previs" on Nexus) and load it after the mod. If none exists, the AI assistant can build one with the Creation Kit, or you can live with lower FPS in those cells.')),
          h('button', { class: 'btn small', onClick: () => askAi(`My ${g.short} precombine scan found problems. Mods breaking precombines/previs: ${r.offenders.slice(0, 15).map((o) => `${o.plugin} (breaks ${o.breaksCells}, disables ${o.disablesCells}, reverts ${o.revertsCells})`).join('; ')}. Explain what this means for my game and walk me through fixing it.`) }, '✦ Ask AI')) : null,
        !bad ? h('div', { class: 'muted small' }, 'No mod is breaking precombines or previs in your load order.') : null),
      r.offenders.length ? h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', {}, 'Mods causing problems'),
        h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Plugin'), h('th', {}, 'Breaks'), h('th', {}, 'Turns off'), h('th', {}, 'Overrides patch'))),
          h('tbody', {}, r.offenders.map((o) => h('tr', {}, h('td', { class: 'name' }, o.plugin), h('td', {}, o.breaksCells || ''), h('td', {}, o.disablesCells || ''), h('td', {}, o.revertsCells || '')))))) : null,
      r.cells.length ? h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', {}, `Affected cells (${r.cells.length})`),
        r.cells.slice(0, 150).map((c) => h('div', { class: `issue ${c.problem === 'reverted' ? 'info' : 'warning'}` }, h('span', { class: 'sev' }), h('div', { class: 'txt' },
          h('div', { class: 'name' }, c.cell, h('span', { class: 'badge', style: { marginLeft: '8px' } }, c.problem)),
          h('div', { class: 'small muted' }, `${c.plugins.join(', ')}${c.builtBy ? ` · precombines built by ${c.builtBy}` : ''}`),
          h('div', { class: 'faint small' }, reason[c.problem]))))) : null,
      r.previsPatches.length ? h('details', { class: 'card' }, h('summary', { class: 'name' }, `Previs patches in your load order (${r.previsPatches.length})`),
        h('div', { class: 'faint small', style: { columns: 2, marginTop: '8px' } }, r.previsPatches.map((p) => h('div', {}, `${p.plugin}: ${fmtNum(p.cells)} cells`)))) : null,
      r.errors.length ? h('div', { class: 'faint small', style: { marginTop: '10px' } }, `Could not read: ${r.errors.map((e) => e.plugin).join(', ')}`) : null,
    );
  };
  show();
  return h('div', {},
    h('div', { class: 'card row wrap', style: { marginBottom: '14px' } },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, 'Precombines & previs'), h('div', { class: 'faint small' }, 'Fallout 4 bakes static objects into combined meshes and pre-computes visibility. Mods that edit those objects without a matching patch cost a lot of FPS and cause flickering.')),
      h('button', { class: 'btn primary', onClick: runIt }, state.precombines?.gameId === g.id ? 'Scan again' : 'Scan load order')),
    out);
}

// ---------- Settings ----------
async function pageSettings() {
  const s = state.settings;
  const keyInput = (name, placeholder, has) => {
    const input = h('input', { class: 'input grow', type: 'password', placeholder: has ? '•••••••• saved (enter a new key to replace)' : placeholder });
    return { input, row: h('div', { class: 'row' }, input) };
  };
  const claude = keyInput('anthropic', 'sk-ant-…', state.keys.anthropic);
  const nexusKey = keyInput('nexus', 'Nexus personal API key', state.keys.nexus);
  const braveKey = keyInput('brave', 'Brave Search API key (optional)', state.keys.brave);
  const model = h('select', { class: 'input' }, ...[['claude-opus-5-5', 'Claude Opus 5.5 (recommended)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, cheaper)'], ['claude-fable-5-1', 'Claude Fable 5.1 (most capable)']].map(([v, l]) => h('option', { value: v, selected: v === s.aiModel }, l)));
  const effort = h('select', { class: 'input' }, ...['low', 'medium', 'high', 'xhigh', 'max'].map((v) => h('option', { value: v, selected: v === s.aiEffort }, v)));
  const launcher = h('input', { class: 'input grow', value: s.minecraftLauncher || '', placeholder: 'Auto-detect' });
  const setS = async (patch) => { state.settings = await api.call('settings:set', patch); };
  model.addEventListener('change', () => setS({ aiModel: model.value }));
  effort.addEventListener('change', () => setS({ aiEffort: effort.value }));
  launcher.addEventListener('change', () => setS({ minecraftLauncher: launcher.value }));

  const saveKey = async (name, secret, input) => {
    await run(() => api.call('secrets:set', secret, input.value.trim()), input.value.trim() ? 'Key saved' : 'Key removed');
    state.keys[name] = !!input.value.trim();
    input.value = '';
    renderPage();
  };

  // Engine choice + Shuriken AI (built-in local engine) status.
  const engine = aiProvider();
  const providerPick = h('select', { class: 'input', style: { width: '100%', marginBottom: '12px' } },
    h('optgroup', { label: 'Free' },
      h('option', { value: 'local', selected: engine === 'local' }, 'Shuriken AI · built in, offline, on your PC'),
      ...state.cloudProviders.filter((c) => c.tag !== 'paid' && c.id !== 'custom').map((c) => h('option', { value: c.id, selected: engine === c.id }, `${c.label} · ${c.tag}${c.id === 'gemini' ? ' (recommended)' : ''}`))),
    h('optgroup', { label: 'Paid (API key)' },
      h('option', { value: 'claude', selected: engine === 'claude' }, 'Claude (Anthropic) · strongest for modding'),
      ...state.cloudProviders.filter((c) => c.tag === 'paid').map((c) => h('option', { value: c.id, selected: engine === c.id }, c.label))),
    h('optgroup', { label: 'Other' },
      ...state.cloudProviders.filter((c) => c.id === 'custom').map((c) => h('option', { value: c.id, selected: engine === c.id }, c.label))));
  providerPick.addEventListener('change', async () => { await setS({ aiProvider: providerPick.value }); renderPage(); });
  const engineSeg = h('div', {}, h('div', { class: 'faint small', style: { marginBottom: '6px' } }, 'Which AI answers in the AI Assistant'), providerPick);
  const localBox = h('div', { class: 'muted small' }, 'Checking Shuriken AI…');
  const drawLocal = async () => {
    try {
      const st = await api.call('engine:status');
      const chosen = st.models.find((m) => m.id === st.model) || st.models[0];
      const modelRows = aiModelList(st, drawLocal);
      localBox.replaceChildren(
        h('div', { class: 'row wrap', style: { marginBottom: '10px' } },
          h('span', { class: `chip ${st.engineInstalled ? 'ok' : 'warn'}` }, st.engineInstalled ? `Engine ${st.build}` : 'Engine not installed'),
          h('span', { class: `chip ${chosen.installed ? 'ok' : 'warn'}` }, chosen.installed ? 'Model ready' : 'Model not downloaded'),
          h('span', { class: `chip ${st.running ? 'ok' : ''}` }, st.running ? `Running${st.gpuMode ? ` · ${st.gpuMode}` : ''}` : 'Idle'),
          h('span', { class: 'chip' }, `GPU: ${st.device}`)),
        h('div', { style: { marginBottom: '10px' } }, modelRows),
        st.ready ? null : h('div', { class: 'issue warning' }, h('span', { class: 'sev' }), h('div', { class: 'txt small' }, 'The AI is not set up yet. Click Download next to a model (the engine comes with it). The 2B model is the smallest; pick the one marked "best for your GPU" for better answers.')),
        h('div', { class: 'row wrap' },
          st.running ? h('button', { class: 'btn', onClick: async () => { await api.call('engine:stop'); toast('Shuriken AI stopped; GPU memory freed.', 'success'); drawLocal(); } }, 'Free GPU memory') : null),
        aiManualSteps(st),
        h('p', { class: 'faint small', style: { marginTop: '10px' } }, "Runs entirely on your PC with Shuriken's built-in engine (llama.cpp + Qwen3-VL). No account, no API key, nothing leaves your computer. It unloads after 20 idle minutes so your games get the GPU back."));
    } catch (e) {
      localBox.textContent = e.message;
    }
  };
  drawLocal();

  return h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' },
      h('h3', {}, '✦ AI assistant'),
      engineSeg,
      engine === 'local' ? localBox : engine === 'claude' ? h('div', { class: 'muted small' }, 'Add your Claude API key in the "Claude" card. It is the strongest choice for modding knowledge, playtests and long fixes (pay-as-you-go, a few cents per conversation).') : cloudBox(engine),
      h('div', { class: 'row', style: { marginTop: '16px' } }, toggle(s.aiAutoApprove, (v) => setS({ aiAutoApprove: v })), h('div', {}, h('div', { class: 'name' }, 'Auto-fix'), h('div', { class: 'muted small' }, 'Apply AI fixes without asking. Files are still backed up.'))),
    ),
    h('div', { class: 'card' },
      h('h3', {}, 'Claude (optional upgrade)'),
      h('p', { class: 'muted small' }, 'For the strongest results, Shuriken can use Claude with your own API key from console.anthropic.com → API Keys (pay-as-you-go). Keys are encrypted with Windows data protection.'),
      claude.row,
      h('div', { class: 'row', style: { margin: '10px 0 16px' } },
        h('button', { class: 'btn primary', onClick: () => saveKey('anthropic', 'anthropicApiKey', claude.input) }, 'Save key'),
        state.keys.anthropic ? h('button', { class: 'btn ghost danger', onClick: async () => { await api.call('secrets:set', 'anthropicApiKey', ''); state.keys.anthropic = false; renderPage(); } }, 'Remove') : null,
        h('button', { class: 'btn ghost', onClick: () => api.call('shell:open', 'https://console.anthropic.com/settings/keys') }, 'Get a key')),
      h('div', { class: 'row wrap' }, h('label', { class: 'field' }, 'Model', model), h('label', { class: 'field' }, 'Effort', effort)),
    ),
    h('div', { class: 'card' },
      h('h3', {}, 'Nexus Mods'),
      h('p', { class: 'muted small' }, 'Personal API key from nexusmods.com → Site preferences → API Keys. Free accounts install via the "Mod Manager Download" button; Premium accounts can also download from inside Shuriken.'),
      nexusKey.row,
      h('div', { class: 'row', style: { margin: '10px 0 16px' } },
        h('button', { class: 'btn primary', onClick: () => saveKey('nexus', 'nexusApiKey', nexusKey.input) }, 'Save key'),
        state.keys.nexus ? h('button', { class: 'btn', onClick: async () => { const u = await run(() => api.call('nexus:validate')); toast(`Connected as ${u.name}${u.is_premium ? ' (Premium)' : ''}`, 'success'); } }, 'Test') : null,
        h('button', { class: 'btn ghost', onClick: () => api.call('shell:open', 'https://www.nexusmods.com/users/myaccount?tab=api') }, 'Get a key')),
      h('div', { class: 'row' }, toggle(s.handleNxm, (v) => setS({ handleNxm: v })), h('div', {}, h('div', { class: 'name' }, 'Handle Nexus downloads'), h('div', { class: 'muted small' }, 'Makes Shuriken the app that opens nxm:// links (replaces Vortex / MO2 for that).'))),
    ),
    h('div', { class: 'card' },
      h('h3', {}, 'AI web research'),
      h('p', { class: 'muted small' }, 'The AI searches the web, Nexus Mods (names, summaries, versions), game wikis and GitHub for you. Web search uses free engines that sometimes rate-limit; for reliable search add a free Brave Search API key (2,000 searches a month free).'),
      braveKey.row,
      h('div', { class: 'row', style: { margin: '10px 0 0' } },
        h('button', { class: 'btn primary', onClick: () => saveKey('brave', 'braveSearchKey', braveKey.input) }, 'Save key'),
        state.keys.brave ? h('button', { class: 'btn ghost danger', onClick: async () => { await api.call('secrets:set', 'braveSearchKey', ''); state.keys.brave = false; renderPage(); } }, 'Remove') : null,
        h('button', { class: 'btn ghost', onClick: () => api.call('shell:open', 'https://brave.com/search/api/') }, 'Get a free key')),
    ),
    h('div', { class: 'card' },
      h('h3', {}, 'Games'),
      managedGames().map((g) => h('div', { class: 'issue info', style: { alignItems: 'center' } },
        h('div', { style: { width: '54px', height: '26px', borderRadius: '6px', backgroundSize: 'cover', flex: 'none', ...artStyle(g) } }),
        h('div', { class: 'txt' }, h('div', { class: 'name' }, g.name), h('div', { class: 'faint small mono' }, g.installDir || 'Not found')),
        h('button', { class: 'btn small', onClick: async () => { if (await pickGameFolder(g)) renderPage(); } }, 'Change'))),
    ),
    h('div', { class: 'card' },
      h('h3', {}, 'Help & bug reports'),
      h('p', { class: 'muted small' }, 'Found a problem? Copy a bug report (version, games, recent errors - no keys or passwords) and paste it into a GitHub issue.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onClick: async () => { const t = await run(() => api.call('app:bugReport')); await navigator.clipboard.writeText(t); toast('Bug report copied to the clipboard', 'success'); } }, 'Copy bug report'),
        h('button', { class: 'btn', onClick: () => api.call('logs:open') }, 'Open logs folder'),
        h('button', { class: 'btn ghost', onClick: () => api.call('shell:open', 'https://github.com/npscott202-stack/Shuriken-Mod-Manager/issues/new') }, 'Report on GitHub'),
        h('button', { class: 'btn ghost', onClick: async () => { const u = await run(() => api.call('app:checkUpdate')); if (u) showUpdate(u); else toast('Shuriken is up to date', 'success'); } }, 'Check for updates'))),
    h('div', { class: 'card' },
      h('h3', {}, 'Launching'),
      h('div', { class: 'row', style: { marginBottom: '14px' } }, toggle(s.autoDeployOnLaunch, (v) => setS({ autoDeployOnLaunch: v })), h('div', {}, h('div', { class: 'name' }, 'Deploy before launching'), h('div', { class: 'muted small' }, 'Applies pending mod changes when you press Play or open a tool.'))),
      h('label', { class: 'field' }, 'Minecraft Launcher path', h('div', { class: 'row' }, launcher)),
      h('p', { class: 'faint small', style: { marginTop: '14px' } }, 'Screenshot hotkey: Ctrl+Shift+F12 (works while the game is running; exclusive-fullscreen games may capture black, so use borderless window).'),
    ),
  );
}

// ---------- modal ----------
let currentModal = null;
function showModal(title, body) {
  closeModal();
  currentModal = h('div', { class: 'modal-back', onClick: (e) => e.target === currentModal && closeModal() },
    h('div', { class: 'modal' }, h('header', {}, title), h('div', { class: 'mbody' }, body), h('footer', {}, h('button', { class: 'btn', onClick: closeModal }, 'Close'))));
  document.body.append(currentModal);
}
function closeModal() {
  currentModal?.remove();
  currentModal = null;
}

// ---------- global events ----------
$('#deployBtn').addEventListener('click', async () => {
  const btn = $('#deployBtn');
  btn.disabled = true;
  btn.textContent = 'Deploying…';
  try {
    const r = await api.call('deploy', state.gameId);
    if (r.virtual) toast(`Ready: ${r.total} mods will load virtually at launch${r.rootFiles ? ` (${r.rootFiles} loader/ENB files placed in the game folder)` : ''}.`, 'success');
    else toast(`Deployed ${r.total} files (${r.linked} linked${r.copied ? `, ${r.copied} copied` : ''})`, 'success');
    await refreshGame();
    if (['plugins', 'dashboard', 'mods'].includes(state.page)) renderPage();
  } catch (e) {
    toast(e.message, 'error', 9000);
  }
  btn.disabled = false;
  btn.textContent = 'Deploy';
});

$('#playBtn').addEventListener('click', async () => {
  const btn = $('#playBtn');
  btn.disabled = true;
  try {
    const r = await api.call('game:launch', state.gameId);
    toast(`Launching ${r.launched}…`, 'success');
    refreshGame();
  } catch (e) {
    toast(e.message, 'error', 9000);
  } finally {
    setTimeout(() => { btn.disabled = false; }, 2500);
  }
});

$('#profileSelect').addEventListener('change', async (e) => {
  const g = game();
  const v = e.target.value;
  if (v === '__new') {
    const name = await askText(`New profile (copy of "${g.profiles.active}")`, 'e.g. Survival, Graphics test', { validate: (n) => nameProblem(n, g.profiles.names) });
    if (name) {
      const made = await run(() => api.call('profiles:create', g.id, name, g.profiles.active).then(() => true));
      if (made) await run(() => api.call('profiles:switch', g.id, name), `Profile "${name}" created and active`);
    }
  } else if (v === '__manage') {
    renderTopbar();
    return manageProfiles();
  } else {
    await run(() => api.call('profiles:switch', g.id, v), g.deployMode === 'virtual' ? `Switched to ${v}.` : `Switched to ${v}. Deploy to apply.`);
  }
  await refreshGame();
  renderPage();
});

$('#instanceSelect').addEventListener('change', async (e) => {
  const g = game();
  const v = e.target.value;
  try {
    if (v === '__new') {
      const pick = await askNewInstance(g);
      if (pick) {
        await run(() => api.call('instances:create', g.id, pick.name, pick.copy));
        await run(() => api.call('instances:switch', g.id, pick.name), `Instance "${pick.name}" created and active`);
      }
    } else if (v === '__del') {
      if (await askConfirm(`Delete instance "${g.instances.active}" and all of its mods? This cannot be undone.`, { title: 'Delete instance', ok: 'Delete', danger: true })) await run(() => api.call('instances:delete', g.id, g.instances.active), 'Instance deleted');
    } else {
      await run(() => api.call('instances:switch', g.id, v), g.deployMode === 'virtual' ? `Instance ${v}` : `Instance ${v}: click Deploy to apply its mods`);
    }
  } catch {
    // run() already showed the error
  }
  state.selectedMod = null;
  await refreshGame();
  renderPage();
});

// Profile manager (MO2-style): rename/duplicate/delete and per-profile INIs and saves.
async function manageProfiles() {
  const g = await refreshGame();
  const virtual = g.deployMode === 'virtual';
  const body = h('div', {},
    h('p', { class: 'muted small' }, virtual
      ? 'Profiles share this instance\'s mods but keep their own enabled list, mod order and load order. In virtual mode a profile can also keep its own INI settings and save games.'
      : 'Profiles share this instance\'s mods but keep their own enabled list, mod order and load order. Switch to Virtual mode on the Dashboard for per-profile INIs and saves.'),
    g.profiles.names.map((name) => {
      const o = g.profileOptions[name] || {};
      return h('div', { class: 'card', style: { marginBottom: '10px', padding: '14px' } },
        h('div', { class: 'row', style: { marginBottom: '10px' } },
          h('div', { class: 'name grow' }, name, name === g.profiles.active ? h('span', { class: 'badge win', style: { marginLeft: '8px' } }, 'active') : null),
          name !== g.profiles.active ? h('button', { class: 'btn small primary', onClick: async () => { await run(() => api.call('profiles:switch', g.id, name)); closeModal(); await refreshGame(); renderPage(); } }, 'Switch') : null,
          h('button', { class: 'btn small', onClick: async () => { const to = await askText(`Rename "${name}"`, '', { value: name, validate: (n) => (n === name ? 'Pick a different name.' : nameProblem(n, g.profiles.names)) }); if (to) { await run(() => api.call('profiles:rename', g.id, name, to), 'Renamed'); manageProfiles(); } } }, 'Rename'),
          h('button', { class: 'btn small', onClick: async () => { const to = await askText(`Duplicate "${name}" as`, '', { value: `${name} copy`, validate: (n) => nameProblem(n, g.profiles.names) }); if (to) { await run(() => api.call('profiles:create', g.id, to, name), 'Profile duplicated'); manageProfiles(); } } }, 'Duplicate'),
          h('button', { class: 'btn small ghost', onClick: () => api.call('profiles:openFolder', g.id, name) }, 'Folder'),
          g.profiles.names.length > 1 ? h('button', { class: 'btn small ghost danger', onClick: async () => { if (await askConfirm(`Delete profile "${name}"?`)) { await run(() => api.call('profiles:delete', g.id, name), 'Profile deleted'); manageProfiles(); } } }, 'Delete') : null),
        g.kind === 'bethesda' ? h('div', { class: 'row wrap', style: { gap: '18px' } },
          h('label', { class: 'row', style: { opacity: virtual ? 1 : 0.5 } }, toggle(o.localInis, async (v) => { await run(() => api.call('profiles:options', g.id, name, { localInis: v })); }, virtual ? '' : 'Virtual mode only'), h('span', { class: 'small' }, 'Profile-specific INI files')),
          h('label', { class: 'row', style: { opacity: virtual ? 1 : 0.5 } }, toggle(o.localSaves, async (v) => { await run(() => api.call('profiles:options', g.id, name, { localSaves: v })); }, virtual ? '' : 'Virtual mode only'), h('span', { class: 'small' }, 'Profile-specific save games'))) : null);
    }),
  );
  showModal(`Profiles · ${g.short} · instance ${g.instances.active}`, body);
  if (!virtual) body.querySelectorAll('.toggle input').forEach((i) => { i.disabled = true; });
  refreshGame();
}

// In-app dialogs. Native await askConfirm()/prompt() are avoided: in Electron on Windows a native dialog
// can leave the page unable to take keyboard focus, so later text boxes ignore typing.
function dialog(title, body, buttons, { width = '440px', onKey } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    let back;
    const done = (value) => { back.remove(); document.removeEventListener('keydown', key, true); prevFocus?.focus?.(); resolve(value); };
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      else if (onKey) onKey(e, done);
    };
    back = h('div', { class: 'modal-back', onMousedown: (e) => e.target === back && done(null) },
      h('div', { class: 'modal', style: { width } },
        h('header', {}, title),
        h('div', { class: 'mbody' }, body),
        h('footer', {}, buttons(done))));
    document.addEventListener('keydown', key, true);
    document.body.append(back);
    setTimeout(() => (back.querySelector('input:not([type=radio]), textarea') || back.querySelector('.btn.primary'))?.focus(), 30);
  });
}

function askConfirm(message, { title = 'Please confirm', ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return dialog(title, h('div', { style: { whiteSpace: 'pre-line', lineHeight: 1.5 } }, message), (done) => [
    h('button', { class: 'btn ghost', onClick: () => done(false) }, cancel),
    h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onClick: () => done(true) }, ok),
  ]).then((v) => v === true);
}

const BAD_NAME = /[<>:"/\\|?*\x00-\x1f]/;
function nameProblem(name, taken = []) {
  if (!name) return 'Type a name first.';
  if (BAD_NAME.test(name)) return 'Names cannot contain < > : " / \\ | ? *';
  if (name.length > 60) return 'Keep the name under 60 characters.';
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) return 'That name is already used.';
  return null;
}

// window.prompt() is not available in Electron, so ask for text with a small modal.
function askText(title, placeholder = '', { value = '', validate } = {}) {
  const input = h('input', { class: 'input', placeholder, value, style: { width: '100%' } });
  const err = h('div', { class: 'small', style: { color: 'var(--err)', minHeight: '18px', marginTop: '6px' } });
  const submit = (done) => {
    const v = input.value.trim();
    const problem = validate ? validate(v) : v ? null : 'Type something first.';
    if (problem) { err.textContent = problem; input.focus(); return; }
    done(v);
  };
  input.addEventListener('input', () => { err.textContent = ''; });
  return dialog(title, h('div', {}, input, err), (done) => [
    h('button', { class: 'btn ghost', onClick: () => done(null) }, 'Cancel'),
    h('button', { class: 'btn primary', onClick: () => submit(done) }, 'OK'),
  ], { onKey: (e, done) => { if (e.key === 'Enter') { e.preventDefault(); submit(done); } } });
}

// New instance: name + start empty or as a copy, in one dialog.
function askNewInstance(g) {
  const input = h('input', { class: 'input', placeholder: 'e.g. Survival build, Testing', style: { width: '100%' } });
  const err = h('div', { class: 'small', style: { color: 'var(--err)', minHeight: '18px', marginTop: '6px' } });
  const radio = (value, label, sub, checked) => h('label', { class: 'row', style: { gap: '10px', alignItems: 'flex-start', padding: '8px 0', cursor: 'pointer' } },
    h('input', { type: 'radio', name: 'instCopy', value, checked }), h('div', {}, h('div', { class: 'name' }, label), h('div', { class: 'faint small' }, sub)));
  const body = h('div', {},
    h('p', { class: 'muted small', style: { marginTop: 0 } }, `An instance is a completely separate mod setup for ${g.short}: its own mods and its own profiles.`),
    input, err,
    radio('empty', 'Start empty', 'No mods yet. Good for a fresh build.', true),
    radio('copy', `Copy "${g.instances.active}"`, 'Same mods, profiles and load order to start from (uses extra disk space).', false));
  const submit = (done) => {
    const name = input.value.trim();
    const problem = nameProblem(name, g.instances.list);
    if (problem) { err.textContent = problem; input.focus(); return; }
    done({ name, copy: body.querySelector('input[name=instCopy]:checked').value === 'copy' });
  };
  input.addEventListener('input', () => { err.textContent = ''; });
  return dialog('New instance', body, (done) => [
    h('button', { class: 'btn ghost', onClick: () => done(null) }, 'Cancel'),
    h('button', { class: 'btn primary', onClick: () => submit(done) }, 'Create instance'),
  ], { width: '480px', onKey: (e, done) => { if (e.key === 'Enter') { e.preventDefault(); submit(done); } } });
}

// Drag & drop install (archives) or attach (images on the AI page).
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  dragDepth++;
  $('#dropOverlay').textContent = state.page === 'ai' ? 'Drop screenshots to attach' : `Drop to install into ${game().short}`;
  $('#dropOverlay').classList.add('show');
});
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.remove('show'); } });
window.addEventListener('dragover', (e) => e.dataTransfer.types.includes('Files') && e.preventDefault());
window.addEventListener('drop', async (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').classList.remove('show');
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  const images = paths.filter((p) => /\.(png|jpe?g|bmp)$/i.test(p));
  const others = paths.filter((p) => !/\.(png|jpe?g|bmp)$/i.test(p));
  if (images.length) {
    const chat = chatFor(state.gameId);
    chat.attachments.push(...(await run(() => api.call('screenshot:fromPaths', images))));
    if (state.page !== 'ai') go('ai');
    else chatDom?.drawAttachments();
  }
  if (others.length) handleInstallResults(await run(() => api.call('mods:installPaths', state.gameId, others)));
});

api.onToast(({ kind, text }) => toast(text, kind === 'error' ? 'error' : 'info', 8000));
api.onDeployProgress((p) => {
  const btn = $('#deployBtn');
  if (btn.disabled && p.total) btn.textContent = `Deploying ${Math.round((100 * p.done) / p.total)}%`;
});
api.onDownload((d) => {
  state.downloads.set(d.id, d);
  if (d.status !== 'downloading') setTimeout(() => state.downloads.delete(d.id), 3000);
  if (state.page === 'downloads') {
    const row = document.querySelector(`[data-dl="${d.id}"]`);
    if (row && d.status === 'downloading') {
      row.querySelector('.progress > div').style.width = d.total ? `${(100 * d.received) / d.total}%` : '30%';
      row.querySelector('.dl-size').textContent = d.total ? `${fmtBytes(d.received)} / ${fmtBytes(d.total)}` : fmtBytes(d.received);
    } else {
      clearTimeout(window.dlRenderTimer);
      window.dlRenderTimer = setTimeout(renderPage, 300);
    }
  }
  renderSidebar();
});
api.onNxmInstalled(({ gameId, result }) => {
  if (gameId !== state.gameId) selectGame(gameId);
  handleInstallResults([result]);
});
api.onScreenshot((shot) => {
  chatFor(state.gameId).attachments.push(shot);
  toast('Screenshot captured and attached to the AI chat.', 'success');
  if (state.page === 'ai') chatDom?.drawAttachments();
});

// ---------- updates, errors, keyboard ----------
function showUpdate(u) {
  const pill = h('button', { class: 'btn small primary', title: `Shuriken ${u.version} is available`, onClick: () => api.call('shell:open', u.url) }, `Update to ${u.version}`);
  document.querySelector('#updateSlot')?.replaceChildren(pill);
  toast(`Shuriken ${u.version} is available. Click "Update" in the top bar to download it.`, 'info', 9000);
}

window.addEventListener('error', (e) => api.call('log:error', 'window', e.error?.stack || e.message).catch(() => {}));
window.addEventListener('unhandledrejection', (e) => api.call('log:error', 'promise', e.reason?.stack || String(e.reason)).catch(() => {}));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.lightbox')) document.querySelector('.lightbox').remove();
    else if (currentModal) closeModal();
    return;
  }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f' && state.page === 'mods') {
    e.preventDefault();
    document.querySelector('#modFilter')?.focus();
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    document.querySelector('#deployBtn')?.click();
  }
  if (e.key === 'F5') {
    e.preventDefault();
    refreshGame().then(renderPage);
  }
});

// ---------- boot ----------
(async function boot() {
  const init = await api.call('app:init');
  state.games = init.games;
  state.settings = init.settings;
  state.keys = init.keys;
  state.cloudProviders = await api.call('cloud:providers').catch(() => []);
  $('#foot').textContent = `Shuriken v${init.version} · ${state.games.filter((g) => g.installDir).length} games found`;
  $('#brandLogo').replaceWith(logo('logo'));
  $('#libraryLink').addEventListener('click', () => go('library'));
  const saved = localStorage.getItem('shuriken.game');
  const mine = managedGames();
  state.gameId = mine.find((g) => g.id === saved)?.id || mine.find((g) => g.installDir)?.id || mine[0]?.id || state.games[0].id;
  const lastPage = localStorage.getItem('shuriken.page');
  const lp = PAGES.find((p) => p.id === lastPage);
  if (lp && !pageHidden(lp, game())) state.page = lastPage;
  renderChrome();
  renderPage();
  setTimeout(() => api.call('app:checkUpdate').then((u) => u && showUpdate(u)).catch(() => {}), 4000);
})();
