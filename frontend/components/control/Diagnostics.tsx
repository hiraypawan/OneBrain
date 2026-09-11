"use client";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { useEffect, useState } from "react";
import { useAssistantStore } from "@/store/assistant";
import { formatBgEvent } from "@/lib/background";
import { db } from "@/lib/db";

export default function Debug() {
  const [info, setInfo] = useState<any>({});
  const [counts, setCounts] = useState<any>({});
  const bgLog = useAssistantStore((s) => s.bgLog);
  const sessionStart = useAssistantStore((s) => s.sessionStart);

  const refresh = async () => {
    const base: any = {
      build: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      mediaSession: "mediaSession" in navigator,
      wakeLock: "wakeLock" in navigator,
      serviceWorker: "serviceWorker" in navigator,
      speechRecognition:
        !!(window as any).SpeechRecognition ||
        !!(window as any).webkitSpeechRecognition,
      speechSynthesis: "speechSynthesis" in window,
      notifications:
        "Notification" in window ? Notification.permission : "unsupported",
      secureContext: window.isSecureContext,
    };
    try {
      const perm = await (navigator as any).permissions?.query({
        name: "microphone",
      });
      base.micPermission = perm?.state || "unknown";
    } catch {
      base.micPermission = "unknown";
    }
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      base.swRegistered = !!reg;
      base.swScope = reg?.scope || null;
    } catch {
      base.swRegistered = false;
    }
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices();
      base.audioInputs =
        devices
          ?.filter((d) => d.kind === "audioinput")
          .map((d) => d.label || "(unnamed)") || [];
      base.audioOutputs =
        devices
          ?.filter((d) => d.kind === "audiooutput")
          .map((d) => d.label || "(unnamed)") || [];
    } catch {
      base.audioInputs = "blocked";
    }
    try {
      base.pageErrors = (window as any).__onebrain_errors || [];
      base.storedErrors = JSON.parse(
        localStorage.getItem("onebrain-errors") || "[]",
      );
    } catch {
      base.pageErrors = "unavailable";
    }
    setInfo(base);
    try {
      setCounts({
        conversations: await db.conversations.count(),
        messages: await db.messages.count(),
        reminders: await db.reminders.count(),
        gems: process.env.NEXT_PUBLIC_API_URL
          ? "backend configured"
          : "local only",
      });
    } catch {
      setCounts({ indexedDB: "unavailable" });
    }
  };

  useEffect(() => {
    refresh();
    const onNet = () => refresh();
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
    return () => {
      window.removeEventListener("online", onNet);
      window.removeEventListener("offline", onNet);
    };
  }, []);

  return (
    <SettingsShell
      active="advanced"
      title="Diagnostics"
      description="Browser capabilities and local session events. These are diagnostic signals, not proof of reliable background listening."
    >
      <section className="settings-card">
        <h2>Browser & storage</h2>
        <p>
          Refresh reads device metadata and existing logs without requesting
          microphone access. Review logs for private details before sharing
          them.
        </p>
        <button onClick={refresh}>Refresh diagnostics</button>
        <pre tabIndex={0} aria-label="Browser and storage diagnostic details">{JSON.stringify({ ...info, storage: counts }, null, 2)}</pre>
      </section>
      <section className="settings-card">
        <h2>Background session log</h2>
        <p>
          {sessionStart
            ? `Session started ${new Date(sessionStart).toLocaleTimeString()}. These events reflect what the browser reported; they do not verify all background audio.`
            : "Start Pocket Mode in the workspace to record session events. Opening this page does not start listening."}
        </p>
        <pre tabIndex={0} aria-label="Background session events">
          {bgLog.length ? bgLog.map(formatBgEvent).join("\n") : "(empty)"}
        </pre>
      </section>
    </SettingsShell>
  );
}
