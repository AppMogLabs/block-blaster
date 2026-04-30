import { NextRequest, NextResponse } from "next/server";
import { getChain } from "@/lib/chain";
import { wagerRateLimit } from "@/lib/rateLimit";
import { logger, shortWallet } from "@/lib/logger";
import { verifyRequest } from "@/lib/privyAuth";

export const runtime = "nodejs";

const log = logger("wager.forfeit");

/**
 * Emergency escape hatch: explicitly burn the caller's active wager
 * without playing through a run. Used when /api/game-end failed to burn
 * on an earlier death — without this the user would have no way to
 * recover their stuck wager.
 *
 * Security: requires a Privy identity token in the Authorization header,
 * and the embedded wallet in the verified claims must match the
 * walletAddress in the body. Without this, the endpoint accepted any 0x…
 * address and any caller could burn any player's active wager (grief
 * vector). The contract still guards `recordDeath` with onlyOwner so the
 * tx is signed by our backend wallet, but the endpoint authorises which
 * player's wager gets burned.
 *
 * POST { walletAddress }, Authorization: Bearer <privy-id-token>
 */
export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { walletAddress } = body as { walletAddress?: string };
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }

  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json(
      { error: "sign in to forfeit a wager" },
      { status: 401 }
    );
  }
  if (
    !auth.walletAddress ||
    auth.walletAddress !== walletAddress.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "wallet does not belong to authenticated user" },
      { status: 403 }
    );
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
    const [amount] = (await gameRewards.activeWager(walletAddress)) as [
      bigint,
      bigint,
    ];
    if (amount === 0n) {
      return NextResponse.json({ skipped: true, reason: "no active wager" });
    }

    const tx = await gameRewards.recordDeath(walletAddress);
    await tx.wait();
    log.info("forfeited", {
      wallet: shortWallet(walletAddress),
      amount: amount.toString(),
      txHash: tx.hash,
    });
    return NextResponse.json({
      txHash: tx.hash,
      burned: Number(amount),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc error";
    log.error("forfeit_failed", { wallet: shortWallet(walletAddress), error: msg });
    return NextResponse.json({ error: `forfeit failed: ${msg}` }, { status: 500 });
  }
}
