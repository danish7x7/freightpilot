import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { buildApp, maskConfirmationToken } from "../../src/app.js";
import type { GateDeps } from "../../src/gate/gateService.js";

// The token is a secret credential in the URL path — it must never reach the access log (Condition F).
const TOKEN = "MMsuPWjYm3wrxiKpcBbq1oMP5oeTTU9sU-G3eW4KV74"; // shape of a real 32-byte base64url token
const stubDeps = { db: undefined, booking: undefined } as unknown as GateDeps;

describe("token redaction in logs (Condition F)", () => {
  test("maskConfirmationToken replaces the token segment, preserving any query", () => {
    expect(maskConfirmationToken(`/api/v1/confirmations/${TOKEN}`)).toBe("/api/v1/confirmations/***");
    expect(maskConfirmationToken(`/api/v1/confirmations/${TOKEN}?x=1`)).toBe("/api/v1/confirmations/***?x=1");
  });

  test("the raw token never appears in the access log; the masked form does", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    });
    const app = buildApp(stubDeps, { logStream: stream });
    await app.ready();
    // The handler will 500 (stub db) — but the request IS logged, which is exactly what we test.
    await app.inject({ method: "GET", url: `/api/v1/confirmations/${TOKEN}` });
    await app.close();

    const log = chunks.join("");
    expect(log).not.toContain(TOKEN);
    expect(log).toContain("/api/v1/confirmations/***");
  });
});
