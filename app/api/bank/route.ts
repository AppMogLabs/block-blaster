import { NextRequest, NextResponse } from "next/server";
import { validateSession, type SessionPayload } from "@/lib/session";
import { getServerConfig } from "@/lib/config";
import { getChain } from "@/lib/chain";
import { maxPlausibleScore } from "@/lib/difficulty";
import { sessionStore } from "@/lib/sessionStore";
import { mintRateLimit } from "@/lib/rateLimit";
import { logger, shortWallet } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger("bank");

/**
 * Mid-run bank: mint `amount` $BLOK to the player without consuming the
 * session token. Players may bank multiple times per run. The server tracks
 * cumulative minted per session in the session store and checks every bank
 * against `maxPlausibleScore(mode, elapsedSec)` so the total can never
 * exceed the anti-cheat ceiling for the elapsed time.
 *
 * Also calls GameRewards.recordBank so the personal-best value stays in
 * sync with the cumulative total. Wager settlement also happens inside
 * recordBank on the FIRST bank after a wagered run — the contract compares
 * against the OLD PB, so this only pays out if the cumulative so far
 * already beats the prior PB. Subsequent banks hit the already-updated PB
 * and don't settle again (wager is already cleared).
 *
 * POST { token, walletAddress, modeId, amount }
 */
export async function POST(req: NextRequest) {
  let cfg;
  try {
    cfg = getServerConfig();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "config error" },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { token, walletAddress, modeId, amount } = body as {
    token?: string;
    walletAddress?: string;
    modeId?: number;
    amount?: number;
  };
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }
  if (typeof modeId !== "number") {
    return NextResponse.json({ error: "modeId required" }, { status: 400 });
  }
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive integer" },
      { status: 400 }
    );
  }
  if (amount > 1e6) {
    return NextResponse.json({ error: "amount too large" }, { status: 400 });
  }

  const rl = await mintRateLimit().check(walletAddress.toLowerCase());
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many requests", retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  // Validate session WITHOUT consuming. The score in the signature check is
  // `amount` (this bank's delta) — plausibility is a cheap gate, the real
  // anti-cheat is the cumulative check below.
  const vr = await validateSession({
    token,
    expectedWallet: walletAddress,
    score: amount,
    modeId,
    secret: cfg.sessionSecret,
    consume: false,
  });
  if (!vr.valid) {
    return NextResponse.json({ error: `session: ${vr.reason}` }, { status: 400 });
  }

  const payload: SessionPayload = vr.payload;
  const elapsedSec = (Date.now() - payload.issuedAt) / 1000;
  const ceiling = maxPlausibleScore(modeId, elapsedSec);

  // Atomic: add to cumulative and reject if it crosses the ceiling.
  const newTotal = await sessionStore().addMinted(payload.sessionId, amount);
  if (!Number.isFinite(newTotal)) {
    return NextResponse.json({ error: "session store unavailable" }, { status: 503 });
  }
  if (newTotal > ceiling) {
    log.warn("cumulative_over_ceiling", {
      wallet: shortWallet(walletAddress),
      modeId,
      amount,
      newTotal,
      ceiling,
      elapsedSec,
    });
    return NextResponse.json(
      {
        error: `impossible cumulative: ${newTotal} > ${ceiling} max after ${elapsedSec.toFixed(1)}s`,
      },
      { status: 400 }
    );
  }

  const { blok, leaderboard, gameRewards } = getChain();

  try {
    // Mint the delta first — this is the BLOK the player actually receives.
    // IMPORTANT: await tx.wait() so the returned response reflects a
    // confirmed on-chain balance. Without this, the client's follow-up
    // balance read can race the tx and show the pre-mint number.
    const mintTx = await blok.mint(walletAddress, amount);
    await mintTx.wait();
    // Submit the cumulative (not delta) as the leaderboard score. We DON'T
    // wait on this one — it's a non-critical side effect and adds latency.
    const scoreTx = await leaderboard.submitScore(walletAddress, newTotal, modeId);
    // Record the bank for PB + wager settlement. Uses cumulative newTotal
    // so PB tracks the RUN total, not a single bank. Await confirmation —
    // without this, a revert (e.g. wager-settlement edge case) returns 200
    // here and the client believes the bank fully settled when on-chain
    // PB / wager state may still be in the prior state.
    let recordTxHash: string | null = null;
    if (gameRewards) {
      const recordTx = await gameRewards.recordBank(walletAddress, modeId, newTotal);
      await recordTx.wait();
      recordTxHash = recordTx.hash;
    }

    log.info("bank_submitted", {
      wallet: shortWallet(walletAddress),
      modeId,
      amount,
      cumulative: newTotal,
      mintTx: mintTx.hash,
      scoreTx: scoreTx.hash,
      recordTx: recordTxHash,
    });

    return NextResponse.json({
      txHash: mintTx.hash,
      leaderboardTxHash: scoreTx.hash,
      recordBankTxHash: recordTxHash,
      cumulative: newTotal,
      banked: amount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc error";
    log.error("bank_failed", {
      wallet: shortWallet(walletAddress),
      modeId,
      amount,
      error: msg,
    });
    return NextResponse.json({ error: `bank failed: ${msg}` }, { status: 500 });
  }
}
