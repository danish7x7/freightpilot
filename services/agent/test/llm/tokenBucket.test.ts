import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TokenBucket } from "../../src/llm/tokenBucket.js";

// Fake timers throughout — deterministic pacing, zero real sleeps.
describe("TokenBucket (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("allows a burst up to capacity without waiting", async () => {
    const bucket = new TokenBucket({ rpm: 60, capacity: 3 });
    // Three immediate acquires resolve with the clock never advanced — no waiting.
    await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);
    expect(Date.now()).toBe(0); // no timer had to fire for the burst to complete
  });

  test("paces the next acquire until a token accrues", async () => {
    // 60 rpm = 1 token/sec; capacity 1 means the 2nd acquire waits ~1000ms.
    const bucket = new TokenBucket({ rpm: 60, capacity: 1 });
    await bucket.acquire(); // consumes the only token immediately

    let resolved = false;
    const pending = bucket.acquire().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false); // not enough time for a token yet

    await vi.advanceTimersByTimeAsync(600); // total 1100ms > 1000ms
    await pending;
    expect(resolved).toBe(true);
  });

  test("rejects a non-positive rpm", () => {
    expect(() => new TokenBucket({ rpm: 0 })).toThrow();
  });
});
