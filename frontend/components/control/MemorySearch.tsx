"use client";
import { useState } from "react";
import { useAssistantStore } from "@/store/assistant";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const messages = useAssistantStore((s) => s.messages);
  const res = messages.filter((m) =>
    m.content.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="py-6">
      <h1 className="text-xl font-bold mb-3">Search memory</h1>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search..."
        className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 mb-3"
      />
      {res.map((m) => (
        <div key={m.id} className="p-2 border-b border-gray-800">
          {m.content}
        </div>
      ))}
    </div>
  );
}
