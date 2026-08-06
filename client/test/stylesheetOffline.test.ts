import { describe, expect, test } from "vitest";

/**
 * The client stylesheet must never fetch anything at runtime.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. A webfont is the single easiest thing to add to a
 * stylesheet and the single hardest to notice in review: one at-rule import at the top of a
 * 500-line file, and the diff reads as a font choice rather than a network dependency. What
 * makes it worth a test is HOW it fails — silently. A font request that is slow, blocked, or
 * answered by a CDN having a bad day does not error; the browser falls back and the page simply
 * renders in a different typeface. Nothing goes red. So:
 *
 *   - it puts a third-party CDN on the critical path of every page load, for an asset the theme
 *     does not need (the stack in index.css is deliberately system/ui-monospace);
 *   - it escapes the e2e suite's hermeticity. `pnpm e2e` is hermetic by intent — the rates API is
 *     mocked at the network layer (.github/workflows/ci.yml, "Playwright E2E (mocked rates API)")
 *     — but a stylesheet's own font request is not one of those mocked routes and would go to the
 *     real internet, making rendering depend on runner connectivity at run time;
 *   - it hands a font CDN the IP of every visitor.
 *
 * NOT because CI is network-isolated: it is not. The workflow runs `pnpm install --frozen-lockfile`
 * and `playwright install --with-deps` on ubuntu-latest, both of which need the network. A remote
 * font would very likely LOAD in CI — which is exactly why the check has to be a static assertion
 * about the source text rather than something a green pipeline could ever demonstrate.
 *
 * COMMENTS ARE SCANNED TOO, deliberately. Stripping `/* … *\/` before matching would be more
 * "correct" in the sense that a URL in a comment fetches nothing — but a commented-out `@import`
 * is exactly what a reviewer waves through and a later PR uncomments. The guard treats the
 * presence of the construct as the failure, not its live-ness. (This is why index.css's own
 * header prose avoids spelling the at-rule literally; see the note at the top of that file.)
 *
 * The rules target REMOTE protocols specifically, not `url()` as a category: `url(data:…)` and
 * `url(./sprite.svg)` are local, ship inside the bundle, and are fine.
 */

/**
 * Raw text via Vite's own glob rather than `node:fs`: the client declares no `@types/node`, and
 * adding one so a lint-shaped test can call `readFileSync` would be a dependency bought for a
 * test. Same idiom as test/proxyContract.test.ts.
 *
 * The glob covers **all** of src, not just index.css — a second stylesheet must inherit the
 * constraint the moment it is added, without anyone remembering to widen this file. The glob does
 * NOT error on zero matches (Vite compiles an unmatched pattern to `Object.assign({})`), so the
 * anti-vacuous test below is what turns "found nothing" into a failure.
 */
const STYLESHEETS = import.meta.glob("../src/**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface RemoteRule {
  /** Named in the failure message, so the output says what was found. */
  name: string;
  pattern: RegExp;
}

