import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

// OneBrain API on Cloudflare Workers + D1. Same routes as backend/src,
// ported to the Workers runtime (async D1, WebCrypto JWT, no node APIs).

type Env = {
  DB: D1Database;
  JWT_SECRET?: string;
  FRONTEND_URL?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const allowed = String(c.env.FRONTEND_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length > 1) {
    return cors({ origin: allowed, credentials: true })(c, next);
  }
  if (allowed.length === 1) {
    return cors({ origin: allowed[0], credentials: true })(c, next);
  }
  return cors({ origin: '*' })(c, next);
});

const uid = () => crypto.randomUUID().replace(/-/g, '') + Date.now().toString(36);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function secret(c: any): string {
  if (!c.env.JWT_SECRET) console.warn('[auth] JWT_SECRET unset — dev fallback. Set a real secret.');
  return c.env.JWT_SECRET || 'dev-insecure-secret-change-me';
}

async function signToken(c: any, user: { id: string; email: string }): Promise<string> {
  return new SignJWT({ id: user.id, email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(new TextEncoder().encode(secret(c)));
}

async function requireAuth(c: any, next: any) {
  const token = c.req.header('Authorization')?.split('Bearer ')[1];
  if (!token) return c.json({ error: 'No token' }, 401);
  try {
    c.set('user', (await jwtVerify(token, new TextEncoder().encode(secret(c)))).payload);
    await next();
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
}

async function optionalAuth(c: any, next: any) {
  const token = c.req.header('Authorization')?.split('Bearer ')[1];
  if (token) {
    try {
      c.set('user', (await jwtVerify(token, new TextEncoder().encode(secret(c)))).payload);
      return next();
    } catch {}
  }
  c.set('user', { id: 'local-user', email: null });
  await next();
}

const me = (c: any) => c.get('user').id as string;
const pub = (u: any) => ({
  id: u.id,
  email: u.email,
  displayName: u.display_name,
  settings: JSON.parse(u.settings || '{}'),
});

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'onebrain-api', runtime: 'workers' }));

// ---------------- auth ----------------
app.post('/api/auth/signup', async (c) => {
  const { email, password, displayName } = await c.req.json().catch(() => ({}));
  if (!email || !EMAIL_RE.test(email)) return c.json({ error: 'Valid email required' }, 400);
  if (!password || password.length < 8) return c.json({ error: 'Password must be 8+ characters' }, 400);
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
  if (exists) return c.json({ error: 'Email already registered' }, 409);
  const id = uid();
  const hash = await bcrypt.hash(password, 10);
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, email.toLowerCase(), hash, displayName || email.split('@')[0], '{}', Date.now()).run();
  const user = { id, email: email.toLowerCase() };
  return c.json({ token: await signToken(c, user), user: pub({ ...user, display_name: displayName || email.split('@')[0] }) });
});

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  const u: any = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind((email || '').toLowerCase()).first();
  if (!u?.password_hash || !(await bcrypt.compare(password || '', u.password_hash))) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }
  return c.json({ token: await signToken(c, u), user: pub(u) });
});

app.get('/api/auth/me', requireAuth, async (c) => {
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me(c)).first();
  if (!u) return c.json({ error: 'User not found' }, 404);
  return c.json({ user: pub(u) });
});

app.post('/api/auth/refresh', requireAuth, async (c) => {
  return c.json({ token: await signToken(c, c.get('user')) });
});

app.post('/api/auth/logout', (c) => c.json({ ok: true }));

app.get('/api/auth/config', (c) =>
  c.json({ google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET), smtp: false })
);

app.post('/api/auth/reset-request', async (c) => {
  const { email } = await c.req.json().catch(() => ({}));
  const u: any = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind((email || '').toLowerCase()).first();
  if (!u) return c.json({ ok: true });
  const token = uid() + uid();
  await c.env.DB.prepare('INSERT INTO reset_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)')
    .bind(token, u.id, Date.now() + 3600000).run();
  // No SMTP on Workers free tier without the Email binding: log for the owner.
  console.log(`[auth] password reset for ${u.email}: token ${token}`);
  return c.json({ ok: true, delivered: false });
});

app.post('/api/auth/reset-confirm', async (c) => {
  const { token, password } = await c.req.json().catch(() => ({}));
  if (!password || password.length < 8) return c.json({ error: 'Password must be 8+ characters' }, 400);
  const t: any = await c.env.DB.prepare('SELECT * FROM reset_tokens WHERE token = ?').bind(token || '').first();
  if (!t || t.used || t.expires_at < Date.now()) return c.json({ error: 'Invalid or expired token' }, 400);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await bcrypt.hash(password, 10), t.user_id).run();
  await c.env.DB.prepare('UPDATE reset_tokens SET used = 1 WHERE token = ?').bind(token).run();
  return c.json({ ok: true });
});

