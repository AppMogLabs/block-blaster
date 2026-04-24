import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { validateSession } from "@/lib/session";
import { getChain } from "@/lib/chain";
import { mintRateLimit } from "@/lib/rateLimit";
import { logger, shortWallet } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger("nuke");

/**
 * Spend 100 $BLOK to fire a nuke. Validates the session token (proves the
 * wallet is in an active run) but does NOT consume it — the player may fire
 * multiple nukes per run if they earn/afford them. Player must have
 * pre-approved the GameRewards contract.
 *
 * POST { token, walletAddress, modeId }
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

  const { token, walletAddress, modeId } = body as {
    token?: string;
    walletAddress?: string;
    modeId?: number;
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

  const rl = await mintRateLimit().check(walletAddress.toLowerCase());
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many requests", retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  // Validate session but do NOT consume. Use a score of 0 so plausibility
  // passes trivially — we only need signature + wallet + mode to match.
  const vr = await validateSession({
    token,
    expectedWallet: walletAddress,
    score: 0,
    modeId,
    secret: cfg.sessionSecret,
    consume: false,
  });
  if (!vr.valid) {
    return NextResponse.json({ error: `session: ${vr.reason}` }, { status: 400 });
  }

  const { gameRewards } = getChain();
  if (!gameRewards) {
    return NextResponse.json(
      { error: "GameRewards not configured on server" },
      { status: 500 }
    );
  }

  try {
    const tx = await gameRewards.spendNuke(walletAddress);
    // Await confirmation so the client's subsequent balance read reflects
    // the burn. Without this the balance-reconcile race can reset an
    // optimistic -100 back to the pre-burn balance.
    await tx.wait();
    log.info("nuke_confirmed", {
      wallet: shortWallet(walletAddress),
      modeId,
      txHash: tx.hash,
    });
    return NextResponse.json({ txHash: tx.hash, cost: 100 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc error";
    log.error("nuke_failed", {
      wallet: shortWallet(walletAddress),
      modeId,
      error: msg,
    });
    // Surface a clearer error for the two most common revert reasons.
    const lower = msg.toLowerCase();
    const friendly = lower.includes("insufficient balance") || lower.includes("erc20")
      ? "insufficient $BLOK balance (100 required)"
      : lower.includes("insufficient allowance")
        ? "approve $BLOK first — allowance too low"
        : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }
}
