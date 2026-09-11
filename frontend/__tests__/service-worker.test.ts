import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    match: vi.fn().mockResolvedValue(undefined),
    keys: vi
      .fn()
      .mockResolvedValue(["another-app-cache", "onebrain-workspace-v5"]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response("ok", { headers: { "Content-Type": "text/html" } }),
    );
  const self = {
    location: { origin: "https://onebrain.test" },
    addEventListener: (name: string, handler: any) => {
      handlers[name] = handler;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  runInNewContext(
    readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
    { self, caches, fetch, URL, Response },
  );
  async function request(path: string, mode = "cors") {
    let response: Promise<Response> | undefined;
    const tasks: Promise<unknown>[] = [];
    handlers.fetch({
      request: { url: `https://onebrain.test${path}`, method: "GET", mode },
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
      waitUntil: (promise: Promise<unknown>) => tasks.push(promise),
    });
    const result = await response;
    await Promise.all(tasks);
    return result;
  }
  return { handlers, request, fetch, caches, cache };
}
describe("service worker freshness and cache isolation", () => {
  it("does not intercept development chunks or RSC requests", async () => {
    const w = worker();
    expect(await w.request("/_next/static/chunks/app/page.js")).toBeUndefined();
    expect(await w.request("/settings?_rsc=abc")).toBeUndefined();
    expect(w.caches.match).not.toHaveBeenCalled();
  });
  it("caches successful immutable assets but not 404 responses", async () => {
    const w = worker();
    await w.request("/_next/static/chunks/main-0123456789abcdef.js");
    expect(w.cache.put).toHaveBeenCalledTimes(1);
    w.fetch.mockResolvedValueOnce(new Response("missing", { status: 404 }));
    await w.request("/_next/static/chunks/main-1111111111111111.js");
    expect(w.cache.put).toHaveBeenCalledTimes(1);
  });
  it("never falls back to a cached API or backend response", async () => {
    const w = worker();
    w.fetch.mockRejectedValue(new Error("offline"));
    for (const path of ["/api/chat", "/backend/profile"])
      expect((await w.request(path))?.status).toBe(503);
    expect(w.caches.match).not.toHaveBeenCalled();
    expect(w.cache.put).not.toHaveBeenCalled();
  });
  it("caches only public successful app-shell navigation", async () => {
    const w = worker();
    await w.request("/settings", "navigate");
    expect(w.cache.put).not.toHaveBeenCalled();
    await w.request("/", "navigate");
    expect(w.cache.put).toHaveBeenCalledTimes(1);
    w.fetch.mockResolvedValueOnce(new Response("broken", { status: 500 }));
    await w.request("/active", "navigate");
    expect(w.cache.put).toHaveBeenCalledTimes(1);
  });
  it("provides a bounded offline fallback even if precaching failed", async () => {
    const w = worker();
    w.fetch.mockRejectedValue(new Error("offline"));
    expect((await w.request("/", "navigate"))?.status).toBe(503);
  });
  it("activation deletes only OneBrain caches, not unrelated caches on the origin", async () => {
    const w = worker();
    let task: Promise<unknown> | undefined;
    w.handlers.activate({
      waitUntil: (promise: Promise<unknown>) => {
        task = promise;
      },
    });
    await task;
    expect(w.caches.delete).toHaveBeenCalledTimes(1);
    expect(w.caches.delete).toHaveBeenCalledWith("onebrain-workspace-v5");
  });
});
