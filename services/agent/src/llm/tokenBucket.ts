/**
 * Per-provider token-bucket pacing (MASTER_PLAN §6.1). Sized to each free-tier RPM
 * so the demo never dies to a 429 we could have avoided. `rpm` tokens accrue per
 * minute up to `capacity`; acquire() consumes one, waiting if the bucket is dry.
 *
 * Time is read via Date.now(), so vitest fake timers drive it deterministically —
 * no real sleeps in tests.
 */
export interface TokenBucketOptions {
  rpm: number;
  /** Max burst. Defaults to `rpm` (one minute's worth). */
  capacity?: number;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly ratePerMs: number;

  constructor(opts: TokenBucketOptions) {
    if (opts.rpm <= 0) throw new Error("TokenBucket rpm must be > 0");
    this.capacity = opts.capacity ?? opts.rpm;
    this.ratePerMs = opts.rpm / 60_000;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.max(1, Math.ceil((1 - this.tokens) / this.ratePerMs));
      await delay(waitMs);
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerMs);
      this.lastRefill = now;
    }
  }
}
