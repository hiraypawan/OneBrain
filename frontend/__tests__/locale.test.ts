// lib/locale: where the user is and how OneBrain talks to them — and every
// place that depends on it (prompt, voice, money, crisis lines, translator).
import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { countryFromTimeZone, normalizeCountry, isSupportedCurrency, currencyChoices } from '../lib/locale/countries';
import { resolveLocale, type LocaleSignals } from '../lib/locale/resolve';
import { resolveVoiceLanguage, isLanguageSetting } from '../lib/locale/voice-languages';
import { currencyFromText, formatDate, formatMoney, formatWeight } from '../lib/locale/format';
import { detectLatinLanguage, scriptLanguage } from '../lib/locale/text-language';
import { normalizeSettings } from '../lib/storage/settings';
import { buildTurnPrompt, detectReplyLanguage } from '../lib/ai/prompt';
import { pickTtsVoice, ttsLangFor } from '../lib/voice/speech';
import { SUPPORTIVE_REPLY, supportiveReply } from '../lib/features/nightmind';
import { defaultPairId, detectLangInPair, detectTranslatorIntent, offlineTranslate, pairById } from '../lib/features/translate';
import { transitAppliesTo } from '../lib/features/transit';
import { parseFitnessLog } from '../lib/features/fitness';
import { detectPlatform, micPermissionHelp, voiceInputNotice } from '../lib/voice/capabilities';
import { GET as geo } from '../app/api/geo/route';
import { AUSTRALIA, DEFAULT_TEST_DEVICE, GERMANY, INDIA, UK, US, useDevice } from './helpers/locale';

const signals = (over: Partial<LocaleSignals>): LocaleSignals => ({ timeZone: null, languages: [], networkCountry: null, ...over });

afterEach(() => useDevice(DEFAULT_TEST_DEVICE));

describe('where the user is', () => {
  it('reads the country from the device time zone, including old and prefixed names', () => {
    expect(countryFromTimeZone('Europe/London')).toBe('GB');
    expect(countryFromTimeZone('Australia/Perth')).toBe('AU');
    expect(countryFromTimeZone('America/Indiana/Indianapolis')).toBe('US');
    expect(countryFromTimeZone('Asia/Calcutta')).toBe('IN');
    expect(countryFromTimeZone('UTC')).toBeNull();
    expect(countryFromTimeZone(null)).toBeNull();
  });
  it('trusts the time zone over the network (VPNs move the IP, not the clock)', () => {
    expect(resolveLocale({}, signals({ timeZone: 'Asia/Kolkata', networkCountry: 'US', languages: ['en-US'] })).country).toBe('IN');
  });
  it('falls back to the network, then the browser region', () => {
    expect(resolveLocale({}, signals({ timeZone: 'UTC', networkCountry: 'CA' }))).toMatchObject({ country: 'CA', countrySource: 'network' });
    expect(resolveLocale({}, signals({ languages: ['en-NZ'] }))).toMatchObject({ country: 'NZ', countrySource: 'language' });
    expect(resolveLocale({}, signals({}))).toMatchObject({ country: null, english: 'en-US', currency: 'USD' });
  });
  it('lets an explicit region win', () => {
    expect(resolveLocale({ country: 'au' }, UK)).toMatchObject({ country: 'AU', countrySource: 'setting', english: 'en-AU', currency: 'AUD' });
    expect(normalizeCountry('xx')).toBeNull();
  });
});

