import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Wiring regressions for music playback.
 *
 * The player used to be unreachable: `MediaPlayer` was mounted nowhere,
 * `parseMediaCommand` was called only by tests, the play event was never
 * dispatched, and the mounted listener closed over a `const` declared after an
 * early return (a TDZ ReferenceError that no catch could see). Unit tests of
 * pure helpers cannot catch any of that, so these assertions check the
 * connections themselves.
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const layout = read('app/layout.tsx');
const player = read('components/MediaPlayer.tsx');
const assistant = read('hooks/useAssistant.ts');
const mediaLib = read('lib/media.ts');
const mediaStore = read('store/media.ts');

describe('the player is reachable', () => {
  it('is mounted once in the root layout', () => {
    expect(layout).toMatch(/import\s*{\s*MediaPlayer\s*}\s*from\s*'@\/components\/MediaPlayer'/);
    expect(layout).toContain('<MediaPlayer />');
  });

  it('announces its own presence so a voice request cannot vanish', () => {
    expect(player).toContain('setPlayerMounted(true)');
    expect(player).toMatch(/return \(\) => setPlayerMounted\(false\)/);
    expect(mediaStore).toMatch(/playerMounted/);
    expect(mediaStore).toMatch(/not mounted/i);
  });

  it('is driven by the store, not by an invisible window-event channel', () => {
    expect(mediaLib).not.toMatch(/MEDIA_PLAY_EVENT|MEDIA_CONTROL_EVENT|onebrain-media-/);
    expect(player).not.toMatch(/MEDIA_PLAY_EVENT|MEDIA_CONTROL_EVENT/);
    expect(assistant).not.toMatch(/MEDIA_PLAY_EVENT|MEDIA_CONTROL_EVENT/);
  });
});

describe('the voice intent is wired', () => {
  it('parses media commands inside the transcript pipeline', () => {
    expect(assistant).toMatch(/parseMediaCommand/);
    expect(assistant).toMatch(/import\s*{\s*parseVoiceCommand,\s*parseMediaCommand/);
    expect(assistant).toContain('const media = parseMediaCommand(transcript)');
  });

  it('drives the shared store for play, pause, resume, next and close', () => {
    expect(assistant).toMatch(/mediaStore\.request\(media\.query, media\.kinds\)/);
    expect(assistant).toMatch(/mediaStore\.control\(media\.action\)/);
    expect(assistant).toMatch(/useMediaStore\.getState\(\)\.control\("close"\)/);
  });

  it('honours the explicit opt-out instead of playing anyway', () => {
    expect(assistant).toMatch(/settings\.musicEnabled/);
    expect(assistant).toMatch(/Music playback is turned off/);
  });

  it('never routes a media command to the AI or into memory', () => {
    // The media block returns before the feature engine and the chat call.
    const mediaAt = assistant.indexOf('const media = parseMediaCommand(transcript)');
    const featureAt = assistant.indexOf('feat = await handleFeatureTurn(transcript)');
    const chatAt = assistant.indexOf('const answer = await fetchChat(transcript');
    expect(mediaAt).toBeGreaterThan(-1);
    expect(featureAt).toBeGreaterThan(mediaAt);
    expect(chatAt).toBeGreaterThan(mediaAt);
  });
});

describe('playback failures are loud', () => {
  it('handles stream errors, stalls, endings and blocked autoplay', () => {
    expect(player).toContain('onError=');
    expect(player).toContain('onEnded=');
    expect(player).toContain('onWaiting=');
    expect(player).toMatch(/reportPlayback\('blocked'\)/);
    expect(player).toMatch(/refuseCurrent\(/);
  });

  it('routes music to the pinned speaker through the shared audio helpers', () => {
    expect(player).toMatch(/activeSinkId\(/);
    expect(player).toMatch(/setSinkId/);
  });

  it('ducks music while a spoken reply owns the speaker', () => {
    expect(player).toContain('SPEECH_DUCK_EVENT');
    expect(read('lib/audio.ts')).toMatch(/export function signalSpeechPlayback/);
    expect(read('lib/speech.ts')).toMatch(/signalSpeechPlayback\('start'\)/);
  });

  it('does not mount a second assistant hook instance', () => {
    // useAssistant owns the microphone; a second instance in the root layout
    // would double-register recognition, timers and output routing.
    expect(player).not.toMatch(/useAssistant\(\)/);
    expect(player).not.toMatch(/from '@\/hooks\/useAssistant'/);
  });
});
