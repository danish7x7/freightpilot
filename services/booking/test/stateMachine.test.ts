// Exhaustive unit coverage of the booking state machine (§2.4) — every legal AND illegal
// transition, plus the null-birth and terminal states. Pure, no DB (the L2 DoD core).
import { describe, expect, test } from "vitest";
import { IllegalTransitionError } from "../src/domain/errors.js";
import { bookingStateMachine, type BookingStatus } from "../src/domain/stateMachine.js";

const STATUSES: BookingStatus[] = [
  "QUOTED",
  "HELD",
  "CONFIRMED",
  "DOCUMENTS_ISSUED",
  "EXPIRED",
  "CANCELLED",
];

// The full legal set per §2.4 (from → to).
const LEGAL = new Set([
  "QUOTED->HELD",
  "QUOTED->CANCELLED",
  "QUOTED->EXPIRED",
  "HELD->CONFIRMED",
  "HELD->CANCELLED",
  "HELD->EXPIRED",
  "CONFIRMED->DOCUMENTS_ISSUED",
  "CONFIRMED->CANCELLED",
]);

describe("every from × to pair", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const key = `${from}->${to}`;
      const legal = LEGAL.has(key);
      test(`${key} is ${legal ? "legal" : "ILLEGAL"}`, () => {
        expect(bookingStateMachine.canTransition(from, to)).toBe(legal);
        if (legal) {
          expect(() => bookingStateMachine.assertTransition(from, to)).not.toThrow();
        } else {
          expect(() => bookingStateMachine.assertTransition(from, to)).toThrow(IllegalTransitionError);
        }
      });
    }
  }
});

describe("birth (from = null)", () => {
  test("null → QUOTED is the only legal birth", () => {
    expect(bookingStateMachine.canTransition(null, "QUOTED")).toBe(true);
    expect(() => bookingStateMachine.assertTransition(null, "QUOTED")).not.toThrow();
  });
  for (const to of STATUSES.filter((s) => s !== "QUOTED")) {
    test(`null → ${to} is ILLEGAL`, () => {
      expect(bookingStateMachine.canTransition(null, to)).toBe(false);
      expect(() => bookingStateMachine.assertTransition(null, to)).toThrow(IllegalTransitionError);
    });
  }
});

describe("terminal states", () => {
  test.each(["DOCUMENTS_ISSUED", "EXPIRED", "CANCELLED"] as BookingStatus[])(
    "%s is terminal (no outgoing transitions)",
    (s) => {
      expect(bookingStateMachine.isTerminal(s)).toBe(true);
      for (const to of STATUSES) expect(bookingStateMachine.canTransition(s, to)).toBe(false);
    },
  );
  test.each(["QUOTED", "HELD", "CONFIRMED"] as BookingStatus[])("%s is not terminal", (s) => {
    expect(bookingStateMachine.isTerminal(s)).toBe(false);
  });
});

test("IllegalTransitionError carries the 409 / ILLEGAL_TRANSITION envelope", () => {
  try {
    bookingStateMachine.assertTransition("QUOTED", "CONFIRMED");
    throw new Error("expected assertTransition to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(IllegalTransitionError);
    expect((err as IllegalTransitionError).httpStatus).toBe(409);
    expect((err as IllegalTransitionError).code).toBe("ILLEGAL_TRANSITION");
  }
});