describe('how OneBrain talks', () => {
  it('speaks the local English: accent from the country, not the browser default', () => {
    expect(resolveLocale({}, UK)).toMatchObject({ english: 'en-GB', currency: 'GBP', units: 'uk', indian: false, hinglish: false });
    expect(resolveLocale({}, US)).toMatchObject({ english: 'en-US', currency: 'USD', units: 'us' });
    expect(resolveLocale({}, AUSTRALIA).voice.recognition).toBe('en-AU');
    // An Indian phone left on "English (US)" still gets the Indian English model.
    const india = resolveLocale({}, signals({ timeZone: 'Asia/Kolkata', languages: ['en-US'] }));
    expect(india).toMatchObject({ english: 'en-IN', currency: 'INR', indian: true, hinglish: false });
    expect(india.voice.recognition).toBe('en-IN');
  });
  it('uses the device language when OneBrain supports it, otherwise stays in English', () => {
    expect(resolveLocale({}, GERMANY)).toMatchObject({ english: 'en-GB', currency: 'EUR' });
    expect(resolveLocale({}, GERMANY).voice.id).toBe('de-DE');
    expect(resolveLocale({}, signals({ timeZone: 'Europe/London', languages: ['ru-RU'] })).voice.id).toBe('en-GB');
    expect(resolveVoiceLanguage('auto', ['zh-Hant-TW'], 'en-US', 'TW').id).toBe('zh-TW');
    expect(resolveVoiceLanguage('auto', ['es-AR'], 'en-US', 'AR').id).toBe('es-MX');
    expect(resolveVoiceLanguage('auto', ['pt'], 'en-GB', 'PT').id).toBe('pt-PT');
  });
  it('keeps explicit choices, including Hinglish', () => {
    const hinglish = resolveLocale({ language: 'hinglish' }, UK);
    expect(hinglish.voice).toMatchObject({ recognition: 'hi-IN', tts: 'en-IN', reply: 'hinglish' });
    expect(hinglish).toMatchObject({ hinglish: true, indian: true, voiceAuto: false });
    expect(isLanguageSetting('auto') && isLanguageSetting('marathi') && !isLanguageSetting('klingon')).toBe(true);
  });
});

describe('settings migration', () => {
  it('moves the old Hinglish default to auto exactly once', () => {
    expect(normalizeSettings({ language: 'hinglish' }).language).toBe('auto');
    expect(normalizeSettings({ language: 'hinglish', settingsVersion: 2 }).language).toBe('hinglish');
    expect(normalizeSettings({ language: 'en-IN' }).language).toBe('en-IN');
    expect(normalizeSettings({ language: 'nonsense' }).language).toBe('auto');
    expect(normalizeSettings({}).settingsVersion).toBe(2);
  });
  it('accepts only known regions', () => {
    expect(normalizeSettings({ country: 'gb' }).country).toBe('GB');
    expect(normalizeSettings({ country: 'ZZ' }).country).toBe('');
  });
});

describe('money, dates and units', () => {
  const uk = resolveLocale({}, UK);
  const us = resolveLocale({}, US);
  it('formats money the local way', () => {
    expect(formatMoney(1234.5, 'GBP', uk)).toBe('£1,234.50');
    expect(formatMoney(20, undefined, us)).toBe('$20');
    expect(formatMoney(123456, 'INR', us)).toBe('₹1,23,456');
  });
  it('orders dates the local way', () => {
    const d = new Date(2026, 9, 21);
    expect(formatDate(d, { day: 'numeric', month: 'long' }, uk)).toBe('21 October');
    expect(formatDate(d, { day: 'numeric', month: 'long' }, us)).toBe('October 21');
  });
  it('reads the currency of a spoken amount', () => {
    expect(currencyFromText('$20', 'AUD')).toBe('AUD');
    expect(currencyFromText('$20', 'INR')).toBe('USD');
    expect(currencyFromText('20 quid', 'USD')).toBe('GBP');
    expect(currencyFromText('rs 50', 'PKR')).toBe('PKR');
    expect(currencyFromText('lunch 12', 'EUR')).toBe('EUR');
  });
  it('logs pounds for Americans and kilograms elsewhere, always stored in kg', () => {
    useDevice(US);
    const us180 = parseFitnessLog('weight 180') as { log: { qty: number; label: string } };
    expect(us180.log).toMatchObject({ qty: 81.6, label: 'Weight 180 lb' });
    expect(formatWeight(81.6)).toBe('180 lb');
    useDevice(UK);
    expect((parseFitnessLog('weight 72') as { log: { qty: number } }).log.qty).toBe(72);
    expect((parseFitnessLog('spent £8.50 on coffee') as { log: { label: string; currency: string } }).log)
      .toMatchObject({ label: 'Spent £8.50 — coffee', currency: 'GBP' });
  });
  it('offers the user’s own currency first', () => {
    expect(currencyChoices('AUD')[0]).toBe('AUD');
    expect(isSupportedCurrency('NZD') && !isSupportedCurrency('XYZ')).toBe(true);
  });
});

