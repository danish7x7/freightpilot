import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { caseSchema, type EvalCase } from "./caseSchema.js";

/**
 * Load + parse + Zod-validate every case file under `casesDir` (§1 layout: cases/<tier>/*.yaml).
 * A malformed case, a filename that does not match its `id`, or a duplicate `id` is a HARD
 * ERROR — the gate must never silently skip a case (§2).
 */
export function loadCases(casesDir: string): EvalCase[] {
  const files = listYamlFiles(casesDir).sort(); // deterministic order
  const cases: EvalCase[] = [];
  const seenIds = new Map<string, string>();

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    let doc: unknown;
    try {
      doc = parseYaml(raw);
    } catch (err) {
      throw new Error(`malformed YAML in ${file}: ${(err as Error).message}`);
    }
    const parsed = caseSchema.safeParse(doc);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      throw new Error(`invalid eval case ${file}: ${issues}`);
    }
    const c = parsed.data;

    const stem = basename(file, extname(file));
    if (stem !== c.id) {
      throw new Error(`case id "${c.id}" must match its filename "${stem}" (${file})`);
    }
    const prior = seenIds.get(c.id);
    if (prior) {
      throw new Error(`duplicate case id "${c.id}" in ${file} and ${prior}`);
    }
    seenIds.set(c.id, file);
    cases.push(c);
  }
  return cases;
}

function listYamlFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      if (entry.startsWith(".")) continue; // skip .gitkeep etc.
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (extname(p) === ".yaml" || extname(p) === ".yml") out.push(p);
    }
  };
  walk(dir);
  return out;
}
