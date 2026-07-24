import { defineConfig } from "vitest/config";

// The runner's own unit tests (§6). Transpile-only (esbuild) — no full tsc typecheck,
// matching agent-service's vitest setup. Tests import agent SOURCE by relative path;
// that source resolves its deps (zod, drizzle, openapi-fetch) from services/agent/node_modules,
// so services/agent must be installed before running these (CI installs it — see ci.yml evals job).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
