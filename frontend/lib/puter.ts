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

// Is the Puter SDK loaded AND already holding a session token?
//
// This matters more than it looks: when there is no token, `puter.ai.chat()`
// does not fail — it first awaits `puter.ui.authenticateWithPuter()`, which
// mounts a modal "This website uses Puter… Continue / Cancel" dialog and
// only settles after the user signs in (or cancels). Called from a voice
// turn, that means a surprise pop-up plus a 20-second silent stall before
// the next provider even gets a chance. So Puter is used only when the user
// has already signed in; otherwise it is skipped instantly.
export function puterReady(target: any = typeof window === 'undefined' ? undefined : window): boolean {
  const puter = target?.puter;
  if (!puter?.ai?.chat) return false;
  try {
    if (typeof puter.auth?.isSignedIn === 'function') return !!puter.auth.isSignedIn();
  } catch {
    return false;
  }
  return !!puter.authToken;
}

export async function askPuter(
  history: PuterMessage[],
  system: string,
  timeoutMs = 20000
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (typeof window === 'undefined') return null;
    if (!puterReady(window)) return null;
    const puter = (window as any).puter;
    const res = await Promise.race([
      puter.ai.chat(
        [{ role: 'system', content: system }, ...(history || []).slice(-6)],
        { max_tokens: 600 }
      ),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('puter-timeout')), timeoutMs);
      }),
    ]);
    return extractText(res) || null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
