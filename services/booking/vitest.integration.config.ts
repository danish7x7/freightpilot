import { defineConfig } from "vitest/config";

// Testcontainers integration tests only. Long timeouts cover container startup +
// migration. Requires a working Docker daemon (CI native Docker); see the note in
// test/schema.it.test.ts about the local WSL2 quirk.
export default defineConfig({
  test: {
    include: ["test/**/*.it.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
