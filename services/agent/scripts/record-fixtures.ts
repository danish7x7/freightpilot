/**
 * One-time fixture recorder — makes REAL provider calls and saves their raw wire
 * responses so unit tests can replay them with zero live calls in CI.
 *
 *   pnpm record:fixtures        (sets RECORD_FIXTURES=1)
 *
 * This file lives in scripts/ — NOT under test/ — so the vitest glob never picks it
 * up and CI never runs it. It is manual and env-gated by design.
 *
 * It records the (a) plain-text and (b) tool-call cases per provider in LLM_CHAIN.
 * The (c) 429 rate-limit fixtures are hand-authored (a real 429 can't be provoked on
 * demand) and already committed under test/fixtures/<provider>/rate-limit-429.json.
 *
 * Requires real keys in the environment (services/agent/.env — gitignored). Only the
 * response BODY + status is written; request auth headers/keys are never persisted.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLlmConfig } from "../src/llm/config.js";
import { createProvider } from "../src/llm/index.js";
import { TEXT_REQUEST, TOOLCALL_REQUEST } from "../test/fixtures/throwawayTool.js";

if (process.env.RECORD_FIXTURES !== "1") {
  console.error("Refusing to run: set RECORD_FIXTURES=1 (use `pnpm record:fixtures`).");
  process.exit(1);
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

// Tee the raw wire response for the next call, without disturbing the provider.
let captured: { status: number; body: unknown } | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const res = await realFetch(input, init);
  const clone = res.clone();
  captured = { status: clone.status, body: await clone.json().catch(() => null) };
  return res;
};

function write(provider: string, name: string): void {
  if (!captured) throw new Error(`no response captured for ${provider}/${name}`);
  const dir = join(fixturesDir, provider);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(captured, null, 2) + "\n");
  console.log(`recorded ${provider}/${name}.json (status ${captured.status})`);
  captured = null;
}

const config = loadLlmConfig();
for (const pc of config.chain) {
  const provider = createProvider(pc, config.timeoutMs);
  console.log(`\n== ${pc.name} (${pc.model}) ==`);
  try {
    await provider.chat(TEXT_REQUEST);
    write(pc.name, "text");
  } catch (err) {
    console.error(`  text case failed:`, err);
  }
  try {
    await provider.chat(TOOLCALL_REQUEST);
    write(pc.name, "toolcall");
  } catch (err) {
    console.error(`  toolcall case failed:`, err);
  }
}

console.log("\nDone. 429 fixtures are hand-authored — not recorded here.");
