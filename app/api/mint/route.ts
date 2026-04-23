import { NextRequest, NextResponse } from "next/server";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { getServerConfig } from "@/lib/config";
import { validateSession } from "@/lib/session";
import { BLOK_ABI, LEADERBOARD_ABI } from "@/lib/contracts";
import { mintRateLimit } from "@/lib/rateLimit";
import { logger, shortWallet } from "@/lib/logger";

export const runtime = "nodejs";

const log = logger("mint");

export async function POST(req: NextRequest) {
  let cfg;
  try {
    cfg = getServerConfig();
  } catch (e) {
    log.error("config_error", { error: e instanceof Error ? e.message : "unknown" });
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

  const { token, score, walletAddress, modeId } = body as {
    token?: string;
    score?: number;
    walletAddress?: string;
    modeId?: number;
  };

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0) {
    return NextResponse.json({ error: "score must be a non-negative integer" }, { status: 400 });
  }
  if (!walletAddress || typeof walletAddress !== "string" || !walletAddress.startsWith("0x")) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }
  if (typeof modeId !== "number") {
    return NextResponse.json({ error: "modeId required" }, { status: 400 });
  }

  const rl = await mintRateLimit().check(walletAddress.toLowerCase());
  if (!rl.ok) {
    log.warn("rate_limited", { wallet: shortWallet(walletAddress), modeId });
    return NextResponse.json(
      { error: "too many requests", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  // Validate + consume the session (single-use).
  const vr = await validateSession({
    token,
    expectedWallet: walletAddress,
    score,
    modeId,
    secret: cfg.sessionSecret,
    consume: true,
  });
  if (!vr.valid) {
    log.warn("session_invalid", {
      wallet: shortWallet(walletAddress),
      modeId,
      score,
      reason: vr.reason,
    });
    return NextResponse.json({ error: `session: ${vr.reason}` }, { status: 400 });
  }

  // Zero scores are legal but not worth a tx — return gracefully.
  if (score === 0) {
    log.info("zero_score_skipped", { wallet: shortWallet(walletAddress), modeId });
    return NextResponse.json({
      txHash: null,
      leaderboardTxHash: null,
      note: "zero score — nothing minted",
    });
  }

  try {
    const provider = new JsonRpcProvider(cfg.megaethRpcUrl);
    const signer = new Wallet(cfg.backendWalletKey, provider);
    const blok = new Contract(cfg.blokAddress, BLOK_ABI, signer);
    const leaderboard = new Contract(cfg.leaderboardAddress, LEADERBOARD_ABI, signer);

    // MegaETH: base fee is stable at 0.001 gwei, no EIP-1559 buffer needed.
    // We rely on the provider's gasPrice discovery.
    const mintTx = await blok.mint(walletAddress, score);
    const scoreTx = await leaderboard.submitScore(walletAddress, score, modeId);

    log.info("mint_submitted", {
      wallet: shortWallet(walletAddress),
      score,
      modeId,
      mintTx: mintTx.hash,
      scoreTx: scoreTx.hash,
    });

    // Fire and forget confirmation — MegaETH's ~10ms blocks mean inclusion is fast,
    // and we already have the hash for the client. If you want stronger guarantees,
    // await mintTx.wait() before returning.
    return NextResponse.json({
      txHash: mintTx.hash,
      leaderboardTxHash: scoreTx.hash,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc error";
    log.error("mint_failed", {
      wallet: shortWallet(walletAddress),
      score,
      modeId,
      error: msg,
    });
    return NextResponse.json({ error: `mint failed: ${msg}` }, { status: 500 });
  }
}
