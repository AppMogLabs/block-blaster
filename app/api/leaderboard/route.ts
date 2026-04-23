import { NextRequest, NextResponse } from "next/server";
import { JsonRpcProvider, Contract } from "ethers";
import { publicConfig } from "@/lib/config";
import { LEADERBOARD_ABI } from "@/lib/contracts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const mode = Number(req.nextUrl.searchParams.get("mode") ?? "0");
  if (![0, 1, 2, 3].includes(mode)) {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }

  if (!publicConfig.leaderboardAddress) {
    // Graceful pre-deploy response — lets the UI render an empty state.
    return NextResponse.json({ entries: [], deployed: false });
  }

  try {
    const provider = new JsonRpcProvider(publicConfig.megaethRpcUrl);
    const lb = new Contract(publicConfig.leaderboardAddress, LEADERBOARD_ABI, provider);
    const raw = (await lb.getTopScores(mode)) as Array<{
      player: string;
      score: bigint;
      timestamp: bigint;
      difficultyMode: number;
    }>;
    const entries = raw
      .map((e) => ({
        player: e.player,
        score: Number(e.score),
        timestamp: Number(e.timestamp),
        mode: Number(e.difficultyMode),
      }))
      .filter((e) => e.player !== "0x0000000000000000000000000000000000000000");

    return NextResponse.json(
      { entries, deployed: true },
      { headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=30" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
