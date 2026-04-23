import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";
import { issueSession } from "@/lib/session";
import { getDifficulty } from "@/lib/difficulty";
import { sessionRateLimit } from "@/lib/rateLimit";
import { logger, shortWallet } from "@/lib/logger";

export const runtime = "nodejs"; // need node:crypto

const log = logger("session.issue");

export async function POST(req: NextRequest) {
  try {
    const { walletAddress, modeId } = await req.json();
    if (typeof walletAddress !== "string" || !walletAddress.startsWith("0x")) {
      return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
    }
    if (typeof modeId !== "number") {
      return NextResponse.json({ error: "modeId required" }, { status: 400 });
    }
    getDifficulty(modeId); // throws on invalid

    const rl = await sessionRateLimit().check(walletAddress.toLowerCase());
    if (!rl.ok) {
      log.warn("rate_limited", { wallet: shortWallet(walletAddress), modeId });
      return NextResponse.json(
        { error: "too many requests", retryAfterSec: rl.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const cfg = getServerConfig();
    const { token, payload } = issueSession({
      walletAddress,
      modeId,
      secret: cfg.sessionSecret,
    });

    log.info("issued", {
      wallet: shortWallet(walletAddress),
      modeId,
      sessionId: payload.sessionId,
    });

    return NextResponse.json({
      token,
      sessionId: payload.sessionId,
      issuedAt: payload.issuedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    log.error("issue_failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
