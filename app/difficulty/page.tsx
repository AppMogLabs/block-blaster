"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DIFFICULTY_MODES } from "@/lib/difficulty";
import { BlockTicker } from "@/components/ui/BlockTicker";
import { useAuth } from "@/hooks/useAuth";

export default function DifficultyPage() {
  const router = useRouter();
  const { handle, isAuthenticated } = useAuth();

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-6">
        <Link href="/" className="text-moon-white/60 hover:text-moon-white text-sm">
          ← Home
        </Link>
        <div className="flex items-center gap-4">
          <BlockTicker />
          {isAuthenticated && handle && (
            <span className="mono text-xs text-moon-white/60">@{handle}</span>
          )}
        </div>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <h2 className="text-3xl sm:text-4xl font-bold mb-2">Pick your tempo</h2>
        <p className="text-moon-white/60 mb-10 mono text-sm">
          difficulty scales to MegaETH's actual block rate
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-3xl">
          {DIFFICULTY_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => router.push(`/game?mode=${mode.id}`)}
              className="glass rounded-2xl p-6 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_0_32px_rgba(247,134,198,0.18)] group relative overflow-hidden"
              style={{ borderColor: mode.accent, borderWidth: 1 }}
            >
              <div
                className="absolute -top-20 -right-20 w-48 h-48 rounded-full opacity-20 blur-3xl group-hover:opacity-40 transition-opacity"
                style={{ background: mode.accent }}
              />
              <div className="relative">
                <div className="mono text-xs uppercase tracking-widest" style={{ color: mode.accent }}>
                  mode {mode.id}
                </div>
                <div className="text-3xl font-bold mt-2">{mode.label}</div>
                <div className="mt-1 text-moon-white/70 text-sm">{mode.tagline}</div>
                <div className="mt-5 flex items-baseline gap-3">
                  <div className="mono text-4xl tabular-nums" style={{ color: mode.accent }}>
                    {mode.blocksPerSecond}
                  </div>
                  <div className="text-xs text-moon-white/50 mono uppercase">blocks / sec</div>
                </div>
                <div className="mt-1 text-xs text-moon-white/50 mono">
                  {mode.durationSec}s rounds
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
