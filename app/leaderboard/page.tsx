"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DIFFICULTY_MODES } from "@/lib/difficulty";
import { BlockTicker } from "@/components/ui/BlockTicker";
import { useAuth } from "@/hooks/useAuth";

type Entry = { player: string; score: number; timestamp: number; mode: number };

export default function LeaderboardPage() {
  const [mode, setMode] = useState(0);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [deployed, setDeployed] = useState<boolean | null>(null);
  const { walletAddress } = useAuth();

  useEffect(() => {
    setEntries(null);
    fetch(`/api/leaderboard?mode=${mode}`)
      .then((r) => r.json())
      .then((d) => {
        setEntries(d.entries ?? []);
        setDeployed(d.deployed ?? false);
      })
      .catch(() => setEntries([]));
  }, [mode]);

  const truncate = (a: string) =>
    a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-6">
        <Link href="/" className="text-moon-white/60 hover:text-moon-white text-sm">
          ← Home
        </Link>
        <BlockTicker />
      </header>

      <section className="flex-1 max-w-3xl w-full mx-auto px-6 pb-10">
        <h2 className="text-3xl font-bold mb-6">Leaderboard</h2>

        <div className="flex gap-2 mb-4 overflow-x-auto">
          {DIFFICULTY_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-4 py-2 rounded-md mono text-xs uppercase tracking-widest transition-colors ${
                mode === m.id
                  ? "bg-moon-white/10 text-moon-white"
                  : "text-moon-white/50 hover:text-moon-white/80"
              }`}
              style={mode === m.id ? { borderBottom: `2px solid ${m.accent}` } : undefined}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="glass rounded-xl overflow-hidden">
          {deployed === false ? (
            <div className="p-8 text-center text-moon-white/60 text-sm">
              Leaderboard contract not deployed yet. Run{" "}
              <span className="mono text-moon-white">npm run deploy:leaderboard</span>{" "}
              and set <span className="mono">NEXT_PUBLIC_LEADERBOARD_CONTRACT_ADDRESS</span>.
            </div>
          ) : entries === null ? (
            <SkeletonRows />
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-moon-white/60 text-sm">
              No scores yet. Be the first.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-moon-white/50 text-xs uppercase tracking-widest">
                  <th className="text-left py-3 px-4 font-normal">#</th>
                  <th className="text-left py-3 px-4 font-normal">Player</th>
                  <th className="text-right py-3 px-4 font-normal">Score</th>
                  <th className="text-right py-3 px-4 font-normal">Date</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 20).map((e, i) => {
                  const mine =
                    walletAddress && e.player.toLowerCase() === walletAddress.toLowerCase();
                  return (
                    <tr
                      key={`${e.player}-${i}`}
                      className={`border-t border-moon-white/5 ${
                        mine ? "bg-magenta/10" : ""
                      }`}
                    >
                      <td className="py-3 px-4 mono text-moon-white/60">{i + 1}</td>
                      <td className="py-3 px-4 mono">
                        {truncate(e.player)}
                        {mine && <span className="ml-2 text-xs text-magenta">you</span>}
                      </td>
                      <td className="py-3 px-4 mono tabular-nums text-right font-bold">
                        {e.score}
                      </td>
                      <td className="py-3 px-4 mono text-right text-moon-white/50 text-xs">
                        {new Date(e.timestamp * 1000).toISOString().split("T")[0]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-moon-white/5">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="p-4 flex items-center gap-4 animate-pulse">
          <div className="h-3 w-4 bg-moon-white/10 rounded" />
          <div className="h-3 flex-1 bg-moon-white/10 rounded" />
          <div className="h-3 w-16 bg-moon-white/10 rounded" />
        </div>
      ))}
    </div>
  );
}
