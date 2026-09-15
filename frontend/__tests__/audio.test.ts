import { describe, it, expect } from 'vitest';
import { micConstraints, outputSelectionSupported, listAudioDevices, diagnoseMicError, cleanDeviceLabel, defaultOutput, pickableOutputs, autoPickOutput, speakerPlan, testToneDataUrl, watchAudioDevices } from '../lib/audio';

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

// --- Output device detection: the "I can't hear him on my neckband" path ---

describe('cleanDeviceLabel', () => {
  it('strips the synthetic Default prefix', () => {
    expect(cleanDeviceLabel('Default - Pawan’s Neckband')).toBe('Pawan’s Neckband');
    expect(cleanDeviceLabel('System Default: Speakers')).toBe('Speakers');
    expect(cleanDeviceLabel('', 'Speaker')).toBe('Speaker');
  });
});

describe('defaultOutput', () => {
  const outputs = [
    { deviceId: 'default', label: 'Neckband', isDefault: true },
    { deviceId: 'a1', label: 'Neckband', isDefault: false },
  ];

  it('finds the OS default entry', () => {
    expect(defaultOutput(outputs)?.deviceId).toBe('default');
    expect(defaultOutput([])).toBeNull();
    expect(defaultOutput(undefined)).toBeNull();
  });

  it('excludes the synthetic default from what the user can pick', () => {
    expect(pickableOutputs(outputs).map((d) => d.deviceId)).toEqual(['a1']);
  });
});

describe('autoPickOutput', () => {
  const outputs = [
    { deviceId: 'default', label: 'Phone speaker', isDefault: true },
    { deviceId: 'a1', label: 'Phone speaker', isDefault: false },
    { deviceId: 'b2', label: 'Neckband', isDefault: false },
  ];

  it('keeps the previous pin while that device is still connected', () => {
    expect(autoPickOutput(outputs, 'b2')).toBe('b2');
  });

  it('falls back to the system default when the pin disappeared', () => {
    expect(autoPickOutput(outputs, 'zz-gone')).toBe('a1');
  });

  it('falls back to the first device when no default is reported', () => {
    expect(autoPickOutput([{ deviceId: 'b2', label: 'Neckband', isDefault: false }], null)).toBe('b2');
  });

  it('returns null when the OS exposes no output at all', () => {
    expect(autoPickOutput([], 'b2')).toBeNull();
  });
});

describe('speakerPlan', () => {
  const outputs = [
    { deviceId: 'default', label: 'Phone speaker', isDefault: true },
    { deviceId: 'a1', label: 'Phone speaker', isDefault: false },
    { deviceId: 'b2', label: 'Neckband', isDefault: false },
  ];

  it('says the system default carries the voice when nothing is pinned', () => {
    const p = speakerPlan({ outputs, chosenId: null, routingSupported: true });
    expect(p.mode).toBe('system-default');
    expect(p.message).toMatch(/Phone speaker/);
    expect(p.hint).toBeNull();
  });

  it('admits speechSynthesis cannot be redirected, and how to fix it', () => {
    const p = speakerPlan({ outputs, chosenId: 'b2', routingSupported: false });
    expect(p.mode).toBe('mismatch');
    expect(p.message).toMatch(/system default output/);
    expect(p.hint).toMatch(/Make Neckband the system default/);
  });

  it('routes media audio but still warns that speech follows the OS', () => {
    const p = speakerPlan({ outputs, chosenId: 'b2', routingSupported: true });
    expect(p.mode).toBe('routed');
    expect(p.canRoute).toBe(true);
    expect(p.message).toMatch(/routed to Neckband/);
    expect(p.hint).toMatch(/system default/);
  });

  it('reports a disconnected selection and re-picks automatically', () => {
    const p = speakerPlan({ outputs, chosenId: 'zz-gone', routingSupported: true });
    expect(p.mode).toBe('unavailable');
    expect(p.deviceId).toBe('a1');
  });

  it('reports no output device at all', () => {
    const p = speakerPlan({ outputs: [], chosenId: null, routingSupported: true });
    expect(p.mode).toBe('none');
    expect(p.message).toMatch(/No output device/);
  });
});

describe('testToneDataUrl', () => {
  it('produces a playable WAV data URL with a real RIFF header', () => {
    const url = testToneDataUrl();
    expect(url.startsWith('data:audio/wav;base64,')).toBe(true);
    const b64 = url.slice('data:audio/wav;base64,'.length);
    const head = Buffer.from(b64.slice(0, 16), 'base64').toString('latin1');
    expect(head.startsWith('RIFF')).toBe(true);
    expect(head.slice(8, 12)).toBe('WAVE');
  });
});

describe('watchAudioDevices', () => {
  it('is a safe no-op without mediaDevices', () => {
    const stop = watchAudioDevices(() => {});
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });
});
