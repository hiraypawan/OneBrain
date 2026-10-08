import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultSettings, normalizeSettings } from '../lib/settings';
import { useAssistantStore } from '../store/assistant';

/**
 * Voice behaviour that lives in the hook: the wiring is asserted at the source
 * level (this repo's e2e-contract style) because the recognition loop only
 * exists inside a browser's SpeechRecognition implementation.
 */
const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const hook = read('hooks/useAssistant.ts');
const surface = read('components/voice/VoiceSurface.tsx');

describe('interrupting and resuming a spoken reply', () => {
  it('is on by default and can be turned off', () => {
    expect(defaultSettings.bargeIn).toBe(true);
    expect(normalizeSettings({}).bargeIn).toBe(true);
    expect(normalizeSettings({ bargeIn: false }).bargeIn).toBe(false);
    // Untrusted input must not grant it by accident.
    expect(normalizeSettings({ bargeIn: 'yes' }).bargeIn).toBe(false);
  });

  it('keeps the recognizer open while speaking instead of muting the user', () => {
    // The old loop stopped recognition during playback, which made interrupting
    // impossible. Now it only stops when barge-in is switched off, and every
    // result heard during playback goes through the interruption classifier —
    // never into the turn collector.
    expect(hook).toContain('bargeInRef.current = useAssistantStore.getState().settings.bargeIn !== false');
    expect(hook).toContain('if (speakingRef.current && bargeInRef.current) {');
    expect(hook).toContain('classifyWhileSpeaking(heard)');
    expect(hook).toContain('barge-ignored');
    expect(hook).toContain('controlsRef.current.interruptSpeech("user-interrupt")');
  });

  it('records how far the answer got and resumes from a sentence start', () => {
    expect(hook).toContain('spokenCharsRef');
    expect(hook).toContain('recordInterruption(');
    expect(hook).toContain('resumePlan(progress)');
    expect(hook).toContain('speak(plan.text, { spokenBefore: plan.offset, origin: progress.text })');
    // The browser voice reports progress at chunk boundaries.
    expect(read('lib/speech.ts')).toContain('opts.onProgress?.(spokenChars)');
  });

  it('finishes the answer on the spoken phrase, before any AI call', () => {
    const resumeAt = hook.indexOf('isResumeRequest(transcript) && carried');
    const commandAt = hook.indexOf('const cmd = parseVoiceCommand(transcript)');
    expect(resumeAt).toBeGreaterThan(-1);
    expect(commandAt).toBeGreaterThan(resumeAt);
  });

  it('offers the remainder on screen and by tap', () => {
    expect(surface).toContain('resume-answer');
    expect(surface).toContain('Continue where it stopped');
    expect(surface).toContain('assistant.resumeSpeech()');
    expect(surface).toContain('Stop and let me talk');
    // The microphone control that the browser suite drives is untouched.
    expect(surface).toContain("data-testid={listening ? 'stop-button' : 'active-button'}");
  });
});

describe('environment recognition is wired into listening', () => {
  it('measures the room from the microphone frames it already reads', () => {
    expect(hook).toContain('updateNoiseFloor(noiseRef.current, rmsOf(buf))');
    expect(hook).toContain('classifyEnvironment(noiseRef.current.floor ?? 0)');
    expect(hook).toContain('setMicEnvironment(env)');
    // A new session re-measures instead of trusting the last room.
    expect(hook).toContain('noiseRef.current = resetNoiseFloor()');
  });

  it('lets the room change the wait, never the user\'s ceiling', () => {
    expect(hook).toContain('effectiveEndOfSpeechMs(');
    expect(hook).toContain('environmentTuning(useAssistantStore.getState().micEnvironment ?? "home")');
  });

  it('answers only the enrolled voice in a loud room', () => {
    expect(hook).toContain('ownerRequiredHere(tuning, stGate.voiceBaseline, !!stGate.settings.ownerOnly)');
    expect(hook).toContain('tuning,');
    expect(surface).toContain('voice-environment');
    expect(read('components/settings/Preferences.tsx')).toContain('environmentTuning(state.micEnvironment)');
  });

  it('exposes both readings to the store the UI reads', () => {
    const state = useAssistantStore.getState();
    expect(state.micEnvironment).toBeNull();
    expect(state.speechProgress).toBeNull();
    state.setMicEnvironment('noisy');
    expect(useAssistantStore.getState().micEnvironment).toBe('noisy');
    state.setSpeechProgress({ text: 'one. two.', spokenChars: 4, at: 1 });
    expect(useAssistantStore.getState().speechProgress?.spokenChars).toBe(4);
    state.setMicEnvironment(null);
    state.setSpeechProgress(null);
  });
});
