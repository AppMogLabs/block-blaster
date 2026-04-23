import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { validateSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { token, score, modeId, walletAddress } = await req.json();
    const cfg = getServerConfig();
    const result = await validateSession({
      token,
      expectedWallet: walletAddress,
      score,
      modeId,
      secret: cfg.sessionSecret,
      consume: false,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ valid: false, reason: msg }, { status: 400 });
  }
}
