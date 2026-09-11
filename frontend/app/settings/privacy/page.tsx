"use client";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { MemoryPreference } from "@/components/settings/Preferences";
import { useAssistantStore } from "@/store/assistant";
export default function Privacy() {
  const { settings, updateSettings } = useAssistantStore();
  return (
    <SettingsShell
      active="privacy"
      title="Memory & privacy"
      description="Choose what stays on this browser, and understand what can leave it."
    >
      <section className="settings-card">
        <h2>Your memory, your choice</h2>
        <MemoryPreference />
        <label>
          Forget chats older than
          <select
            value={settings.autoDeleteDays}
            onChange={(e) =>
              updateSettings({ autoDeleteDays: Number(e.target.value) })
            }
          >
            <option value={0}>No age-based deletion</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </label>
        <p className="settings-footnote">
          Chat retention runs during periodic cleanup while memory is enabled,
          not immediately when you change this setting. Without age-based
          deletion, older chats may be summarized to manage storage. Structured
          workspace records are not covered by this chat-retention setting.
        </p>
        <div className="settings-actions">
          <a className="settings-action primary" href="/settings/data-export">
            Export & delete local data ↗
          </a>
        </div>
      </section>
      <section className="settings-card">
        <h2>Microphone & AI providers</h2>
        <p>
          Listening starts only after you enable a microphone session. Stop ends
          that session. Browser speech recognition may send audio to the browser
          vendor; on-device recognition is not guaranteed.
        </p>
        <p>
          General AI questions can send transcripts and relevant context to
          configured providers, including Puter or the app backend. OneBrain
          does not intentionally retain raw audio in this workspace. Do not
          dictate passwords or other secrets.
        </p>
        <p>
          Opening settings does not start listening or upload your local canvas.
          The third-party AI SDK is not loaded on settings or sign-in pages.
        </p>
      </section>
      <section className="settings-card">
        <h2>Device storage is not a secure account boundary</h2>
        <p>
          Structured workspace records and receipts are stored in IndexedDB on
          this browser, scoped by the current local account identifier. This is
          not encryption or protection against someone who controls the device.
        </p>
        <p>
          Legacy conversations and reminders need a separate account-isolation
          audit; do not use this build for shared-device confidential data.
          Local deletion does not delete copies already sent to providers or
          server workspaces, or revoke your Google sign-in session.
        </p>
      </section>
      <section className="settings-card">
        <h2>Permission before conversation</h2>
        <p>
          Proactive conversation is off by default. History topics and
          preference questions have separate switches; quiet hours and
          invitation caps keep them bounded. No answer is not consent.
          Preference answers are not silently added to a personality profile.
        </p>
        <a className="settings-action" href="/settings/voice">
          Conversation preferences ↗
        </a>
      </section>
    </SettingsShell>
  );
}
