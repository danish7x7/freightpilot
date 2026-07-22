import { z } from "zod";

/**
 * Agent-service runtime config for the DOWNSTREAM services it calls (§2.2 rule 1:
 * the agent reaches rates/booking ONLY through their public REST APIs, never their
 * DBs). These origins are injected by compose (docker-compose.yml) and mirrored in
 * .env.example. Kept SEPARATE from src/llm/config.ts — that module owns the LLM
 * chain; this one owns service wiring. No overlap.
 */
const schema = z.object({
  RATES_SERVICE_URL: z.string().url(),
  BOOKING_SERVICE_URL: z.string().url(),
  // agent-service's OWN database (L3 — confirmations table). The agent owns this DB; it is
  // NOT a rates/booking DB (§2.2). Injected by compose (docker-compose.yml).
  AGENT_DATABASE_URL: z.string().url(),
});

export interface ServiceConfig {
  ratesServiceUrl: string;
  bookingServiceUrl: string;
  agentDatabaseUrl: string;
}

/** Parse + validate the agent's env config. Throws a readable error on a bad/missing value. */
export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid agent service config: ${issues}`);
  }
  return {
    ratesServiceUrl: parsed.data.RATES_SERVICE_URL,
    bookingServiceUrl: parsed.data.BOOKING_SERVICE_URL,
    agentDatabaseUrl: parsed.data.AGENT_DATABASE_URL,
  };
}
