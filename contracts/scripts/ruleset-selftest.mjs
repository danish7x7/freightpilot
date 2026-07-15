// Regression guard for the custom house-convention rules in .spectral.yaml.
// Runs spectral against test/negative.openapi.yaml (a deliberately-broken spec) and
// asserts that BOTH custom rules fire. If a rule is turned off, renamed, or its
// JSONPath stops matching, this fails — so §5 enforcement can't quietly disappear.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const bin = resolve(root, "node_modules/.bin/spectral");
const fixture = resolve(root, "test/negative.openapi.yaml");
const ruleset = resolve(root, ".spectral.yaml");

const expected = [
  "freightpilot-error-responses-use-envelope",
  "freightpilot-responses-declare-request-id",
];

const run = spawnSync(bin, ["lint", fixture, "--ruleset", ruleset, "-f", "json"], {
  encoding: "utf8",
});

if (run.error) {
  console.error("failed to run spectral:", run.error.message);
  process.exit(2);
}

let results;
try {
  results = JSON.parse(run.stdout);
} catch {
  console.error("could not parse spectral JSON output:\n", run.stdout, run.stderr);
  process.exit(2);
}

const codes = new Set(results.map((r) => r.code));
const missing = expected.filter((code) => !codes.has(code));

if (missing.length > 0) {
  console.error(
    `ruleset self-test FAILED — the negative fixture did not trip: ${missing.join(", ")}.\n` +
      `These §5 house-convention rules are no longer catching violations.`,
  );
  process.exit(1);
}

console.log(`ruleset self-test OK — both custom rules fired: ${expected.join(", ")}`);
