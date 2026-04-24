"use client";

import { publicConfig } from "@/lib/config";

/**
 * Small "0x1234…abcd" chip shown in headers when the player is signed in.
 * Clicking opens the MegaETH block explorer on the /address/{wallet} page
 * in a new tab so testers can inspect their onchain $BLOK balance,
 * transaction history, and allowances.
 */
export function WalletChip({
  walletAddress,
}: {
  walletAddress: string | null;
}) {
  if (!walletAddress) return null;
  const short = `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;
  const url = `${publicConfig.megaethExplorer}/address/${walletAddress}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={`View ${walletAddress} on MegaETH explorer`}
      className="mono text-xs text-moon-white/60 hover:text-moon-white transition-colors underline decoration-dotted decoration-moon-white/20 hover:decoration-moon-white/60"
    >
      {short}
    </a>
  );
}
