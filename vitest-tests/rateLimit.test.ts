import { describe, it, expect, beforeEach } from "vitest";
import { createRateLimit, __resetRateLimits } from "../lib/rateLimit";

/**
 * Unit tests for the in-memory rate-limiter path. Regression-guards for
 * the "all limiters share the same KV key" bug that made wagers fail with
 * "too many requests" after a busy run — previously every limiter INCRed
 * the same `bb:rl:${wallet}` key.
 */
describe("rateLimit", () => {
  beforeEach(() => {
    __resetRateLimits();
    const g = globalThis as { __bbRateLimit?: Map<string, unknown> };
    g.__bbRateLimit = new Map();
  });

  it("allows calls under the limit", async () => {
    const rl = createRateLimit({ name: "t1", limit: 3, windowSec: 60 });
    for (let i = 0; i < 3; i++) {
      const r = await rl.check("user1");
      expect(r.ok).toBe(true);
    }
  });

  it("rejects once the limit is exceeded", async () => {
    const rl = createRateLimit({ name: "t2", limit: 2, windowSec: 60 });
    await rl.check("user1");
    await rl.check("user1");
    const over = await rl.check("user1");
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.retryAfterSec).toBeGreaterThan(0);
  });

  it("tracks different users independently", async () => {
    const rl = createRateLimit({ name: "t3", limit: 1, windowSec: 60 });
    expect((await rl.check("alice")).ok).toBe(true);
    expect((await rl.check("alice")).ok).toBe(false);
    expect((await rl.check("bob")).ok).toBe(true);
  });

  it("different names do NOT share counters (regression: shared-key bug)", async () => {
    const mintish = createRateLimit({ name: "mint", limit: 10, windowSec: 60 });
    const wagerish = createRateLimit({ name: "wager", limit: 3, windowSec: 60 });
    for (let i = 0; i < 10; i++) await mintish.check("sharedWallet");
    const mintOver = await mintish.check("sharedWallet");
    expect(mintOver.ok).toBe(false);
    const wagerFirst = await wagerish.check("sharedWallet");
    expect(wagerFirst.ok).toBe(true);
  });

  it("resets after the window elapses", async () => {
    const rl = createRateLimit({ name: "t4", limit: 1, windowSec: 0.05 });
    expect((await rl.check("u")).ok).toBe(true);
    expect((await rl.check("u")).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect((await rl.check("u")).ok).toBe(true);
  });
});
