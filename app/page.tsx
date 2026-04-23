"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BlockTicker } from "@/components/ui/BlockTicker";
import { Logo } from "@/components/ui/Logo";
import { useAuth } from "@/hooks/useAuth";

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, login, handle, privyEnabled } = useAuth();
  // Defer all auth-dependent rendering until after mount — server render and
  // hydration can disagree on these values (e.g. when Privy's bundle lags the
  // env var update). Gating on `mounted` forces identical server/client markup.
  const [mounted, setMounted] = useState(false);
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
            <Link href="/difficulty" className="btn-secondary">
              Play as Guest
            </Link>
            <button onClick={handleSignIn} className="btn-primary">
              {mounted && isAuthenticated
                ? `Continue as @${handle ?? "you"}`
                : "Sign in with X"}
            </button>
          </div>

          <div className="glass rounded-xl px-5 py-4 w-full max-w-lg text-left">
            <div className="mono text-xs uppercase tracking-widest text-moon-white/50">
              How it works
            </div>
            <p className="mt-2 text-sm text-moon-white/80">
              Blocks descend at MegaETH's actual block rate. Blast them before they stack. Survive the timer, and your score is minted as <span className="mono">$BLOK</span> onchain.
            </p>
          </div>
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
