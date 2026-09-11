import { Router } from 'express';
import { all, run, uid } from '../db';
import { authenticate } from '../middleware/auth';

// User memory facts, persisted in SQLite (was an in-memory array).
const router = Router();
router.use(authenticate);
const me = (req: any) => req.user.id as string;

router.get('/', (req, res) => {
  res.json({
    memories: all('SELECT * FROM user_memory WHERE user_id = ? ORDER BY created_at DESC LIMIT 500', me(req)),
  });
});

router.post('/save', (req, res) => {
  const { memory_type, key, value, confidence } = req.body || {};
  const id = uid();
  run('INSERT INTO user_memory (id, user_id, memory_type, key, value, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, me(req), String(memory_type || 'fact'), String(key || ''),
    JSON.stringify(value ?? null), Number(confidence) || 0.5, Date.now());
  res.json({ ok: true, id });
});

router.get('/search', (req, res) => {
  const q = `%${String(req.query.q || '').slice(0, 100)}%`;
  res.json({
    memories: all(
      'SELECT * FROM user_memory WHERE user_id = ? AND (key LIKE ? OR value LIKE ?) ORDER BY created_at DESC LIMIT 100',
      me(req), q, q
    ),
  });
});

router.delete('/:id', (req, res) => {
  run('DELETE FROM user_memory WHERE id = ? AND user_id = ?', req.params.id, me(req));
  res.json({ ok: true });
});

router.delete('/', (req, res) => {
  run('DELETE FROM user_memory WHERE user_id = ?', me(req));
  res.json({ ok: true });
});

export default router;
