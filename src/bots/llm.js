'use strict';
// Optional local-LLM brain for the chat bots. Ollama-compatible, fails soft.
const config = require('../config');

let reachable = null;
let lastCheck = 0;

async function health() {
  if (reachable != null && Date.now() - lastCheck < 60000) return reachable;
  lastCheck = Date.now();
  try {
    const base = config.get('llm.endpoint').replace(/\/api\/.*$/, '');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(base + '/api/tags', { signal: ctl.signal });
    clearTimeout(t);
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  return reachable;
}

async function chat({ system, messages, maxTokens = 120, temperature = 0.9 }) {
  if (!config.get('llm.enabled')) return null;
  if (!(await health())) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.get('llm.timeoutMs') || 20000);
  try {
    const res = await fetch(config.get('llm.endpoint'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.get('llm.model'),
        stream: false,
        options: { temperature, num_predict: maxTokens },
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.message?.content || data?.response || '';
    return String(text).trim().replace(/^["']|["']$/g, '').slice(0, 500) || null;
  } catch {
    reachable = false;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chat, health };
