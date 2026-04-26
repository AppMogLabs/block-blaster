"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

const STORAGE_PREFIX = "bb:welcome-seen:";

/**
 * One-time onboarding modal shown to a freshly-signed-in user. Explains
 * that a wallet has been provisioned for them, that everything is on
 * testnet (no real money), and that the upcoming Approve step is a
 * one-time setup. Dismissed permanently per-wallet via localStorage so
 * returning users never see it again, but a different account on the same
 * device still gets the welcome on its first visit.
 */
export function WelcomeModal() {
  const { isAuthenticated, walletAddress } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !walletAddress) {
      setShow(false);
      return;
    }
    if (typeof window === "undefined") return;
    const key = STORAGE_PREFIX + walletAddress.toLowerCase();
    setShow(window.localStorage.getItem(key) !== "1");
  }, [isAuthenticated, walletAddress]);

  if (!show || !walletAddress) return null;

  const dismiss = () => {
    window.localStorage.setItem(
      STORAGE_PREFIX + walletAddress.toLowerCase(),
      "1"
    );
    setShow(false);
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-night-sky/90 backdrop-blur-sm p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="glass rounded-2xl p-7 max-w-md w-full text-left">
        <div className="mono uppercase tracking-widest text-pink text-[10px]">
          welcome to
        </div>
        <h2
          id="welcome-title"
          className="text-3xl font-bold mt-1 mb-5 tracking-tight"
        >
          BLOCK{" "}
          <span className="bg-gradient-to-r from-pink via-magenta to-peach bg-clip-text text-transparent">
            BLASTER
          </span>
        </h2>
        <div className="space-y-3 text-sm text-moon-white/85 leading-relaxed">
          <p>
            We&apos;ve set up a free game wallet for you on{" "}
            <span className="mono text-mint">MegaETH testnet</span> — no real
            money, no setup, no app to download. It&apos;s yours; you can
            export the keys from the home page anytime.
          </p>
          <p>
            When you bank points in a run, real{" "}
            <span className="mono">$BLOK</span> tokens are minted to that
            wallet. They&apos;re testnet tokens — bragging rights for now.
          </p>
          <p>
            Up next: a one-time{" "}
            <span className="mono text-pink">Approve</span> step lets the game
            spend your <span className="mono">$BLOK</span> on in-game features
            (Nuke, Sweep refill, Wagers). It costs a tiny bit of testnet ETH
            and we&apos;ve already topped your wallet up. No real money, no
            recurring approvals.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="btn-primary w-full mt-6 text-sm"
          autoFocus
        >
          Got it, let&apos;s play
        </button>
      </div>
    </div>
  );
}
