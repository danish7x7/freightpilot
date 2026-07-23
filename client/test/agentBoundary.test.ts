import { describe, expect, test } from "vitest";

/**
 * STRUCTURAL guard for the load-bearing invariant at the UI (D14 Condition 8), the client mirror of
 * agent-service's L2/L3 import-graph tests. The HONEST framing (not the naive "the client never
 * POSTs /bookings" — the MANUAL flow legitimately does, §2.2): the AGENT chat flow must reach a
 * booking ONLY through the confirmation gate. So the agent-flow modules must NOT import the booking
 * client/hooks and must NOT name the booking create/confirm endpoints. The one and only
 * booking-causing call reachable from the agent flow is POST /api/v1/confirmations/{token} — the
 * gate redeem, which requires an explicit user click.
 *
 * Source text is read via Vite's `?raw` glob (no node:fs — the client tsconfig has no Node types).
 */
const rawByPath = import.meta.glob("../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// The agent chat flow — everything the chat panel can reach. BookingPanel / bookingHooks are the
// MANUAL flow and are deliberately NOT in this set.
const AGENT_FLOW = [
  "src/api/agent.ts",
  "src/api/agentHooks.ts",
  "src/components/ChatPanel.tsx",
  "src/components/ConfirmationCard.tsx",
];

function sourceOf(rel: string): string {
  const key = Object.keys(rawByPath).find((k) => k.endsWith(rel));
  if (!key) throw new Error(`agent-flow file not found in glob: ${rel}`);
  return rawByPath[key];
}

const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
function importsOf(src: string): string[] {
  return [...src.matchAll(IMPORT_RE)].map((m) => m[1]);
}

describe("hard boundary — the agent flow reaches booking ONLY via the gate (Condition 8)", () => {
  test("no agent-flow module imports the booking client or hooks", () => {
    const offenders: string[] = [];
    for (const rel of AGENT_FLOW) {
      for (const spec of importsOf(sourceOf(rel))) {
        if (/(^|\/)booking(\.gen)?$|bookingHooks|BookingPanel/.test(spec)) {
          offenders.push(`${rel} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no agent-flow module names a direct booking create/confirm endpoint", () => {
    const offenders: string[] = [];
    for (const rel of AGENT_FLOW) {
      const src = sourceOf(rel);
      if (/\/api\/v1\/bookings(\b|["'/])/.test(src) || /\/confirm\b/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the agent flow's only booking-causing call is the gate redeem", () => {
    const hooks = sourceOf("src/api/agentHooks.ts");
    // POST to the confirmation token path is present (the redeem) — and it is the ONLY POST that
    // can cause a booking anywhere in the agent flow (guarded by the two tests above).
    expect(hooks).toMatch(/POST\("\/api\/v1\/confirmations\/\{token\}"/);
  });

  test("the confirmation-card query key is the non-secret id, never the token (Condition 3)", () => {
    const hooks = sourceOf("src/api/agentHooks.ts");
    expect(hooks).toMatch(/queryKey:\s*\["confirmation-card",\s*args\.confirmationId\]/);
    const keyLine = hooks.split("\n").find((l: string) => l.includes("queryKey:")) ?? "";
    expect(keyLine).not.toContain("token");
  });
});
