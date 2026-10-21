import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clockStoreForTests, useNow } from '@/hooks/useNow';

// useNow() keeps clock-dependent text ("Good evening", today's date) out of
// prerendered HTML, so hydration never disagrees with the server; and keeps
// it current while the app stays open.

function Clock() {
  const now = useNow();
  return createElement('span', null, now ? `time ${now.getTime()}` : 'pending');
}

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(21, 8));
    clockStoreForTests.reset();
  });
  afterEach(() => {
    clockStoreForTests.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is null in server HTML, so a prerendered page never carries the build day', () => {
    expect(renderToString(createElement(Clock))).toBe('<span>pending</span>');
  });

  it('answers the same within a render, and freshly for a screen opened later', () => {
    const first = clockStoreForTests.getSnapshot();
    vi.advanceTimersByTime(30_000);
    expect(clockStoreForTests.getSnapshot()).toBe(first);
    vi.advanceTimersByTime(3 * 60 * 60_000);
    expect(clockStoreForTests.getSnapshot()).toBe(at(21, 11, 0) + 30_000);
  });

  it('moves on every minute and on returning to the app; stops when unwatched', () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', doc);
    const seen: number[] = [];
    clockStoreForTests.getSnapshot();
    const unsubscribe = clockStoreForTests.subscribe(() => seen.push(clockStoreForTests.getSnapshot()));

    vi.advanceTimersByTime(60_000);
    expect(seen).toEqual([at(21, 8, 1)]);

    // Left open overnight in the background, where timers barely run.
    vi.setSystemTime(at(22, 7, 30));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(seen.at(-1)).toBe(at(22, 7, 30));

    unsubscribe();
    vi.advanceTimersByTime(5 * 60_000);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toHaveLength(2);
  });
});
