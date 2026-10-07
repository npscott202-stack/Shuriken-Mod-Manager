// Cloud AI providers that speak the OpenAI chat API. Several have free tiers (Gemini, Groq,
// OpenRouter free models, Cerebras); OpenAI and Mistral are pay-as-you-go. Claude has its own
// path in ai.js. The user brings their own key; models are listed live from the provider.
const store = require('./store');
const { streamChat } = require('./oaistream');

// version number inside a model id, for "newest first" ordering (gemini-3.5-flash > gemini-3-flash)
const ver = (id) => {
  const m = String(id).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
};
const newest = (ids, re, not) => ids.filter((id) => re.test(id) && !(not && not.test(id))).sort((a, b) => ver(b) - ver(a) || a.length - b.length)[0];

const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    tag: 'free tier',
    about: 'Free API key from Google AI Studio. Strong, sees screenshots, huge context. Best free choice.',
    keyName: 'geminiApiKey',
    keyUrl: 'https://aistudio.google.com/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    cleanId: (id) => id.replace(/^models\//, ''),
    filter: (m) => /gemini|gemma/i.test(m.id) && !/embed|tts|image|veo|imagen|audio|live|aqa/i.test(m.id),
    pick: (ids) => newest(ids, /gemini-[\d.]+-flash/, /lite|preview|exp|thinking|image/) || newest(ids, /gemini-[\d.]+-flash/) || newest(ids, /gemini/),
    vision: () => true,
  },
  groq: {
    label: 'Groq',
    tag: 'free tier',
    about: 'Free key. Extremely fast open models (GPT-OSS, Llama, Qwen). Daily limits apply.',
    keyName: 'groqApiKey',
    keyUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    filter: (m) => !/whisper|tts|guard|playai|orpheus|prompt-guard|compound/i.test(m.id),
    pick: (ids) => newest(ids, /gpt-oss-120b/) || newest(ids, /llama-4|maverick|scout/) || newest(ids, /qwen/) || ids[0],
    vision: (id) => /llama-4|scout|maverick|vision/i.test(id),
  },
  openrouter: {
    label: 'OpenRouter',
    tag: 'free models',
    about: 'One key for hundreds of models; the ":free" ones cost nothing (about 50 requests a day).',
    keyName: 'openrouterApiKey',
    keyUrl: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    headers: { 'HTTP-Referer': 'https://github.com/npscott202-stack/Shuriken-Mod-Manager', 'X-Title': 'Shuriken' },
    // Free models that can call tools first.
    filter: (m) => !m.supported_parameters || m.supported_parameters.includes('tools'),
    order: (m) => (/:free$/.test(m.id) ? 0 : 1),
    pick: (ids) => newest(ids, /:free$/) || ids[0],
    vision: (id, m) => !m || (m.architecture?.input_modalities || []).includes('image'),
    note: (id) => (/:free$/.test(id) ? 'free' : 'paid'),
  },
  cerebras: {
    label: 'Cerebras',
    tag: 'free tier',
    about: 'Free key. Very fast open models (GPT-OSS, Qwen, Llama). Text only.',
    keyName: 'cerebrasApiKey',
    keyUrl: 'https://cloud.cerebras.ai/',
    baseUrl: 'https://api.cerebras.ai/v1',
    pick: (ids) => newest(ids, /gpt-oss-120b/) || newest(ids, /qwen/) || newest(ids, /llama/) || ids[0],
    vision: () => false,
  },
  mistral: {
    label: 'Mistral',
    tag: 'free tier',
    about: 'Free "Experiment" plan (phone verification). Good all-round models.',
    keyName: 'mistralApiKey',
    keyUrl: 'https://console.mistral.ai/api-keys',
    baseUrl: 'https://api.mistral.ai/v1',
    filter: (m) => !/embed|moderation|ocr|transcribe|voxtral/i.test(m.id),
    pick: (ids) => newest(ids, /mistral-medium-latest/) || newest(ids, /mistral-large-latest/) || newest(ids, /mistral-small-latest/) || ids[0],
    vision: (id) => /medium|large|small|pixtral/i.test(id),
  },
  openai: {
    label: 'OpenAI (GPT)',
    tag: 'paid',
    about: 'Pay-as-you-go API key from platform.openai.com (a ChatGPT subscription does not include API use).',
    keyName: 'openaiApiKey',
    keyUrl: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    filter: (m) => /^(gpt|o\d|chatgpt)/i.test(m.id) && !/audio|realtime|transcribe|tts|image|search|instruct|embedding/i.test(m.id),
    pick: (ids) => newest(ids, /^gpt-[\d.]+$/) || newest(ids, /^gpt-[\d.]+-mini$/) || newest(ids, /^gpt/) || ids[0],
    vision: () => true,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    tag: 'any',
    about: 'Any OpenAI-compatible server: LM Studio, Ollama, vLLM, NVIDIA NIM, another cloud. Enter its base URL.',
    keyName: 'customApiKey',
    keyOptional: true,
    pick: (ids) => ids[0],
    vision: () => true,
  },
};

