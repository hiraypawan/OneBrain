"use client";
import { useEffect, useState } from "react";
import { digestMessages, type Digest } from "@/lib/digest";
import { db } from "@/lib/db";

export default function Timeline() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [digest, setDigest] = useState<Digest | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const msgs = await db.messages.orderBy("createdAt").toArray();
        if (on)
          setDigest(
            digestMessages(
              msgs.map((m) => ({
                role: m.role,
                content: m.content,
                createdAt: m.createdAt,
              })),
            ),
          );
      } catch { if (on) setError("Conversation timeline could not be read. Check browser storage and reload to retry."); }
      finally { if (on) setLoading(false); }
    })();
    return () => {
      on = false;
    };
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (loading) return <p role="status">Reading conversation timeline…</p>;
  if (!digest || digest.perDay.length === 0) {
    return (
      <div className="py-6">
        <h1 className="text-xl font-bold">Memory timeline</h1>
        <p className="text-gray-400">
          Daily activity will appear here after you chat.
        </p>
      </div>
    );
  }

  const max = Math.max(...digest.perDay.map((d) => d.count));
  return (
    <div className="py-6">
      <h1 className="text-xl font-bold mb-4">Memory timeline (last 14 days)</h1>
      <div className="space-y-2">
        {digest.perDay.map((d) => (
          <div key={d.day} className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-24">
              {new Date(d.day).toLocaleDateString()}
            </span>
            <div className="flex-1 h-4 bg-gray-900 rounded overflow-hidden">
              <div
                className="h-4 bg-green-600"
                style={{ width: `${Math.max(4, (d.count / max) * 100)}%` }}
              />
            </div>
            <span className="text-xs w-8">{d.count}</span>
          </div>
        ))}
      </div>
      {digest.activeHours.length > 0 && (
        <p className="text-sm text-gray-400 mt-4">
          Peak hours: {digest.activeHours.map((h) => `${h.hour}:00`).join(", ")}
        </p>
      )}
    </div>
  );
}
