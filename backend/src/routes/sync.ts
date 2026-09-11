import { Router } from 'express';
import { all, run } from '../db';
import { authenticate } from '../middleware/auth';

// Backup/restore sync: devices push rows keyed by stable client uuids,
// pull merges everything newer. Last-write-wins by createdAt.
const router = Router();
router.use(authenticate);
const me = (req: any) => req.user.id as string;

router.post('/backup', (req, res) => {
  const { conversations = [], messages = [], reminders = [] } = req.body || {};
  let upserted = 0;
  for (const c of conversations.slice(0, 500)) {
    if (!c?.id) continue;
    run('INSERT OR IGNORE INTO conversations (id, user_id, title, created_at) VALUES (?, ?, ?, ?)',
      String(c.id), me(req), String(c.title || 'Conversation'), Number(c.createdAt) || Date.now());
    upserted++;
  }
  for (const m of messages.slice(0, 5000)) {
    if (!m?.uuid || !m?.conversationId) continue;
    run(
      'INSERT OR IGNORE INTO messages (uuid, conversation_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      String(m.uuid), String(m.conversationId), me(req),
      m.role === 'assistant' ? 'assistant' : 'user',
      String(m.content || '').slice(0, 20000), Number(m.createdAt) || Date.now()
    );
    upserted++;
  }
  for (const r of reminders.slice(0, 500)) {
    if (!r?.id) continue;
    run('INSERT OR REPLACE INTO reminders (id, user_id, title, reminder_time, reminder_date, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      String(r.id), me(req), String(r.title || ''), String(r.time || ''), r.date ? String(r.date) : null,
      r.active === false ? 0 : 1, Date.now());
    upserted++;
  }
  res.json({ ok: true, upserted });
});

router.get('/backup', (req, res) => {
  const userId = me(req);
  res.json({
    conversations: all('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 500', userId),
    messages: all('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 5000', userId),
    reminders: all('SELECT * FROM reminders WHERE user_id = ?', userId),
  });
});

export default router;
