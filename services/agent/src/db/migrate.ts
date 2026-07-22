// Applies committed migrations (./drizzle) to a database URL. Used two ways:
//   - boot-time: server.ts calls applyMigrations() before app.listen() (fail-fast).
//   - CLI: `node dist/db/migrate.js` via `make migrate-agent`, run INSIDE the compose
//     network because agent-db has no host port (ADR-0001). Mirrors booking's migrate.ts.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function applyMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}

// CLI entrypoint — only when run directly, not when imported by server.ts.
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.AGENT_DATABASE_URL;
  if (!url) {
    console.error("AGENT_DATABASE_URL is not set");
    process.exit(1);
  }
  applyMigrations(url)
    .then(() => console.log("agent migrations applied"))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
