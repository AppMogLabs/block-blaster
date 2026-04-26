import { NextRequest, NextResponse } from "next/server";
import { parseEther, formatEther } from "ethers";
import { getChain } from "@/lib/chain";
import { faucetRateLimit } from "@/lib/rateLimit";
import { logger, shortWallet } from "@/lib/logger";
import { verifyRequest } from "@/lib/privyAuth";

export const runtime = "nodejs";

const log = logger("faucet");

/**
 * Sponsor the player's embedded wallet with a tiny amount of testnet ETH so
 * they can sign the one-time approve() tx (and a few others) without
 * needing to hit a faucet themselves.
 *
 * Design:
 *   - DRIP_AMOUNT is the amount sent per successful drip.
 *   - MIN_BALANCE is the threshold under which we consider a wallet
 *     "needs funding" — set generously so a dust balance still triggers a
 *     top-up.
 *   - Rate-limit: 1 drip per wallet per 24h (faucetRateLimit) combined
 *     with an on-chain balance check means someone who drains their wallet
 *     quickly has to wait until tomorrow. That's fine — this is testnet.
 *   - Always rate-limit BEFORE the on-chain balance check so a high call
 *     volume doesn't hammer the RPC.
 *
 * POST { walletAddress }
 */

const DRIP_AMOUNT = "0.001"; // ETH
const MIN_BALANCE = "0.0005"; // below this → drip

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

  // Privy identity-token auth: the caller MUST be a signed-in user (X login)
  // whose embedded wallet matches the requested walletAddress. Without this
  // anyone can mass-drip the backend wallet by POSTing fresh addresses.
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json(
      { error: "sign in to request a drip" },
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

  const rl = await faucetRateLimit().check(walletAddress.toLowerCase());
  if (!rl.ok) {
    return NextResponse.json(
      { error: "already dripped recently", retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }

  try {
    const { provider, signer } = getChain();
    const currentBalance = await provider.getBalance(walletAddress);
    const minBalance = parseEther(MIN_BALANCE);
    if (currentBalance >= minBalance) {
      log.info("skipped_funded", {
        wallet: shortWallet(walletAddress),
        balance: formatEther(currentBalance),
      });
      return NextResponse.json({
        skipped: true,
        reason: "wallet already funded",
        balance: formatEther(currentBalance),
      });
    }

    const tx = await signer.sendTransaction({
      to: walletAddress,
      value: parseEther(DRIP_AMOUNT),
    });
    log.info("drip_sent", {
      wallet: shortWallet(walletAddress),
      amount: DRIP_AMOUNT,
      txHash: tx.hash,
    });
    // Don't await — the 10ms block means confirmation is effectively instant
    // anyway, and we want the client to move on quickly.
    return NextResponse.json({
      txHash: tx.hash,
      amount: DRIP_AMOUNT,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc error";
    log.error("drip_failed", { wallet: shortWallet(walletAddress), error: msg });
    return NextResponse.json({ error: `drip failed: ${msg}` }, { status: 500 });
  }
}
