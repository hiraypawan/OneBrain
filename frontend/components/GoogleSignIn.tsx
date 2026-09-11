"use client";
import { useEffect, useState } from "react";
import { platformApi } from "@/lib/platform";
export function GoogleSignIn({
  className = "ops-card ops-auth",
}: { className?: string } = {}) {
  const [availability, setAvailability] = useState<
      "loading" | "ready" | "unconfigured" | "error"
    >("loading"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setAvailability("loading");
    setError(new URLSearchParams(location.search).has("error"));
    platformApi("/capabilities")
      .then((c) => {
        if (alive)
          setAvailability(
            c.authMode === "google-only" && c.configured
              ? "ready"
              : "unconfigured",
          );
      })
      .catch(() => {
        if (alive) setAvailability("error");
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  return (
    <section className={className}>
      <h2>Continue with Google</h2>
      <p>
        Use the same Google account to sign up or sign in. There are no OneBrain
        passwords. Your local canvas is not uploaded automatically.
      </p>
      {error && (
        <p role="alert">
          Google sign-in was not completed. It may have expired, been cancelled,
          or require operator configuration. Try again; legacy accounts need a
          reviewed identity migration.
        </p>
      )}
      <form
        method="post"
        action="/api/auth/google/start"
        onSubmit={() => setBusy(true)}
      >
        <button
          className="ops-primary"
          disabled={availability !== "ready" || busy}
        >
          {busy ? "Opening Google…" : "Continue with Google"}
        </button>
      </form>
      {availability === "loading" ? (
        <p role="status">Checking Google sign-in…</p>
      ) : availability === "error" ? (
        <>
          <p role="status">
            Google sign-in availability could not be checked. Check your
            connection and try again.
          </p>
          <button onClick={() => setAttempt((n) => n + 1)}>
            Retry Google availability
          </button>
        </>
      ) : availability === "unconfigured" ? (
        <p role="status">
          Google sign-in needs operator setup. Follow docs/GOOGLE-AUTH-SETUP.md.
          Device-local capture still works without an account.
        </p>
      ) : (
        <p>
          Only basic identity is requested: name, email and Google account ID.
          Calendar, Gmail and Sheets permissions require separate explicit
          consent.
        </p>
      )}
      <p>
        <a href="/auth/login" target="_blank" rel="noopener noreferrer">
          Open sign-in in a separate tab
        </a>{" "}
        when using an embedded preview.
      </p>
      <a href="/">Continue with device-local capture</a>
    </section>
  );
}
