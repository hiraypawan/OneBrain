"use client";
import { useState } from "react";
import { exportAllLocal } from "@/lib/db";
import { useAssistantStore } from "@/store/assistant";
import { SettingsShell } from "@/components/settings/SettingsShell";
export default function DataExport() {
  const [summary, setSummary] = useState(""),
    [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    setSummary("");
    try {
      const data = await exportAllLocal(),
        store = useAssistantStore.getState();
      const full = {
        ...data,
        session: {
          messagesInView: store.messages.length,
          settings: store.settings,
          hasApiKey: !!store.apiKey,
          voiceEnrolled: store.voiceBaseline != null,
        },
      };
      const a = document.createElement("a"),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(full, null, 2)], {
            type: "application/json",
          }),
        );
      a.href = url;
      a.download = "onebrain-data.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSummary(
        `Export prepared: ${data.brainItems.length} workspace records, ${data.conversations.length} conversations, ${data.messages.length} messages and ${data.reminders.length} reminders. Check your browser downloads.`,
      );
    } catch {
      setSummary(
        "Export failed. No complete export was prepared. Check browser storage access and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function wipe() {
    if (
      !confirm(
        "Delete local workspace records, chats, reminders, cached profile, settings and browser AI key? This cannot be undone. It does not delete server records, revoke your Google session, or delete the separate encrypted vault.",
      )
    )
      return;
    setBusy(true);
    setSummary("");
    try {
      await useAssistantStore.getState().wipeAll();
      setSummary(
        "Local canvas database cleared and preferences reset. Server records, Google sessions, provider copies, the separate encrypted vault, browser caches and diagnostics logs are not deleted.",
      );
    } catch {
      setSummary(
        "Local deletion could not be completed. Do not assume your data has been deleted. Check browser storage access and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsShell
      active="privacy"
      title="Export & delete local data"
      description="Manage this browser’s canvas data. Server workspaces and the encrypted vault have separate controls."
    >
      {summary && (
        <p className="settings-status" role="status">
          {summary}
        </p>
      )}
      <section className="settings-card">
        <h2>Take a copy with you</h2>
        <p>
          Export saved workspace records, receipts, conversations, reminders and
          preferences as JSON. This includes local scopes on this browser, not
          just the currently visible canvas. Treat the file as private.
        </p>
        <p>
          The API key, cached sign-in profile and encrypted vault are not
          included. Session-only captures are not a complete part of this
          database export; use the workspace export while that session is open.
        </p>
        <button disabled={busy} onClick={() => void download()}>
          Download local data (JSON)
        </button>
      </section>
      <section className="settings-card">
        <h2>Delete local canvas data</h2>
        <p>
          This clears the canvas database across local scopes and resets
          preferences, the browser AI key and pitch baseline. It cannot be
          undone. Download a copy first if you need one.
        </p>
        <p>
          This is not account deletion or sign-out. It does not remove server
          workspaces, provider copies, the separate encrypted vault, browser
          caches or diagnostics logs. Close other OneBrain tabs and stop active
          listening before deleting.
        </p>
        <button
          className="danger-action"
          disabled={busy}
          onClick={() => void wipe()}
        >
          Delete local canvas data
        </button>
        <div className="settings-actions">
          <a className="settings-action" href="/control?panel=account">
            Account & sign-out
          </a>
          <a className="settings-action" href="/control?panel=vault">
            Separate encrypted vault ↗
          </a>
        </div>
      </section>
    </SettingsShell>
  );
}
