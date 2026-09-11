"use client";
import { useAssistantStore } from "@/store/assistant";
import { normalizeProactive } from "@/lib/proactive";
export function ConversationPreferences() {
  const state = useAssistantStore(),
    prefs = normalizeProactive(state.settings.proactive);
  const updatePrefs = (patch: Partial<typeof prefs>) =>
    state.updateSettings({ proactive: { ...prefs, ...patch } });
  return (
    <section className="settings-section">
      <h3>Conversation, on your terms</h3>
      <p>
        OneBrain can offer an occasional, relevant opening during an active
        listening session. It asks permission first, never treats silence as
        consent, and never pressures you to reply.
      </p>
      <label className="switch-row">
        <span>
          Proactive conversation
          <small>Off by default. Only while Pocket Mode is listening.</small>
        </span>
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(e) => updatePrefs({ enabled: e.target.checked })}
        />
      </label>
      <label className="switch-row">
        <span>
          Revisit earlier conversation topics
          <small>
            Uses eligible user messages. Sensitive topics are excluded
            conservatively.
          </small>
        </span>
        <input
          type="checkbox"
          checked={prefs.historyTopics}
          onChange={(e) => updatePrefs({ historyTopics: e.target.checked })}
        />
      </label>
      <label className="switch-row">
        <span>
          Ask occasional preference questions
          <small>
            No automatic personality profile or sensitive inference.
          </small>
        </span>
        <input
          type="checkbox"
          checked={prefs.preferenceQuestions}
          onChange={(e) =>
            updatePrefs({ preferenceQuestions: e.target.checked })
          }
        />
      </label>
      <div className="settings-grid">
        <label>
          Minimum time between invitations
          <select
            value={prefs.intervalMinutes}
            onChange={(e) =>
              updatePrefs({ intervalMinutes: Number(e.target.value) })
            }
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </label>
        <label>
          Maximum invitations per session
          <select
            value={prefs.maxPerSession}
            onChange={(e) =>
              updatePrefs({ maxPerSession: Number(e.target.value) })
            }
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quiet hours start
          <select
            value={prefs.quietStart}
            onChange={(e) =>
              updatePrefs({ quietStart: Number(e.target.value) })
            }
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
        <label>
          Quiet hours end
          <select
            value={prefs.quietEnd}
            onChange={(e) => updatePrefs({ quietEnd: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="settings-footnote">
        At least 90 seconds without detected speech. At most {prefs.maxPerDay}{" "}
        invitations a day. “Not now” pauses suggestions for 30 minutes. No
        answer also pauses them. Same-hour quiet settings disable the quiet
        window.
      </p>
    </section>
  );
}
export function VoicePreferences({
  includeMemory = true,
}: { includeMemory?: boolean } = {}) {
  const state = useAssistantStore();
  return (
    <section className="settings-section">
      <h3>{includeMemory ? "Voice & memory" : "Listening & replies"}</h3>
      <label className="switch-row">
        <span>
          Require an active-session wake phrase
          <small>
            Start a request with “OneBrain” or “Hey OneBrain”. Stop and pause
            still work without it. This cannot wake a closed or suspended
            browser.
          </small>
        </span>
        <input
          type="checkbox"
          checked={!!state.settings.wakePhrase}
          onChange={(e) =>
            state.updateSettings({ wakePhrase: e.target.checked })
          }
        />
      </label>
      <label>
        Recognition name aliases · one heard name = saved name per line
        <textarea
          rows={3}
          defaultValue={Object.entries(state.settings.speechAliases || {})
            .map(([a, b]) => `${a} = ${b}`)
            .join("\n")}
          onBlur={(e) => {
            const pairs = e.target.value
              .split("\n")
              .filter(Boolean)
              .slice(0, 20)
              .map((line) => line.split("=").map((x) => x.trim()))
              .filter((p) => p.length === 2 && p[0] && p[1]);
            state.updateSettings({ speechAliases: Object.fromEntries(pairs) });
          }}
          placeholder="ABC co = ABC Corporation"
        />
      </label>
      <label className="switch-row">
        <span>
          Silent Mode
          <small>No spoken answers or proactive invitations.</small>
        </span>
        <input
          type="checkbox"
          checked={!!state.settings.silentMode}
          onChange={(e) => {
            if (e.target.checked) window.speechSynthesis?.cancel();
            state.updateSettings({ silentMode: e.target.checked });
          }}
        />
      </label>
      {includeMemory && <MemoryPreference />}
      <label>
        Recognition language
        <select
          value={state.settings.language}
          onChange={(e) => state.updateSettings({ language: e.target.value })}
        >
          <option value="en-IN">English (India)</option>
          <option value="en-US">English (US)</option>
          <option value="hinglish">Hindi / Hinglish</option>
          <option value="hi-IN">Hindi</option>
          <option value="marathi">Marathi</option>
          <option value="es-ES">Spanish</option>
        </select>
      </label>
      <p className="settings-footnote">
        Restart listening after changing language. Browser recognition may
        process audio remotely. Voice-based speaker profiles are not
        authentication.
      </p>
    </section>
  );
}

export function MemoryPreference() {
  const state = useAssistantStore();
  return (
    <label className="switch-row">
      <span>
        Save memory on this device
        <small>
          Turning off keeps new captures session-only. Existing saved records
          remain until deleted.
        </small>
      </span>
      <input
        type="checkbox"
        checked={state.settings.memoryEnabled}
        onChange={(e) =>
          state.updateSettings({ memoryEnabled: e.target.checked })
        }
      />
    </label>
  );
}
