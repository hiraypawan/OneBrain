import { NextRequest, NextResponse } from 'next/server';
import { buildSystem, askGemini, askPollinations, fallback, verbosityBudget } from '@/lib/gemini';
import { looksFactual, fetchWikipedia } from '@/lib/knowledge';

export async function POST(req: NextRequest) {
  const { message, history, userKey, profile, recall, verbosity } = await req.json();

  // 1. User's own free key (best quality)  2. Host's Gemini key
  // 3. Host's OpenAI key  4. Keyless community API (zero setup)
  // 5. Offline fallback
  // Memory-aware system: clock + verbosity + who they are + relevant past chats.
  const sysParts = [buildSystem()];
  sysParts.push(verbosity === 'long' ? 'Give fuller explanations when asked.' : 'Be concise: short spoken answers.');
  if (profile) sysParts.push(profile);
  if (recall) sysParts.push(recall);
  const system = sysParts.join('\n\n');
  const maxTokens = verbosityBudget(verbosity);
  const geminiKey = userKey || process.env.GEMINI_API_KEY;
  let keyBlame: string | null = null;
  if (geminiKey) {
    const res = await askGemini(geminiKey, message, history || [], { system, maxTokens });
    if (res.text) return NextResponse.json({ answer: res.text, provider: 'gemini' });
    console.error('Gemini failed:', res.error);
    if (userKey && /api key|not valid|permission|quota|exceed/i.test(res.error || '')) {
      keyBlame = String(res.error).slice(0, 220);
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: maxTokens,
          temperature: 0.5,
          messages: [
            { role: 'system', content: system },
            ...(history || []).slice(-10),
            { role: 'user', content: message },
          ],
        }),
      });
      const j = await r.json();
      const answer = j.choices?.[0]?.message?.content;
      if (answer) return NextResponse.json({ answer, provider: 'openai' });
    } catch (e) {
      console.error('OpenAI failed, using fallback', e);
    }
  }
  // Keyless community API: works with zero setup. Tried after keyed
  // providers so a user's own key (better quality) always wins when present.
  // Live facts first for factual questions (fresh > training cutoff).
  try {
    if (looksFactual(message)) {
      const wiki = await fetchWikipedia(message);
      if (wiki?.text) return NextResponse.json({ answer: wiki.text, provider: 'wikipedia' });
    }
  } catch (e) {
    console.error('Wikipedia failed:', e);
  }
  const free = await askPollinations(message, history || [], system);
  if (free.text) return NextResponse.json({ answer: free.text, provider: 'pollinations' });
  console.error('Pollinations failed:', free.error);

  // Everything failed: if the user's own key was rejected, say so plainly.
  if (userKey && keyBlame) {
    return NextResponse.json({
      answer: `Tumhari Gemini key kaam nahi kar rahi (${keyBlame}). Settings me key dobara check karo, aistudio.google.com se nayi key lekar paste karo.`,
      provider: 'key-error',
    });
  }
  return NextResponse.json({ answer: fallback(message), provider: 'offline' });
}
