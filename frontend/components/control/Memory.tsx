"use client";
import { useEffect, useState } from "react";
import { useAssistantStore } from "@/store/assistant";
import { fetchDigest, getToken } from "@/lib/sync";
import { digestMessages, type Digest } from "@/lib/digest";
import { db } from "@/lib/db";
import { AnimatedCounter } from "@/components/rare/animated-counter";

export default function MemoryPage() {
  const memoryEnabled = useAssistantStore((s) => s.settings.memoryEnabled);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"cloud" | "local">("local");

  useEffect(() => {
    let on = true;
    (async () => {
      if (getToken()) {
        const cloud = await fetchDigest().catch(() => null);
        if (cloud && on && cloud.totalMessages > 0) {
          setDigest({ ...cloud, perDay: [] });
          setSource("cloud");
          setLoading(false);
          return;
        }
      }
      if (!on) return;
      try {
        const msgs = await db.messages.orderBy("createdAt").toArray();
        setDigest(
          digestMessages(
            msgs.map((m) => ({
              role: m.role,
              content: m.content,
              createdAt: m.createdAt,
            })),
          ),
        );
        setSource("local");
      } catch { if (on) setError("Saved memory could not be read. Check browser storage and reload to retry."); }
      finally { if (on) setLoading(false); }
    })();
    return () => {
      on = false;
    };
  }, []);

  return (
    <div className="py-6">
      <nav className="memory-tools" aria-label="Memory tools">
        <a href="/control?panel=memory-search">Search conversations</a>
        <a href="/control?panel=timeline">View timeline</a>
        <a href="/">Saved notes & tasks</a>
      </nav>
      <h1 className="text-2xl font-bold mb-2">Memory</h1>
      {error ? <p role="alert">{error}</p> : loading ? <p role="status">Reading saved memory…</p> : !memoryEnabled ? (
        <div className="p-4 bg-yellow-950 border border-yellow-700 rounded-xl text-sm">
          Memory is paused — turn it on in Settings to save conversations and
          learn topics. Nothing new is being stored.
        </div>
      ) : !digest ? (
        <p className="text-gray-400">
          No conversation history yet. Ask OneBrain or start talking on Today.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <AnimatedCounter
                value={digest.totalMessages}
                className="text-3xl font-bold text-green-400"
              />
              <div className="text-xs text-gray-400">messages</div>
            </div>
            <div>
              <AnimatedCounter
                value={digest.activeDays}
                className="text-3xl font-bold text-green-400"
              />
              <div className="text-xs text-gray-400">active days</div>
            </div>
            <div className="text-xs text-gray-400 self-end pb-1">
              from {source === "cloud" ? "cloud sync" : "this device"}
            </div>
          </div>
          {digest.routineNotes.length > 0 && (
            <div className="p-4 bg-gray-900 border border-gray-700 rounded-xl">
              <div className="font-bold mb-1">Routine</div>
              {digest.routineNotes.map((n) => (
                <div key={n} className="text-sm text-gray-300">
                  · {n}
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="font-bold mb-2">Top topics</div>
            <div className="flex flex-wrap gap-2">
              {digest.topics.map((t) => (
                <span
                  key={t.topic}
                  className="px-3 py-1 bg-gray-900 border border-gray-700 rounded-full text-sm"
                >
                  #{t.topic} ×{t.count}
                </span>
              ))}
            </div>
          </div>
          <a
            href="/control?panel=timeline"
            className="inline-block underline text-sm"
          >
            View timeline →
          </a>
        </div>
      )}
    </div>
  );
}
