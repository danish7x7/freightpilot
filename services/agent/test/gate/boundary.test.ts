import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * STRUCTURAL guard for the load-bearing L3 invariant (Condition C): the proposal executor —
 * the only code that issues the two real booking POSTs — must be UNREACHABLE from the tool
 * loop. We assert by static import graph: NO file under src/tools or src/loop may import
 * anything from src/gate. LLM output flows into the loop; the loop cannot reach execution.
 *
 * This mirrors L2's "withhold the capability" construction and is deliberately hard to weaken:
 * adding a gate import anywhere in the loop/tools fails this test.
 */
const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(full);
    return e.isFile() && e.name.endsWith(".ts") ? [full] : [];
  });
}

// Catches static `from "x"`, dynamic `import("x")`, and `require("x")` — so a dynamic import
// can't smuggle the executor into the loop past this guard.
const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(IMPORT_RE)].map((m) => m[1]);
}

describe("hard boundary — the executor is unreachable from the loop (Condition C)", () => {
  for (const area of ["tools", "loop"]) {
    test(`no file under src/${area} imports src/gate`, () => {
      const offenders: string[] = [];
      for (const file of tsFiles(join(srcRoot, area))) {
        for (const spec of importsOf(file)) {
          if (spec.includes("/gate/") || spec.endsWith("/gate") || spec.includes("gateService") || spec.includes("executor")) {
            offenders.push(`${file} imports ${spec}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  test("the executor is imported ONLY by the gate service (its single caller)", () => {
    const importers: string[] = [];
    for (const file of tsFiles(srcRoot)) {
      // Match the executor whether imported by package path (gate/executor) or relatively
      // (./executor.js) — the only legitimate importer is gateService.
      if (importsOf(file).some((s) => /(^|\/)executor(\.js)?$/.test(s))) {
        importers.push(file.replace(srcRoot, "src").replaceAll("\\", "/"));
      }
    }
    expect(importers).toEqual(["src/gate/gateService.ts"]);
  });
});
