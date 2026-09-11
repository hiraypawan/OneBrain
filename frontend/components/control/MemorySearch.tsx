"use client";
import { useEffect, useState } from "react";
import { db, type StoredMessage } from "@/lib/db";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const query = q.trim().toLocaleLowerCase();
        const rows = await db.messages.orderBy('createdAt').reverse()
          .filter(m => m.content.toLocaleLowerCase().includes(query)).limit(100).toArray();
        if (alive) { setMessages(rows); setError(''); }
      } catch { if (alive) { setMessages([]); setError('Saved conversations could not be searched. Check browser storage and try again.'); } }
      finally { if (alive) setLoading(false); }
    }, 150);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);
  return (
    <div className="py-6">
      <h2 className="text-xl font-bold mb-3">Search saved conversations</h2>
      <p className="text-sm text-gray-400 mb-3">Searches all conversations saved on this browser, not just the active chat. Shows the 100 most recent matches. It does not search connected apps.</p>
      <label>
        Words to find
        <input value={q} maxLength={200} onChange={e => setQ(e.target.value)} placeholder="A name, topic or phrase"
          className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 mb-3" />
      </label>
      {loading ? <p role="status">Searching saved conversations…</p> : error ? <p role="alert">{error}</p> : !messages.length ? <p role="status">No saved conversations match this search.</p> : (
        <ul className="space-y-3">
          {messages.map(m => <li key={m.id} className="p-3 border-b border-gray-800 break-words">
            <a href={`/control?panel=conversation&id=${encodeURIComponent(m.conversationId)}`}>
              <span className="text-xs text-gray-400">{m.role === 'user' ? 'You' : 'OneBrain'} · {new Date(m.createdAt).toLocaleString()}</span>
              <p>{m.content}</p>
            </a>
          </li>)}
        </ul>
      )}
    </div>
  );
}
