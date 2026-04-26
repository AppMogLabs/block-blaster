"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useBlok } from "@/hooks/useBlok";
import { useToast } from "@/components/ui/Toast";
import { publicConfig } from "@/lib/config";
import { txLink } from "@/lib/txLink";

const DISMISS_KEY = "bb:approve-banner-dismissed";

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
  const { approved, ready, walletWarmup, approve, refresh } = useBlok(walletAddress);
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  // Settle delay: the hook briefly has `ready: true, approved: false`
  // immediately after a fresh /api/balance fetch returns 0 allowance.
  // If the user already approved, a subsequent refresh would flip
  // approved true quickly. We wait 500ms after `ready` becomes true
  // before showing the banner so a stable "not approved" state doesn't
  // flash up for users who actually are approved.
  const [showableAt, setShowableAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  });

  useEffect(() => {
    if (!ready || approved) {
      setShowableAt(null);
      return;
    }
    // Schedule a "settle" deadline if we don't have one yet.
    if (showableAt === null) {
      const deadline = Date.now() + 500;
      setShowableAt(deadline);
      const t = setTimeout(() => setTick((n) => n + 1), 520);
      return () => clearTimeout(t);
    }
  }, [ready, approved, showableAt]);

  const settled = showableAt !== null && Date.now() >= showableAt;
  // Gate: only show when signed in, state has loaded + settled,
  // and not already approved. Also hide if contracts aren't
  // configured (pre-deploy / local dev).
  if (
    !isAuthenticated ||
    !walletAddress ||
    !ready ||
    approved ||
    !settled ||
    dismissed ||
    !publicConfig.gameRewardsAddress
  ) {
    // `tick` dependency keeps the settle timer re-rendering properly
    // but isn't used for any content decisions.
    void tick;
    return null;
  }

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const hash = await approve();
      toast.push("success", "$BLOK spending approved", txLink(hash));
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

  const handleSkip = () => {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[500] w-[min(92vw,620px)] px-4 py-3 rounded-lg glass border border-pink/40 flex items-center gap-3">
      <div className="flex-1 text-xs text-moon-white/80">
        <div className="mono uppercase tracking-widest text-pink text-[10px] mb-1">
          optional setup
        </div>
        Approve <span className="mono">$BLOK</span> spending to unlock Nuke,
        Sweep reload, and Wagers. You can play and bank without this — only
        the in-game spend actions need it.
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button
          onClick={handleApprove}
          disabled={submitting || walletWarmup !== "ready"}
          className="btn-primary text-xs whitespace-nowrap disabled:opacity-50"
          title={
            walletWarmup === "pending"
              ? "Wallet is provisioning — wait a moment"
              : walletWarmup === "failed"
                ? "Wallet failed to connect — refresh the page"
                : undefined
          }
        >
          {submitting
            ? "approving…"
            : walletWarmup === "pending"
              ? "preparing…"
              : walletWarmup === "failed"
                ? "wallet error"
                : "Approve"}
        </button>
        <button
          onClick={handleSkip}
          disabled={submitting}
          className="text-[10px] text-moon-white/50 hover:text-moon-white/80 underline decoration-dotted disabled:opacity-30"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
