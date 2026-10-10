"use client";
import Script from "next/script";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listPuterImageModels, puterSessionReady, type PuterModelOption } from "@/lib/puter";

function currentPuter(): any {
  return typeof window === "undefined" ? null : (window as any).puter || null;
}

function costMetadata(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.slice(0, 180);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  try { return JSON.stringify(value).slice(0, 180); } catch { return ""; }
}

function safeImageSource(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const source = value.trim();
  if (/^data:image\/(?:png|jpeg|webp|gif);/i.test(source)) return source;
  try {
    const url = new URL(source, window.location.origin);
    if (url.protocol === "https:" || url.protocol === "blob:") return url.href;
    if (url.origin === window.location.origin && url.protocol === "http:") return url.href;
  } catch { /* malformed or unsafe URL */ }
  return "";
}

export function ImageStudio() {
  const [sdkReady, setSdkReady] = useState(false);
  const [loadSdk, setLoadSdk] = useState(false);
  const [sdkLoading, setSdkLoading] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [models, setModels] = useState<PuterModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [filter, setFilter] = useState("");

  const refreshStatus = useCallback(() => {
    const puter = currentPuter();
    setSdkReady(!!puter?.ai?.txt2img);
    setSignedIn(puterSessionReady(typeof window === "undefined" ? undefined : window));
  }, []);

  useEffect(() => {
    refreshStatus();
    const onFocus = () => refreshStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshStatus]);

  async function loadModels() {
    setCatalogBusy(true);
    setCatalogError("");
    try {
      const available = await listPuterImageModels();
      setModels(available);
      if (selectedModel && !available.some((m) => m.id === selectedModel)) setSelectedModel("");
      if (!available.length) setCatalogError("Puter returned no available image models.");
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "Could not load image models.");
    } finally {
      setCatalogBusy(false);
    }
  }

  const filteredModels = useMemo(() => {
    const q = filter.trim().toLocaleLowerCase();
    return (q ? models.filter((m) => `${m.name || ""} ${m.id} ${m.provider || ""}`.toLocaleLowerCase().includes(q)) : models).slice(0, 100);
  }, [filter, models]);
  const selectedOption = models.find((m) => m.id === selectedModel);
  const selectedCost = costMetadata(selectedOption?.cost);

  async function generate() {
    const cleanPrompt = prompt.trim();
    const puter = currentPuter();
    if (!cleanPrompt || cleanPrompt.length > 2000 || !selectedModel) return;
    if (!puterSessionReady(window) || typeof puter?.ai?.txt2img !== "function") {
      setStatus("Connect and sign in to Puter in Advanced settings before generating an image.");
      return;
    }
    setBusy(true);
    setStatus("Generating with the selected Puter model… This may take a little while.");
    setImageUrl("");
    try {
      const chosenModel = models.find((item) => item.id === selectedModel);
      const result = await puter.ai.txt2img(cleanPrompt, {
        model: selectedModel,
        ...(chosenModel?.provider ? { provider: chosenModel.provider } : {}),
        ratio: { w: 1, h: 1 },
      });
      const rawSrc = typeof result === "string" ? result : result?.src;
      const src = safeImageSource(rawSrc);
      if (!src) throw new Error("The image provider returned no safe, displayable image URL.");
      setImageUrl(src);
      setStatus("Image generated. It has not been added to your saved notes; download it if you want to keep a copy.");
    } catch (e) {
      setStatus(e instanceof Error ? `Image generation failed: ${e.message.slice(0, 240)}` : "Image generation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-6">
      {loadSdk && (
        <Script
          src="https://js.puter.com/v2/"
          strategy="afterInteractive"
          onReady={() => {
            refreshStatus();
            setSdkLoading(false);
            setStatus("Puter tools are loaded. Connect your account in Advanced settings if needed, then refresh the image catalog.");
          }}
          onError={() => {
            setLoadSdk(false);
            setSdkLoading(false);
            setStatus("Puter's browser SDK could not load. No image request was sent.");
          }}
        />
      )}
      <h1 className="text-2xl font-bold">AI image studio</h1>
      <p className="text-gray-400 my-3">
        Image generation uses your signed-in Puter account and its current allowance, provider limits, and model terms. Press Load Puter image tools to download Puter’s browser SDK; this does not sign you in or send a prompt. Refreshing the catalog sends a metadata request; your prompt and generated image are sent only after you press Generate. OneBrain does not save the result automatically.
      </p>
      <p role="status">{!sdkReady ? "Puter image tools are not loaded." : signedIn ? "Puter is signed in." : "Puter sign-in is required."}</p>
      {!sdkReady && (
        <button
          type="button"
          disabled={sdkLoading}
          onClick={() => {
            setSdkLoading(true);
            setLoadSdk(true);
            setStatus("Loading Puter’s browser SDK. No account, catalog, or image request is made yet.");
          }}
        >
          {sdkLoading ? "Loading Puter…" : "Load Puter image tools"}
        </button>
      )}
      {!signedIn && <a className="settings-action" href="/control?panel=advanced">Connect Puter in Advanced settings ↗</a>}
      <section className="settings-card mt-4">
        <div className="settings-actions">
          <button type="button" disabled={!sdkReady || !signedIn || catalogBusy} onClick={() => void loadModels()}>
            {catalogBusy ? "Loading models…" : "Refresh image model catalog"}
          </button>
        </div>
        <label>
          Search image models
          <input value={filter} maxLength={120} onChange={(e) => setFilter(e.target.value)} placeholder="Model or provider" />
        </label>
        <label>
          Image model (required)
          <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
            <option value="">Choose a model—no default is preselected</option>
            {filteredModels.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}{m.provider ? ` · ${m.provider}` : ""} ({m.id})</option>)}
          </select>
        </label>
        {catalogError && <p role="status">{catalogError}</p>}
        {selectedOption && <p className="settings-footnote">Selected: {selectedOption.id}{selectedOption.provider ? ` · ${selectedOption.provider}` : ""}{selectedCost ? ` · catalog pricing metadata: ${selectedCost}` : " · no price metadata returned"}</p>}
        <p className="settings-footnote">Catalog availability, provider routing and account usage can change; this is not a fixed-price guarantee. Check current Puter/provider terms before generating. OneBrain passes the selected ID/provider and does not automatically retry with a different image model.</p>
        <label>
          Describe the image
          <textarea value={prompt} maxLength={2000} rows={5} onChange={(e) => setPrompt(e.target.value)} placeholder="A small red panda reading by a rainy Pune window, warm light, storybook illustration…" />
        </label>
        <button type="button" disabled={!signedIn || busy || !selectedModel || !prompt.trim()} onClick={() => void generate()}>
          {busy ? "Generating…" : "Generate image"}
        </button>
        {status && <p role="status">{status}</p>}
        {imageUrl && (
          <figure className="mt-4">
            {/* Provider output is rendered as an image only; never injected as HTML. */}
            <img src={imageUrl} alt={`Generated from: ${prompt.slice(0, 180)}`} className="max-w-full rounded" />
            <figcaption className="mt-2">
              <a href={imageUrl} download="onebrain-generated-image.png">Download image</a>
            </figcaption>
          </figure>
        )}
      </section>
    </div>
  );
}
