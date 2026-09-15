"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  activeSinkId,
  autoPickOutput,
  cleanDeviceLabel,
  listAudioDevices,
  listOutputDevices,
  outputSelectionSupported,
  resolvedOutput,
  pickableOutputs,
  playTestTone,
  speakerPlan,
  watchAudioDevices,
  type AudioDevice,
  type OutputDevice,
} from "@/lib/audio";
import {
  diagnoseTts,
  pickTtsVoice,
  splitForSpeech,
  ttsLangFor,
  waitForVoices,
} from "@/lib/speech";
import { useAssistantStore } from "@/store/assistant";

const SAMPLE = "OneBrain voice test. If you can hear this, your output device is working.";

/**
 * Microphone + speaker picker with automatic detection.
 *
 * It exists because spoken replies follow the OS default output: without this
 * panel a neckband stays quiet and there is nowhere to look for the reason.
 */
export function AudioDevices() {
  const speakerDeviceId = useAssistantStore((s) => s.speakerDeviceId);
  const setSpeakerDeviceId = useAssistantStore((s) => s.setSpeakerDeviceId);
  const micDeviceId = useAssistantStore((s) => s.micDeviceId);
  const setMicDeviceId = useAssistantStore((s) => s.setMicDeviceId);
  const language = useAssistantStore((s) => s.settings.language);
  const silentMode = useAssistantStore((s) => s.settings.silentMode);
  const updateSettings = useAssistantStore((s) => s.updateSettings);

  const [outputs, setOutputs] = useState<OutputDevice[]>([]);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [namesHidden, setNamesHidden] = useState(false);
  const [voices, setVoices] = useState<any[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "tone" | "voice" | "mic">(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const { inputs: ins } = await listAudioDevices();
    const outs = await listOutputDevices();
    if (!mountedRef.current) return;
    setInputs(ins);
    setOutputs(outs);
    // Browsers hide device labels until microphone permission is granted once.
    setNamesHidden(outs.length > 0 && outs.every((d) => !d.label || d.label === "Speaker"));
    // Auto-detect: keep the pin while that device is connected, otherwise fall
    // back to the system default (or the first output) without asking.
    const chosen = autoPickOutput(outs, useAssistantStore.getState().speakerDeviceId);
    if (chosen !== useAssistantStore.getState().speakerDeviceId) {
      setSpeakerDeviceId(chosen);
    }
  }, [setSpeakerDeviceId]);

  useEffect(() => {
    void refresh();
    // Neckband connected or unplugged: re-read the list and re-pick.
    const stop = watchAudioDevices(() => void refresh());
    return stop;
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    const synth: any = typeof window !== "undefined" ? window.speechSynthesis : null;
    void waitForVoices(synth, 1500).then((v) => {
      if (alive) setVoices(Array.isArray(v) ? v : []);
    });
    return () => {
      alive = false;
    };
  }, []);

  const plan = speakerPlan({
    outputs,
    chosenId: speakerDeviceId,
    routingSupported: outputSelectionSupported(),
  });
  const choices = pickableOutputs(outputs);

  const lang = ttsLangFor(SAMPLE, language);
  const health = diagnoseTts({
    silentMode: false,
    synthSupported: typeof window !== "undefined" && "speechSynthesis" in window,
    voices,
    choice: pickTtsVoice(voices, lang),
    lang,
  });

  async function revealNames() {
    setBusy("mic");
    setStatus(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await refresh();
      setStatus("Device names unlocked.");
    } catch {
      setStatus(
        "Microphone permission was refused, so the browser keeps device names hidden. Allow it once to see them — you can revoke it after.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function testTone() {
    setBusy("tone");
    setStatus(null);
    const ok = await playTestTone(activeSinkId(speakerDeviceId));
    setStatus(
      ok
        ? "Test tone played. If you did not hear it, raise that device's volume."
        : "The test tone could not play on that device. Try another output.",
    );
    setBusy(null);
  }

  async function testVoice() {
    setBusy("voice");
    setStatus(null);
    const synth: any = typeof window !== "undefined" ? window.speechSynthesis : null;
    const list = await waitForVoices(synth, 1500);
    const choice = pickTtsVoice(list, ttsLangFor(SAMPLE, language));
    if (!synth || !choice.voice) {
      setStatus(
        "No speech voice is installed, so the test cannot be spoken. Install one in your system Text-to-speech settings.",
      );
      setBusy(null);
      return;
    }
    try {
      synth.cancel();
    } catch {}
    let finished = false;
    for (const chunk of splitForSpeech(SAMPLE)) {
      if (finished) break;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = choice.lang || lang;
        try {
          u.voice = choice.voice;
        } catch {}
        const timer = setTimeout(() => {
          finished = true;
          resolve();
        }, 8000);
        u.onend = () => {
          clearTimeout(timer);
          resolve();
        };
        u.onerror = () => {
          clearTimeout(timer);
          finished = true;
          resolve();
        };
        try {
          synth.speak(u);
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
    setStatus(
      finished
        ? `The voice test did not play with ${choice.name}. Check the output device and its volume.`
        : `Spoken with ${choice.name} (${choice.lang}).`,
    );
    setBusy(null);
  }

  return (
    <section className="settings-card audio-devices">
      <h2>Microphone &amp; speaker</h2>
      <p>
        Nothing here has to be set. Spoken replies are real audio and follow
        whatever your phone, tablet or computer is currently playing through —
        connect a neckband, earbuds or speaker and the voice goes there
        automatically. Pick a device below only to pin replies to one output.
      </p>

      <label>
        Speaker output
        <select
          value={speakerDeviceId || ""}
          onChange={(e) => setSpeakerDeviceId(e.target.value || null)}
          disabled={!choices.length}
        >
          <option value="">
            {choices.length
              ? `Automatic — ${resolvedOutput().label || plan.defaultLabel || "follow my device"}`
              : "No output detected"}
          </option>
          {choices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
              {plan.defaultLabel && d.label === plan.defaultLabel
                ? " · system default"
                : ""}
            </option>
          ))}
        </select>
      </label>

      <p className={`device-plan plan-${plan.mode}`} role="status">
        {plan.message}
      </p>
      {plan.hint && <p className="settings-footnote">{plan.hint}</p>}

      <div className="settings-actions">
        <button disabled={busy !== null} onClick={() => void testTone()}>
          {busy === "tone" ? "Playing…" : "Test this speaker"}
        </button>
        <button disabled={busy !== null} onClick={() => void testVoice()}>
          {busy === "voice" ? "Speaking…" : "Test OneBrain voice"}
        </button>
      </div>

      <label>
        Microphone
        <select
          value={micDeviceId || ""}
          onChange={(e) => setMicDeviceId(e.target.value || null)}
          disabled={!inputs.length}
        >
          <option value="">
            {inputs.length ? "Default microphone" : "No microphone detected"}
          </option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {cleanDeviceLabel(d.label, "Microphone")}
            </option>
          ))}
        </select>
      </label>

      {namesHidden && (
        <p className="settings-footnote">
          Device names are hidden until microphone permission is granted once.
          <button
            className="text-button"
            disabled={busy !== null}
            onClick={() => void revealNames()}
          >
            {busy === "mic" ? "Asking…" : "Unlock device names"}
          </button>
        </p>
      )}

      <div className="settings-actions">
        <button disabled={busy !== null} onClick={() => void refresh()}>
          Re-detect devices
        </button>
        {silentMode && (
          <button onClick={() => updateSettings({ silentMode: false })}>
            Turn off Silent Mode
          </button>
        )}
      </div>

      {silentMode && (
        <p className="device-plan plan-blocked" role="status">
          Silent Mode is on, so answers stay text only.
        </p>
      )}
      {!silentMode && voices.length === 0 && (
        <p className="device-plan plan-blocked" role="status">
          {health.message} {health.hint}
        </p>
      )}
      {status && <p role="status">{status}</p>}

      <p className="settings-footnote">
        Devices are detected automatically and re-read the moment something
        connects or disconnects. Replies are played as audio, so they follow
        the system output; on Chromium browsers a pinned device is also applied
        through setSinkId. On iPhone/iPad the system alone decides — connect the
        neckband or earbuds and it plays there with no setting to change.
      </p>
    </section>
  );
}

export default AudioDevices;
