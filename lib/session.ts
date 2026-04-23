/**
 * Session token issue + validate.
 *
 * A session token is the HMAC-SHA256 of a compact payload, signed with
 * SESSION_SECRET. Tokens are single-use: `validateSession({consume:true})`
 * claims the sessionId in the backing store atomically.
 *
 * IMPORTANT — anti-cheat invariant:
 * The plausibility check below (see `maxPlausibleScore`) must stay in sync
 * with in-game scoring rules. If you adjust block values, combo multipliers,
 * or rare-block ratios in the Phaser scene, update `lib/difficulty.ts` at
 * the same time or cheating becomes trivial.
 */

import crypto from "node:crypto";
import { maxPlausibleScore, getDifficulty } from "./difficulty";
import { sessionStore } from "./sessionStore";

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type SessionPayload = {
  walletAddress: string;
  issuedAt: number; // ms epoch
  sessionId: string;
  modeId: number;
};

function sign(payloadJson: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadJson).digest("base64url");
}

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function issueSession(params: {
  walletAddress: string;
  modeId: number;
  secret: string;
}): { token: string; payload: SessionPayload } {
  getDifficulty(params.modeId); // validate mode
  const payload: SessionPayload = {
    walletAddress: params.walletAddress.toLowerCase(),
    issuedAt: Date.now(),
    sessionId: crypto.randomUUID(),
    modeId: params.modeId,
  };
  const json = JSON.stringify(payload);
  const sig = sign(json, params.secret);
  const token = `${b64urlEncode(json)}.${sig}`;
  return { token, payload };
}

export type ValidateResult =
  | { valid: true; payload: SessionPayload }
  | { valid: false; reason: string };

export async function validateSession(params: {
  token: string;
  expectedWallet: string;
  score: number;
  modeId: number;
  secret: string;
  /** If true, atomically mark the session as used. */
  consume?: boolean;
}): Promise<ValidateResult> {
  const { token, secret } = params;
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed token" };
  const [b64, sig] = parts;

  let payloadJson: string;
  let payload: SessionPayload;
  try {
    payloadJson = b64urlDecode(b64).toString("utf8");
    payload = JSON.parse(payloadJson);
  } catch {
    return { valid: false, reason: "malformed payload" };
  }

  const expected = sign(payloadJson, secret);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad signature" };
  }

  if (Date.now() - payload.issuedAt > SESSION_TTL_MS) {
    return { valid: false, reason: "expired" };
  }

  if (payload.walletAddress.toLowerCase() !== params.expectedWallet.toLowerCase()) {
    return { valid: false, reason: "wallet mismatch" };
  }

  if (payload.modeId !== params.modeId) {
    return { valid: false, reason: "mode mismatch" };
  }

  if (!Number.isFinite(params.score) || params.score < 0 || params.score > 1e12) {
    return { valid: false, reason: "bad score shape" };
  }

  const elapsedSec = (Date.now() - payload.issuedAt) / 1000;
  const maxScore = maxPlausibleScore(params.modeId, elapsedSec);
  if (params.score > maxScore) {
    return {
      valid: false,
      reason: `impossible score: ${params.score} > ${maxScore} max for mode=${params.modeId} after ${elapsedSec.toFixed(1)}s`,
    };
  }

  if (params.consume) {
    const won = await sessionStore().claim(payload.sessionId);
    if (!won) return { valid: false, reason: "already used" };
  }

  return { valid: true, payload };
}
