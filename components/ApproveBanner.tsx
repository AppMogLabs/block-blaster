"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useBlok } from "@/hooks/useBlok";
import { useToast } from "@/components/ui/Toast";
import { publicConfig } from "@/lib/config";

/**
 * Shown globally when the player is signed in but has not yet approved the
 * GameRewards contract to spend their $BLOK. One-time prompt — after
 * approval the banner disappears and the player never sees it again.
 *
 * The approve tx costs a tiny amount of MegaETH testnet ETH; if the wallet
 * has none the Privy-side tx will fail and we surface a toast pointing the
 * user at the faucet.
 */
export function ApproveBanner() {
  const { isAuthenticated, walletAddress } = useAuth();
  const { approved, ready, approve, refresh } = useBlok(walletAddress);
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);

  // Gate: only show when signed in, state has loaded, and not already approved.
  // Also hide if contracts aren't configured (pre-deploy / local dev).
  if (
    !isAuthenticated ||
    !walletAddress ||
    !ready ||
    approved ||
    !publicConfig.gameRewardsAddress
  ) {
    return null;
  }

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const hash = await approve();
      toast.push("success", `$BLOK spending approved. tx ${hash.slice(0, 10)}…`);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "approve failed";
      // Surface common failure modes with clearer copy.
      const friendly = /insufficient funds/i.test(msg)
        ? "wallet needs testnet ETH for gas — visit the MegaETH faucet"
        : /user rejected/i.test(msg)
          ? "approval cancelled"
          : msg;
      toast.push("error", friendly);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[500] w-[min(92vw,620px)] px-4 py-3 rounded-lg glass border border-pink/40 flex items-center gap-4">
      <div className="flex-1 text-xs text-moon-white/80">
        <div className="mono uppercase tracking-widest text-pink text-[10px] mb-1">
          one-time setup
        </div>
        Allow Block Blaster to spend <span className="mono">$BLOK</span> for in-game
        actions (Nuke, Sweep reload, Wagers). Required before your first action.
      </div>
      <button
        onClick={handleApprove}
        disabled={submitting}
        className="btn-primary text-xs whitespace-nowrap disabled:opacity-50"
      >
        {submitting ? "approving…" : "Approve"}
      </button>
    </div>
  );
}
