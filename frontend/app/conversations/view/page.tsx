'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAssistantStore } from '@/store/assistant';
import { getConversationMessages } from '@/lib/db';
import { splitReply } from '@/lib/speech';

function ConvView() {
  const params = useSearchParams();
  const id = params.get('id') || '';
  const conversations = useAssistantStore((s) => s.conversations);
  const sessionMsgs = useAssistantStore((s) => s.messages);
  const currentId = useAssistantStore((s) => s.currentConversationId);
  const [stored, setStored] = useState<{ role: string; content: string; meta?: string }[]>([]);

  useEffect(() => {
    if (!id) return;
    let on = true;
    getConversationMessages(id)
      .then((m) => { if (on) setStored(m); })
      .catch(() => {});
    return () => { on = false; };
  }, [id]);

  const conv = conversations.find((c) => c.id === id);
  const live = id && id === currentId ? sessionMsgs.filter((m) => !String(m.id).startsWith('db-')) : [];
  const all = [...stored.map((m) => ({ role: m.role, content: m.content, meta: m.meta })), ...live];

  return (
    <div className="py-6">
      <a href="/conversations" className="text-sm text-blue-400 underline">← All conversations</a>
      <h1 className="text-xl font-bold mt-2">{conv?.title || 'Conversation'}</h1>
      <p className="text-gray-400 text-sm mb-4">{all.length} messages</p>
      <div className="space-y-2">
        {all.map((m, i) => {
          const { spoken, english } = m.role === 'assistant' ? splitReply(m.content) : { spoken: m.content, english: null };
          return (
            <div key={i} className="p-3 bg-gray-900 rounded border border-gray-800">
              <b>{m.role === 'user' ? 'You' : 'OneBrain'}</b>
              {m.meta ? <span className="text-xs text-gray-400"> · {m.meta}</span> : null}
              <div>{spoken}</div>
              {english ? <div className="mt-1 text-sm text-gray-400">EN: {english}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ConvViewPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-gray-400">Loading…</p>}>
      <ConvView />
    </Suspense>
  );
}
