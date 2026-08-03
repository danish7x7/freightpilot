import { describe, expect, test } from "vitest";
import { proxyConfig } from "../proxy.config";

/**
 * The proxy map must agree with the contracts (guardian C3).
 *
 * WHY THIS IS THE POINT OF THE CHANGE, not a formality. `proxy.config.ts` is a DERIVED second copy
 * of a path -> service partition that `contracts/*.openapi.yaml` already states. A second copy of a
 * fact drifts. And the drift fails SILENTLY in the worst possible way: an `/api/v1/...` path that
 * matches NO rule is not an error. A GET falls through to Vite's SPA history fallback and returns
 * `200 text/html`, which openapi-fetch surfaces as an opaque parse failure; the fallback bails on
 * other methods, so an unmatched POST 404s instead. Either way it is harder to debug than the CORS
 * error this change exists to fix. So a missing or mis-targeted rule has to fail HERE, at build
 * time, with a message that names the path.
 *
 * EXACTLY ONE rule must match each path, not "at least one". Two matching rules would mean routing
 * is decided by object-key insertion order, and the `/api/v1/quotes` prefix is genuinely split
 * across two services, so that ambiguity is reachable rather than theoretical.
 *
 * No YAML dependency (guardian C4): the client has no YAML parser, and the generated `*.gen.ts`
 * files are types-only so they cannot enumerate paths at runtime. A line regex over the spec text
 * is sufficient and keeps a dev-proxy test from adding a production dependency.
 */

/**
 * Specs are pulled in as RAW TEXT via Vite's own glob rather than `node:fs`, deliberately: the
 * client declares no `@types/node`, and adding one so a dev-proxy test can call `readFileSync`
 * would be a dependency bought for a test.
 *
 * NOTE the glob does NOT fail on a missing file: Vite's `transformGlobImport` compiles a zero-match
 * pattern to `Object.assign({})` with no error and no warning. What turns that into a failure is the
 * runtime `throw` in `specText()` below, which fires while `EXPECTED` is being built at module
 * evaluation and surfaces as a vitest collection error.
 */
const SPEC_TEXT = import.meta.glob("../../contracts/*.openapi.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Which service owns each spec, and therefore which port its paths must proxy to. */
const CONTRACTS: { file: string; port: string }[] = [
  { file: "rates.openapi.yaml", port: "8080" },
  { file: "booking.openapi.yaml", port: "8081" },
  { file: "agent.openapi.yaml", port: "8082" },
];

/**
 * Path counts per spec, pinned so a path silently dropped by a layout change fails loudly.
 * Update deliberately when a contract gains or loses an endpoint.
 */
const EXPECTED_PATH_COUNTS: { file: string; count: number }[] = [
  { file: "rates.openapi.yaml", count: 2 },
  { file: "booking.openapi.yaml", count: 6 },
  { file: "agent.openapi.yaml", count: 2 },
];

/** Top-level `paths:` keys are indented exactly two spaces. */
const PATH_LINE = /^ {2}(\/\S*):\s*$/;

/** `/api/v1/bookings/{id}/confirm` -> `/api/v1/bookings/sample-id/confirm`. */
function substituteParams(path: string): string {
  return path.replace(/\{[^}]+\}/g, "sample-id");
}

function specText(file: string): string {
  const key = Object.keys(SPEC_TEXT).find((k) => k.endsWith(`/${file}`));
  if (key === undefined) {
    throw new Error(
      `contracts/${file} was not picked up by the glob. Loaded: ${Object.keys(SPEC_TEXT).join(", ") || "(none)"}`,
    );
  }
  return SPEC_TEXT[key]!;
}

