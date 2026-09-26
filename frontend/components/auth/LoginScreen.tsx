"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GoogleSignIn } from "@/components/GoogleSignIn";
import { useAssistantStore } from "@/store/assistant";
import { safeReturnPath } from "@/lib/auth-return";

export function LoginScreen() {
  const params = useSearchParams();
  const next = safeReturnPath(params.get("next"));
  const error = params.get("error");
  const authenticated = useAssistantStore((s) => s.isAuthenticated);
  const email = useAssistantStore((s) => s.user?.email);

  return (
    <div className="auth-page">
      <header className="auth-intro">
        <p className="auth-kicker">OneBrain account</p>
        <h1>{authenticated ? "You’re signed in" : "Sign in to OneBrain"}</h1>
        <p>
          {authenticated
            ? `Signed in${email ? ` as ${email}` : ""}. Your plan and shared spaces follow you to every device.`
            : "Optional. Notes, tasks, logs and voice already work on this device. Signing in adds shared spaces and an account-wide plan."}
        </p>
      </header>
      {authenticated ? (
        <section className="ops-card ops-auth">
          <div className="auth-actions">
            <Link prefetch={false} className="ops-primary auth-button" href={next}>
              Continue
            </Link>
            <Link prefetch={false} href="/control?panel=account">
              Manage account & sessions
            </Link>
          </div>
        </section>
      ) : (
        <GoogleSignIn next={next} error={error} />
      )}
      <p className="auth-skip">
        <Link prefetch={false} href={next}>
          {authenticated ? "Back" : "Not now — keep using this device"}
        </Link>
      </p>
    </div>
  );
}
