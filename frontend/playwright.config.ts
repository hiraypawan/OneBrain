import { defineConfig } from "@playwright/test";
export default defineConfig({
  webServer: process.env.CI
    ? [{ command: "npm --prefix ../workers/api run dev", url: "http://127.0.0.1:8787/api/health", timeout: 120000 }, {
        command: "npm run start -- --hostname 0.0.0.0",
        url: "http://127.0.0.1:3000",
        timeout: 120000,
      }]
    : undefined,
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-zygote",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--disable-gpu",
      ],
    },
    trace: "retain-on-failure",
  },
});
