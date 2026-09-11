// Presence hint only. Never use this readable cookie to authorize or show a
// verified identity. The real session remains HttpOnly and server-verified.
export const SESSION_HINT = 'onebrain-session-present';
export function shouldRestoreSession(cookie: string, pathname: string, search: string) {
  const ownsCheck = pathname === '/operations' || pathname === '/settings/account' || pathname === '/control' && ['account','shared'].includes(new URLSearchParams(search).get('panel') || '');
  return !ownsCheck && cookie.split(';').some(part => part.trim() === `${SESSION_HINT}=1`);
}
