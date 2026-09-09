'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAssistantStore } from '@/store/assistant';
import { db } from '@/lib/db';
import { DeleteButton } from '@/components/rare/delete-button';

export default function ConversationsPage() {
  const { conversations, deleteConversation, newConversation } = useAssistantStore();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const router = useRouter();

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const msgs = await db.messages.toArray();
        const c: Record<string, number> = {};
        for (const m of msgs) c[m.conversationId] = (c[m.conversationId] || 0) + 1;
        if (on) setCounts(c);
      } catch {}
    })();
    return () => { on = false; };
  }, [conversations]);

  const download = async () => {
    const { exportAllLocal } = await import('@/lib/db');
    const data = await exportAllLocal().catch(() => ({ exportedAt: new Date().toISOString() }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'onebrain-export.json';
    a.click();
  };

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">History</h1>
        <div className="flex gap-2">
          <button
            onClick={() => { newConversation(); router.push('/active'); }}
            className="px-3 py-2 bg-green-700 rounded"
          >
            + New
          </button>
          <button onClick={download} className="px-3 py-2 bg-gray-800 rounded">Export JSON</button>
        </div>
      </div>
      {conversations.length === 0 && <p className="text-gray-400">No conversations yet. Go Active.</p>}
      <div className="space-y-2">
        {conversations.map((c) => (
          <div key={c.id} className="flex items-center justify-between p-3 bg-gray-900 rounded border border-gray-800">
            <a href={`/conversations/view?id=${c.id}`} className="flex-1">
              <div className="font-bold">{c.title || 'Conversation'}</div>
              <div className="text-xs text-gray-400">
                {new Date(c.createdAt).toLocaleString()} · {counts[c.id] ?? ''} messages
              </div>
            </a>
            <DeleteButton
              onConfirm={() => deleteConversation(c.id)}
              aria-label={`Delete ${c.title || 'conversation'}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
