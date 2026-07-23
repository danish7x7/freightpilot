import { buildApp, type AppDeps } from "./app.js";
import { loadServiceConfig } from "./config.js";
import { createBookingClient } from "./api/booking.js";
import { createDb } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";
import { buildLlmRouter } from "./llm/index.js";
import { TOOLS, createToolClients } from "./tools/index.js";

const port = Number(process.env.PORT ?? 8082);

async function main(): Promise<void> {
  const cfg = loadServiceConfig();

  // Fail-fast: apply migrations before listening (mirrors booking). A failed migration exits
  // the process → the container stays unhealthy.
  await applyMigrations(cfg.agentDatabaseUrl);
  const { db, close } = createDb(cfg.agentDatabaseUrl);
  const booking = createBookingClient(cfg.bookingServiceUrl);

  // Wire the L5 turn surface iff the LLM chain is configured. The confirmation gate does NOT
  // need the LLM, so an unconfigured chain boots in gate-only mode (POST /turns simply absent)
  // rather than taking the whole service — and its redeem path — down.
  let turn: AppDeps["turn"];
  try {
    turn = { router: buildLlmRouter(process.env), tools: TOOLS, clients: createToolClients() };
  } catch (err) {
    console.warn(`LLM chain unconfigured — POST /api/v1/turns disabled: ${(err as Error).message}`);
  }

  const app = buildApp({ db, booking, turn });
  const address = await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`agent-service listening on ${address}`);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      app.log.info(`${signal} received — draining`);
      void app
        .close()
        .then(() => close())
        .finally(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
