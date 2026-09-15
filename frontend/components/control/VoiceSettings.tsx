"use client";
import { SettingsShell } from "@/components/settings/SettingsShell";
import {
  ConversationPreferences,
  VoicePreferences,
} from "@/components/settings/Preferences";
import { useAssistantStore } from "@/store/assistant";
import { AudioDevices } from "@/components/control/AudioDevices";
export default function VoiceSettings() {
  const { settings, updateSettings } = useAssistantStore();
  return (
    <SettingsShell
      active="voice"
      title="Voice & conversation"
      description="Make the conversation sound and feel right for you. Preferences save on this browser."
    >
      <div className="settings-card">
        <VoicePreferences includeMemory={false} />
        <label>
          Voice speed · {settings.voiceSpeed.toFixed(1)}×
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={settings.voiceSpeed}
            onChange={(e) =>
              updateSettings({ voiceSpeed: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Answer length
          <select
            value={settings.verbosity}
            onChange={(e) =>
              updateSettings({
                verbosity: e.target.value as "short" | "medium" | "long",
              })
            }
          >
            <option value="short">Short · made for listening</option>
            <option value="medium">Medium · a little more context</option>
            <option value="long">Long · fuller explanations</option>
          </select>
        </label>
      </div>
      <div className="settings-card">
        <ConversationPreferences />
      </div>
      <AudioDevices />
      <section className="settings-card">
        <h2>Still not hearing anything?</h2>
        <p>
          Check Silent Mode above, run both tests, then open diagnostics for the
          speech event log (tts-start, tts-error, tts-stall).
        </p>
        <a className="settings-action" href="/control?panel=debug">
          Open diagnostics ↗
        </a>
      </section>
    </SettingsShell>
  );
}
