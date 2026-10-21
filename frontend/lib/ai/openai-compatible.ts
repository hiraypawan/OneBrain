import type { ChatHistory } from './gemini';

// User-supplied key on any OpenAI-compatible endpoint (OpenRouter free
// models, DeepSeek with the user's own key, any self-hosted gateway).
// Operator cost stays $0: the key and quota belong to the user, exactly like
// the Gemini lane. Everything is guarded — any failure returns an error and
// the caller falls through to the next provider.

export const OPENAI_PRESETS = [
  { id: 'openrouter', label: 'OpenRouter (free models)', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'deepseek', label: 'DeepSeek (your own key)', baseUrl: 'https://api.deepseek.com' },
  { id: 'custom', label: 'Custom endpoint', baseUrl: '' },
] as const;

/** Public https endpoints only — never localhost, bare IPs, creds or odd ports. */
export function sanitizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/\/+$/, '');
  if (!t || t.length > 120) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && !['443'].includes(u.port)) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.')) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  // No literal IPs, loopback, private ranges or cloud metadata (SSRF guard —
  // the server fetches this URL, so internal targets are refused outright).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(host)) return null;
  const m172 = host.match(/^172\.(1[6-9]|2\d|3[01])\./);
  if (m172) return null;
  if (host === '[::1]' || host === '::1') return null;
  return u.toString().replace(/\/+$/, '');
}

export function sanitizeModel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t || t.length > 120 || /[\s<>]/.test(t)) return null;
  return t;
}

export async function askOpenAICompatible(
  opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    message: string;
    history?: ChatHistory[];
    system?: string;
    maxTokens?: number;
  },
): Promise<{ text?: string; error?: string }> {
  const base = sanitizeBaseUrl(opts.baseUrl);
  const model = sanitizeModel(opts.model);
  const key = typeof opts.apiKey === 'string' ? opts.apiKey.trim() : '';
  if (!base) return { error: 'invalid endpoint URL (https only)' };
  if (!model) return { error: 'invalid model name' };
  if (!key || key.length > 512) return { error: 'invalid API key' };
  const messages: { role: string; content: string }[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  for (const m of (opts.history || []).slice(-20)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    messages.push({ role: m.role, content: m.content.slice(0, 8000) });
  }
  messages.push({ role: 'user', content: String(opts.message || '').slice(0, 8000) });
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: Math.min(Math.max(opts.maxTokens || 600, 1), 4000),
        temperature: 0.5,
      }),
    });
    if (!r.ok) {
      let detail = '';
      try {
        const j = await r.json();
        detail = String(j?.error?.message || j?.error || '').slice(0, 220);
      } catch { /* non-JSON error body */ }
      return { error: detail ? `HTTP ${r.status}: ${detail}` : `HTTP ${r.status}` };
    }
    const j = await r.json();
    const text = String(j?.choices?.[0]?.message?.content || '').trim();
    return text ? { text } : { error: 'empty response' };
  } catch (e: any) {
    return { error: ['AbortError', 'TimeoutError'].includes(e?.name) ? 'timed out' : e?.message || 'network error' };
  }
}
