import { test, expect } from "@playwright/test";

/**
 * Smoke-tests the session + leaderboard APIs directly. Does NOT exercise
 * the mint route because that requires deployed contracts + on-chain gas.
 */

test("POST /api/session issues a token for a wallet", async ({ request }) => {
  const res = await request.post("/api/session", {
    data: {
      walletAddress: "0x000000000000000000000000000000000000dEaD",
      modeId: 0,
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(typeof body.sessionId).toBe("string");
});

test("POST /api/session rejects bad mode", async ({ request }) => {
  const res = await request.post("/api/session", {
    data: { walletAddress: "0xdEaD", modeId: 99 },
  });
  expect(res.status()).toBe(400);
});

test("validate rejects impossible score", async ({ request }) => {
  const wallet = "0x000000000000000000000000000000000000dEaD";
  const issue = await request.post("/api/session", {
    data: { walletAddress: wallet, modeId: 0 },
  });
  const { token } = await issue.json();
  const validate = await request.post("/api/session/validate", {
    data: {
      token,
      walletAddress: wallet,
      score: 10_000_000, // wildly impossible for Easy after <1 s
      modeId: 0,
    },
  });
  const body = await validate.json();
  expect(body.valid).toBe(false);
  expect(body.reason).toMatch(/impossible score/);
});

test("GET /api/leaderboard returns shape (deployed or not)", async ({ request }) => {
  const res = await request.get("/api/leaderboard?mode=0");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.entries)).toBe(true);
  expect(typeof body.deployed).toBe("boolean");
});
