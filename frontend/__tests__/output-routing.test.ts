import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  activeSinkId,
  knownOutputs,
  refreshOutputRouting,
  resolvedOutput,
  startOutputRouting,
} from '../lib/audio';

const DEVICES = [
  { kind: 'audioinput', deviceId: 'mic-1', label: 'Phone microphone' },
  { kind: 'audiooutput', deviceId: 'default', label: 'Default - Phone speaker' },
  { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Phone speaker' },
  { kind: 'audiooutput', deviceId: 'bt-neckband', label: 'boAt Neckband' },
];

function stubDevices(list = DEVICES) {
  vi.stubGlobal('navigator', {
    mediaDevices: { enumerateDevices: async () => list, addEventListener() {}, removeEventListener() {} },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('automatic output detection', () => {
  it('lists outputs and resolves the automatic target to the system default', async () => {
    stubDevices();
    await refreshOutputRouting(null);
    expect(knownOutputs().map((d) => d.deviceId)).toEqual(['default', 'speaker-1', 'bt-neckband']);
    // The synthetic `default` entry is resolved to the concrete device it mirrors.
    expect(resolvedOutput().deviceId).toBe('speaker-1');
    expect(activeSinkId(null)).toBe('speaker-1');
  });

  it('uses an explicitly pinned device while it is still connected', async () => {
    stubDevices();
    await refreshOutputRouting('bt-neckband');
    expect(activeSinkId('bt-neckband')).toBe('bt-neckband');
    expect(activeSinkId(null)).toBe('bt-neckband');
  });

  it('falls back to the automatic target when a pinned neckband disconnects', async () => {
    stubDevices();
    await refreshOutputRouting('bt-neckband');
    stubDevices(DEVICES.filter((d) => d.deviceId !== 'bt-neckband'));
    await refreshOutputRouting('bt-neckband');
    expect(activeSinkId('bt-neckband')).toBe('speaker-1');
  });

  it('keeps one watcher (no duplicate devicechange subscriptions) and stops cleanly', async () => {
    let added = 0;
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: async () => DEVICES,
        addEventListener() {
          added += 1;
        },
        removeEventListener() {},
      },
    });
    const first = await startOutputRouting(() => null);
    const second = await startOutputRouting(() => null);
    expect(added).toBe(1);
    first();
    second();
    const third = await startOutputRouting(() => null);
    expect(typeof third).toBe('function');
  });

  it('reports nothing to route when no output exists, without throwing', async () => {
    stubDevices([]);
    await refreshOutputRouting(null);
    expect(activeSinkId(null)).toBeNull();
    expect(resolvedOutput().label).toBeNull();
  });
});