app.get('/api/auth/google', (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: 'Google login not configured' }, 501);
  const redirect = c.env.GOOGLE_REDIRECT || `${new URL(c.req.url).origin}/api/auth/google/callback`;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID, redirect_uri: redirect,
    response_type: 'code', scope: 'openid email profile',
  });
  return c.redirect(url);
});

app.get('/api/auth/google/callback', async (c) => {
  try {
    if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return c.json({ error: 'Google login not configured' }, 501);
    const redirect = c.env.GOOGLE_REDIRECT || `${new URL(c.req.url).origin}/api/auth/google/callback`;
    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(c.req.query('code') || ''), client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code',
      }),
    });
    const tok: any = await tokRes.json();
    if (!tok.access_token) throw new Error('exchange failed');
    const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const g: any = await meRes.json();
    if (!g.email) throw new Error('no email');
    let u: any = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(String(g.email).toLowerCase()).first();
    if (!u) {
      const id = uid();
      await c.env.DB.prepare(
        'INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, String(g.email).toLowerCase(), '', g.name || g.email, '{}', Date.now()).run();
      u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    }
    const token = await signToken(c, u);
    return c.redirect(`${c.env.FRONTEND_URL || 'https://onebrain.pages.dev'}/auth/callback?token=${token}`);
  } catch (e) {
    console.error('google oauth failed:', e);
    return c.json({ error: 'Google login failed' }, 502);
  }
});

// ---------------- chat brain (mirrors frontend/lib/gemini.ts) ----------------
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
  'If asked who you are, say you are OneBrain in one line. ' +
  'In urgent or scary situations (police, hospital, danger): give immediate practical ' +
  'steps first, never ask questions, stay calm and concrete. ' +
  'Plain sentences only: no emojis, no markdown, no bullet symbols, no asterisks ' +
  '- answers are read aloud by a speech engine. Keep under 200 words for voice. ' +
  'After your reply, add a line with exactly ---EN--- then a short English version ' +
  '(skip the English part if you already replied in English).';

function vBudget(v?: string): number {
  return v === 'long' ? 1000 : v === 'medium' ? 600 : 300;
}

async function askGemini(apiKey: string, message: string, history: any[], system: string, maxTokens: number): Promise<{ text?: string; error?: string }> {
  const contents = [
    ...(history || []).slice(-10).map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];
  const errors: string[] = [];
  for (const model of ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-1.5-flash']) {
    let status = 0;
    let detail = '';
    for (const useThinking of [true, false]) {
      try {
        const generationConfig: any = { maxOutputTokens: maxTokens, temperature: 0.5 };
        if (useThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig }),
          }
        );
        if (r.ok) {
          const j: any = await r.json();
          const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('');
          if (text) return { text };
          status = 200;
          detail = j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || 'empty response';
          break;
        }
        try {
          detail = ((await r.json()) as any)?.error?.message || '';
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
    if (status === 401 || status === 403) break;
    if (status === 400 && /api key/i.test(detail)) break;
  }
  return { error: errors.join(' | ') || 'no model answered' };
}

async function askWikipedia(message: string): Promise<string | null> {  try {
    const t = String(message || '').trim();
    const factual =
      /^(who|what|when|where|which|list|name|kaun|kya|kab|kahan|current|latest|top\s+\d|aaj|abhi)\b/i.test(t) ||
      /contestants?|winner|capital|population|president|prime minister|score|match|movie|actor|release date|season/i.test(t);
    if (!t || t.length > 220 || !factual) return null;
    const api = 'https://en.wikipedia.org/w/api.php';
    const s = await fetch(`${api}?action=query&list=search&srsearch=${encodeURIComponent(t)}&srlimit=3&format=json&origin=*`);
    if (!s.ok) return null;
    const title = ((await s.json()) as any)?.query?.search?.[0]?.title;
    if (!title) return null;
    const e = await fetch(`${api}?action=query&prop=extracts&exintro&explaintext&exsentences=3&titles=${encodeURIComponent(title)}&format=json&origin=*`);
    if (!e.ok) return null;
    const pages = ((await e.json()) as any)?.query?.pages || {};
    const text = String((Object.values(pages)[0] as any)?.extract || '')
      .replace(/\[.+?\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 600);
    return text && text.length >= 40 ? text : null;
  } catch {
    return null;
  }
}

async function askPollinations(message: string, history: any[], system: string): Promise<string | null> {
  try {
    const lines = [system];
    for (const m of (history || []).slice(-6)) {
      lines.push(`${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`);
    }
    lines.push(`User: ${message}`);
    lines.push('Assistant:');
    const r = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai-fast', messages: [{ role: 'user', content: lines.join('\n') }] }),
    });
    if (!r.ok) return null;
    return (await r.text()).trim() || null;
  } catch {
    return null;
  }
}

