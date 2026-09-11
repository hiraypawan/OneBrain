import { Router } from 'express';
import { row, all, run } from '../db';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);
const me = (req: any) => req.user.id as string;

router.get('/profile', (req, res) => {
  const u = row<any>('SELECT * FROM users WHERE id = ?', me(req));
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({ id: u.id, email: u.email, displayName: u.display_name, settings: JSON.parse(u.settings || '{}') });
});

router.put('/settings', (req, res) => {
  run('UPDATE users SET settings = ? WHERE id = ?', JSON.stringify(req.body?.settings || {}), me(req));
  res.json({ ok: true });
});

router.post('/export-all-data', (req, res) => {
  const userId = me(req);
  res.json({
    exportedAt: new Date().toISOString(),
    conversations: all('SELECT * FROM conversations WHERE user_id = ?', userId),
    messages: all('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC', userId),
    memory: all('SELECT * FROM user_memory WHERE user_id = ?', userId),
    reminders: all('SELECT * FROM reminders WHERE user_id = ?', userId),
  });
});

router.delete('/delete-account', (req, res) => {
  const userId = me(req);
  run('DELETE FROM messages WHERE user_id = ?', userId);
  run('DELETE FROM conversations WHERE user_id = ?', userId);
  run('DELETE FROM user_memory WHERE user_id = ?', userId);
  run('DELETE FROM reminders WHERE user_id = ?', userId);
  run('DELETE FROM reset_tokens WHERE user_id = ?', userId);
  run('DELETE FROM users WHERE id = ?', userId);
  res.json({ ok: true });
});

export default router;
