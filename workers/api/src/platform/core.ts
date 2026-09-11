import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
export type PlatformEnv = {
  DB: D1Database; JWT_SECRET?: string; TOKEN_ENCRYPTION_KEY?: string;
  OUTBOUND_HOSTS?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_CONNECT_REDIRECT?: string; GOOGLE_LOGIN_REDIRECT?: string; APP_ORIGIN?: string;
};
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type PlatformContext = { Bindings: PlatformEnv; Variables: { actor: { id: string; email: string }; session: string; role: Role } };
export type Ctx = Context<PlatformContext>;
export const id = () => crypto.randomUUID();
export const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503, message: string): never => { throw new HTTPException(status, { message }); };
export function text(value: unknown, label: string, max = 200, optional = false): string {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label} must be 1–${max} characters.`);
  return (value as string).trim();
}
export function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(400, `${label} is outside its supported range.`);
  return value as number;
}
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'A JSON object is required.');
  return value as Record<string, any>;
}
export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function hash(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function randomToken() { return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''); }
const bytes64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const base64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
async function key(env: PlatformEnv) {
  let raw: Uint8Array;
  try { raw = bytes64(env.TOKEN_ENCRYPTION_KEY || ''); } catch { return fail(503, 'Connector encryption is not configured.'); }
  if (raw.length !== 32) fail(503, 'Connector encryption requires an independently generated 32-byte key.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env: PlatformEnv, scope: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(scope) }, await key(env), new TextEncoder().encode(JSON.stringify(value)));
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function unseal(env: PlatformEnv, scope: string, value: string): Promise<any> {
  const [iv, data] = value.split('.');
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes64(iv), additionalData: new TextEncoder().encode(scope) }, await key(env), bytes64(data));
  return JSON.parse(new TextDecoder().decode(raw));
}
export const actor = (c: Ctx) => c.get('actor');
export async function membership(c: Ctx, space: string, minimum: 'read' | 'write' | 'admin' | 'owner' = 'read'): Promise<Role> {
  const row = await c.env.DB.prepare('SELECT role FROM space_members WHERE space_id=? AND user_id=?').bind(space, actor(c).id).first<{ role: Role }>();
  const allowed = minimum === 'read' ? ['owner','admin','editor','viewer'] : minimum === 'write' ? ['owner','admin','editor'] : minimum === 'admin' ? ['owner','admin'] : ['owner'];
  if (!row || !allowed.includes(row.role)) fail(403, 'You do not have permission in this workspace.');
  return row!.role;
}
export function audit(env: PlatformEnv, space: string, actorId: string, operation: string, subject: string, detail: unknown = {}) {
  return env.DB.prepare('INSERT INTO space_audit (id,space_id,actor_id,operation,subject_id,at,detail) VALUES (?,?,?,?,?,?,?)').bind(id(),space,actorId,operation,subject,Date.now(),JSON.stringify(detail));
}
export async function rateLimit(c: Ctx, label: string, max: number) {
  const now = Date.now(), window = Math.floor(now / 60000);
  const address = c.req.header('CF-Connecting-IP') || 'local';
  const bucket = await hash(`${label}:${address}:${window}`);
  const row = await c.env.DB.prepare('INSERT INTO platform_rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,now+120000).first<{count:number}>();
  if (!row || row.count > max) fail(429, 'Too many requests. Try again in a minute.');
}
export function publicConnection(row: any) {
  return { id: row.id, provider: row.provider, name: row.name, status: row.status, created_at: row.created_at, updated_at: row.updated_at, config: JSON.parse(row.config) };
}
