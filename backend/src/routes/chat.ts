import { Router } from 'express';
import OpenAI from 'openai';
import rateLimit from 'express-rate-limit';
import { optionalAuth } from '../middleware/auth';

const router = Router();
router.use(optionalAuth);

// Stricter than the global limiter: voice chats are small but frequent.
// 30/min per IP stops one user burning the host's free quota.
router.use(rateLimit({ windowMs: 60 * 1000, max: 30 }));

const SYSTEM =
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

function buildSystem(now: Date = new Date()): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-IN', {
      timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(now);
  return (
    `${SYSTEM} Current time: ${fmt('Asia/Kolkata')} IST (India) | ${fmt('UTC')} UTC. ` +
    'Answer time/date questions from this clock. Do maths step by step and say the final answer clearly.'
  );
}

function verbosityBudget(v?: string): number {
  if (v === 'long') return 1000;
  if (v === 'medium') return 600;
  return 300;
}

async function askGemini(
  apiKey: string,
  message: string,
  history: any[],
  opts?: { system?: string; maxTokens?: number }
): Promise<string | null> {
  const contents = [
    ...(history || []).slice(-10).map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];
  // Keep in sync with frontend/lib/gemini.ts (Google retires names regularly).
  // NOTE: frontend copy also retries a model bare when it rejects thinkingConfig;
  // backend keeps the simple path (update here if a model starts 400ing).
  for (const model of ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-1.5-flash']) {
    try {
      const generationConfig: any = { maxOutputTokens: opts?.maxTokens || 600, temperature: 0.5 };
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts?.system || buildSystem() }] },
            contents,
            generationConfig,
          }),
        }
      );
      if (r.ok) {
        const j: any = await r.json();
        const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('');
        if (text) return text;
        continue;
      }
      let detail = '';
      try {
        detail = ((await r.json()) as any)?.error?.message || '';
      } catch {}
      if (r.status === 401 || r.status === 403) break;
      if (r.status === 400 && /api key/i.test(detail)) break;
    } catch {
      break;
    }
  }
  return null;
}

router.post('/', async (req, res) => {
  const { message, history, userKey, profile, recall, verbosity } = req.body;

  // Memory-aware system: clock + verbosity + who they are + relevant past chats.
  const sysParts = [buildSystem()];
  sysParts.push(verbosity === 'long' ? 'Give fuller explanations when asked.' : 'Be concise: short spoken answers.');
  if (profile) sysParts.push(String(profile));
  if (recall) sysParts.push(String(recall));
  const system = sysParts.join('\n\n');
  const maxTokens = verbosityBudget(verbosity);

  // 1. User's own free key (BYOK — infinite scale, zero host cost)
  // 2. Host's Gemini free-tier key  3. Host's OpenAI key
  const geminiKey = userKey || process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const answer = await askGemini(geminiKey, message, history || [], { system, maxTokens });
      if (answer) return res.json({ answer, provider: 'gemini' });
    } catch (e) {
      console.error('Gemini failed:', e);
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const openai = new OpenAI({ apiKey: openaiKey });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: maxTokens,
        temperature: 0.5,
        messages: [
          { role: 'system', content: system },
          ...((history || []).slice(-10) as any),
          { role: 'user', content: message },
        ],
      });
      return res.json({ answer: completion.choices[0].message.content, provider: 'openai' });
    } catch (e) {
      console.error('OpenAI failed:', e);
    }
  }

  // Keyless community API, mirrors frontend/lib/gemini.ts (backend can't import it).
  // Bare shape only: extra fields get rejected by the free tier.
  async function askPollinations(): Promise<string | null> {
    try {
      const lines = [buildSystem()];
      for (const m of (history || []).slice(-6)) {
        lines.push(`${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`);
      }
      lines.push(`User: ${message}`);
      lines.push('Assistant:');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const r = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'openai-fast',
          messages: [{ role: 'user', content: lines.join('\n') }],
        }),
      });
      clearTimeout(timer);
      if (!r.ok) return null;
      return (await r.text()).trim() || null;
    } catch {
      return null;
    }
  }

  // Live facts for factual questions (mirrors frontend/lib/knowledge.ts).
  async function askWikipedia(): Promise<string | null> {
    try {
      const t = String(message || '').trim();
      const factual =
        /^(who|what|when|where|which|list|name|kaun|kya|kab|kahan|current|latest|top\s+\d|aaj|abhi)\b/i.test(t) ||
        /contestants?|winner|capital|population|president|prime minister|score|match|movie|actor|release date|season/i.test(t);
      if (!t || t.length > 220 || !factual) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const api = 'https://en.wikipedia.org/w/api.php';
      const s = await fetch(
        `${api}?action=query&list=search&srsearch=${encodeURIComponent(t)}&srlimit=3&format=json&origin=*`,
        { signal: ctrl.signal }
      );
      if (!s.ok) {
        clearTimeout(timer);
        return null;
      }
      const title = ((await s.json()) as any)?.query?.search?.[0]?.title;
      if (!title) {
        clearTimeout(timer);
        return null;
      }
      const e = await fetch(
        `${api}?action=query&prop=extracts&exintro&explaintext&exsentences=3&titles=${encodeURIComponent(title)}&format=json&origin=*`,
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (!e.ok) return null;
      const pages = ((await e.json()) as any)?.query?.pages || {};
      const text = String((Object.values(pages)[0] as any)?.extract || '')
        .replace(/\[.+?\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 600);
      return text && text.length >= 40 ? text : null;
    } catch {
      return null;
    }
  }

  const wiki = await askWikipedia();
  if (wiki) return res.json({ answer: wiki, provider: 'wikipedia' });

  const free = await askPollinations();
  if (free) return res.json({ answer: free, provider: 'pollinations' });

  res.json({ answer: `Samajh gaya: "${message}". (AI busy hai, thodi der me dobara try karo.)`, provider: 'offline' });
});

router.get('/history/:id', async (_req, res) => res.json({ messages: [] }));
router.post('/summarize', async (_req, res) => res.json({ summary: '' }));

export default router;
