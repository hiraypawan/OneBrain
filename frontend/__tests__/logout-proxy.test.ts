import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/platform/[...path]/route";
beforeEach(() => {
  vi.stubEnv("PLATFORM_API_URL", "https://api.example.test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("sign-out confirmation", () => {
  for (const path of ["logout", "logout-all"])
    for (const status of [200, 401, 500])
      it(`${path} ${status} clears the cookie only when safe`, async () => {
        vi.stubGlobal(
          "fetch",
          vi
            .fn()
            .mockResolvedValue(
              new Response(JSON.stringify({ ok: status === 200 }), { status }),
            ),
        );
        const response = await POST(
          new NextRequest(`https://app.example.test/api/platform/${path}`, {
            method: "POST",
            headers: {
              host: "app.example.test",
              origin: "https://app.example.test",
              "Content-Type": "application/json",
              cookie: "onebrain-platform-session=test-only-session",
            },
            body: "{}",
          }),
          { params: Promise.resolve({ path: [path] }) },
        );
        expect(response.status).toBe(status);
        expect(response.cookies.has("onebrain-platform-session")).toBe(
          status !== 500,
        );
      });
});
