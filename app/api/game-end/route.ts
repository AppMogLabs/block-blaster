import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { validateSession } from "@/lib/session";
import { getChain } from "@/lib/chain";
import { mintRateLimit } from "@/lib/rateLimit";
import { logger, shortWallet } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger("game-end");

/**
 * Called by the client when a run ends. Settles any lingering wager state
 * that /api/bank might not have settled (e.g., the player died without ever
 * banking — no recordBank call happened, so the wager is still in escrow).
 *
 * Outcomes:
 *   - "death": GameRewards.recordDeath → any active wager is burned
 *   - "win":  no-op (banks already settle PB + wager during the run)
 *
 * Session is consumed on game-end so the token can't be replayed against
 * either the bank or the spend endpoints after the game is over.
 *
 * POST { token, walletAddress, modeId, outcome }
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

  const { token, walletAddress, modeId, outcome } = body as {
    token?: string;
    walletAddress?: string;
    modeId?: number;
    outcome?: "win" | "death";
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
  if (outcome !== "win" && outcome !== "death") {
    return NextResponse.json({ error: "outcome must be win|death" }, { status: 400 });
  }

  const rl = await mintRateLimit().check(walletAddress.toLowerCase());
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many requests", retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  // Consume the session — this call marks the run as over. After it, the
  // bank/nuke/sweep endpoints will reject the same token.
  const vr = await validateSession({
    token,
    expectedWallet: walletAddress,
    score: 0,
    modeId,
    secret: cfg.sessionSecret,
    consume: true,
  });
  if (!vr.valid) {
    return NextResponse.json({ error: `session: ${vr.reason}` }, { status: 400 });
  }

  const { gameRewards } = getChain();

  // On win, banks during the run already settled wager + updated PB. Nothing
  // else to do on the contract side.
  if (outcome === "win" || !gameRewards) {
    log.info("game_ended", {
      wallet: shortWallet(walletAddress),
      modeId,
      outcome,
    });
    return NextResponse.json({ outcome, recordTxHash: null });
  }

  try {
    const tx = await gameRewards.recordDeath(walletAddress);
    // Await confirmation so a reverted burn is surfaced as an error instead
    // of silently leaving the wager stuck in escrow. Matches the wait-on-
    // confirmation pattern used by /api/bank and /api/nuke.
    await tx.wait();
    log.info("death_burned", {
      wallet: shortWallet(walletAddress),
      modeId,
      txHash: tx.hash,
    });
    return NextResponse.json({ outcome: "death", recordTxHash: tx.hash });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc error";
    log.error("death_failed", {
      wallet: shortWallet(walletAddress),
      modeId,
      error: msg,
    });
    return NextResponse.json({ error: `game-end failed: ${msg}` }, { status: 500 });
  }
}
