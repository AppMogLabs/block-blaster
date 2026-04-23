import { test, expect } from "@playwright/test";

/**
 * Rate limiting + session-replay defense tests.
 *
 * These hit `/api/session` and `/api/session/validate` directly — no deployed
 * contracts required. The mint-level consume test is in `game-flow.spec.ts`
 * because it requires the full flow including deployed contract addresses in
 * the env (otherwise /api/mint fails at config validation).
 *
 * Runs in-process against whatever server `playwright.config.ts` spun up.
 * Uses distinct wallet addresses per test so the in-memory rate limiter
 * doesn't carry counters between tests.
 */

const W = (suffix: string) => `0x${suffix.padEnd(40, "0")}`;

test("session issuance rejects malformed wallet", async ({ request }) => {
  const res = await request.post("/api/session", {
    data: { walletAddress: "not-an-address", modeId: 0 },
  });
  expect(res.status()).toBe(400);
});

test("session issuance rejects non-numeric modeId", async ({ request }) => {
  const res = await request.post("/api/session", {
    data: { walletAddress: W("a"), modeId: "easy" },
  });
  expect(res.status()).toBe(400);
});

test("session rate limit eventually returns 429", async ({ request }) => {
  const wallet = W("1");
  // Limit is 12/minute — fire 20 in a tight loop and expect ≥1 429.
  const results: number[] = [];
  for (let i = 0; i < 20; i++) {
    const res = await request.post("/api/session", {
      data: { walletAddress: wallet, modeId: 0 },
    });
    results.push(res.status());
  }
  const ok = results.filter((s) => s === 200).length;
  const limited = results.filter((s) => s === 429).length;
  expect(ok).toBeGreaterThan(0); // at least some succeed
  expect(limited).toBeGreaterThan(0); // eventually we hit the wall
});

test("rate-limited response includes Retry-After header", async ({ request }) => {
  const wallet = W("2");
  // Burn through the budget.
  let limited: Awaited<ReturnType<typeof request.post>> | null = null;
  for (let i = 0; i < 30; i++) {
    const res = await request.post("/api/session", {
      data: { walletAddress: wallet, modeId: 0 },
    });
    if (res.status() === 429) {
      limited = res;
      break;
    }
  }
  expect(limited, "expected at least one 429 within 30 requests").not.toBeNull();
  expect(limited!.headers()["retry-after"]).toMatch(/^\d+$/);
  const body = await limited!.json();
  expect(body.retryAfterSec).toBeGreaterThan(0);
});

test("session validate accepts a fresh token", async ({ request }) => {
  const wallet = W("3");
  const issue = await request.post("/api/session", {
    data: { walletAddress: wallet, modeId: 0 },
  });
  expect(issue.status()).toBe(200);
  const { token } = await issue.json();

  const validate = await request.post("/api/session/validate", {
    data: { token, walletAddress: wallet, score: 100, modeId: 0 },
  });
  const body = await validate.json();
  expect(body.valid).toBe(true);
});

test("session validate rejects wallet mismatch", async ({ request }) => {
  const walletA = W("4");
  const walletB = W("5");
  const issue = await request.post("/api/session", {
    data: { walletAddress: walletA, modeId: 0 },
  });
  const { token } = await issue.json();

  const validate = await request.post("/api/session/validate", {
    data: { token, walletAddress: walletB, score: 100, modeId: 0 },
  });
  const body = await validate.json();
  expect(body.valid).toBe(false);
  expect(body.reason).toMatch(/wallet mismatch/);
});

test("session validate rejects mode mismatch", async ({ request }) => {
  const wallet = W("6");
  const issue = await request.post("/api/session", {
    data: { walletAddress: wallet, modeId: 0 },
  });
  const { token } = await issue.json();

  const validate = await request.post("/api/session/validate", {
    data: { token, walletAddress: wallet, score: 100, modeId: 2 },
  });
  const body = await validate.json();
  expect(body.valid).toBe(false);
  expect(body.reason).toMatch(/mode mismatch/);
});

test("session validate rejects forged token signature", async ({ request }) => {
  const wallet = W("7");
  const issue = await request.post("/api/session", {
    data: { walletAddress: wallet, modeId: 0 },
  });
  const { token } = await issue.json();
  // Tamper with the signature portion (after the dot).
  const tampered = token.replace(/\.(.+)$/, ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

  const validate = await request.post("/api/session/validate", {
    data: { token: tampered, walletAddress: wallet, score: 100, modeId: 0 },
  });
  const body = await validate.json();
  expect(body.valid).toBe(false);
  expect(body.reason).toMatch(/signature|malformed/);
});