describe('what the model is told', () => {
  it('uses the user’s clock, spelling, units and money — never India by default', () => {
    const p = buildTurnPrompt({ message: 'what time is it', language: 'en-GB', country: 'GB', timeZone: 'Europe/London', now: new Date('2026-10-21T12:00:00Z') });
    expect(p.system).toMatch(/1:00 PM \(Europe\/London\)/);
    expect(p.system).toMatch(/British spelling/);
    expect(p.system).toMatch(/United Kingdom/);
    expect(p.system).toMatch(/\(GBP\)/);
    expect(p.system).not.toMatch(/IST|India/);
    const us = buildTurnPrompt({ message: 'how hot is it', language: 'en-US', country: 'US', timeZone: 'America/Chicago' });
    expect(us.system).toMatch(/American spelling/);
    expect(us.system).toMatch(/US customary units/);
  });
  it('ignores a junk time zone or unknown country instead of failing', () => {
    const p = buildTurnPrompt({ message: 'hi there friend', timeZone: 'Mars/Olympus', country: 'ZZ' });
    expect(p.system).toMatch(/time zone is unknown/);
    expect(p.system).not.toMatch(/The user is in/);
  });
  it('answers in the language actually used, without mistaking other languages for Hinglish', () => {
    expect(detectReplyLanguage('co na obiad dzisiaj', 'pl-PL', 'PL')).toBe('polish');
    expect(detectReplyLanguage('wie ist das wetter heute', 'en-GB', 'GB')).toBe('german');
    expect(detectReplyLanguage('ho ho ho merry christmas', 'en-US', 'US')).toBe('english');
    expect(detectReplyLanguage('kya haal hai', 'en-IN', 'IN')).toBe('hinglish');
    expect(detectReplyLanguage('今日は何曜日ですか', 'en-US', 'US')).toBe('japanese');
    const tw = buildTurnPrompt({ message: '今天天氣如何', language: 'zh-TW' });
    expect(tw.system).toMatch(/Traditional characters/);
  });
  it('detects scripts and common words conservatively', () => {
    expect(scriptLanguage('東京に行きます')).toBe('japanese');
    expect(scriptLanguage('北京欢迎你')).toBe('chinese');
    expect(detectLatinLanguage('je voudrais un café avec du lait')).toBe('french');
    expect(detectLatinLanguage('ok')).toBeNull();
  });
});

