import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` diffs src/db/schema.ts and writes versioned SQL to ./drizzle. We commit
// the generated SQL and apply it with the migrator (src/db/migrate.ts) — never `drizzle-kit
// push` (no schema drift straight to a DB). Mirrors booking-service's drizzle.config.ts.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Only used by push/introspect (which we don't run); `generate` needs no DB. No embedded
    // credential fallback — fail loudly if a DB command is run without the URL.
    url: process.env.AGENT_DATABASE_URL ?? "",
  },
});
