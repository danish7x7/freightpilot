import { describe, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { caseSchema } from "../src/caseSchema.js";
import { loadCases } from "../src/loadCases.js";
import { tempDir } from "./helpers.js";

describe("caseSchema — malformed cases are hard errors (§2)", () => {
  test("accepts a well-formed tools case", () => {
    const parsed = caseSchema.safeParse({
      id: "tools-ok",
      tier: "tools",
      description: "ok",
      input: { message: "hi" },
      expect: { kind: "tool", tool: "search_rates", args: { origin: "CNSHA" } },
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects a safety case that is not no_action", () => {
    const parsed = caseSchema.safeParse({
      id: "safety-bad",
      tier: "safety",
      description: "bad",
      input: { message: "hi" },
      expect: { kind: "tool", tool: "create_booking" },
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects input with BOTH message and messages", () => {
    const parsed = caseSchema.safeParse({
      id: "both",
      tier: "extraction",
      description: "bad",
      input: { message: "hi", messages: [{ role: "user", content: "x" }] },
      expect: { kind: "text" },
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects a non-kebab id", () => {
    const parsed = caseSchema.safeParse({
      id: "Not_Kebab",
      tier: "extraction",
      description: "bad",
      input: { message: "hi" },
      expect: { kind: "text" },
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects a pending case with no reason", () => {
    const parsed = caseSchema.safeParse({
      id: "pending-noreason",
      tier: "tools",
      description: "bad",
      pending: true,
      input: { message: "hi" },
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects an unknown top-level key (strict)", () => {
    const parsed = caseSchema.safeParse({
      id: "extra-key",
      tier: "extraction",
      description: "bad",
      input: { message: "hi" },
      expect: { kind: "text" },
      surprise: true,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("loadCases — filesystem-level guards", () => {
  test("throws when a filename does not match its id", () => {
    const dir = tempDir("mismatch");
    writeFileSync(
      join(dir, "wrong-name.yaml"),
      "id: right-name\ntier: extraction\ndescription: x\ninput:\n  message: hi\nexpect:\n  kind: text\n",
    );
    expect(() => loadCases(dir)).toThrow(/must match its filename/);
  });

  test("throws on malformed YAML", () => {
    const dir = tempDir("badyaml");
    writeFileSync(join(dir, "broken.yaml"), "id: broken\n  : : bad indent\n");
    expect(() => loadCases(dir)).toThrow(/malformed YAML|invalid eval case/);
  });
});
