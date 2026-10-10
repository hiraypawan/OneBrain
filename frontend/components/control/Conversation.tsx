"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAssistantStore } from "@/store/assistant";
import { getConversationMessages, type StoredMessage } from "@/lib/db";
import { splitReply } from "@/lib/speech";

function ConvView() {
  const params = useSearchParams();
  const id = params.get("id") || "";
  const conversations = useAssistantStore((s) => s.conversations);
  const sessionMsgs = useAssistantStore((s) => s.messages);
  const currentId = useAssistantStore((s) => s.currentConversationId);
  const loadConversation = useAssistantStore((s) => s.loadConversation);
  const router = useRouter();
  const [stored, setStored] = useState<StoredMessage[]>([]);
  const [error, setError] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [resuming, setResuming] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setStored([]); setError(""); setLoading(true);
    if (!id) { setLoading(false); return; }
    let on = true;
    getConversationMessages(id)
      .then((m) => {
        if (on) setStored(m);
      })
      .catch(() => { if (on) setError("This conversation could not be loaded. Check browser storage and retry."); })
      .finally(() => { if (on) setLoading(false); });
    return () => {
      on = false;
    };
  }, [id]);

  const conv = conversations.find((c) => c.id === id);
  const saved = stored.map(m => ({ id: m.uuid || `db-${m.id}`, role: m.role, content: m.content, meta: m.meta }));
  const savedIds = new Set(saved.map(m => m.id));
  const live = id && id === currentId ? sessionMsgs.filter(m => !savedIds.has(m.id)) : [];
  const all = [...saved, ...live];
  async function resumeConversation() {
    setResuming(true);
    setResumeError("");
    try {
      await loadConversation(id);
      router.push("/");
    } catch (e) {
      setResumeError(e instanceof Error ? e.message : "This conversation could not be resumed.");
    } finally {
      setResuming(false);
    }
  }

  return (
    <div className="py-6">
      <a
        href="/control?panel=conversations"
        className="text-sm text-blue-400 underline"
      >
        ← All conversations
      </a>
      <h1 className="text-xl font-bold mt-2 break-words">
        {conv?.title || "Conversation"}
      </h1>
      <p className="text-gray-400 text-sm mb-4" role="status">{loading ? "Loading conversation…" : error || `${all.length} messages`}</p>
      {!loading && !error && all.length > 0 && (
        <div className="mb-4">
          <button type="button" disabled={resuming} onClick={() => void resumeConversation()}>
            {resuming ? "Opening conversation…" : "Continue this conversation"}
          </button>
          {resumeError && <p role="alert">{resumeError}</p>}
        </div>
      )}
      <div className="space-y-2">
        {all.map((m, i) => {
          const { spoken, english } =
            m.role === "assistant"
              ? splitReply(m.content)
              : { spoken: m.content, english: null };
          return (
            <div
              key={i}
              className="p-3 bg-gray-900 rounded border border-gray-800 break-words"
            >
              <b>{m.role === "user" ? "You" : "OneBrain"}</b>
              {m.meta ? (
                <span className="text-xs text-gray-400"> · {m.meta}</span>
              ) : null}
              <div>{spoken}</div>
              {english ? (
                <div className="mt-1 text-sm text-gray-400">EN: {english}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ConvViewPage() {
  return (
    <Suspense
      fallback={<p className="py-10 text-center text-gray-400">Loading…</p>}
    >
      <ConvView />
    </Suspense>
  );
}
