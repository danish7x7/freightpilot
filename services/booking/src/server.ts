import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";

const port = Number(process.env.PORT ?? 8081);

async function main(databaseUrl: string): Promise<void> {
  // Fail-fast: apply migrations before listening. A failed migration exits the process →
  // the container stays unhealthy (mirrors rates' Flyway-on-startup). This is the boot-time
  // wiring deferred from booking-L1, now due because the endpoints need the DB pool.
  await applyMigrations(databaseUrl);
  const { db, close } = createDb(databaseUrl);
  const app = buildApp(db);
  const address = await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`booking-service listening on ${address}`);

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

const url = process.env.BOOKING_DATABASE_URL;
if (!url) {
  console.error("BOOKING_DATABASE_URL is not set");
  process.exit(1);
}

main(url).catch((err) => {
  console.error(err);
  process.exit(1);
});
