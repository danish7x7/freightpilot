// Applies committed migrations (./drizzle) to BOOKING_DATABASE_URL, then exits.
// Run INSIDE the compose network (booking-db has no host port, ADR-0001):
//   docker compose run --rm --no-deps booking-service node dist/db/migrate.js
// (wrapped as `make migrate-booking`). The Testcontainers IT applies the same
// migrations to prove they're clean. This is a bare migrate-then-close step — the
// app's DB pool / repository wiring lands at L2 when an endpoint first needs it.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.BOOKING_DATABASE_URL;
if (!url) {
  console.error("BOOKING_DATABASE_URL is not set");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("booking migrations applied");
} finally {
  await client.end();
}
