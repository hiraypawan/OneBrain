"use client";
// The ONLY Google sign-in button in the app. It lives on /auth/login; every
// other "Sign in" entry point links there (see lib/platform/auth-return.ts loginHref).
import { useEffect, useState } from "react";
import { platformApi } from "@/lib/platform/platform";
import { safeReturnPath, signInErrorMessage } from "@/lib/platform/auth-return";

type Availability = "loading" | "ready" | "unconfigured" | "error" | "paused";
/** Setting names (never values) the server still needs, and the callback to register. */
type Setup = { missing: string[]; callback: string | null };

function readSetup(caps: any): Setup | null {
  const g = caps?.googleSignIn;
  if (!g || !Array.isArray(g.missing)) return null;
  return {
    missing: g.missing.filter((m: unknown) => typeof m === "string").slice(0, 8),
    callback: typeof g.callback === "string" ? g.callback : null,
  };
}

export function GoogleSignIn({
  className = "ops-card ops-auth",
  next = "/",
  error = null,
}: { className?: string; next?: string; error?: string | null } = {}) {
  const [availability, setAvailability] = useState<Availability>("loading"),
    [busy, setBusy] = useState(false),
    [embedded, setEmbedded] = useState(false),
    [attempt, setAttempt] = useState(0),
    [setup, setSetup] = useState<Setup | null>(null);
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
        setSetup(readSetup(c));
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
            {setup?.missing.length ? (
              <p data-testid="google-setup-missing">
                The sign-in server is still missing:{" "}
                <strong>{setup.missing.join(", ")}</strong>.
              </p>
            ) : null}
            <ol>
              <li>
                In Google Cloud Console → APIs &amp; Services → Credentials,
                create an OAuth client ID of type “Web application”
                {setup?.callback ? (
                  <>
                    {" "}with this exact authorized redirect URI:{" "}
                    <code data-testid="google-setup-callback">{setup.callback}</code>
                  </>
                ) : null}
                .
              </li>
              <li>
                Add its client ID and client secret as the GitHub repository
                secrets GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or as secrets
                on the API Worker), then run the Cloudflare deploy again. The
                deploy creates the encryption key itself.
              </li>
            </ol>
            <p>Full steps: docs/GOOGLE-AUTH-SETUP.md.</p>
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
