"use client";
import Script from "next/script";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listPuterModels, puterSessionReady, type PuterModelOption } from "@/lib/puter";
import { useAssistantStore } from "@/store/assistant";

function currentPuter(): any {
  return typeof window === "undefined" ? null : (window as any).puter || null;
}

function modelOptionKey(model: PuterModelOption): string {
  return `${model.provider || "unscoped"}::${model.id}`;
}

function modelCost(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.slice(0, 160);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  try { return JSON.stringify(value).slice(0, 160); } catch { return ""; }
}

export function PuterSettings() {
  const puterEnabled = useAssistantStore((s) => s.settings.puterEnabled === true);
  const puterFallbackEnabled = useAssistantStore((s) => s.settings.puterFallbackEnabled === true);
  const puterSpeechEnabled = useAssistantStore((s) => s.settings.puterSpeechEnabled === true);
  const puterModel = useAssistantStore((s) => s.settings.puterModel || "");
  const puterProvider = useAssistantStore((s) => s.settings.puterProvider || "");
  const language = useAssistantStore((s) => s.settings.language);
  const updateSettings = useAssistantStore((s) => s.updateSettings);
  const [sdkReady, setSdkReady] = useState(false);
  const [loadSdk, setLoadSdk] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [models, setModels] = useState<PuterModelOption[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [filter, setFilter] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [sttBusy, setSttBusy] = useState(false);
  const [sttText, setSttText] = useState("");

  const refreshStatus = useCallback(async () => {
    const puter = currentPuter();
    setSdkReady(!!puter?.ai?.chat);
    const active = puterSessionReady(typeof window === "undefined" ? undefined : window);
    setSignedIn(active);
    if (!active) {
      setUsername("");
      return;
    }
    try {
      const user = await puter.auth?.getUser?.();
      setUsername(typeof user?.username === "string" ? user.username.slice(0, 80) : "");
    } catch {
      setUsername("");
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const onFocus = () => void refreshStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshStatus]);

  async function connect() {
    const puter = currentPuter();
    if (!puter) {
      setLoadSdk(true);
      setBusy(true);
      setMessage("Loading Puter's browser SDK. When it is ready, press Connect Puter again to open sign-in.");
      return;
    }
    if (typeof puter.auth?.signIn !== "function") {
      setMessage("Puter account sign-in is unavailable in this SDK session.");
      return;
    }
    setBusy(true);
    setMessage("Opening Puter sign-in…");
    try {
      if (!puterSessionReady(window)) await puter.auth.signIn();
      await refreshStatus();
      if (puterSessionReady(window)) {
        setMessage("Puter connected. Chat and speech remain off until you enable them below.");
      } else {
        setMessage("Puter sign-in was not completed; OneBrain will not use it.");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message.slice(0, 240) : "Puter sign-in did not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function loadModels() {
    setCatalogBusy(true);
    setCatalogError("");
    try {
      const available = await listPuterModels();
      setModels(available);
      if (!available.length) setCatalogError("Puter returned no chat models. You can still use its default model.");
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "Could not load Puter's current model list.");
    } finally {
      setCatalogBusy(false);
    }
  }

  async function transcribeFile() {
    if (!audioFile) return;
    const puter = currentPuter();
    if (!puterSessionReady(window) || typeof puter?.ai?.speech2txt !== "function") {
      setMessage("Connect Puter before sending an audio file for transcription.");
      return;
    }
    setSttBusy(true);
    setSttText("");
    try {
      const result = await puter.ai.speech2txt(audioFile, { language: language === "hinglish" ? "hi" : language });
      const text = typeof result === "string" ? result : String(result?.text || result?.transcript || "");
      setSttText(text.trim() || "No transcript was returned.");
    } catch (e) {
      setSttText(e instanceof Error ? `Transcription failed: ${e.message.slice(0, 200)}` : "Transcription failed.");
    } finally {
      setSttBusy(false);
    }
  }

  const filteredModels = useMemo(() => {
    const q = filter.trim().toLocaleLowerCase();
    return q ? models.filter((m) => `${m.name || ""} ${m.id} ${m.provider || ""}`.toLocaleLowerCase().includes(q)).slice(0, 100) : models.slice(0, 100);
  }, [filter, models]);
  const savedModelKey = puterModel ? `${puterProvider || "unscoped"}::${puterModel}` : "";
  const selectedOption = models.find((m) => m.id === puterModel && (m.provider || "") === puterProvider);
  const selectedCost = modelCost(selectedOption?.cost);

  return (
    <section className="settings-card" aria-labelledby="puter-settings-heading">
      {loadSdk && (
        <Script
          src="https://js.puter.com/v2/"
          strategy="afterInteractive"
          onReady={() => {
            void refreshStatus();
            setBusy(false);
            setMessage("Puter is ready. Press Connect Puter again to continue with sign-in.");
          }}
          onError={() => {
            setLoadSdk(false);
            setBusy(false);
            setMessage("Puter's browser SDK could not load. Other chat providers remain available.");
          }}
        />
      )}
      <h2 id="puter-settings-heading">Puter AI (your Puter account)</h2>
      <p>
        Puter’s browser SDK loads only after you press Connect Puter. Connecting only signs in; chat and speech remain off until you enable them separately. With chat enabled, Puter receives the current question and included context. With speech enabled, it receives reply text for synthesis. Your account allowance, provider limits and model terms apply. A failed Puter chat stays local unless you separately allow another provider below.
      </p>
      <p role="status">
        {!sdkReady ? "Puter connection is not loaded." : signedIn ? `Puter account connected${username ? ` as ${username}` : ""}.` : "No active Puter session detected."}
        {puterEnabled && !signedIn ? " Puter is enabled, but no active session is available; it will be skipped." : ""}
      </p>
      <div className="settings-actions">
        {!signedIn && (
          <button type="button" disabled={busy} onClick={() => void connect()}>
            {busy ? (sdkReady ? "Connecting…" : "Loading Puter…") : "Connect Puter"}
          </button>
        )}
      </div>
      <label className="switch-row">
        <span>Use Puter for chat</span>
        <input
          type="checkbox"
          checked={puterEnabled}
          disabled={!signedIn}
          onChange={(e) => updateSettings({
            puterEnabled: e.target.checked,
            puterFallbackEnabled: e.target.checked && puterFallbackEnabled,
          })}
        />
      </label>
      <label className="switch-row">
        <span>Allow another provider if Puter fails</span>
        <input
          type="checkbox"
          checked={puterFallbackEnabled}
          disabled={!puterEnabled}
          onChange={(e) => updateSettings({ puterFallbackEnabled: e.target.checked })}
        />
      </label>
      <p className="settings-footnote">
        When enabled, a failed Puter request may send the question and selected context to your configured Gemini/OpenAI-compatible key or the community service. The provider badge shows who answered. If disabled, the answer stays on OneBrain’s local fallback instead of switching providers.
      </p>
      <label className="switch-row">
        <span>Use Puter for spoken replies</span>
        <input
          type="checkbox"
          checked={puterSpeechEnabled}
          disabled={!signedIn}
          onChange={(e) => updateSettings({ puterSpeechEnabled: e.target.checked })}
        />
      </label>
      <p className="settings-footnote">
        Off by default. When on, spoken reply text is sent to Puter; otherwise speech uses the selected Gemini key, if any, then the community route/browser voice.
      </p>
      {message && <p role="status">{message}</p>}

      <details>
        <summary>Choose a Puter chat model</summary>
        <p>Model IDs and availability change. Loading this list does not send your chat history. A listed “free” model may still have provider limits; using a stronger model can consume more of your Puter allowance.</p>
        <div className="settings-actions">
          <button type="button" disabled={!sdkReady || catalogBusy} onClick={() => void loadModels()}>
            {catalogBusy ? "Loading models…" : "Refresh model catalog"}
          </button>
        </div>
        <label>
          Find a model
          <input value={filter} maxLength={120} onChange={(e) => setFilter(e.target.value)} placeholder="Search model or provider" />
        </label>
        <label>
          Puter chat model and provider
          <select
            value={savedModelKey}
            onChange={(e) => {
              if (!e.target.value) updateSettings({ puterModel: "", puterProvider: "" });
              else {
                const choice = models.find((m) => modelOptionKey(m) === e.target.value);
                if (choice) updateSettings({ puterModel: choice.id, puterProvider: choice.provider || "" });
              }
            }}
          >
            <option value="">Puter default (model/provider may change)</option>
            {puterModel && !filteredModels.some((m) => modelOptionKey(m) === savedModelKey) && (
              <option value={savedModelKey}>Saved selection unavailable or missing provider: {puterProvider || "unscoped"} · {puterModel}</option>
            )}
            {filteredModels.map((m) => <option key={modelOptionKey(m)} value={modelOptionKey(m)}>{m.name || m.id}{m.provider ? ` · ${m.provider}` : " · provider not listed"} ({m.id})</option>)}
          </select>
        </label>
        {puterModel && !puterProvider && <p role="alert">This saved model has no provider pin. OneBrain will not send it; choose a current catalog pair or Puter default.</p>}
        {catalogError && <p role="status">{catalogError}</p>}
        {selectedOption && <p className="settings-footnote">Pinned selection: {puterProvider} · {puterModel}{selectedCost ? ` · catalog cost metadata: ${selectedCost}` : " · no cost metadata returned"}</p>}
        {models.length > 100 && <p className="settings-footnote">Showing up to 100 matches. Narrow the search to find other catalog entries.</p>}
        <p className="settings-footnote">Catalog model/provider pairs are pinned on each request. The answer badge reports which service answered; Puter account limits and provider pricing still apply.</p>
      </details>

      <details>
        <summary>Transcribe an audio file with Puter</summary>
        <p>Choose a recording and press Transcribe to send that file to Puter. This is an opt-in file transcription tool, not live streaming microphone recognition. Your browser's live SpeechRecognition remains browser-controlled and may process audio remotely.</p>
        <label>
          Audio recording
          <input type="file" accept="audio/*" onChange={(e) => { setAudioFile(e.target.files?.[0] || null); setSttText(""); }} />
        </label>
        <button type="button" disabled={!audioFile || sttBusy || !signedIn} onClick={() => void transcribeFile()}>
          {sttBusy ? "Transcribing…" : "Transcribe selected recording"}
        </button>
        {sttText && <p role="status" className="whitespace-pre-wrap">{sttText}</p>}
      </details>
    </section>
  );
}
