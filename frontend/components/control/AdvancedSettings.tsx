"use client";
import { useEffect, useState } from "react";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { VoiceEnrollment } from "@/components/settings/VoiceEnrollment";
import { PuterSettings } from "@/components/control/PuterSettings";
import { useAssistantStore } from "@/store/assistant";
export default function Advanced() {
  const { apiKey, setApiKey, aiProvider, setAiProvider, aiBaseUrl, setAiBaseUrl, aiModel, setAiModel, settings, updateSettings } = useAssistantStore();
  const [draft, setDraft] = useState(apiKey),
    [message, setMessage] = useState(""),
    [testing, setTesting] = useState(false),
    [enrollment, setEnrollment] = useState(false);
  const [draftProvider, setDraftProvider] = useState<'gemini' | 'openai'>(aiProvider),
    [draftBaseUrl, setDraftBaseUrl] = useState(aiBaseUrl),
    [draftModel, setDraftModel] = useState(aiModel);
  useEffect(() => {
    setDraft(apiKey);
  }, [apiKey]);
  useEffect(() => {
    setDraftProvider(aiProvider);
    setDraftBaseUrl(aiBaseUrl);
    setDraftModel(aiModel);
  }, [aiProvider, aiBaseUrl, aiModel]);
  function valid() {
    if (/GOCSPX-|apps\.googleusercontent\.com/i.test(draft)) {
      setMessage(
        "This is a Google sign-in credential, not a Gemini API key. Configure sign-in credentials privately on the API server, never in browser settings.",
      );
      return false;
    }
    return true;
  }
  async function testKey() {
    if (!valid()) return;
    if (!draft.trim()) {
      setMessage("Enter an optional AI API key first.");
      return;
    }
    setTesting(true);
    setMessage("Testing with one short request…");
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Reply with only the word OK",
          history: [],
          userKey: draft.trim(),
          provider: draftProvider,
          baseUrl: draftBaseUrl.trim() || undefined,
          model: draftModel.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      const okProvider = draftProvider === "openai" ? "openai" : "gemini";
      setMessage(
        data.provider === okProvider
          ? "The key responded to this test. Future availability depends on provider limits."
          : "The key was not confirmed. Check the key, endpoint, model and provider quota; a fallback response is not key validation.",
      );
    } catch {
      setMessage(
        "The key could not be tested. Check your connection and provider configuration.",
      );
    } finally {
      setTesting(false);
    }
  }
  return (
    <SettingsShell
      active="advanced"
      title="Advanced"
      description="Optional provider tools and device diagnostics. None of these are needed to sign in."
    >
      <section className="settings-card">
        <h2>Labs</h2>
        <p>
          Some features are still being finished: Stories, Email drafts and
          Music &amp; podcasts. They are hidden from Your space so the app stays
          focused. Turn this on to try them — they may change or break.
        </p>
        <label className="switch-row">
          <span>Show Labs features</span>
          <input
            type="checkbox"
            checked={!!settings.labsEnabled}
            onChange={(e) => updateSettings({ labsEnabled: e.target.checked })}
          />
        </label>
      </section>
      <section className="settings-card">
        <h2>Theme</h2>
        <p>
          Dark is the palette this app was designed and reviewed in. Light is an
          early token swap for the tab bar and the Track, Voice and You tabs —
          not a second design. Today and Your space keep their dark palette
          until they are reviewed with it, so a light panel never ends up with
          text chosen for the other one.
        </p>
        <div
          className="settings-actions"
          role="radiogroup"
          aria-label="Theme on this browser"
        >
          <button
            type="button"
            role="radio"
            aria-checked={settings.theme !== "light"}
            onClick={() => updateSettings({ theme: "dark" })}
          >
            Dark
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={settings.theme === "light"}
            onClick={() => updateSettings({ theme: "light" })}
          >
            Light (beta)
          </button>
        </div>
        <p className="settings-footnote">
          Saved on this browser only. It changes colours; it does not change what
          OneBrain stores or sends anywhere.
        </p>
      </section>
      <PuterSettings />
      <section className="settings-card">
        <h2>Optional AI provider</h2>
        <p>
          Google account sign-in and Gemini AI access are different. You do not
          need an AI key to create an account or use local capture. When Puter is
          enabled above it is tried first. If Puter fails, OneBrain stays on a
          local fallback unless you separately enable cross-provider fallback;
          with Puter off, the saved key provider is tried before community.
        </p>
        <details>
          <summary>Configure an AI API key (optional, free tiers)</summary>
          <p>
            Use only free-tier keys with billing disabled if you want to
            avoid charges. Hosted APIs have quotas, not unlimited free use. This
            browser key is sent to the app backend for AI requests; local
            browser storage is not an encrypted vault. The operator is never
            billed — the key and quota are yours.
          </p>
          <label>
            Provider
            <select
              value={draftProvider}
              onChange={(e) => {
                setDraftProvider(e.target.value === "openai" ? "openai" : "gemini");
                setMessage("");
              }}
            >
              <option value="gemini">Gemini (aistudio.google.com key)</option>
              <option value="openai">OpenAI-compatible (OpenRouter / DeepSeek / custom)</option>
            </select>
          </label>
          {draftProvider === "openai" && (
            <>
              <label>
                Endpoint (https)
                <input
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={120}
                  value={draftBaseUrl}
                  onChange={(e) => {
                    setDraftBaseUrl(e.target.value);
                    setMessage("");
                  }}
                  placeholder="https://openrouter.ai/api/v1"
                />
              </label>
              <label>
                Model
                <input
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={120}
                  value={draftModel}
                  onChange={(e) => {
                    setDraftModel(e.target.value);
                    setMessage("");
                  }}
                  placeholder="e.g. deepseek/deepseek-chat-v3.1:free"
                />
              </label>
            </>
          )}
          <label>
            {draftProvider === "openai" ? "API key for the endpoint" : "Gemini API key"}
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setMessage("");
              }}
              placeholder={draftProvider === "openai" ? "Endpoint key — yours, never the operator's" : "Gemini key — not an OAuth client secret"}
            />
          </label>
          <p>
            Save stores the key on this browser. Test sends one short request
            through the configured app backend and may consume provider quota.
            Never paste a Google OAuth client secret here.
          </p>
          <div className="settings-actions">
            <button
              disabled={testing || !draft.trim()}
              onClick={() => {
                if (valid()) {
                  setApiKey(draft.trim());
                  setAiProvider(draftProvider);
                  setAiBaseUrl(draftBaseUrl.trim());
                  setAiModel(draftModel.trim());
                  setMessage(
                    "Key saved on this browser. Availability has not been verified.",
                  );
                }
              }}
            >
              Save key locally
            </button>
            <button disabled={testing} onClick={() => void testKey()}>
              {testing ? "Testing…" : "Test key"}
            </button>
            <button
              disabled={testing || !apiKey}
              onClick={() => {
                setApiKey("");
                setDraft("");
                setMessage(
                  "Browser key removed. This does not revoke the key at Google.",
                );
              }}
            >
              Remove saved key
            </button>
          </div>
          {message && <p role="status">{message}</p>}
          {apiKey && (
            <p className="settings-footnote">A key is saved on this browser.</p>
          )}
        </details>
      </section>
      <section className="settings-card">
        <h2>Experimental speaker filter</h2>
        <p>
          Pitch comparison is not authentication. Enrollment uses your
          microphone only after you press “Enroll my voice”.
        </p>
        <details onToggle={(e) => setEnrollment(e.currentTarget.open)}>
          <summary>Manage voice baseline & filter</summary>
          {enrollment && <VoiceEnrollment />}
        </details>
      </section>
      <section className="settings-card">
        <h2>Diagnostics</h2>
        <p>
          Check browser capabilities, storage availability and background
          session events. Diagnostics are shown locally; opening them does not
          start the microphone.
        </p>
        <a className="settings-action" href="/control?panel=debug">
          Open diagnostics ↗
        </a>
      </section>
      <section className="settings-card">
        <h2>Looking for account settings?</h2>
        <p>
          Google sign-in and sign-out controls have their own section. Server
          OAuth credentials are configured privately by the operator, never on
          this page.
        </p>
        <a className="settings-action" href="/control?panel=account">
          Go to Account ↗
        </a>
      </section>
    </SettingsShell>
  );
}
