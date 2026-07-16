import { expect, test } from "vitest";
import { formatMoney, formatTransit } from "../src/lib/format";

test("formatMoney renders integer cents as currency (÷100 at the boundary)", () => {
  expect(formatMoney(366540, "USD")).toBe("$3,665.40");
  expect(formatMoney(0, "USD")).toBe("$0.00");
});

test("formatTransit collapses an equal min/max range", () => {
  expect(formatTransit(30, 35)).toBe("30–35 days");
  expect(formatTransit(30, 30)).toBe("30 days");
});
