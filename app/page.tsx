"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BlockTicker } from "@/components/ui/BlockTicker";
import { WalletChip } from "@/components/ui/WalletChip";
import { ExportWalletButton } from "@/components/ui/ExportWalletButton";
import { Logo } from "@/components/ui/Logo";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, login, handle, privyEnabled, walletAddress } = useAuth();
  // Defer all auth-dependent rendering until after mount — server render and
  // hydration can disagree on these values (e.g. when Privy's bundle lags the
  // env var update). Gating on `mounted` forces identical server/client markup.
  const [mounted, setMounted] = useState(false);
  const [showGuestConfirm, setShowGuestConfirm] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleSignIn = () => {
    if (isAuthenticated) {
      router.push("/difficulty");
    } else {
      login();
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-6">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <span className="mono text-sm tracking-wider text-moon-white/70">BLOCK.BLASTER</span>
        </div>
        <div className="flex items-center gap-4">
          <BlockTicker />
          {mounted && isAuthenticated && (
            <WalletChip walletAddress={walletAddress} />
          )}
          <Link
            href="/leaderboard"
            className="text-xs text-moon-white/60 hover:text-moon-white transition-colors"
          >
            Leaderboard
          </Link>
        </div>
      </header>

      <section className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl w-full text-center flex flex-col items-center gap-8">
          <Logo size={96} />

          <div>
            <h1 className="text-5xl sm:text-7xl font-bold tracking-tight">
              BLOCK <span className="bg-gradient-to-r from-pink via-magenta to-peach bg-clip-text text-transparent">BLASTER</span>
            </h1>
            <p className="mt-4 text-moon-white/70 text-lg">
              The chain never stops. Can you keep up?
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <button
              onClick={() => setShowGuestConfirm(true)}
              className="btn-secondary"
            >
              Play as Guest
            </button>
            <button onClick={handleSignIn} className="btn-primary">
              {mounted && isAuthenticated
                ? `Continue as @${handle ?? "you"}`
                : "Sign in"}
            </button>
          </div>

          {showGuestConfirm && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-night-sky/80 backdrop-blur-sm p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="guest-confirm-title"
              onClick={() => setShowGuestConfirm(false)}
            >
              <div
                className="glass rounded-2xl p-6 max-w-md w-full text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  id="guest-confirm-title"
                  className="mono text-xs uppercase tracking-widest text-moon-white/60"
                >
                  guest mode
                </div>
                <p className="mt-3 text-sm text-moon-white/85 leading-relaxed">
                  Guest mode = no wallet, no leaderboard, no{" "}
                  <span className="mono">$BLOK</span>, limited gameplay.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
                  <button
                    onClick={() => {
                      setShowGuestConfirm(false);
                      login();
                    }}
                    className="btn-primary text-xs"
                  >
                    Sign in to bank $BLOK
                  </button>
                  <button
                    onClick={() => {
                      setShowGuestConfirm(false);
                      router.push("/difficulty");
                    }}
                    className="btn-secondary text-xs"
                  >
                    Just let me play
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="glass rounded-xl px-5 py-4 w-full max-w-lg text-left">
            <div className="mono text-xs uppercase tracking-widest text-moon-white/50">
              How it works
            </div>
            <p className="mt-2 text-sm text-moon-white/80">
              Blocks descend at MegaETH's actual block rate. Blast them before they stack. Survive the timer, and your score is minted as <span className="mono">$BLOK</span> onchain.
            </p>
          </div>

          {mounted && isAuthenticated && (
            <div className="text-xs text-moon-white/40 flex items-center gap-4">
              <span>Your wallet is self-custodial.</span>
              <ExportWalletButton />
            </div>
          )}
        </div>
      </section>

      <footer className="p-6 text-center text-xs text-moon-white/40">
        Powered by MegaETH · 100k TPS · 10ms blocks
        {mounted && !privyEnabled && (
          <span className="block mt-1 text-rose/70">
            (Privy not configured — X sign-in is disabled)
          </span>
        )}
      </footer>
    </main>
  );
}