app.post('/api/chat', optionalAuth, async (c) => {
  const { message, history, userKey, profile, recall, verbosity } = await c.req.json().catch(() => ({}));
  const sysParts = [SYSTEM + ' ' + new Date().toISOString()];
  sysParts.push(verbosity === 'long' ? 'Give fuller explanations when asked.' : 'Be concise: short spoken answers.');
  if (profile) sysParts.push(String(profile));
  if (recall) sysParts.push(String(recall));
  const system = sysParts.join('\n\n');
  const maxTokens = vBudget(verbosity);

  const geminiKey = userKey || c.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const res = await askGemini(geminiKey, message, history || [], system, maxTokens);
      if (res.text) return c.json({ answer: res.text, provider: 'gemini' });
    } catch (e) {
      console.error('Gemini failed:', e);
    }
  }
  const openaiKey = c.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini', max_tokens: maxTokens, temperature: 0.5,
          messages: [{ role: 'system', content: system }, ...((history || []).slice(-10)), { role: 'user', content: message }],
        }),
      });
      const j: any = await r.json();
      if (j.choices?.[0]?.message?.content) return c.json({ answer: j.choices[0].message.content, provider: 'openai' });
    } catch (e) {
      console.error('OpenAI failed:', e);
    }
  }
  const wikiAns = await askWikipedia(message);
  if (wikiAns) return c.json({ answer: wikiAns, provider: 'wikipedia' });
  const free = await askPollinations(message, history || [], system);
  if (free) return c.json({ answer: free, provider: 'pollinations' });
  return c.json({ answer: `Samajh gaya: "${message}". (AI busy hai, thodi der me dobara try karo.)`, provider: 'offline' });
});

app.get('/api/chat/history/:id', optionalAuth, async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100'
  ).bind(c.req.param('id')).all();
  return c.json({ messages: rows.results || [] });
});

// ---------------- speech ----------------
app.post('/api/speech/stt', optionalAuth, async (c) => {
  return c.json({ transcript: '', note: 'Client uses on-device Web Speech API; Whisper needs OPENAI_API_KEY + multipart wiring.' });
});

app.post('/api/speech/tts', optionalAuth, async (c) => {
  const { text } = await c.req.json().catch(() => ({}));
  const key = c.env.ELEVENLABS_API_KEY;
  if (!key || !text) return c.json({ fallback: true });
  const voiceId = c.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
    body: JSON.stringify({ text: String(text).slice(0, 1000), model_id: 'eleven_monolingual_v1' }),
  });
  if (!r.ok) return c.json({ fallback: true }, 502);
  return new Response(await r.arrayBuffer(), { headers: { 'Content-Type': 'audio/mpeg' } });
});

// ---------------- memory ----------------
app.get('/api/memory', requireAuth, async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM user_memory WHERE user_id = ? ORDER BY created_at DESC LIMIT 500').bind(me(c)).all();
  return c.json({ memories: rows.results || [] });
});

app.post('/api/memory/save', requireAuth, async (c) => {
  const { memory_type, key, value, confidence } = await c.req.json().catch(() => ({}));
  const id = uid();
  await c.env.DB.prepare(
    'INSERT INTO user_memory (id, user_id, memory_type, key, value, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, me(c), String(memory_type || 'fact'), String(key || ''), JSON.stringify(value ?? null), Number(confidence) || 0.5, Date.now()).run();
  return c.json({ ok: true, id });
});

app.get('/api/memory/search', requireAuth, async (c) => {
  const q = `%${String(c.req.query('q') || '').slice(0, 100)}%`;
  const rows = await c.env.DB.prepare(
    'SELECT * FROM user_memory WHERE user_id = ? AND (key LIKE ? OR value LIKE ?) ORDER BY created_at DESC LIMIT 100'
  ).bind(me(c), q, q).all();
  return c.json({ memories: rows.results || [] });
});

app.delete('/api/memory/clear-all', requireAuth, async (c) => {
  await c.env.DB.prepare('DELETE FROM user_memory WHERE user_id = ?').bind(me(c)).run();
  return c.json({ ok: true });
});

app.delete('/api/memory/:id', requireAuth, async (c) => {
  await c.env.DB.prepare('DELETE FROM user_memory WHERE id = ? AND user_id = ?').bind(c.req.param('id'), me(c)).run();
  return c.json({ ok: true });
});

// ---------------- conversations ----------------
app.get('/api/conversations', requireAuth, async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(me(c)).all();
  return c.json({ conversations: rows.results || [] });
});

