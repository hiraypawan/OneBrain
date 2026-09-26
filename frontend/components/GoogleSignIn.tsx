"use client";
// The ONLY Google sign-in button in the app. It lives on /auth/login; every
// other "Sign in" entry point links there (see lib/auth-return.ts loginHref).
import { useEffect, useState } from "react";
import { platformApi } from "@/lib/platform";
import { safeReturnPath, signInErrorMessage } from "@/lib/auth-return";

type Availability = "loading" | "ready" | "unconfigured" | "error" | "paused";

export function GoogleSignIn({
  className = "ops-card ops-auth",
  next = "/",
  error = null,
}: { className?: string; next?: string; error?: string | null } = {}) {
  const [availability, setAvailability] = useState<Availability>("loading"),
    [busy, setBusy] = useState(false),
    [embedded, setEmbedded] = useState(false),
    [attempt, setAttempt] = useState(0);
  const returnTo = safeReturnPath(next);
  const errorText = signInErrorMessage(error);

  useEffect(() => {
    try {
      setEmbedded(window.self !== window.top);
    } catch {
      setEmbedded(true);
    }
    // Coming back from a bfcache "Back" after leaving for Google.
    const reset = (e: PageTransitionEvent) => e.persisted && setBusy(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  useEffect(() => {
    let alive = true;
    setAvailability("loading");
    platformApi("/capabilities")
      .then((c) => {
        if (!alive) return;
        setAvailability(
          c.mode && c.mode !== "normal"
            ? "paused"
            : c.authMode === "google-only" && c.configured
              ? "ready"
              : "unconfigured",
        );
      })
      .catch(() => alive && setAvailability("error"));
    return () => {
      alive = false;
    };
  }, [attempt]);

  // Google refuses to render its consent screen inside an iframe (e.g. an
  // embedded preview), so open the same page in a real tab instead.
  const newTabHref =
    typeof window === "undefined" ? "/auth/login" : window.location.href;

  return (
    <section className={className} aria-labelledby="google-signin-title">
      <h2 id="google-signin-title">Continue with Google</h2>
      <p>
        One button for new and returning users — there are no OneBrain
        passwords. Signing in never uploads what is already on this device.
      </p>
      {errorText && (
        <p role="alert" className="auth-error">
          {errorText}
        </p>
      )}
      {embedded && availability === "ready" ? (
        <a
          className="ops-primary auth-button"
          href={newTabHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open sign-in in a new tab
        </a>
      ) : (
        <form
          method="post"
          action="/api/auth/google/start"
          onSubmit={() => setBusy(true)}
        >
          <input type="hidden" name="next" value={returnTo} />
          <button
            type="submit"
            className="ops-primary auth-button"
            disabled={availability !== "ready" || busy}
            aria-busy={busy}
          >
            {busy ? "Opening Google…" : "Continue with Google"}
          </button>
        </form>
      )}
      {availability === "loading" ? (
        <p role="status">Checking Google sign-in…</p>
      ) : availability === "error" ? (
        <>
          <p role="status">
            Google sign-in availability could not be checked. Check your
            connection and try again.
          </p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Retry Google availability
          </button>
        </>
      ) : availability === "paused" ? (
        <p role="status">
          Sign-in is paused for a moment while the server is busy. Everything on
          this device keeps working.
        </p>
      ) : availability === "unconfigured" ? (
        <>
          <p role="status">
            Google sign-in isn’t switched on for this site yet. You can keep
            using OneBrain on this device without an account.
          </p>
          <details className="auth-operator">
            <summary>Running this site? How to turn it on</summary>
            <p>
              Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and the redirect URL on
              the platform API, and connect the frontend to it (PLATFORM_API
              binding or PLATFORM_API_URL). Full steps:
              docs/GOOGLE-AUTH-SETUP.md.
            </p>
          </details>
        </>
      ) : embedded ? (
        <p>
          This page is inside a preview frame, and Google doesn’t allow sign-in
          there — the button opens it in a normal tab.
        </p>
      ) : (
        <p>
          Only your name, email and Google account ID are requested. Calendar,
          Gmail and Sheets each ask separately, only if you connect them.
        </p>
      )}
    </section>
  );
}