function contractPaths(file: string): string[] {
  const text = specText(file);
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = PATH_LINE.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

/**
 * Vite's matcher, copied in its actual OR form rather than paraphrased as an if/else. Getting this
 * wrong would make the whole file assert something Vite does not do. Note Vite evaluates the
 * `startsWith` arm even for a regex key; it is always false there because a `req.url` never begins
 * with "^", but reproducing the OR verbatim means a reader does not have to prove that equivalence.
 */
function ruleMatches(key: string, url: string): boolean {
  return (key[0] === "^" && new RegExp(key).test(url)) || url.startsWith(key);
}

function portOf(key: string): string {
  const target = proxyConfig[key]!.target;
  return new URL(String(target)).port;
}

function matchingRules(url: string): string[] {
  return Object.keys(proxyConfig).filter((key) => ruleMatches(key, url));
}

/** Every contract path, with its owning port, params substituted. */
const EXPECTED: { url: string; port: string; file: string }[] = CONTRACTS.flatMap(({ file, port }) =>
  contractPaths(file).map((p) => ({ url: substituteParams(p), port, file })),
);

function describeMatches(url: string, matched: string[]): string {
  if (matched.length === 0) return "  matched: (NONE)";
  return matched.map((k) => `  matched: ${JSON.stringify(k)} -> port ${portOf(k)}`).join("\n");
}

describe("the Vite proxy map agrees with contracts/*.openapi.yaml", () => {
  test("the contracts actually parsed (anti-vacuous)", () => {
    // Without this, a changed indentation or a moved file would empty EXPECTED and every assertion
    // below would pass over an empty list.
    expect(EXPECTED.length).toBe(EXPECTED_PATH_COUNTS.reduce((n, c) => n + c.count, 0));

    // CONTRACTS is itself a hand-maintained second copy of "which specs exist", and an unguarded
    // one: add a fourth contracts/*.openapi.yaml and the glob picks it up while CONTRACTS ignores
    // it, so its paths never enter EXPECTED, no proxy rule is ever required for them, and every
    // call to that service resolves to the SPA fallback with this suite still green. That is the
    // same drift this file exists to prevent, one level up.
    expect(
      Object.keys(SPEC_TEXT).sort(),
      "a contracts/*.openapi.yaml file is not listed in CONTRACTS, so its paths are UNCHECKED " +
        "against the proxy map. Add it to CONTRACTS with its owning port.",
    ).toHaveLength(CONTRACTS.length);

    // Per-file counts, not a floor. `EXPECTED.length >= 10` would be satisfied forever once ten
    // paths exist, so a path silently dropped by an indentation change (which removes it from
    // EXPECTED without orphaning any rule) would go unnoticed.
    for (const { file, count } of EXPECTED_PATH_COUNTS) {
      expect(
        contractPaths(file).length,
        `contracts/${file} yielded a different number of paths than expected. Either a path was ` +
          "added or removed (update EXPECTED_PATH_COUNTS and add a proxy rule if needed), or the " +
          "two-space indentation PATH_LINE relies on has changed and paths are being silently missed.",
      ).toBe(count);
    }

    for (const { port } of CONTRACTS) {
      expect(
        Object.values(proxyConfig).some((o) => new URL(String(o.target)).port === port),
        `no proxy rule targets port ${port}, so that service is unreachable from the client`,
      ).toBe(true);
    }
  });

  test.each(EXPECTED)("$url routes to exactly one rule, on port $port", ({ url, port, file }) => {
    const matched = matchingRules(url);

    expect(
      matched.length,
      `PROXY ROUTING for ${url}\n` +
        `  declared in: contracts/${file}\n` +
        `  expected: exactly 1 matching rule, on port ${port}\n` +
        `  actual:   ${matched.length} matching rule(s)\n` +
        describeMatches(url, matched) +
        (matched.length === 0
          ? "\n  A path matching NO rule does not error: Vite falls through to the SPA history\n" +
            "  fallback and returns 200 text/html, which openapi-fetch reports as a parse failure.\n" +
            "  Add a rule to client/proxy.config.ts."
          : "\n  Two rules matching means routing is decided by object-key insertion order.\n" +
            "  Make the rules mutually exclusive in client/proxy.config.ts."),
    ).toBe(1);

    const actualPort = portOf(matched[0]!);
    expect(
      actualPort,
      `PROXY TARGET for ${url}\n` +
        `  declared in: contracts/${file} (owned by the service on port ${port})\n` +
        `  matched rule: ${JSON.stringify(matched[0])}\n` +
        `  expected port: ${port}\n` +
        `  actual port:   ${actualPort}\n` +
        "  This path would be proxied to the WRONG SERVICE.",
    ).toBe(port);
  });

  test.each(EXPECTED)("$url routes identically with a query string", ({ url, port, file }) => {
    const withQuery = `${url}?a=1`;
    const matched = matchingRules(withQuery);

    expect(
      matched.length,
      `PROXY ROUTING for ${withQuery}\n` +
        `  declared in: contracts/${file}\n` +
        `  expected: exactly 1 matching rule, on port ${port}\n` +
        `  actual:   ${matched.length} matching rule(s)\n` +
        describeMatches(withQuery, matched) +
        "\n  A rule anchored with $ but not \\? stops matching once a query string is appended.",
    ).toBe(1);

    const actualPort = portOf(matched[0]!);
    expect(
      actualPort,
      `PROXY TARGET for ${withQuery}\n` +
        `  matched rule: ${JSON.stringify(matched[0])}\n` +
        `  expected port: ${port}, actual port: ${actualPort}`,
    ).toBe(port);
  });

  test("every rule in the map matches at least one contract path", () => {
    const urls = EXPECTED.map((e) => e.url);
    const orphans = Object.keys(proxyConfig).filter((key) => !urls.some((u) => ruleMatches(key, u)));

    expect(
      orphans,
      `ORPHAN PROXY RULE(S): ${orphans.map((k) => JSON.stringify(k)).join(", ")}\n` +
        "  These rules in client/proxy.config.ts match no path in any contract.\n" +
        `  Known contract paths:\n${urls.map((u) => `    ${u}`).join("\n")}\n` +
        "  Either the path was removed from a contract and the rule is now dead, or the rule\n" +
        "  proxies something the contracts never declared. Both are drift; remove the rule or\n" +
        "  add the path to the owning contract.",
    ).toEqual([]);
  });
});