const REMOTE_RULES: RemoteRule[] = [
  {
    // Banned outright, INCLUDING the local form — a deliberate constraint, not a build limitation
    // (Vite does inline a relative `@import` via postcss-import). The reason is that this rule is
    // the ONLY thing that catches `@import "//fonts.googleapis.com/…";` — bare string, no `url()`,
    // no scheme — so narrowing it to "remote imports only" means re-deriving what "remote" means
    // in a second place. The cost is real and worth naming: splitting index.css into partials, or
    // adopting anything that ships as `@import "framework";`, requires revisiting this rule.
    name: "an @import at-rule",
    pattern: /@import/i,
  },
  {
    // Catches the protocol-relative `url(//cdn.example/x.woff2)`, which rule 3 misses because it
    // has no scheme. Quotes optional, whitespace tolerated: url( ' // … ).
    name: "url() pointing at a remote host",
    pattern: /url\(\s*["']?\s*(?:https?:|\/\/)/i,
  },
  {
    // The blunt one: any absolute http(s) URL anywhere in the file, in a declaration or a comment.
    name: "an absolute http(s) URL",
    pattern: /https?:\/\//i,
  },
];

interface Finding {
  file: string;
  rule: string;
  line: number;
  text: string;
}

/**
 * Every remote construct in `text`, with the 1-indexed line and the offending line's content.
 *
 * Matched against the WHOLE text, not line by line: `url(\n  //cdn.example/x.woff2\n)` is valid
 * CSS, and a line-scoped scan would see neither half of it. One finding per line — a single
 * `@import url("https://…")` trips all three rules, and printing the same line three times reads
 * as three problems.
 */
function findRemoteRefs(file: string, text: string): Finding[] {
  const lines = text.split("\n");
  const out: Finding[] = [];
  const claimed = new Set<number>();

  for (const rule of REMOTE_RULES) {
    const re = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace("g", "")}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split("\n").length;
      if (claimed.has(line)) continue;
      claimed.add(line);
      out.push({ file, rule: rule.name, line, text: lines[line - 1]!.trim() });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

function describeFindings(findings: Finding[]): string {
  return findings
    .map((f) => `  ${f.file}:${f.line} — ${f.rule}\n      ${f.text}`)
    .join("\n");
}

const INDEX_CSS = "../src/index.css";

describe("the client stylesheet declares no network dependency", () => {
  test("the stylesheets actually loaded (anti-vacuous)", () => {
    // Without this, a renamed file or a moved test directory would empty STYLESHEETS and the scan
    // below would pass over nothing — a green guard that guards nothing, which is worse than none.
    expect(
      Object.keys(STYLESHEETS),
      "no stylesheet was picked up by the glob, so the offline scan below would assert nothing. " +
        "Either client/src/index.css moved, or this test file did.",
    ).toContain(INDEX_CSS);

    // A file that exists but is empty (or is a stub someone truncated) would also scan clean.
    const css = STYLESHEETS[INDEX_CSS]!;
    expect(
      css.length,
      `client/src/index.css is only ${css.length} chars — too short to be the real theme. ` +
        "The offline scan would pass trivially.",
    ).toBeGreaterThan(500);
    expect(css, "client/src/index.css does not define the :root design tokens").toContain(":root");
  });

  test.each(Object.keys(STYLESHEETS))("%s fetches nothing remote", (file) => {
    const findings = findRemoteRefs(file, STYLESHEETS[file]!);

    expect(
      findings,
      `REMOTE REFERENCE IN A STYLESHEET\n` +
        `${describeFindings(findings)}\n` +
        `  ${file} contains a remote reference (an @import at-rule or an http(s)/protocol-relative\n` +
        "  URL). The client stylesheet must fetch nothing at runtime: a remote font or asset puts a\n" +
        "  third-party CDN on the critical path of every page load, and escapes the hermetic e2e\n" +
        "  suite, which mocks the rates API but not a stylesheet's own outbound requests.\n" +
        "  It has to fail HERE because it will not fail anywhere else — a font that is blocked or\n" +
        "  slow does not error, the browser silently falls back and the page just renders in a\n" +
        "  different typeface. Nothing else in the pipeline goes red.\n" +
        "  Use the system/ui-monospace stack already in index.css, or inline the asset as a data: URI.\n" +
        "  NOTE: comments are scanned too — a commented-out @import is what gets uncommented later.",
    ).toEqual([]);
  });

  /**
   * The detector, tested against the mutations it exists to catch. Without these, a typo'd regex
   * (or a later "cleanup" that narrows one) would leave every test above green while catching
   * nothing — the exact rot this whole file is built to prevent, one level up.
   */
  describe("the detector catches what it claims to (positive controls)", () => {
    const CAUGHT: { label: string; css: string }[] = [
      {
        label: "a webfont @import",
        css: '@import url("https://fonts.googleapis.com/css2?family=X");\nbody { color: red; }',
      },
      { label: "a bare http(s) URL inside a comment", css: "/* see https://example.com/x.woff2 */" },
      {
        // Load-bearing control: rule 1 is the ONLY rule that catches this shape. There is no
        // `url(` for rule 2 and no scheme for rule 3, yet it is valid CSS that fetches a real
        // webfont. Without this case, deleting the @import rule outright leaves every other
        // control green — i.e. the anti-rot claim this describe block makes would be false.
        label: "a bare-string protocol-relative @import (caught by rule 1 alone)",
        css: '@import "//fonts.googleapis.com/css2?family=X";',
      },
      {
        // Rule 2's reason to exist: protocol-relative inside url(), split across lines.
        label: "a multi-line url() with a protocol-relative host",
        css: "@font-face {\n  src: url(\n    //cdn.example.com/x.woff2\n  );\n}",
      },
      { label: "a protocol-relative url()", css: "@font-face { src: url(//cdn.example.com/x.woff2); }" },
      { label: "a quoted remote url()", css: "body { background: url('https://example.com/bg.png'); }" },
      { label: "an uppercase @IMPORT", css: '@IMPORT "https://example.com/a.css";' },
    ];

    test.each(CAUGHT)("flags $label", ({ css }) => {
      expect(findRemoteRefs("synthetic.css", css)).not.toEqual([]);
    });

    const ALLOWED: { label: string; css: string }[] = [
      {
        label: "a data: URI",
        css: "body { background: url(data:image/svg+xml;base64,AAAA); }",
      },
      { label: "a relative url()", css: "body { background: url(./sprite.svg); }" },
      { label: "a root-relative url()", css: "body { background: url(/sprite.svg); }" },
      {
        // A literal excerpt of the select-caret rule, pinned rather than read from the live file:
        // re-scanning index.css here would just restate the main scan above and fire a second,
        // vaguer failure whenever the real file goes bad. The `//` in a protocol-relative URL and
        // the `%` arithmetic in calc() are the two shapes most likely to trip an over-broad rule.
        label: "gradient + calc() syntax that must not read as a protocol-relative URL",
        css:
          "background-image: linear-gradient(45deg, transparent 50%, var(--ink) 50%),\n" +
          "  linear-gradient(135deg, var(--ink) 50%, transparent 50%);\n" +
          "background-position: calc(100% - 1.05rem) 55%, calc(100% - 0.7rem) 55%;",
      },
    ];

    // The mirror image: too BROAD a rule is also a defect. It would ban the local, bundled assets
    // this theme is allowed to use and push someone toward deleting the guard.
    test.each(ALLOWED)("allows $label", ({ css }) => {
      expect(findRemoteRefs("synthetic.css", css)).toEqual([]);
    });
  });
});