function settings() {
  return store.load('settings', {});
}

function baseUrl(id) {
  if (id === 'custom') {
    const u = String(settings().customBaseUrl || '').trim().replace(/\/+$/, '');
    if (!u) throw new Error('Enter the custom server address in Settings → AI assistant (e.g. http://localhost:1234/v1).');
    return u;
  }
  return PROVIDERS[id].baseUrl;
}

function auth(id) {
  const p = PROVIDERS[id];
  const key = store.getSecret(p.keyName);
  if (!key && !p.keyOptional) throw new Error(`Add your ${p.label} API key in Settings → AI assistant (${p.keyUrl}).`);
  return { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(p.headers || {}) };
}

const modelCache = new Map(); // provider -> { at, list }

async function listModels(id, { refresh = false } = {}) {
  const p = PROVIDERS[id];
  if (!p) throw new Error('Unknown AI provider');
  const c = modelCache.get(id);
  if (c && !refresh && Date.now() - c.at < 30 * 60000) return c.list;
  const res = await fetch(`${baseUrl(id)}/models`, { headers: auth(id), signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${p.label}: ${res.status === 401 || res.status === 403 ? 'the API key was rejected' : `HTTP ${res.status}`}`);
  const json = await res.json();
  const raw = (json.data || json.models || []).map((m) => ({ ...m, id: (p.cleanId || ((x) => x))(m.id || m.name) }));
  let list = raw.filter((m) => m.id && (!p.filter || p.filter(m)));
  if (p.order) list.sort((a, b) => p.order(a) - p.order(b) || a.id.localeCompare(b.id));
  else list.sort((a, b) => a.id.localeCompare(b.id));
  list = list.map((m) => ({ id: m.id, name: m.name && m.name !== m.id ? m.name : null, note: p.note ? p.note(m.id) : null, vision: p.vision(m.id, m), context: m.context_length || null }));
  modelCache.set(id, { at: Date.now(), list });
  return list;
}

// The model to use: the user's pick, else the provider's best default from its live list.
async function resolveModel(id) {
  const chosen = settings().cloudModels?.[id];
  if (chosen) return chosen;
  const list = await listModels(id);
  if (!list.length) throw new Error(`${PROVIDERS[id].label} returned no usable models for this key.`);
  return PROVIDERS[id].pick(list.map((m) => m.id)) || list[0].id;
}

function friendly(id, e) {
  const label = PROVIDERS[id]?.label || 'AI';
  if (e.status === 401 || e.status === 403) return new Error(`${label} rejected the API key. Check it in Settings → AI assistant.`);
  if (e.status === 429) return new Error(`${label} free-tier limit reached for now. Wait a minute (or until tomorrow for daily limits), pick another model, or switch provider in Settings.`);
  if (e.status === 404) return new Error(`${label} does not have that model any more. Pick another one in Settings → AI assistant.`);
  if (e.status === 400 && /image|vision|multimodal/i.test(e.message)) return new Error(`This ${label} model cannot read screenshots. Pick a vision model in Settings, or send text only.`);
  return e;
}

async function chatTurn({ provider, model, messages, tools, signal }, onEvent) {
  return streamChat({
    url: `${baseUrl(provider)}/chat/completions`,
    headers: auth(provider),
    body: { model, messages, tools: tools?.length ? tools : undefined, temperature: 0.4, max_tokens: 8192 },
    signal,
    onEvent,
    label: PROVIDERS[provider].label,
    mapError: (e) => friendly(provider, e),
  });
}

async function test(id) {
  const model = await resolveModel(id);
  const msg = await chatTurn({ provider: id, model, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }, () => {});
  return { model, reply: msg.content.trim().slice(0, 80) };
}

function publicList() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, tag: p.tag, about: p.about, keyUrl: p.keyUrl || null, keyOptional: !!p.keyOptional, hasKey: !!store.getSecret(p.keyName) }));
}

module.exports = { PROVIDERS, listModels, resolveModel, chatTurn, test, publicList, keyNames: Object.values(PROVIDERS).map((p) => p.keyName) };
