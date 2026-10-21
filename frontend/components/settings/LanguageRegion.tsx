"use client";
// Language + region pickers. "Auto" follows the device (language from the
// browser, region from the time zone / network) and says what it detected,
// so the user can see why OneBrain sounds British, Australian or Indian.
import { useAssistantStore } from "@/store/assistant";
import { useLocale } from "@/hooks/useLocale";
import { COUNTRIES } from "@/lib/locale/countries";
import { AUTO_LANGUAGE, VOICE_LANGUAGES, voiceLanguageLabel } from "@/lib/locale/voice-languages";

const GROUPS: { label: string; test: (id: string) => boolean }[] = [
  { label: "English", test: (id) => id.startsWith("en-") },
  { label: "Indian languages", test: (id) => ["hinglish", "hi-IN", "marathi"].includes(id) },
  { label: "Other languages", test: (id) => !id.startsWith("en-") && !["hinglish", "hi-IN", "marathi"].includes(id) },
];

const SOURCE_LABEL: Record<string, string> = {
  timezone: "from your time zone",
  network: "from your network",
  language: "from your browser language",
};

const COUNTRY_OPTIONS = Object.entries(COUNTRIES)
  .map(([code, info]) => ({ code, name: info.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function LanguageRegion() {
  const settings = useAssistantStore((s) => s.settings);
  const updateSettings = useAssistantStore((s) => s.updateSettings);
  const locale = useLocale();
  const detectedCountry = locale.countrySource !== "setting" && locale.info ? locale.info.name : null;
  return (
    <>
      <label>
        Language
        <small>
          OneBrain listens and answers in this language. Auto follows your
          device; it stays in English unless your device uses another
          supported language.
        </small>
        <select
          value={settings.language || AUTO_LANGUAGE}
          onChange={(e) => updateSettings({ language: e.target.value })}
        >
          <option value={AUTO_LANGUAGE}>
            {`Auto — ${locale.voiceAuto ? voiceLanguageLabel(locale.voice) : "follow this device"}`}
          </option>
          {GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {VOICE_LANGUAGES.filter((v) => group.test(v.id)).map((v) => (
                <option key={v.id} value={v.id}>
                  {voiceLanguageLabel(v)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        Region
        <small>Dates, money, units, the clock and crisis helplines follow your region.</small>
        <select
          value={settings.country || ""}
          onChange={(e) => updateSettings({ country: e.target.value })}
        >
          <option value="">
            {detectedCountry
              ? `Auto — ${detectedCountry} (${SOURCE_LABEL[locale.countrySource] || "detected"})`
              : "Auto — not detected yet"}
          </option>
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
