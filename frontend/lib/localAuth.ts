import { db } from './db';

// Device-local accounts (used when no backend is configured).
// SHA-256 + per-user salt. Honest scope: this protects a shared device from
// casual snooping; real multi-device security comes from the backend JWT.
interface LocalAccount {
  email: string;
  name: string;
  salt: string;
  hash: string;
  createdAt: number;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getAccounts(): Promise<Record<string, LocalAccount>> {
  try {
    return (await db.kv.get('localUsers'))?.value || {};
  } catch {
    return {};
  }
}

export async function signupLocal(email: string, password: string, name: string) {
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Valid email required');
  if (!password || password.length < 8) throw new Error('Password must be 8+ characters');
  const accounts = await getAccounts();
  if (accounts[email]) throw new Error('Email already registered on this device');
  const salt = Math.random().toString(36).slice(2);
  accounts[email] = {
    email, name: name || email.split('@')[0],
    salt, hash: await sha256Hex(`${salt}:${password}`), createdAt: Date.now(),
  };
  await db.kv.put({ key: 'localUsers', value: accounts });
  return { id: `local-${email}`, email, displayName: accounts[email].name };
}

export async function loginLocal(email: string, password: string) {
  email = email.trim().toLowerCase();
  const accounts = await getAccounts();
  const acc = accounts[email];
  if (!acc) throw new Error('No account for this email on this device');
  const hash = await sha256Hex(`${acc.salt}:${password}`);
  if (hash !== acc.hash) throw new Error('Wrong password');
  return { id: `local-${email}`, email, displayName: acc.name };
}
