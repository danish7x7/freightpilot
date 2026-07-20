import { defineConfig } from "vitest/config";

// Unit tests only. Replay tests use recorded fixtures via undici MockAgent — ZERO
// live API calls in CI. The fixture recorder lives in scripts/ (outside this glob),
// so it is never picked up here.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
