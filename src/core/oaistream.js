// Streaming client for OpenAI-compatible chat APIs: the built-in engine (llama-server) and cloud
// providers (Gemini, Groq, OpenRouter, Cerebras, Mistral, OpenAI, custom). Collects text, reasoning
// and tool calls, and stops answers that start repeating themselves.

// True when the newest text is a chunk that already appeared several times in a row.
function looping(text) {
  if (text.length < 240) return false;
  const tail = text.slice(-60);
  let count = 0;
  let from = text.length - 60;
  const window = Math.max(0, text.length - 1500);
  while ((from = text.lastIndexOf(tail, from - 1)) >= window) count++;
  return count >= 3;
}

// Returns { role: 'assistant', content, tool_calls? }. mapError lets callers turn engine errors
// into friendlier ones.
async function streamChat({ url, headers = {}, body, signal, onEvent, mapError = (e) => e, label = 'AI' }) {
  const ctl = new AbortController();
  const relay = () => ctl.abort();
  signal?.addEventListener('abort', relay);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ...body, stream: true }), signal: ctl.signal });
  } catch (e) {
    signal?.removeEventListener('abort', relay);
    throw mapError(e);
  }
  if (!res.ok) {
    signal?.removeEventListener('abort', relay);
    const text = (await res.text().catch(() => '')).slice(0, 400);
    const err = new Error(`${label} error ${res.status}: ${text}`);
    err.status = res.status;
    throw mapError(err);
  }
  const msg = { role: 'assistant', content: '', tool_calls: [] };
  let buf = '';
  const decoder = new TextDecoder();
  let looped = false;
  try {
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let ev;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (ev.error) throw new Error(ev.error.message || String(ev.error));
        const d = ev.choices?.[0]?.delta || {};
        const reasoning = d.reasoning_content || d.reasoning;
        if (reasoning) onEvent({ type: 'thinking', delta: reasoning });
        if (d.content) {
          msg.content += d.content;
          onEvent({ type: 'text', delta: d.content });
          if (looping(msg.content)) {
            looped = true;
            ctl.abort();
            break;
          }
        }
        for (const tc of d.tool_calls || []) {
          const i = tc.index ?? msg.tool_calls.length;
          const cur = (msg.tool_calls[i] = msg.tool_calls[i] || { id: tc.id || `call_${Date.now()}_${i}`, type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.function.name += tc.function.name;
          if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
          // Gemini sends whole tool calls per chunk and can reuse index 0 for parallel calls.
          if (tc.extra_content) cur.extra_content = tc.extra_content;
        }
      }
      if (looped) break;
    }
  } catch (e) {
    if (!looped) throw mapError(e);
  } finally {
    signal?.removeEventListener('abort', relay);
  }
  if (looped) {
    onEvent({ type: 'text', delta: '\n\n_(stopped: the answer started repeating itself)_' });
    msg.tool_calls = [];
  }
  msg.tool_calls = msg.tool_calls.filter(Boolean);
  if (!msg.tool_calls.length) delete msg.tool_calls;
  return msg;
}

module.exports = { streamChat, looping };
