// Where to send someone after Google sign-in. Only same-site relative paths
// are allowed (no "//host", no "/\\host", no auth/api loops) so the return
// parameter can never become an open redirect.
export const NEXT_COOKIE = 'onebrain-auth-next';
export const DEFAULT_RETURN = '/';

export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_RETURN;
  const path = value.trim();
  if (!path || path.length > 512) return DEFAULT_RETURN;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return DEFAULT_RETURN;
  if ([...path].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return DEFAULT_RETURN;
  if (/^\/(auth|api)(\/|\?|#|$)/i.test(path)) return DEFAULT_RETURN;
  return path;
}

/** Link to the one sign-in page, remembering where the user came from. */
export function loginHref(returnTo?: string | null): string {
  const next = safeReturnPath(returnTo ?? '');
  return next === DEFAULT_RETURN ? '/auth/login' : `/auth/login?next=${encodeURIComponent(next)}`;
}

export type SignInError = 'configuration' | 'unreachable' | 'cancelled' | 'expired' | 'google';

export function signInErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case null: case undefined: case '': return null;
    case 'cancelled': return 'Google sign-in was cancelled. Nothing changed — try again whenever you like.';
    case 'expired': return 'That sign-in attempt expired or was opened in a different tab or browser. Start again from this page.';
    case 'configuration': return 'Google sign-in isn’t switched on for this site yet. You can keep using OneBrain on this device.';
    case 'unreachable': return 'OneBrain’s sign-in server couldn’t be reached. Check your connection and try again.';
    default: return 'Google couldn’t finish signing you in. Try again — if it keeps failing, your account may need support.';
  }
}
