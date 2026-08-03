import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { proxyConfig } from "./proxy.config";

export default defineConfig({
  plugins: [react()],
  // Dev cross-origin (ADR-0010 / D14 Condition 7): the agent client uses a SAME-ORIGIN base
  // (relative paths), and Vite proxies its two path prefixes to agent-service:8082. This keeps
  // the secret confirmation token on a same-origin fetch — no CORS surface added to agent-service,
  // and the token never crosses an origin boundary.
  //
  // EXTENDED 2026-08-03: rates and booking now use the same transport. They previously used
  // absolute VITE_*_URL defaults (cross-origin, unproxied), and the line that used to sit here
  // said "only the agent surface is proxied" — that was a scope statement from an agent-only PR,
  // not a decision to keep the other two cross-origin. In practice it broke them: X-Request-Id
  // makes the rates GET non-simple, so the browser preflighted and rates-service answered 403.
  // ALL browser -> service traffic is now same-origin, proxied here in dev and by nginx in prod.
  // The routing table and the full rationale live in ./proxy.config.ts.
  //
  // Both `server.proxy` and `preview.proxy` read that ONE exported const, deliberately: two copies
  // could drift. `preview` matters because playwright.config.ts serves the built bundle from :4173,
  // and because without it a relative API path under `pnpm preview` would hit the SPA history
  // fallback and return 200 text/html, which is a much worse failure than a CORS error.
  server: { proxy: proxyConfig },
  preview: { proxy: proxyConfig },
  test: {
    globals: true,
    environment: "jsdom",
    // Unit tests only. Playwright specs live in e2e/ (*.spec.ts) and run via `pnpm e2e`.
    include: ["{src,test}/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
