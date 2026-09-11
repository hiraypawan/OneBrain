import { describe, it, expect } from 'vitest';
import { micConstraints, outputSelectionSupported, listAudioDevices, diagnoseMicError } from '../lib/audio';

describe('micConstraints', () => {
  it('requests echo/noise/gain control by default', () => {
    const c = micConstraints(null);
    expect(c.audio.echoCancellation).toBe(true);
    expect(c.audio.noiseSuppression).toBe(true);
    expect(c.audio.autoGainControl).toBe(true);
    expect(c.audio.deviceId).toBeUndefined();
  });

  it('pins an exact device when the user picked one', () => {
    const c = micConstraints('abc123');
    expect(c.audio.deviceId).toEqual({ exact: 'abc123' });
  });
});

describe('outputSelectionSupported', () => {
  it('is false without a DOM (SSR/tests)', () => {
    expect(outputSelectionSupported()).toBe(false);
  });
});

describe('listAudioDevices', () => {
  it('returns empty lists without browser APIs instead of throwing', async () => {
    await expect(listAudioDevices()).resolves.toEqual({ inputs: [], outputs: [] });
  });
});

describe('diagnoseMicError', () => {
  it('retries default when the pinned Bluetooth mic vanished', () => {
    expect(diagnoseMicError('OverconstrainedError', true, 2)).toBe('retry-default');
    expect(diagnoseMicError('NotFoundError', true, 0)).toBe('retry-default');
  });

  it('reports no-hardware when the OS exposes zero inputs', () => {
    expect(diagnoseMicError('NotFoundError', false, 0)).toBe('no-hardware');
    expect(diagnoseMicError('OverconstrainedError', false, 0)).toBe('no-hardware');
  });

  it('passes everything else through (busy/blocked)', () => {
    expect(diagnoseMicError('NotAllowedError', false, 2)).toBe('passthrough');
    expect(diagnoseMicError('NotReadableError', false, 1)).toBe('passthrough');
    expect(diagnoseMicError('NotFoundError', false, 2)).toBe('passthrough');
    expect(diagnoseMicError('NotFoundError', false, -1)).toBe('passthrough');
  });
});
