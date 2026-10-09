import { describe, expect, it } from 'vitest';
import {
  correctProperNouns,
  phoneticKey,
  pickBestAlternative,
  resolveStationName,
} from '../lib/pronunciation';
import { detectTransitIntent } from '../lib/transit';

describe('pronunciation core: Indian station names survive the engine', () => {
  it('maps a truncated Vangani back to Vangani', () => {
    expect(resolveStationName('vani')).toBe('vangani');
    expect(resolveStationName('vangani')).toBe('vangani');
    expect(resolveStationName('wangani')).toBe('vangani');
  });

  it('repairs a full route transcript, keeping the rest of the words', () => {
    const r = correctProperNouns('vani station to kalyan local time');
    expect(r.text).toContain('vangani');
    expect(r.text).toContain('kalyan');
    expect(r.corrections.length).toBeGreaterThanOrEqual(1);
  });

  it('does not rewrite ordinary words or short fillers', () => {
    expect(correctProperNouns('call vani now').text).not.toContain('vangani');
    expect(correctProperNouns('to go now').text).toBe('to go now');
    expect(resolveStationName('to')).toBeNull();
  });

  it('keeps phonetic variants together (w/v, aspirates, doubles)', () => {
    expect(phoneticKey('wangani')).toBe(phoneticKey('vangani'));
    expect(phoneticKey('andhari')).toBe(phoneticKey('andheri'));
    expect(resolveStationName('andhari')).toBe('andheri');
  });

  it('picks the n-best alternative that keeps the proper noun', () => {
    expect(pickBestAlternative(['vani station time', 'vangani station time'])).toBe(
      'vangani station time',
    );
  });

  it('routes a misheard Vangani turn to suburban with both stations', () => {
    const i = detectTransitIntent('vani station se kalyan local time batao');
    expect(i?.kind).toBe('suburban');
    if (i?.kind === 'suburban') {
      expect(i.from).toBe('vangani');
      expect(i.to).toBe('kalyan');
    }
  });

  it('resolves between-station typo from/to', () => {
    const i = detectTransitIntent('trains from pune to mumbi');
    expect(i?.kind).toBe('between');
    if (i?.kind === 'between') {
      expect(i.from).toBe('pune');
      expect(i.to).toBe('mumbai');
    }
  });
});
