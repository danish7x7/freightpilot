import { expect, test } from "vitest";
import { formatMoney, formatTransit, formatDateTime } from "../src/lib/format";

test("formatMoney renders integer cents as currency (÷100 at the boundary)", () => {
  expect(formatMoney(366540, "USD")).toBe("$3,665.40");
  expect(formatMoney(0, "USD")).toBe("$0.00");
});

test("formatTransit collapses an equal min/max range", () => {
  expect(formatTransit(30, 35)).toBe("30–35 days");
  expect(formatTransit(30, 30)).toBe("30 days");
});

test("formatDateTime renders a server ISO instant with date + time", () => {
  // Assert structure, not an exact string, so the test is timezone-independent.
  const out = formatDateTime("2026-07-19T12:00:00.000Z");
  expect(out).toContain("2026");
  expect(out).toMatch(/\d{1,2}:\d{2}/);
});
