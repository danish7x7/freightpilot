import { defineConfig } from "vitest/config";

// Unit tests only — no Docker. Testcontainers integration tests (*.it.test.ts) are
// excluded here and run via `pnpm test:integration` (see vitest.integration.config.ts).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/*.it.test.ts", "node_modules/**", "dist/**"],
  },
});
