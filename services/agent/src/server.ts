import { buildApp, type AppDeps } from "./app.js";
import { loadServiceConfig } from "./config.js";
import { createBookingClient } from "./api/booking.js";
import { createDb } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";
import { buildLlmRouter } from "./llm/index.js";
import { PROMPT_BYTES, PROMPT_SHA256, PROMPT_SOURCE, PROMPT_VERSION } from "./prompt/systemPrompt.js";
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

  // L5-C7's boot proof: the packaging claim is verified by BOOTING the container, not by reading
  // the Dockerfile, so the container has to say what it loaded. The digest is over the trimmed text
  // that goes on the wire, which is what binds the `prompt_version` LABEL to actual BYTES.
  // Emitted unconditionally, including in gate-only mode where no LLM chain is configured: the
  // question "did this image ship the prompt" is independent of whether it can call a model.
  app.log.info({
    event: "prompt_loaded",
    prompt_version: PROMPT_VERSION,
    source: PROMPT_SOURCE,
    bytes: PROMPT_BYTES,
    sha256: PROMPT_SHA256,
  });
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
