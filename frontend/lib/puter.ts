// Keyless browser AI via Puter.js (https://js.puter.com/v2/ loaded in layout).
// No signup, no API key — runs on the user's own fair-use quota.
// Everything is guarded: any failure returns null and the caller falls through
// to the next provider. Safe to call when offline or when the SDK is blocked.
export interface PuterMessage {
  role: string;
  content: string;
}

function extractText(res: any): string {
  const content = res?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (typeof b === 'string' ? b : b?.text || ''))
      .join('')
      .trim();
  }
  if (typeof res === 'string') return res.trim();
  return '';
}

export async function askPuter(
  history: PuterMessage[],
  system: string,
  timeoutMs = 20000
): Promise<string | null> {
  try {
    if (typeof window === 'undefined') return null;
    const puter = (window as any).puter;
    if (!puter?.ai?.chat) return null;
    const res = await Promise.race([
      puter.ai.chat(
        [{ role: 'system', content: system }, ...(history || []).slice(-6)],
        { max_tokens: 600 }
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('puter-timeout')), timeoutMs)),
    ]);
    return extractText(res) || null;
  } catch {
    return null;
  }
}
