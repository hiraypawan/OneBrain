"use client";
import { useEffect, useRef, useState } from "react";
import { useAssistantStore } from "@/store/assistant";
import { detectPitch, learnBaseline, rangeFromPitch } from "@/lib/voiceprint";
import { micConstraints } from "@/lib/audio";
// Deliberately does not mount the conversation engine or request audio on render.
export function VoiceEnrollment() {
  const { settings, updateSettings, voiceBaseline, setVoiceBaseline } =
    useAssistantStore();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  async function enroll() {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage(
      "Allow the microphone, then read one sentence aloud for three seconds.",
    );
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    const stop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      if (context && context.state !== "closed")
        void context.close().catch(() => {});
    };
    controller.signal.addEventListener("abort", stop);
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        micConstraints(useAssistantStore.getState().micDeviceId),
      );
      if (controller.signal.aborted) return;
      const Context = window.AudioContext || (window as any).webkitAudioContext;
      context = new Context();
      if (!context) throw new Error();
      await context.resume();
      if (controller.signal.aborted) return;
      const source = context.createMediaStreamSource(stream),
        analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const pitches: number[] = [],
        buffer = new Float32Array(analyser.fftSize);
      for (let i = 0; i < 12; i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (controller.signal.aborted) return;
        analyser.getFloatTimeDomainData(buffer);
        const pitch = detectPitch(buffer, context.sampleRate);
        if (pitch !== null) pitches.push(pitch);
      }
      // Re-enrolling no longer overwrites the profile with one sample: the new
      // reading is blended into the stored baseline, so a husky morning or a
      // noisy room cannot permanently move the owner's range.
      const hz = learnBaseline(voiceBaseline, pitches);
      if (hz === null)
        setMessage("No clear voice detected. Try again somewhere quiet.");
      else {
        setVoiceBaseline(Math.round(hz));
        const range = rangeFromPitch(hz);
        setMessage(
          `Voice profile saved at approximately ${Math.round(hz)} Hz${range === "unknown" ? "" : ` (${range} range)`}. Enroll again any time to make it steadier. This is not identity verification.`,
        );
      }
    } catch {
      if (!controller.signal.aborted)
        setMessage(
          "Microphone unavailable. Check browser permissions and try again.",
        );
    } finally {
      stop();
      controller.signal.removeEventListener("abort", stop);
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <p>
        This experimental pitch filter can make mistakes and cannot reliably
        exclude other people. It never verifies identity or authorizes actions.{" "}
        {voiceBaseline
          ? `Current baseline: approximately ${voiceBaseline} Hz.`
          : "No voice baseline enrolled."}
        {voiceBaseline
          ? " In a loud room only this voice is answered; everywhere else nothing changes."
          : " Enroll once and a loud room will know to ignore the background instead of answering it."}
      </p>
      <div className="settings-actions">
        <button disabled={busy} onClick={() => void enroll()}>
          {busy ? "Listening…" : "Enroll my voice"}
        </button>
        {busy && (
          <button
            onClick={() => {
              request.current?.abort();
              setBusy(false);
              setMessage("Enrollment cancelled. No new baseline saved.");
            }}
          >
            Cancel enrollment
          </button>
        )}
        {voiceBaseline && (
          <button
            disabled={busy}
            onClick={() => {
              setVoiceBaseline(null);
              setMessage("Local pitch baseline removed.");
            }}
          >
            Remove voice baseline
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      <label className="switch-row">
        <span>
          Filter very different voices
          <small>
            Attempts to filter by pitch only while listening. Requires an
            enrolled baseline; not a security boundary.
          </small>
        </span>
        <input
          type="checkbox"
          checked={settings.ownerOnly}
          onChange={(e) => updateSettings({ ownerOnly: e.target.checked })}
        />
      </label>
    </>
  );
}
