"use client";
// A3 split: the acoustic half of the voice engine. It owns the mic stream, the
// silent keep-alive AudioContext (which also feeds the pitch analyser), pitch
// sampling, environment noise-floor tracking and the 3-second owner enrollment.
// Only its own nodes and timers live here; useAssistant keeps the recognizer,
// the reply pipeline and the session state machine, reading the returned
// refs/callbacks exactly where it used to own them.

import { useCallback, useRef } from "react";
import { useAssistantStore } from "@/store/assistant";
import { micConstraints } from "@/lib/voice/audio";
import { detectPitch, median } from "@/lib/voice/voiceprint";
import {
  classifyEnvironment,
  environmentChanged,
  resetNoiseFloor,
  rmsOf,
  updateNoiseFloor,
  type EnvironmentClass,
  type NoiseFloorState,
} from "@/lib/voice/environment";

export function useVoicePrint() {
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  // Environment + interruption state (lib/voice/environment.ts, lib/voice/barge-in.ts).
  // The noise floor is smoothed across frames; the microphone is the same
  // stream used for pitch, so this costs no extra permission or battery.
  const noiseRef = useRef<NoiseFloorState>(resetNoiseFloor());
  const envRef = useRef<EnvironmentClass | null>(null);
  // Last moment the microphone frame carried voice energy. The recognizer
  // drops results now and then while the person is still talking; this is how
  // the turn assembler tells "dropped a result" from "stopped talking".
  const lastVoiceAtRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const pitchWinRef = useRef<Array<{ t: number; hz: number }>>([]);
  const pitchTimerRef = useRef<any>(null);

  const stopPitchTracking = useCallback(() => {
    try {
      if (pitchTimerRef.current) clearInterval(pitchTimerRef.current);
    } catch {}
    pitchTimerRef.current = null;
    try {
      analyserRef.current?.disconnect();
    } catch {}
    analyserRef.current = null;
    pitchWinRef.current = [];
    // No frame is being read any more, so "voice energy" must not stay true
    // and hold a turn open for nothing.
    lastVoiceAtRef.current = 0;
  }, []);

  // Sample mic pitch a few times per second while listening. Feeds the
  // speaker tags above; cheap (one 2048 FFT buffer per tick).
  const startPitchTracking = useCallback(() => {
    try {
      const ctx = audioCtxRef.current;
      const stream = streamRef.current;
      if (!ctx || !stream) return;
      stopPitchTracking();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyserRef.current = analyser;
      pitchTimerRef.current = setInterval(() => {
        try {
          const st = useAssistantStore.getState();
          if (!st.isActive || st.currentStatus !== "listening") return;
          const buf = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(buf);
          // Environment recognition: the same frame that carries a voice also
          // carries the room. Track the sustained floor and tell the app when
          // the surroundings change (see lib/voice/environment.ts for the rules).
          noiseRef.current = updateNoiseFloor(noiseRef.current, rmsOf(buf));
          // Voice activity, from the very same frame: energy well above the
          // smoothed floor is the person talking. The turn assembler reads
          // this so a dropped recognition result never ends a turn early.
          // (rmsOf over 2048 samples costs microseconds; this tick is 250 ms.)
          const energy = rmsOf(buf);
          const floor = noiseRef.current.floor ?? 0;
          if (energy > Math.max(0.015, floor * 3)) lastVoiceAtRef.current = Date.now();
          const env = classifyEnvironment(noiseRef.current.floor ?? 0);
          if (environmentChanged(envRef.current, env)) {
            envRef.current = env;
            try {
              useAssistantStore.getState().setMicEnvironment(env);
              useAssistantStore
                .getState()
                .logBgEvent("environment", `${env} · floor ${(noiseRef.current.floor ?? 0).toFixed(4)}`);
            } catch {}
          }
          const hz = detectPitch(buf, ctx.sampleRate);
          if (hz != null) {
            pitchWinRef.current.push({ t: Date.now(), hz });
            const cutoff = Date.now() - 8000;
            pitchWinRef.current = pitchWinRef.current.filter(
              (w) => w.t > cutoff,
            );
          }
        } catch {}
      }, 250);
    } catch {}
  }, [stopPitchTracking]);

  // 3-second owner enrollment: read a line aloud, we store median pitch.
  const enrollVoice = useCallback(async (): Promise<number | null> => {
    const s = await navigator.mediaDevices.getUserMedia(
      micConstraints(useAssistantStore.getState().micDeviceId),
    );
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      try {
        await ctx.resume();
      } catch {}
      const src = ctx.createMediaStreamSource(s);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const pitches: number[] = [];
      const buf = new Float32Array(analyser.fftSize);
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 250));
        analyser.getFloatTimeDomainData(buf);
        const hz = detectPitch(buf, ctx.sampleRate);
        if (hz != null) pitches.push(hz);
      }
      try {
        s.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        await ctx.close();
      } catch {}
      const med = median(pitches);
      if (med == null) return null;
      useAssistantStore.getState().setVoiceBaseline(Math.round(med));
      return Math.round(med);
    } catch (e) {
      try {
        s.getTracks().forEach((t) => t.stop());
      } catch {}
      throw e;
    }
  }, []);

  const startSilentLoop = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current!;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 0.001;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      osc.start();
      oscRef.current = osc;
    } catch {}
  }, []);

  return {
    streamRef,
    audioCtxRef,
    oscRef,
    noiseRef,
    envRef,
    lastVoiceAtRef,
    analyserRef,
    pitchWinRef,
    pitchTimerRef,
    stopPitchTracking,
    startPitchTracking,
    enrollVoice,
    startSilentLoop,
  };
}
