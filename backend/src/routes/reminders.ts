import { Router } from 'express';
import { all, run, uid } from '../db';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);
const me = (req: any) => req.user.id as string;

router.get('/', (req, res) => {
  const rows = all<any>('SELECT * FROM reminders WHERE user_id = ? ORDER BY created_at ASC', me(req));
  res.json({
    reminders: rows.map((r) => ({
      id: r.id, title: r.title, time: r.reminder_time, date: r.reminder_date,
      active: !!r.active, createdAt: r.created_at,
    })),
  });
});

router.post('/', (req, res) => {
  const { title, time, date } = req.body || {};
  if (!title || !time) return res.status(400).json({ error: 'title + time required' });
  const id = uid();
  run('INSERT INTO reminders (id, user_id, title, reminder_time, reminder_date, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
    id, me(req), String(title), String(time), date ? String(date) : null, Date.now());
  res.json({ ok: true, id });
});

router.delete('/:id', (req, res) => {
  run('DELETE FROM reminders WHERE id = ? AND user_id = ?', req.params.id, me(req));
  res.json({ ok: true });
});

// Due within the next minute (polled by clients while open).
router.get('/due', (req, res) => {
  const now = new Date();
  const hhmm = `${`${now.getHours()}`.padStart(2, '0')}:${`${now.getMinutes()}`.padStart(2, '0')}`;
  const rows = all<any>('SELECT * FROM reminders WHERE user_id = ? AND active = 1', me(req));
  res.json({
    reminders: rows.filter((r) => (r.reminder_time || '').slice(0, 5) <= hhmm).map((r) => ({
      id: r.id, title: r.title, time: r.reminder_time, date: r.reminder_date,
    })),
  });
});

export default router;
