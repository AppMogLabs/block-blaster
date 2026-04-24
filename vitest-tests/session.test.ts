import { describe, it, expect, beforeEach } from "vitest";
import { issueSession, validateSession } from "../lib/session";
import { __resetSessionStore } from "../lib/sessionStore";
import { DIFFICULTY_MODES } from "../lib/difficulty";

const SECRET = "test-secret-value-at-least-32-bytes-long-ok";
const WALLET = "0x00000000000000000000000000000000000000A1";

describe("session issue/validate", () => {
  beforeEach(() => {
    __resetSessionStore();
    const g = globalThis as {
      __bbSessions?: Map<string, number>;
      __bbMinted?: Map<string, number>;
    };
    g.__bbSessions = new Map();
    g.__bbMinted = new Map();
  });

  it("issues a structurally valid token", () => {
    const { token, payload } = issueSession({
      walletAddress: WALLET,
      modeId: 0,
      secret: SECRET,
    });
    expect(token.split(".").length).toBe(2);
    expect(payload.walletAddress).toBe(WALLET.toLowerCase());
    expect(payload.modeId).toBe(0);
    expect(typeof payload.sessionId).toBe("string");
  });

  it("validates a fresh token (non-consuming)", async () => {
    const { token } = issueSession({ walletAddress: WALLET, modeId: 0, secret: SECRET });
    const r = await validateSession({
      token,
      expectedWallet: WALLET,
      score: 0,
      modeId: 0,
      secret: SECRET,
      consume: false,
    });
    expect(r.valid).toBe(true);
  });

  it("rejects wallet mismatch", async () => {
    const { token } = issueSession({ walletAddress: WALLET, modeId: 0, secret: SECRET });
    const r = await validateSession({
      token,
      expectedWallet: "0x00000000000000000000000000000000000000b0",
      score: 0,
      modeId: 0,
      secret: SECRET,
      consume: false,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/wallet/);
  });

  it("rejects mode mismatch", async () => {
    const { token } = issueSession({ walletAddress: WALLET, modeId: 0, secret: SECRET });
    const r = await validateSession({
      token,
      expectedWallet: WALLET,
      score: 0,
      modeId: 2,
      secret: SECRET,
      consume: false,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/mode/);
  });

  it("rejects bad signature", async () => {
    const { token } = issueSession({ walletAddress: WALLET, modeId: 0, secret: SECRET });
    const bad = token.replace(/\.(.+)$/, ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const r = await validateSession({
      token: bad,
      expectedWallet: WALLET,
      score: 0,
      modeId: 0,
      secret: SECRET,
      consume: false,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/signature/);
  });

  it("rejects impossibly large score for elapsed time", async () => {
    const { token } = issueSession({ walletAddress: WALLET, modeId: 1, secret: SECRET });
    const r = await validateSession({
      token,
      expectedWallet: WALLET,
      score: 1_000_000,
      modeId: 1,
      secret: SECRET,
      consume: false,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/impossible/);
  });

  it("rejects non-finite / negative scores", async () => {
    const { token } = issueSession({ walletAddress: WALLET, modeId: 0, secret: SECRET });
    for (const bad of [-1, NaN, Infinity, -Infinity]) {
      const r = await validateSession({
        token,
        expectedWallet: WALLET,
        score: bad,
        modeId: 0,
        secret: SECRET,
        consume: false,
      });
      expect(r.valid, `should reject ${bad}`).toBe(false);
    }
  });

  it("consume: true claims once — second call returns already-used", async () => {
    const { token } = issueSession({ walletAddress: WALLET, modeId: 0, secret: SECRET });
    const args = {
      token,
      expectedWallet: WALLET,
      score: 0,
      modeId: 0,
      secret: SECRET,
      consume: true,
    };
    const first = await validateSession(args);
    expect(first.valid).toBe(true);
    const second = await validateSession(args);
    expect(second.valid).toBe(false);
    if (!second.valid) expect(second.reason).toMatch(/already used/);
  });

  it("consume: false does NOT claim (bank flow)", async () => {
    const { token } = issueSession({ walletAddress: WALLET, modeId: 0, secret: SECRET });
    const args = {
      token,
      expectedWallet: WALLET,
      score: 0,
      modeId: 0,
      secret: SECRET,
      consume: false,
    };
    for (let i = 0; i < 5; i++) {
      const r = await validateSession(args);
      expect(r.valid).toBe(true);
    }
    const final = await validateSession({ ...args, consume: true });
    expect(final.valid).toBe(true);
  });

  it("each mode yields a distinct token", () => {
    const tokens = new Set<string>();
    for (const mode of DIFFICULTY_MODES) {
      const { token } = issueSession({
        walletAddress: WALLET,
        modeId: mode.id,
        secret: SECRET,
      });
      tokens.add(token);
    }
    expect(tokens.size).toBe(DIFFICULTY_MODES.length);
  });
});
