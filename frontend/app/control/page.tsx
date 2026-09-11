import { Suspense } from "react";
import { ControlCenter } from "@/components/control/ControlCenter";
export const metadata = { title: "Your space · OneBrain" };
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Opening your space…</p>}>
      <ControlCenter />
    </Suspense>
  );
}
