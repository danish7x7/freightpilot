import { describe, expect, test } from "vitest";
import { mintToken, TOKEN_BYTES } from "../../src/gate/token.js";

describe("mintToken (Condition F — the token IS the authorization)", () => {
  test("is 256-bit, url-safe, base64url with no padding", () => {
    const token = mintToken();
    // 32 bytes → 43 base64url chars, url-safe alphabet, no '=' padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("=");
    expect(Buffer.from(token, "base64url")).toHaveLength(TOKEN_BYTES);
    expect(TOKEN_BYTES).toBe(32);
  });

  test("is unguessable — no collisions across many mints (high entropy)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(mintToken());
    expect(seen.size).toBe(5000);
  });
});
