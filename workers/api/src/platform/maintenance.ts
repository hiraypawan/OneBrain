import type { PlatformEnv } from './core';
/** Hourly, indexed and bounded. Never delete business records or action evidence. */
export async function maintenance(env: PlatformEnv, now = Date.now()) {
  if (env.PLATFORM_MODE && env.PLATFORM_MODE !== 'normal') return;
  const tables = [
    ['platform_sessions', 'token_hash'], ['google_login_states', 'state_hash'],
    ['oauth_states', 'state_hash'], ['platform_rate_limits', 'key'], ['space_invites', 'token_hash'],
  ] as const;
  // At most 250 base rows/hour (6,000/day), plus billed index changes.
  // An expiry backlog drains gradually instead of consuming the daily quota at once.
  await env.DB.batch(tables.map(([table,key]) => env.DB.prepare(
    `DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE expires_at < ? ORDER BY expires_at LIMIT 50)`
  ).bind(now)));
}
