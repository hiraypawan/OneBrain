import { Router } from 'express';
import { row, all, run, uid } from '../db';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);
const me = (req: any) => req.user.id as string;

router.get('/', (req, res) => {
  res.json({
    conversations: all('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', me(req)),
  });
});

router.post('/', (req, res) => {
  const { id, title } = req.body || {};
  const cid = id || uid();
  run('INSERT OR IGNORE INTO conversations (id, user_id, title, created_at) VALUES (?, ?, ?, ?)',
    cid, me(req), title || 'Conversation', Date.now());
  res.json({ conversation: row('SELECT * FROM conversations WHERE id = ?', cid) });
});

router.get('/:id', (req, res) => {
  const conv = row('SELECT * FROM conversations WHERE id = ? AND user_id = ?', req.params.id, me(req));
  if (!conv) return res.status(404).json({ error: 'Not found' });
  res.json({
    conversation: conv,
    messages: all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', req.params.id),
  });
});

router.delete('/:id', (req, res) => {
  run('DELETE FROM messages WHERE conversation_id = ? AND user_id = ?', req.params.id, me(req));
  run('DELETE FROM conversations WHERE id = ? AND user_id = ?', req.params.id, me(req));
  res.json({ ok: true });
});

export default router;
