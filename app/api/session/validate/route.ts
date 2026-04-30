import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { validateSession } from "@/lib/session";
import { sessionRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * Pre-flight session check used by client UI to decide whether to allow
 * gameplay. Does NOT consume the session — replays return the same answer.
 *
 * Rate-limited per-wallet to prevent abuse as a free signature-verification
 * oracle (without this, an attacker could probe captured tokens at high
 * speed).
 */
export async function POST(req: NextRequest) {
  try {
    const { token, score, modeId, walletAddress } = await req.json();
    if (typeof walletAddress === "string" && walletAddress) {
      const rl = await sessionRateLimit().check(walletAddress.toLowerCase());
      if (!rl.ok) {
        return NextResponse.json(
          { valid: false, reason: "rate limited", retryAfterSec: rl.retryAfterSec },
          { status: 429 }
        );
      }
    }
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
