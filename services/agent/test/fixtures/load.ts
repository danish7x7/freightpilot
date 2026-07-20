import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** A recorded raw wire response: the HTTP status + the exact JSON body a provider returned. */
export interface WireFixture {
  status: number;
  body: unknown;
}

/** Load a fixture by path relative to test/fixtures, e.g. loadFixture("gemini/text.json"). */
export function loadFixture(rel: string): WireFixture {
  return JSON.parse(readFileSync(join(here, rel), "utf8")) as WireFixture;
}
