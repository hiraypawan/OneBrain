'use client';
import { useState } from 'react';

const API = () => (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');

  const request = async () => {
    setMsg('Sending…');
    try {
      if (!API()) throw new Error('Password reset needs the backend running (see README).');
      const r = await fetch(`${API()}/api/auth/reset-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      setMsg(j.delivered === false
        ? 'Reset created. This server has no email configured — ask the server owner for the token from its log.'
        : 'If the email exists, a reset link is on its way (valid 1 hour).');
    } catch (e: any) {
      setMsg(e?.message || 'Failed');
    }
  };

  const confirm = async () => {
    setMsg('Resetting…');
    try {
      if (!API()) throw new Error('Password reset needs the backend running.');
      const r = await fetch(`${API()}/api/auth/reset-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const j = await r.json();
      setMsg(r.ok ? 'Password changed. Go login.' : j.error || 'Failed');
    } catch (e: any) {
      setMsg(e?.message || 'Failed');
    }
  };

  return (
    <div className="py-10 max-w-sm mx-auto space-y-3">
      <h1 className="text-2xl font-bold">Reset password</h1>
      {msg && <p className="text-sm text-gray-300">{msg}</p>}
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700" />
      <button onClick={request} className="w-full py-2 bg-blue-600 rounded font-bold">Send reset link</button>
      <div className="pt-4 space-y-3 border-t border-gray-800">
        <p className="text-sm text-gray-400">Have a token? Set a new password:</p>
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Reset token" className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (8+ chars)" className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700" />
        <button onClick={confirm} className="w-full py-2 bg-green-700 rounded font-bold">Set new password</button>
      </div>
    </div>
  );
}