describe('which voice speaks', () => {
  it('reads Japanese with a Japanese voice even though it contains kanji', () => {
    expect(ttsLangFor('今日は晴れです', 'en-US', 'en-US')).toBe('ja-JP');
  });
  it('uses the voice language for its own text and the English accent for English', () => {
    expect(ttsLangFor('Hoy hace sol y calor en la ciudad', 'es-MX', 'en-US')).toBe('es-MX');
    expect(ttsLangFor('The meeting is at three today', 'es-MX', 'en-US')).toBe('en-US');
    expect(ttsLangFor('The meeting is at three', 'en-GB', 'en-GB')).toBe('en-GB');
    expect(ttsLangFor('Kal meeting hai', 'hinglish', 'en-IN')).toBe('en-IN');
  });
  it('never picks a novelty voice and prefers the most natural one', () => {
    const mac = [{ name: 'Albert', lang: 'en-US' }, { name: 'Bubbles', lang: 'en-US' }, { name: 'Samantha', lang: 'en-US' }];
    expect(pickTtsVoice(mac, 'en-US').voice?.name).toBe('Samantha');
    const edge = [{ name: 'Microsoft Zira - English (United States)', lang: 'en-US' }, { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' }];
    expect(pickTtsVoice(edge, 'en-US').voice?.name).toMatch(/Aria Online \(Natural\)/);
  });
  it('falls back to the nearest accent', () => {
    const voices = [{ name: 'Samantha', lang: 'en-US' }, { name: 'Daniel', lang: 'en-GB' }];
    expect(pickTtsVoice(voices, 'en-AU').voice?.name).toBe('Daniel');
    expect(pickTtsVoice(voices, 'en-CA').voice?.name).toBe('Samantha');
  });
});

describe('crisis support', () => {
  it('gives the helpline and emergency number of the user’s country', () => {
    expect(supportiveReply(resolveLocale({}, UK))).toMatch(/Samaritans.*116 123.*999/);
    expect(supportiveReply(resolveLocale({}, US))).toMatch(/988.*911/);
    expect(supportiveReply(resolveLocale({}, signals({ timeZone: 'Asia/Kolkata', languages: ['en-IN'] })))).toMatch(/Tele-MANAS on 14416/);
    expect(supportiveReply(resolveLocale({ language: 'hinglish' }, INDIA))).toBe(SUPPORTIVE_REPLY);
  });
  it('points to a directory instead of guessing a number it does not know', () => {
    const brazil = supportiveReply(resolveLocale({}, signals({ timeZone: 'America/Sao_Paulo', languages: ['pt-BR'] })));
    expect(brazil).toMatch(/findahelpline\.com/);
    expect(brazil).toMatch(/local emergency number/);
  });
});

describe('translator pairs', () => {
  it('understands world-language pairs', () => {
    expect(detectTranslatorIntent('english to spanish')).toEqual({ action: 'pair', id: 'en-es' });
    expect(detectTranslatorIntent('translate to french')).toEqual({ action: 'pair', id: 'en-fr' });
    expect(detectTranslatorIntent('japanese translator')).toEqual({ action: 'pair', id: 'en-ja' });
    expect(detectTranslatorIntent('hindi to marathi')).toEqual({ action: 'pair', id: 'hi-mr' });
  });
  it('opens with the user’s own language', () => {
    expect(defaultPairId('german', false)).toBe('en-de');
    expect(defaultPairId('english', true)).toBe('hi-en');
    expect(defaultPairId('english', false)).toBe('en-es');
  });
  it('tells the two sides apart, even for one word', () => {
    expect(detectLangInPair('gracias', pairById('en-es'))).toBe('es');
    expect(detectLangInPair('where is the station', pairById('en-es'))).toBe('en');
    expect(offlineTranslate('hello', 'en', 'es')).toBeNull();
  });
});

describe('India-only features stay in India', () => {
  it('routes Indian rail questions only for Indian users or Indian places', () => {
    expect(transitAppliesTo('train status to boston', false)).toBe(false);
    expect(transitAppliesTo('mumbai local status', false)).toBe(true);
    expect(transitAppliesTo('train status to boston', true)).toBe(true);
  });
});

describe('voice capability notices', () => {
  const ua = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
    instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0',
  };
  it('recognises the platform, including iPads that claim to be Macs', () => {
    expect(detectPlatform({ userAgent: ua.iphone })).toEqual({ os: 'ios', browser: 'safari', inApp: false });
    expect(detectPlatform({ userAgent: ua.ipad, maxTouchPoints: 5 }).os).toBe('ios');
    expect(detectPlatform({ userAgent: ua.android })).toMatchObject({ os: 'android', browser: 'chrome' });
    expect(detectPlatform({ userAgent: ua.edge })).toMatchObject({ os: 'windows', browser: 'edge' });
    expect(detectPlatform({ userAgent: ua.instagram }).inApp).toBe(true);
  });
  it('explains what will not work before the user tries', () => {
    const all = { recognition: true, synthesis: true, microphone: true };
    expect(voiceInputNotice(detectPlatform({ userAgent: ua.firefox }), { ...all, recognition: false })).toMatch(/Firefox/);
    expect(voiceInputNotice(detectPlatform({ userAgent: ua.instagram }), all)).toMatch(/Open in Safari/);
    expect(voiceInputNotice(detectPlatform({ userAgent: ua.edge }), all)).toBeNull();
  });
  it('says exactly where to re-allow the microphone', () => {
    expect(micPermissionHelp(detectPlatform({ userAgent: ua.iphone }))).toMatch(/aA/);
    expect(micPermissionHelp(detectPlatform({ userAgent: ua.edge }))).toMatch(/Windows Settings/);
  });
});

describe('/api/geo', () => {
  const call = (headers: Record<string, string>) => geo(new NextRequest('https://onebrain.test/api/geo', { headers }));
  it('returns only a known country code and is never cached', async () => {
    const res = call({ 'cf-ipcountry': 'GB' });
    expect(await res.json()).toEqual({ country: 'GB' });
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(await call({ 'cf-ipcountry': 'XX' }).json()).toEqual({ country: null });
    expect(await call({}).json()).toEqual({ country: null });
  });
});