app.post('/api/conversations', requireAuth, async (c) => {
  const { id, title } = await c.req.json().catch(() => ({}));
  const cid = id || uid();
  await c.env.DB.prepare('INSERT OR IGNORE INTO conversations (id, user_id, title, created_at) VALUES (?, ?, ?, ?)')
    .bind(cid, me(c), title || 'Conversation', Date.now()).run();
  return c.json({ conversation: await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(cid).first() });
});

app.get('/api/conversations/:id', requireAuth, async (c) => {
  const conv = await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').bind(c.req.param('id'), me(c)).first();
  if (!conv) return c.json({ error: 'Not found' }, 404);
  const msgs = await c.env.DB.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').bind(c.req.param('id')).all();
  return c.json({ conversation: conv, messages: msgs.results || [] });
});

app.delete('/api/conversations/:id', requireAuth, async (c) => {
  await c.env.DB.prepare('DELETE FROM messages WHERE conversation_id = ? AND user_id = ?').bind(c.req.param('id'), me(c)).run();
  await c.env.DB.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(c.req.param('id'), me(c)).run();
  return c.json({ ok: true });
});

// ---------------- sync ----------------
app.post('/api/sync/backup', requireAuth, async (c) => {
  const { conversations = [], messages = [], reminders = [] } = await c.req.json().catch(() => ({}));
  const userId = me(c);
  let upserted = 0;
  for (const conv of conversations.slice(0, 500)) {
    if (!conv?.id) continue;
    await c.env.DB.prepare('INSERT OR IGNORE INTO conversations (id, user_id, title, created_at) VALUES (?, ?, ?, ?)')
      .bind(String(conv.id), userId, String(conv.title || 'Conversation'), Number(conv.createdAt) || Date.now()).run();
    upserted++;
  }
  for (const m of messages.slice(0, 5000)) {
    if (!m?.uuid || !m?.conversationId) continue;
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO messages (uuid, conversation_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(String(m.uuid), String(m.conversationId), userId, m.role === 'assistant' ? 'assistant' : 'user',
      String(m.content || '').slice(0, 20000), Number(m.createdAt) || Date.now()).run();
    upserted++;
  }
  for (const r of reminders.slice(0, 500)) {
    if (!r?.id) continue;
    await c.env.DB.prepare(
      'INSERT OR REPLACE INTO reminders (id, user_id, title, reminder_time, reminder_date, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(String(r.id), userId, String(r.title || ''), String(r.time || ''), r.date ? String(r.date) : null,
      r.active === false ? 0 : 1, Date.now()).run();
    upserted++;
  }
  return c.json({ ok: true, upserted });
});

app.get('/api/sync/backup', requireAuth, async (c) => {
  const userId = me(c);
  const [convos, msgs, rems] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 500').bind(userId).all(),
    c.env.DB.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 5000').bind(userId).all(),
    c.env.DB.prepare('SELECT * FROM reminders WHERE user_id = ?').bind(userId).all(),
  ]);
  return c.json({ conversations: convos.results || [], messages: msgs.results || [], reminders: rems.results || [] });
});

// ---------------- digest ----------------
const STOP = new Set(
  ('the,a,an,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,is,are,was,were,' +
    'be,been,being,have,has,had,do,does,did,will,would,can,could,should,may,might,' +
    'i,you,he,she,it,we,they,me,him,her,us,them,my,your,his,its,our,their,this,that,' +
    'these,those,what,when,where,which,who,whom,how,why,not,no,yes,so,as,just,like,' +
    'hai,mein,me,ne,ko,se,ka,ki,ke,aur,toh,kya,kaise,ho,raha,rahi,hain,tha,' +
    'please,tell,give,know,want,need,help,pls,ok,okay,thanks,thank,hello,hi,hey').split(',')
);

