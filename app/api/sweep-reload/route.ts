import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { validateSession } from "@/lib/session";
import { getChain } from "@/lib/chain";
import { mintRateLimit } from "@/lib/rateLimit";
import { logger, shortWallet } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger("sweep-reload");

/**
 * Spend 25 $BLOK to instantly refill the sweep fuel bar. Mirrors /api/nuke's
 * auth model — session validated (not consumed) so multiple reloads are
 * allowed, subject to the player's BLOK balance and approval.
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
  if (modeId === 0) {
    // Easy has no sweep, so no reload either.
    return NextResponse.json({ error: "sweep unavailable in easy mode" }, { status: 400 });
  }

  const rl = await mintRateLimit().check(walletAddress.toLowerCase());
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many requests", retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

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
    const tx = await gameRewards.spendSweepReload(walletAddress);
    await tx.wait();
    log.info("reload_confirmed", {
      wallet: shortWallet(walletAddress),
      modeId,
      txHash: tx.hash,
    });
    return NextResponse.json({ txHash: tx.hash, cost: 25 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc error";
    log.error("reload_failed", {
      wallet: shortWallet(walletAddress),
      modeId,
      error: msg,
    });
    const lower = msg.toLowerCase();
    const friendly =
      lower.includes("insufficient balance") || lower.includes("erc20: transfer amount exceeds balance")
        ? "insufficient $BLOK balance (25 required)"
        : lower.includes("insufficient allowance") ||
            lower.includes("missing revert data") ||
            lower.includes("erc20: insufficient allowance")
          ? "approve $BLOK spending first to refill sweep"
          : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }
}
