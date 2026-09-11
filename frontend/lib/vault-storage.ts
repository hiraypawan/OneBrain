import { db } from './db';
import type { VaultEnvelope } from './vault';
export const VAULT_STORAGE = 'encrypted-vault:v1';

/** All mutations (including first creation, restore and deletion) use the same CAS boundary. */
export async function commitVault(expected: VaultEnvelope | null, next: VaultEnvelope | null, isCurrent = () => true): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const current = await db.kv.get(VAULT_STORAGE);
    if (!isCurrent()) throw new Error('Vault operation cancelled because the vault was locked.');
    if (JSON.stringify(current?.value ?? null) !== JSON.stringify(expected))
      throw new Error('Vault changed in another tab. Lock and reload before editing; nothing was overwritten.');
    if (next) await db.kv.put({ key: VAULT_STORAGE, value: next });
    else await db.kv.delete(VAULT_STORAGE);
    if (!isCurrent()) throw new Error('Vault operation cancelled because the vault was locked.');
  });
}