app.get('/api/digest', requireAuth, async (c) => {
  const rows: any[] = (await c.env.DB.prepare(
    'SELECT role, content, created_at FROM messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 5000'
  ).bind(me(c)).all()).results || [];
  const freq = new Map<string, number>();
  const hours = new Array(24).fill(0);
  const days = new Set<string>();
  let userCount = 0;
  let timeAsks = 0;
  const timeHours: number[] = [];
  for (const m of rows) {
    const d = new Date(m.created_at);
    hours[d.getHours()]++;
    days.add(d.toDateString());
    if (m.role !== 'user') continue;
    userCount++;
    const text = String(m.content || '');
    if (/time|samay|baje|clock/i.test(text)) {
      timeAsks++;
      timeHours.push(d.getHours());
    }
    for (const w of text.toLowerCase().split(/[^a-z\u0900-\u097f]+/)) {
      if (w.length > 3 && !STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([topic, count]) => ({ topic, count }));
  const activeHours = hours.map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count).slice(0, 3);
  const notes: string[] = [];
  if (timeAsks >= 3) notes.push(`Asks the time often (around ${Math.round(timeHours.reduce((a, b) => a + b, 0) / timeHours.length)}:00).`);
  if (activeHours[0]?.count > 0) notes.push(`Most active around ${activeHours[0].hour}:00.`);
  if (userCount > 0 && days.size > 0) notes.push(`${userCount} questions over ${days.size} day(s).`);
  return c.json({ totalMessages: rows.length, userMessages: userCount, activeDays: days.size, topics, activeHours, routineNotes: notes });
});

// ---------------- reminders ----------------
app.get('/api/reminders', requireAuth, async (c) => {
  const rows: any[] = (await c.env.DB.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY created_at ASC').bind(me(c)).all()).results || [];
  return c.json({
    reminders: rows.map((r) => ({ id: r.id, title: r.title, time: r.reminder_time, date: r.reminder_date, active: !!r.active, createdAt: r.created_at })),
  });
});

app.post('/api/reminders', requireAuth, async (c) => {
  const { title, time, date } = await c.req.json().catch(() => ({}));
  if (!title || !time) return c.json({ error: 'title + time required' }, 400);
  const id = uid();
  await c.env.DB.prepare(
    'INSERT INTO reminders (id, user_id, title, reminder_time, reminder_date, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
  ).bind(id, me(c), String(title), String(time), date ? String(date) : null, Date.now()).run();
  return c.json({ ok: true, id });
});

app.delete('/api/reminders/:id', requireAuth, async (c) => {
  await c.env.DB.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').bind(c.req.param('id'), me(c)).run();
  return c.json({ ok: true });
});

app.get('/api/reminders/due', requireAuth, async (c) => {
  const now = new Date();
  const hhmm = `${`${now.getHours()}`.padStart(2, '0')}:${`${now.getMinutes()}`.padStart(2, '0')}`;
  const rows: any[] = (await c.env.DB.prepare('SELECT * FROM reminders WHERE user_id = ? AND active = 1').bind(me(c)).all()).results || [];
  return c.json({
    reminders: rows.filter((r) => (r.reminder_time || '').slice(0, 5) <= hhmm)
      .map((r) => ({ id: r.id, title: r.title, time: r.reminder_time, date: r.reminder_date })),
  });
});

// ---------------- media search (keyless: saavn / itunes / invidious) ----------------
const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://iv.melmac.space',
  'https://invidious.nerdvpn.de',
];
const MEDIA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

async function timedFetch(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

app.post('/api/media', optionalAuth, async (c) => {
  const { query, kinds } = await c.req.json().catch(() => ({}));
  const q = String(query || '').slice(0, 120);
  if (!q) return c.json({ tracks: [] });

  const runSearch = async (term: string) => {
    const want = new Set<string>(kinds || ['song', 'podcast', 'video']);
    const tracks: any[] = [];

    if (want.has('song')) {
      for (const host of ['https://saavn.dev', 'https://saavn.me']) {
        try {
          const r = await timedFetch(`${host}/api/search/songs?query=${encodeURIComponent(term)}&limit=5`, 9000, {
            headers: { 'User-Agent': MEDIA_UA },
          });
          if (!r.ok) continue;
          const j: any = await r.json();
          for (const s of j?.data?.results || j?.data?.songs || []) {
            const dls = s?.downloadUrl || [];
            const best = dls[dls.length - 1]?.url || dls[0]?.url;
            if (!best) continue;
            tracks.push({
              kind: 'song',
              title: String(s?.name || s?.title || 'Unknown song'),
              artist: Array.isArray(s?.artists?.primary)
                ? s.artists.primary.map((a: any) => a?.name).filter(Boolean).join(', ') : '',
              image: s?.image?.[1]?.url || s?.image?.[0]?.url || '',
              url: String(best),
              source: 'saavn',
            });
          }
          if (tracks.length) break;
        } catch {}
      }
    }

    if (want.has('podcast')) {
      try {
        const r = await timedFetch(
          `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=3&term=${encodeURIComponent(term)}`, 9000,
          { headers: { 'User-Agent': MEDIA_UA } }
        );
        if (r.ok) {
          const j: any = await r.json();
          for (const col of (j?.results || []).slice(0, 2)) {
            if (!col?.feedUrl) continue;
            try {
              const f = await timedFetch(col.feedUrl, 9000, { headers: { 'User-Agent': MEDIA_UA } });
              if (!f.ok) continue;
              const m = /<enclosure[^>]+url=["']([^"']+)["']/i.exec(await f.text());
              if (m?.[1]) {
                tracks.push({
                  kind: 'podcast',
                  title: String(col?.trackName || col?.collectionName || 'Podcast episode'),
                  artist: String(col?.artistName || ''),
                  image: String(col?.artworkUrl600 || col?.artworkUrl100 || ''),
                  url: m[1],
                  source: 'itunes',
                });
              }
            } catch {}
          }
        }
      } catch {}
    }

    if (want.has('video')) {
      for (const base of INVIDIOUS) {
        try {
          const r = await timedFetch(`${base}/api/v1/search?q=${encodeURIComponent(term)}&type=video`, 8000, {
            headers: { 'User-Agent': MEDIA_UA },
          });
          if (!r.ok) continue;
          const j: any = await r.json();
          const vids = (Array.isArray(j) ? j : [])
            .filter((v: any) => v?.type === 'video' && v?.videoId)
            .slice(0, 5)
            .map((v: any) => ({
              kind: 'video',
              title: String(v.title || 'Video'),
              artist: String(v.author || ''),
              image: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
              url: `https://www.youtube-nocookie.com/embed/${v.videoId}?autoplay=1&rel=0`,
              source: 'invidious',
              videoId: v.videoId,
            }));
          if (vids.length) {
            tracks.push(...vids);
            break;
          }
        } catch {}
      }
    }
    return tracks.slice(0, 12);
  };

  let out = await runSearch(q);
  // Transliteration misspellings (saudebaji vs saudebazi): one j/z retry.
  if (!out.length) {
    const hasJ = q.includes('j');
    const hasZ = q.includes('z');
    const variant = hasJ && !hasZ ? q.replace(/j/g, 'z') : !hasJ && hasZ ? q.replace(/z/g, 'j') : q;
    if (variant !== q) out = await runSearch(variant);
  }
  return c.json({
    tracks: out,
    query: q,
    youtubeSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  });
});

// ---------------- user ----------------
app.get('/api/user/profile', requireAuth, async (c) => {
  const u: any = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me(c)).first();
  if (!u) return c.json({ error: 'Not found' }, 404);
  return c.json({ id: u.id, email: u.email, displayName: u.display_name, settings: JSON.parse(u.settings || '{}') });
});

app.put('/api/user/settings', requireAuth, async (c) => {
  const { settings } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare('UPDATE users SET settings = ? WHERE id = ?').bind(JSON.stringify(settings || {}), me(c)).run();
  return c.json({ ok: true });
});

app.post('/api/user/export-all-data', requireAuth, async (c) => {
  const userId = me(c);
  const [conversations, messages, memory, reminders] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM conversations WHERE user_id = ?').bind(userId).all(),
    c.env.DB.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC').bind(userId).all(),
    c.env.DB.prepare('SELECT * FROM user_memory WHERE user_id = ?').bind(userId).all(),
    c.env.DB.prepare('SELECT * FROM reminders WHERE user_id = ?').bind(userId).all(),
  ]);
  return c.json({
    exportedAt: new Date().toISOString(),
    conversations: conversations.results || [], messages: messages.results || [],
    memory: memory.results || [], reminders: reminders.results || [],
  });
});

app.delete('/api/user/delete-account', requireAuth, async (c) => {
  const userId = me(c);
  for (const t of ['messages', 'conversations', 'user_memory', 'reminders', 'reset_tokens']) {
    await c.env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(userId).run();
  }
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  return c.json({ ok: true });
});

export default app;
