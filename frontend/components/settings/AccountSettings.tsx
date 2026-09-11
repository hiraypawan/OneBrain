"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAssistantStore } from "@/store/assistant";
import { GoogleSignIn } from "@/components/GoogleSignIn";
import { SettingsShell } from "./SettingsShell";
type Account = { id: string; email: string; displayName?: string };
export function AccountSettings() {
  const [status, setStatus] = useState<"loading" | "ready" | "guest" | "error">(
      "loading",
    ),
    [account, setAccount] = useState<Account | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const turn = ++generation.current;
    setStatus("loading");
    try {
      const r = await fetch("/api/platform/me", { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (turn !== generation.current) return;
      if (r.status === 401) {
        setAccount(null);
        setStatus("guest");
        useAssistantStore.setState({ isAuthenticated: false });
        return;
      }
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (turn !== generation.current) return;
      setAccount(data.user);
      useAssistantStore.getState().loginBackend(data.user);
      setStatus("ready");
    } catch {
      if (turn === generation.current) setStatus("error");
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  async function signOut(all: boolean) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/platform/${all ? "logout-all" : "logout"}`,
        {
          method: "POST",
          signal: AbortSignal.timeout(20000),
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok && response.status !== 401) throw new Error();
      generation.current++;
      useAssistantStore.getState().logout();
      try {
        localStorage.removeItem("onebrain-shared-voice");
      } catch {}
      setAccount(null);
      setStatus("guest");
      setNotice(
        response.status === 401
          ? all
            ? "This session expired. Sign in again to revoke other sessions."
            : "Your session has expired. Sign in again when ready."
          : all
            ? "All OneBrain server sessions have been revoked."
            : "Signed out of OneBrain. Local records have not been deleted.",
      );
    } catch {
      setNotice(
        "Sign-out could not be confirmed. You may still be signed in; check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsShell
      active="account"
      title="Account"
      description="One Google account. Clear control over where you’re signed in."
    >
      {notice && (
        <p className="settings-status" role="status">
          {notice}
        </p>
      )}
      {status === "loading" ? (
        <p role="status">Checking your server session…</p>
      ) : status === "error" ? (
        <section className="settings-card">
          <h2>We couldn’t check your account</h2>
          <p>
            Cached profile information is not proof of a current server session.
            Local capture is still available.
          </p>
          <button onClick={() => void load()}>Try again</button>
        </section>
      ) : account ? (
        <>
          <section className="settings-card">
            <span className="settings-pill">
              GOOGLE ACCOUNT · SESSION VERIFIED
            </span>
            <div className="settings-identity">
              <span className="settings-avatar" aria-hidden="true">
                {(account.displayName || account.email)
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <div>
                <strong>{account.displayName || "Your Google account"}</strong>
                <small>{account.email}</small>
              </div>
            </div>
            <p>
              Google handles account sign-in. OneBrain never asks for your
              Google password or client secret here.
            </p>
            <div className="settings-actions">
              <a className="settings-action primary" href="/control?panel=shared">
                Open shared workspaces ↗
              </a>
              <button disabled={busy} onClick={() => void signOut(false)}>
                Sign out
              </button>
            </div>
          </section>
          <section className="settings-card">
            <h2>Sessions & access</h2>
            <p>
              Signing out of all sessions revokes OneBrain access on your other
              devices too. It does not sign you out of Google, delete records,
              or cancel already approved jobs.
            </p>
            <button
              className="danger-action"
              disabled={busy}
              onClick={() => {
                if (confirm("Sign out of OneBrain on every device?"))
                  void signOut(true);
              }}
            >
              Sign out all sessions
            </button>
          </section>
        </>
      ) : (
        <GoogleSignIn className="settings-card" />
      )}
      <section className="settings-card">
        <h2>Local is separate from shared</h2>
        <p>
          You can use the local canvas without signing in. Google sign-in gives
          access to server workspaces; it does not automatically upload your
          device’s memories.
        </p>
        <div className="settings-actions">
          <a className="settings-action" href="/control?panel=privacy">
            Memory & privacy
          </a>
          <a className="settings-action" href="/control?panel=shared">
            Shared workspaces
          </a>
        </div>
      </section>
    </SettingsShell>
  );
}
