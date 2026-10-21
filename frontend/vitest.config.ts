import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["__tests__/**/*.test.ts"],
    // Pins the locale "device" so tests do not depend on the machine's time zone/language.
    setupFiles: ["./__tests__/helpers/setup-locale.ts"],
  },
});
