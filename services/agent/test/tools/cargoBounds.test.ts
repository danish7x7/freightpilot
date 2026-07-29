import { describe, expect, test } from "vitest";
import { cargoSchema, shipmentJsonSchema } from "../../src/tools/shipment.js";

/**
 * The enforcement boundary for cargo bounds is Zod, NOT the JSON-Schema hint.
 *
 * ADR-0011 finding (a) forced `shipmentJsonSchema` to drop `exclusiveMinimum` — Gemini's
 * function-declaration dialect rejects the keyword outright (non-retryable 400 on the PRIMARY
 * provider). The fragment now says `minimum: 0` and carries the strict ">0" intent in
 * `description`, which means the hint handed to the model is DELIBERATELY WEAKER than the rule.
 *
 * That is only safe because `cargoSchema` still says `.gt(0)` and the loop refuses to execute a
 * tool whose args fail `validate` (agentLoop.ts — `safeParse` gates `execute`). These tests pin
 * that asymmetry so the obvious "cleanup" refactor — aligning Zod down to the JSON hint's
 * `minimum: 0` because the two disagree — cannot land with a green suite.
 */

const validCargo = { weight_kg: 5000, description: "palletised electronics" };

describe("cargoSchema is the enforcement boundary for the >0 bounds", () => {
  test("rejects weight_kg: 0 — the value the JSON hint's `minimum: 0` now admits", () => {
    const result = cargoSchema.safeParse({ ...validCargo, weight_kg: 0 });
    expect(result.success).toBe(false);
  });

  test("rejects a negative weight_kg", () => {
    expect(cargoSchema.safeParse({ ...validCargo, weight_kg: -1 }).success).toBe(false);
  });

  test("rejects volume_cbm: 0 when the optional field is present", () => {
    const result = cargoSchema.safeParse({ ...validCargo, volume_cbm: 0 });
    expect(result.success).toBe(false);
  });

  test("still accepts a valid cargo, with and without the optional volume_cbm", () => {
    expect(cargoSchema.safeParse(validCargo).success).toBe(true);
    expect(cargoSchema.safeParse({ ...validCargo, volume_cbm: 12.5 }).success).toBe(true);
  });

  test("keeps enforcing the upper bound the JSON hint also states", () => {
    expect(cargoSchema.safeParse({ ...validCargo, weight_kg: 30001 }).success).toBe(false);
    expect(cargoSchema.safeParse({ ...validCargo, weight_kg: 30000 }).success).toBe(true);
  });
});

describe("the JSON hint is weaker than Zod, and says so", () => {
  const cargo = shipmentJsonSchema.properties.cargo.properties;

  test("the hint admits 0 for both fields — proving Zod is what actually rejects it", () => {
    expect(cargo.weight_kg.minimum).toBe(0);
    expect(cargo.volume_cbm.minimum).toBe(0);
    // If either regains `exclusiveMinimum`, the Gemini guard test fails — this asserts the
    // replacement is present rather than the bound having been dropped altogether.
    expect(cargo.weight_kg).not.toHaveProperty("exclusiveMinimum");
    expect(cargo.volume_cbm).not.toHaveProperty("exclusiveMinimum");
  });

  test("the lost >0 intent is carried in the description the model actually reads", () => {
    expect(cargo.weight_kg.description).toMatch(/greater than 0/);
    expect(cargo.volume_cbm.description).toMatch(/greater than 0/);
  });
});
