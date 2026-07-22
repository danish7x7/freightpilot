import { buildApp } from "./app.js";
import { loadServiceConfig } from "./config.js";
import { createBookingClient } from "./api/booking.js";
import { createDb } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";

const port = Number(process.env.PORT ?? 8082);

async function main(): Promise<void> {
  const cfg = loadServiceConfig();

  // Fail-fast: apply migrations before listening (mirrors booking). A failed migration exits
  // the process → the container stays unhealthy.
  await applyMigrations(cfg.agentDatabaseUrl);
  const { db, close } = createDb(cfg.agentDatabaseUrl);
  const booking = createBookingClient(cfg.bookingServiceUrl);

  const app = buildApp({ db, booking });
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
