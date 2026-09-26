import { Suspense } from "react";
import { LoginScreen } from "@/components/auth/LoginScreen";
export const metadata = { title: "Sign in · OneBrain" };
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Opening sign-in…</p>}>
      <LoginScreen />
    </Suspense>
  );
}
