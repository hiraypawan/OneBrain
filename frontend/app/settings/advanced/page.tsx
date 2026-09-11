"use client";
import { useEffect, useState } from "react";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { VoiceEnrollment } from "@/components/settings/VoiceEnrollment";
import { useAssistantStore } from "@/store/assistant";
export default function Advanced() {
  const { apiKey, setApiKey } = useAssistantStore();
  const [draft, setDraft] = useState(apiKey),
    [message, setMessage] = useState(""),
    [testing, setTesting] = useState(false),
    [enrollment, setEnrollment] = useState(false);
  useEffect(() => {
    setDraft(apiKey);
  }, [apiKey]);
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
      setMessage("Enter an optional Gemini API key first.");
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
        }),
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setMessage(
        data.provider === "gemini"
          ? "Gemini responded to this test. Future availability depends on provider limits."
          : "Gemini did not confirm this key. Check the key and provider quota; a fallback response is not key validation.",
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
        <h2>Optional AI provider</h2>
        <p>
          Google account sign-in and Gemini AI access are different. You do not
          need an AI key to create an account or use local capture.
        </p>
        <details>
          <summary>Configure a Gemini API key</summary>
          <p>
            Use only a free-tier project with billing disabled if you want to
            avoid charges. Hosted APIs have quotas, not unlimited free use. This
            browser key is sent to the app backend for Gemini requests; local
            browser storage is not an encrypted vault.
          </p>
          <label>
            Gemini API key
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
              placeholder="Gemini key — not an OAuth client secret"
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
        <a className="settings-action" href="/settings/debug">
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
        <a className="settings-action" href="/settings/account">
          Go to Account ↗
        </a>
      </section>
    </SettingsShell>
  );
}
