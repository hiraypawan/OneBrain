import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { row, all, run, uid } from '../db';
import { authenticate, signToken } from '../middleware/auth';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    settings: JSON.parse(u.settings || '{}'),
  };
}

router.post('/signup', async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });
  if (row('SELECT id FROM users WHERE email = ?', email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = { id: uid(), email: email.toLowerCase(), hash, name: displayName || email.split('@')[0] };
  run('INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    user.id, user.email, hash, user.name, '{}', Date.now());
  const token = signToken(user);
  res.json({ token, user: publicUser({ ...user, display_name: user.name }) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = row<any>('SELECT * FROM users WHERE email = ?', (email || '').toLowerCase());
  if (!u || !u.password_hash) return res.status(401).json({ error: 'Invalid email or password' });
  if (!(await bcrypt.compare(password || '', u.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: signToken(u), user: publicUser(u) });
});

router.get('/me', authenticate, async (req, res) => {
  const u = row<any>('SELECT * FROM users WHERE id = ?', (req as any).user.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(u) });
});

router.post('/refresh', authenticate, async (req, res) => {
  res.json({ token: signToken((req as any).user) });
});

router.post('/logout', (_req, res) => {
  // JWTs are stateless — the client discards its token. Endpoint exists so
  // clients (and future blocklists) have something to call.
  res.json({ ok: true });
});

// What login options actually work on this server? The app hides the rest.
router.get('/config', (_req, res) => {
  res.json({
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    smtp: !!process.env.SMTP_HOST,
  });
});

// ---- Password reset (token flow; emailed when SMTP is configured) ----
router.post('/reset-request', async (req, res) => {
  const { email } = req.body || {};
  const u = row<any>('SELECT * FROM users WHERE email = ?', (email || '').toLowerCase());
  // Always respond OK so addresses can't be enumerated.
  if (!u) return res.json({ ok: true });
  const token = uid() + uid();
  run('INSERT INTO reset_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)',
    token, u.id, Date.now() + 60 * 60 * 1000);
  if (!process.env.SMTP_HOST) {
    // No mailer configured (typical self-host): log it for the server owner.
    console.log(`[auth] password reset for ${u.email}: token ${token} (set SMTP_HOST to email these)`);
    return res.json({ ok: true, delivered: false });
  }
  try {
    const nodemailer = await import('nodemailer').catch(() => null) as any;
    if (!nodemailer) return res.status(501).json({ error: 'Email not configured (install nodemailer + SMTP_HOST)' });
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    const link = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset?token=${token}`;
    await t.sendMail({ from: process.env.SMTP_FROM || 'onebrain@localhost', to: u.email, subject: 'OneBrain password reset', text: `Reset (1h): ${link}` });
    res.json({ ok: true, delivered: true });
  } catch (e) {
    console.error('reset email failed:', e);
    res.status(502).json({ error: 'Could not send reset email' });
  }
});

router.post('/reset-confirm', async (req, res) => {
  const { token, password } = req.body || {};
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });
  const t = row<any>('SELECT * FROM reset_tokens WHERE token = ?', token || '');
  if (!t || t.used || t.expires_at < Date.now()) return res.status(400).json({ error: 'Invalid or expired token' });
  run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(password, 10), t.user_id);
  run('UPDATE reset_tokens SET used = 1 WHERE token = ?', token);
  res.json({ ok: true });
});

// ---- Google OAuth (activates when GOOGLE_CLIENT_ID/SECRET are set) ----
router.get('/google', (req, res) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT } = process.env;
  if (!GOOGLE_CLIENT_ID) return res.status(501).json({ error: 'Google login not configured' });
  const redirect = GOOGLE_REDIRECT || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'openid email profile',
    });
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  try {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT, FRONTEND_URL } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(501).json({ error: 'Google login not configured' });
    const redirect = GOOGLE_REDIRECT || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code || ''),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
    });
    const tok: any = await tokRes.json();
    if (!tok.access_token) throw new Error('Google token exchange failed');
    const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me: any = await meRes.json();
    if (!me.email) throw new Error('Google did not return an email');
    let u = row<any>('SELECT * FROM users WHERE email = ?', String(me.email).toLowerCase());
    if (!u) {
      const id = uid();
      run('INSERT INTO users (id, email, password_hash, display_name, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        id, String(me.email).toLowerCase(), '', me.name || me.email, '{}', Date.now());
      u = row<any>('SELECT * FROM users WHERE id = ?', id);
    }
    const token = signToken(u);
    res.redirect(`${FRONTEND_URL || 'http://localhost:3000'}/auth/callback?token=${token}`);
  } catch (e) {
    console.error('google oauth failed:', e);
    res.status(502).json({ error: 'Google login failed' });
  }
});

export default router;
