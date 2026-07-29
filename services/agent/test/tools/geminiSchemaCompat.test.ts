import { describe, expect, test } from "vitest";
import { TOOLS } from "../../src/tools/index.js";

/**
 * Gemini-dialect compatibility guard for the tool schemas.
 *
 * Every tool's `schema.parameters` is handed to the provider VERBATIM — the Gemini adapter
 * spreads `t.parameters` with no filtering (geminiProvider.ts:108-113, plain fetch, no SDK
 * sanitizer in the path). Gemini's function-declaration `Schema` proto is an OpenAPI-3.0
 * subset; an UNKNOWN FIELD NAME is a deterministic JSON→proto parse rejection → non-retryable
 * 400 → no fallback (the fallback allowlist is 429/5xx/timeout/network only). That is exactly
 * how `exclusiveMinimum` silently broke the PRIMARY provider — every real turn 400'd and only
 * the Groq fallback served, so the failure hid in the recordings (ADR-0011 finding (a)).
 *
 * This test walks the SAME object graph the provider sends and fails the build if any schema
 * reintroduces a field name outside Gemini's allowlist (exclusiveMinimum, exclusiveMaximum,
 * multipleOf, additionalProperties, $ref, oneOf, allOf, const, …). DB-free, live-call-free.
 */

// Gemini `Schema` proto field names (generativelanguage **v1beta**, an OpenAPI-3.0 subset), read
// from ai.google.dev/api/caching#Schema on 2026-07-28. Hand-maintained: a field wrongly ADDED here
// makes the guard silently permissive, so re-check the source before extending this set.
const GEMINI_SCHEMA_FIELDS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "anyOf",
  "default",
  "example",
  "propertyOrdering",
]);

// `format` VALUES the schemas actually ship. Unlike an unknown field NAME (a provable JSON→proto
// parse rejection), an unsupported format VALUE is a known-field/bad-value case — and the live
// re-record of 2026-07-28 answered it empirically: all 30 committed fixtures are successful
// Gemini calls whose request carried `format: "date"` and `format: "uuid"`, so Gemini ACCEPTS
// both despite neither appearing in its documented set. Documented values plus those two:
const GEMINI_ACCEPTED_FORMATS = new Set([
  // documented (ai.google.dev/api/caching#Schema)
  "enum",
  "date-time",
  "float",
  "double",
  "int32",
  "int64",
  // Empirically accepted 2026-07-28 by the 30-fixture Gemini-primary capture. NB this evidence is
  // ALIAS-BOUND: the capture ran through `gemini-flash-latest`, and ADR-0007 explicitly accepts
  // that the model served behind that alias shifts under us (it already has). So acceptance can
  // lapse without any change in this repo — a live 400 on these formats is a re-verify signal,
  // not a contradiction of this list.
  "date",
  "uuid",
]);

/** Collect every `{ path, key }` object-key and every `{ path, value }` format found in a schema. */
function walk(
  node: unknown,
  path: string,
  onKey: (key: string, path: string) => void,
  onFormat: (value: unknown, path: string) => void,
): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`, onKey, onFormat));
    return;
  }
  if (!node || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    onKey(key, path);
    if (key === "format") onFormat(obj[key], `${path}.format`);

    // Descend into structural keywords whose VALUES are (or contain) sub-schemas. `enum` and
    // `required` hold plain strings, not sub-schemas, so they are intentionally not recursed —
    // an `enum` value of "type" must not be mistaken for the `type` field.
    if (key === "properties" && obj[key] && typeof obj[key] === "object") {
      for (const [prop, sub] of Object.entries(obj[key] as Record<string, unknown>)) {
        walk(sub, `${path}.properties.${prop}`, onKey, onFormat);
      }
    } else if (key === "items" || key === "anyOf") {
      walk(obj[key], `${path}.${key}`, onKey, onFormat);
    }
  }
}

describe("tool schemas are Gemini function-declaration compatible", () => {
  test("no schema uses a field name outside Gemini's Schema-proto allowlist", () => {
    const violations: string[] = [];
    for (const tool of TOOLS) {
      walk(
        tool.schema.parameters,
        tool.name,
        (key, path) => {
          if (!GEMINI_SCHEMA_FIELDS.has(key)) violations.push(`${path}.${key}`);
        },
        () => {},
      );
    }
    // A non-empty list means a Gemini-incompatible keyword would 400 the PRIMARY provider,
    // non-retryably, and hide behind the Groq fallback. e.g. `exclusiveMinimum` (ADR-0011 (a)).
    expect(violations).toEqual([]);
  });

  // The format-VALUE class is a weaker guard than the field-name one above and is scoped
  // accordingly. `format` is a valid Gemini field, so a bad VALUE is not a provable parse
  // rejection; the 2026-07-28 live capture settled the two values we actually ship ("date",
  // "uuid" — both accepted). This test therefore pins the shipped set rather than the documented
  // one: it fails when a schema introduces a format value NOBODY has verified live, which is the
  // only moment the question is open again.
  test("format values are documented, or empirically verified against the live API", () => {
    const offenders: string[] = [];
    for (const tool of TOOLS) {
      walk(
        tool.schema.parameters,
        tool.name,
        () => {},
        (value, path) => {
          if (typeof value === "string" && !GEMINI_ACCEPTED_FORMATS.has(value)) {
            offenders.push(`${path}=${value}`);
          }
        },
      );
    }
    expect(offenders).toEqual([]);
  });
});
