import { defineConfig } from "vitest/config";

// Unit tests only. Replay tests use recorded fixtures via undici MockAgent — ZERO
// live API calls in CI. The fixture recorder lives in scripts/ (outside this glob),
// so it is never picked up here.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Testcontainers integration tests (*.it.test.ts) are excluded here (no Docker) and run
    // via `pnpm test:integration` (see vitest.integration.config.ts).
    exclude: ["**/*.it.test.ts", "node_modules/**", "dist/**"],
  },
});
