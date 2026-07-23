import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Dev cross-origin (ADR-0010 / D14 Condition 7): the agent client uses a SAME-ORIGIN base
  // (relative paths), and Vite proxies its two path prefixes to agent-service:8082. This keeps
  // the secret confirmation token on a same-origin fetch — no CORS surface added to agent-service,
  // and the token never crosses an origin boundary. rates/booking still use absolute VITE_*_URL
  // (cross-origin, unproxied) — only the agent surface is proxied.
  server: {
    proxy: {
      "/api/v1/turns": { target: "http://localhost:8082", changeOrigin: true },
      "/api/v1/confirmations": { target: "http://localhost:8082", changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    // Unit tests only. Playwright specs live in e2e/ (*.spec.ts) and run via `pnpm e2e`.
    include: ["{src,test}/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
