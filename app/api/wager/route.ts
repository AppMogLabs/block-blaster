import { NextRequest, NextResponse } from "next/server";
import { getChain } from "@/lib/chain";
import { wagerRateLimit } from "@/lib/rateLimit";
import { logger, shortWallet } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger("wager");

/**
 * Place a self-wager against the player's existing PB. Called pre-game from
 * the difficulty screen after tier selection. The frontend should only
 * display the wager tiers if `personalBests[mode] > 0`; this endpoint
 * enforces it via the contract which reverts with NoPersonalBest otherwise.
 *
 * Tiers (enforced contract-side): 50, 100, 200, 500. Anything else reverts.
 * Player must have previously approved the GameRewards contract.
 *
 * This endpoint does NOT require a session token — wagers happen before
 * a session is issued. Gated only by the wallet's prior approve().
 *
 * POST { walletAddress, modeId, amount }
 */
export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { walletAddress, modeId, amount } = body as {
    walletAddress?: string;
    modeId?: number;
    amount?: number;
  };
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }
  if (typeof modeId !== "number" || modeId < 0 || modeId > 3) {
    return NextResponse.json({ error: "modeId required" }, { status: 400 });
  }
  if (![50, 100, 200, 500].includes(Number(amount))) {
    return NextResponse.json({ error: "amount must be 50, 100, 200, or 500" }, { status: 400 });
  }

  const rl = await wagerRateLimit().check(walletAddress.toLowerCase());
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many requests", retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  const { gameRewards } = getChain();
  if (!gameRewards) {
    return NextResponse.json(
      { error: "GameRewards not configured on server" },
      { status: 500 }
    );
  }

  try {
    const tx = await gameRewards.placeWager(walletAddress, modeId, amount);
    log.info("wager_submitted", {
      wallet: shortWallet(walletAddress),
      modeId,
      amount,
      txHash: tx.hash,
    });
    return NextResponse.json({ txHash: tx.hash, amount, modeId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc error";
    log.error("wager_failed", {
      wallet: shortWallet(walletAddress),
      modeId,
      amount,
      error: msg,
    });
    const lower = msg.toLowerCase();
    const friendly = lower.includes("nopersonalbest")
      ? "play this difficulty once before you can wager on it"
      : lower.includes("wageractive")
        ? "a wager is already active — finish your run first"
        : lower.includes("insufficient balance")
          ? "insufficient $BLOK balance for this tier"
          : lower.includes("insufficient allowance")
            ? "approve $BLOK first — allowance too low"
            : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }
}
