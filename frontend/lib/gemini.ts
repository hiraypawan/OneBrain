// Pure chat-brain helpers: no Next.js imports, so they run anywhere (and in tests).
export const SYSTEM =
  'You are OneBrain, the personal voice assistant living in the user earbuds. ' +
  'Reply in the user language (English, Hindi, Hinglish, Marathi, or any language they speak). ' +
  'Answer the actual question FIRST, directly and briefly: no lectures, no moralizing, ' +
  'no asking for details you can work around. At most ONE short follow-up question, ' +
  'only if you truly cannot answer without it. Never ask about the user other ' +
  'conversations, contacts, calls, or personal matters. If the user corrects you ' +
  '(wrong name, wrong word, "I never said that"), accept it immediately with at most ' +
  'five words of apology and move on — never argue, never re-ask what they denied. ' +
  'If the user already gave specifics (a name, season, place, number), answer ' +
  'from context and available knowledge — never stonewall by asking for what ' +
  'they just provided. ' +
  'If asked who you are, say you are ' +
  'OneBrain in one line. In urgent or scary situations (police, hospital, danger): ' +
  'give immediate practical steps first, never ask questions, stay calm and concrete. ' +
  'Plain sentences only: no emojis, no markdown, no bullet symbols, no asterisks ' +
  '- answers are read aloud by a speech engine. Keep under 200 words for voice. ' +
  'After your reply, add a line with exactly ---EN--- then a short English version ' +
  '(skip the English part if you already replied in English).';

// Fresh clock on every request, so "India me time kya hai" and date/maths
// questions are answered from reality, not the model's training cutoff.
export function buildSystem(now: Date = new Date()): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-IN', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now);
  return (
    `${SYSTEM} Current time: ${fmt('Asia/Kolkata')} IST (India) | ${fmt('UTC')} UTC. ` +
    'Answer time/date questions from this clock. Do maths step by step and say the final answer clearly.'
  );
}

export interface ChatHistory {
  role: string;
  content: string;
}

// Verbosity setting -> output token budget (actually honored, unlike before).
export function verbosityBudget(v?: string): number {
  if (v === 'long') return 1000;
  if (v === 'medium') return 600;
  return 300;
}

export async function askGemini(
  apiKey: string,
  message: string,
  history: ChatHistory[],
  opts?: { system?: string; maxTokens?: number }
): Promise<{ text?: string; error?: string }> {
  const contents = [
    ...(history || []).slice(-10).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];
  // Try newest model first, fall back to older ones (availability varies by key/region).
  // Every failure is recorded so the caller can show WHY nothing answered.
  // NOTE: Google retires model names regularly — the API error itself tells us
  // the current name, so keep this list fresh when key-error messages say so.
  const errors: string[] = [];
  const MODELS = [
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-1.5-flash',
  ];
  for (const model of MODELS) {
    let status = 0;
    let detail = '';
    // Attempt 1 disables thinking (fast, complete voice replies). If the model
    // rejects that field, attempt 2 retries the same model without it.
    for (const useThinking of [true, false]) {
      try {
        const generationConfig: any = { maxOutputTokens: opts?.maxTokens || 600, temperature: 0.5 };
        if (useThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: opts?.system || SYSTEM }] },
              contents,
              generationConfig,
            }),
          }
        );
        if (r.ok) {
          const j = await r.json();
          const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('');
          if (text) return { text };
          status = 200;
          detail =
            j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || 'empty response';
          break;
        }
        try {
          const j = await r.json();
          detail = j?.error?.message || '';
        } catch {}
        status = r.status;
        if (useThinking && r.status === 400 && /invalid argument/i.test(detail)) continue;
        break;
      } catch (e: any) {
        status = -1;
        detail = e?.message || 'network error';
        break;
      }
    }
    errors.push(`${model}: ${detail || `HTTP ${status}`}`);
    // Bad key / no access: other models will fail the same way, stop here.
    // (A 400 does NOT always mean a bad key — retired model names also 400 —
    // so only stop on 400 when the message blames the key itself.)
    if (status === 401 || status === 403) break;
    if (status === 400 && /api key/i.test(detail)) break;
  }
  return { error: errors.join(' | ') || 'no model answered' };
}

// Fold system + history + message into ONE plain user message.
// The keyless endpoint only accepts the bare shape reliably (extra fields
// like temperature or system roles get rejected), so everything goes inline.
export function foldPrompt(message: string, history: ChatHistory[], system?: string): string {
  const lines = [system || SYSTEM];
  for (const m of (history || []).slice(-6)) {
    lines.push(`${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`);
  }
  lines.push(`User: ${message}`);
  lines.push('Assistant:');
  return lines.join('\n');
}

// Keyless fallback: free community API, no signup, no key. Quality varies and
// it can be slow or rate-limited — but it means the app answers out of the box.
export async function askPollinations(
  message: string,
  history: ChatHistory[],
  system?: string
): Promise<{ text?: string; error?: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const r = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: 'openai-fast',
        messages: [{ role: 'user', content: foldPrompt(message, history, system) }],
      }),
    });
    clearTimeout(timer);
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const text = (await r.text()).trim();
    return text ? { text } : { error: 'empty response' };
  } catch (e: any) {
    return { error: e?.name === 'AbortError' ? 'timed out' : e?.message || 'network error' };
  }
}

export function fallback(message: string): string {
  const m = (message || '').toLowerCase();
  if (m.includes('train')) return 'Next train 6:42 PM, platform 2.';
  if (m.includes('hello') || m.includes('namaste') || m.includes('हेलो') || m.includes('नमस्ते'))
    return 'Namaste! Main sun raha hoon, boliye?';
  return `Samajh gaya: "${message}". (Add a free Gemini key in Settings → AI key for full answers.)`;
}
