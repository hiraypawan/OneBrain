import Dexie, { Table } from 'dexie';
import type { BrainItem, ActionReceipt } from './workspace/model';

export interface StoredMessage {
  id?: number;
  uuid: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
  createdAt: number;
}

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  summary?: string;
  tags?: string[];
}

export interface StoredReminder {
  id: string;
  title: string;
  time: string; // HH:MM (daily) — plus optional date for one-time
  date?: string; // YYYY-MM-DD
  active: boolean;
  lastFired?: string; // YYYY-MM-DD of last fire (daily) or 'done' (one-time)
  createdAt: number;
}

export interface StoredUser {
  id: string;
  email: string;
  displayName?: string;
}

class OneBrainDB extends Dexie {
  brainItems!: Table<BrainItem, string>;
  actionReceipts!: Table<ActionReceipt, string>;
  conversations!: Table<StoredConversation, string>;
  messages!: Table<StoredMessage, number>;
  reminders!: Table<StoredReminder, string>;
  kv!: Table<{ key: string; value: any }, string>;
  pendingSync!: Table<any, number>;

  constructor() {
    super('onebrain');
    this.version(1).stores({
      conversations: 'id, createdAt',
      messages: '++id, conversationId, createdAt',
      pendingSync: '++id, createdAt',
    });
    // v2: reminders, kv (user/session flags), message meta
    this.version(2).stores({
      conversations: 'id, createdAt',
      messages: '++id, conversationId, createdAt',
      reminders: 'id, createdAt',
      kv: 'key',
      pendingSync: '++id, createdAt',
    });
    // v3: stable client uuids on messages (sync identity across devices)
    this.version(3)
      .stores({
        conversations: 'id, createdAt',
        messages: '++id, conversationId, createdAt, uuid',
        reminders: 'id, createdAt',
        kv: 'key',
        pendingSync: '++id, createdAt',
      })
      .upgrade((tx) =>
        tx
          .table('messages')
          .toCollection()
          .modify((m: any) => {
            m.uuid = m.uuid || `db-${m.id}`;
          })
      );
    // v4 adds workspace tables without rewriting legacy conversations.
    this.version(4).stores({
      brainItems: 'id, scope, kind, updatedAt',
      actionReceipts: 'id, scope, at',
    });
  }
}

export const db = new OneBrainDB();

export async function saveConversationLocal(conv: StoredConversation, msgs: StoredMessage[]) {
  await db.conversations.put(conv);
  if (msgs.length) await db.messages.bulkAdd(msgs);
}

export async function queueForSync(payload: any) {
  try {
    await db.pendingSync.add({ ...payload, createdAt: Date.now() });
  } catch {}
}

export async function getConversationMessages(conversationId: string): Promise<StoredMessage[]> {
  return db.messages.where('conversationId').equals(conversationId).sortBy('createdAt');
}

export async function getRecentMessages(limit = 500): Promise<StoredMessage[]> {
  const all = await db.messages.orderBy('createdAt').reverse().limit(limit).toArray();
  return all.reverse();
}

export async function getConversations(): Promise<StoredConversation[]> {
  return db.conversations.orderBy('createdAt').reverse().toArray();
}

export async function deleteConversationLocal(id: string) {
  await db.transaction('rw', db.messages, db.conversations, async () => {
    await db.messages.where('conversationId').equals(id).delete();
    await db.conversations.delete(id);
  });
}

export async function clearAllLocal() {
  // A failed clear must roll back every table rather than partially delete data.
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      if (table.name === 'kv') await table.filter(row => row.key !== 'encrypted-vault:v1').delete();
      else await table.clear();
    }
  });
}

export async function exportAllLocal() {
  const [conversations, messages, reminders, kv, brainItems, actionReceipts] = await Promise.all([
    db.conversations.toArray(),
    db.messages.toArray(),
    db.reminders.toArray(),
    db.kv.toArray(),
    db.brainItems.toArray(),
    db.actionReceipts.toArray(),
  ]);
  return { conversations, messages, reminders, kv: kv.filter(row => !['localUsers', 'user', 'encrypted-vault:v1'].includes(row.key)), brainItems, actionReceipts, exportedAt: new Date().toISOString() };
}
