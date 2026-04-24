import { NextRequest, NextResponse } from "next/server";
import { getChain } from "@/lib/chain";
import { logger, shortWallet } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger("balance");

/**
 * Returns the caller's onchain state: $BLOK balance, allowance granted to
 * GameRewards (so the frontend knows whether to prompt an approve), and
 * the personal best per difficulty mode.
 *
 * GET /api/balance?wallet=0x...
 */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  }

  try {
    const { blok, gameRewards } = getChain();
    const balance: bigint = await blok.balanceOf(wallet);
    const gameRewardsAddr =
      process.env.GAMEREWARDS_CONTRACT_ADDRESS ??
      process.env.NEXT_PUBLIC_GAMEREWARDS_CONTRACT_ADDRESS ??
      "";
    const allowance: bigint = gameRewardsAddr
      ? await blok.allowance(wallet, gameRewardsAddr)
      : 0n;

    let personalBests: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    let activeWagerAmount = 0;
    let activeWagerMode = 0;
    if (gameRewards) {
      const pbs = await Promise.all(
        [0, 1, 2, 3].map((m) => gameRewards.personalBest(wallet, m))
      );
      personalBests = {
        0: Number(pbs[0]),
        1: Number(pbs[1]),
        2: Number(pbs[2]),
        3: Number(pbs[3]),
      };
      const [amt, mode] = (await gameRewards.activeWager(wallet)) as [bigint, bigint];
      activeWagerAmount = Number(amt);
      activeWagerMode = Number(mode);
    }

    return NextResponse.json({
      wallet,
      balance: Number(balance),
      allowance: allowance >= (1n << 200n) ? "max" : Number(allowance),
      personalBests,
      activeWagerAmount,
      activeWagerMode,
      gameRewardsAddress: gameRewardsAddr || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc error";
    log.error("read_failed", { wallet: shortWallet(wallet), error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
