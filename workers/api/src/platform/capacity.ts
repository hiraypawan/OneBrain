/** Advisory, per-isolate cooldown after an actual D1 failure. No user data,
 * authorization cache, database writes, global quota promises or paid overflow. */
const cooldowns = new WeakMap<object, number>();
export function isD1CapacityError(error: unknown): boolean {
  return error instanceof Error && /exceeded D1|D1.*(?:overloaded|too many requests|exceeded|quota|database is busy)/i.test(error.message);
}
export function noteD1Failure(db: object, error: unknown, now = Date.now()): boolean {
  if (!isD1CapacityError(error)) return false;
  cooldowns.set(db, now + 60000);
  return true;
}
export function capacityRetryAfter(db: object, now = Date.now()): number {
  const until = cooldowns.get(db) || 0;
  if (until <= now) { cooldowns.delete(db); return 0; }
  return Math.ceil((until - now) / 1000);
}
