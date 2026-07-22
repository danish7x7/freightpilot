import { defineConfig } from "vitest/config";

// Testcontainers integration tests only (the confirmations table + single-use claim against a
// real Postgres). Long timeouts cover container startup + migration. Requires a working Docker
// daemon (CI native Docker); may not launch locally on WSL2 — CI is the source of truth,
// mirroring booking-service's integration config.
export default defineConfig({
  test: {
    include: ["test/**/*.it.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
