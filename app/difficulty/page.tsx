"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { DIFFICULTY_MODES } from "@/lib/difficulty";
import { BlockTicker } from "@/components/ui/BlockTicker";
import { WalletChip } from "@/components/ui/WalletChip";
import { useAuth } from "@/hooks/useAuth";
import { useBlok } from "@/hooks/useBlok";
import { useToast } from "@/components/ui/Toast";
import { txLink } from "@/lib/txLink";

const WAGER_TIERS = [50, 100, 200, 500] as const;

export default function DifficultyPage() {
  const router = useRouter();
  const { handle, isAuthenticated, walletAddress } = useAuth();
  const blok = useBlok(walletAddress);
  const toast = useToast();
  const [pendingMode, setPendingMode] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  // Ref lock — React's `placing` state is async and a fast repeat click
  // can fire placeWagerAndPlay() twice before the button re-disables,
  // blowing through rate limits on the second call. The ref flips
  // synchronously so any re-entry is rejected immediately.
  const placeLockRef = useRef(false);

  // A tile click either opens the wager picker (if the player has a PB on
  // that mode and enough balance for at least the smallest tier) or
  // navigates directly to the game. Guests always go direct.
  const pickMode = (modeId: number) => {
    const pb = blok.personalBests[modeId as 0 | 1 | 2 | 3] ?? 0;
    const eligible =
      isAuthenticated && blok.ready && pb > 0 && blok.balance >= WAGER_TIERS[0];
    if (eligible) {
      setPendingMode(modeId);
    } else {
      router.push(`/game?mode=${modeId}`);
    }
  };

  const placeWagerAndPlay = async (amount: number | null) => {
    if (pendingMode === null) return;
    if (placeLockRef.current) return;
    const modeId = pendingMode;
    if (amount === null || !walletAddress) {
      // Skip path — straight to game.
      setPendingMode(null);
      router.push(`/game?mode=${modeId}`);
      return;
    }
    placeLockRef.current = true;
    setPlacing(true);
    try {
      const res = await fetch("/api/wager", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress, modeId, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "wager failed");
      blok.addOptimistic(-amount);
      toast.push(
        "success",
        `wager placed: ${amount} $BLOK`,
        txLink(data.txHash)
      );
      router.push(`/game?mode=${modeId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "wager failed";
      toast.push("error", msg);
    } finally {
      placeLockRef.current = false;
      setPlacing(false);
      setPendingMode(null);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-6">
        <Link href="/" className="text-moon-white/60 hover:text-moon-white text-sm">
          ← Home
        </Link>
        <div className="flex items-center gap-4">
          <BlockTicker />
          {isAuthenticated && blok.ready && (
            <span className="mono text-xs text-mint">
              {blok.balance} $BLOK
            </span>
          )}
          {isAuthenticated && <WalletChip walletAddress={walletAddress} />}
          {isAuthenticated && handle && (
            <span className="mono text-xs text-moon-white/60">@{handle}</span>
          )}
        </div>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        {blok.activeWagerAmount > 0 && (
          <ActiveWagerBanner
            amount={blok.activeWagerAmount}
            modeId={blok.activeWagerMode}
            onResume={() => router.push(`/game?mode=${blok.activeWagerMode}`)}
            onForfeit={async () => {
              if (!walletAddress) return;
              try {
                const res = await fetch("/api/wager/forfeit", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ walletAddress }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? "forfeit failed");
                toast.push(
                  "success",
                  data.skipped ? "no wager was active" : `burned ${data.burned} $BLOK`,
                  data.skipped ? undefined : txLink(data.txHash)
                );
                await blok.refresh();
              } catch (e) {
                const msg = e instanceof Error ? e.message : "forfeit failed";
                toast.push("error", msg);
              }
            }}
          />
        )}
        <h2 className="text-3xl sm:text-4xl font-bold mb-2">Pick your tempo</h2>
        <p className="text-moon-white/60 mb-10 mono text-sm">
          difficulty scales to MegaETH's actual block rate
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-3xl">
          {DIFFICULTY_MODES.map((mode) => {
            const pb = blok.personalBests[mode.id as 0 | 1 | 2 | 3] ?? 0;
            return (
              <button
                key={mode.id}
                onClick={() => pickMode(mode.id)}
                className="glass rounded-2xl p-6 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_0_32px_rgba(247,134,198,0.18)] group relative overflow-hidden"
                style={{ borderColor: mode.accent, borderWidth: 1 }}
              >
                <div
                  className="absolute -top-20 -right-20 w-48 h-48 rounded-full opacity-20 blur-3xl group-hover:opacity-40 transition-opacity"
                  style={{ background: mode.accent }}
                />
                <div className="relative">
                  <div
                    className="mono text-xs uppercase tracking-widest"
                    style={{ color: mode.accent }}
                  >
                    mode {mode.id}
                  </div>
                  <div className="text-3xl font-bold mt-2">{mode.label}</div>
                  <div className="mt-1 text-moon-white/70 text-sm">{mode.tagline}</div>
                  <div className="mt-5 flex items-baseline gap-3">
                    <div
                      className="mono text-4xl tabular-nums"
                      style={{ color: mode.accent }}
                    >
                      {mode.blocksPerSecond}
                    </div>
                    <div className="text-xs text-moon-white/50 mono uppercase">
                      blocks / sec
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-moon-white/50 mono">
                    {mode.durationSec}s rounds
                  </div>
                  {isAuthenticated && pb > 0 && (
                    <div className="mt-3 text-xs mono text-moon-white/70">
                      PB: <span className="text-mint">{pb}</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {pendingMode !== null && (
        <WagerOverlay
          modeId={pendingMode}
          pb={blok.personalBests[pendingMode as 0 | 1 | 2 | 3] ?? 0}
          balance={blok.balance}
          placing={placing}
          onConfirm={placeWagerAndPlay}
          onCancel={() => setPendingMode(null)}
        />
      )}
    </main>
  );
}

function ActiveWagerBanner({
  amount,
  modeId,
  onResume,
  onForfeit,
}: {
  amount: number;
  modeId: number;
  onResume: () => void;
  onForfeit: () => void | Promise<void>;
}) {
  const mode = DIFFICULTY_MODES.find((m) => m.id === modeId);
  return (
    <div className="mb-8 w-full max-w-3xl p-4 rounded-xl glass border border-pink/50 flex flex-col sm:flex-row items-center gap-4">
      <div className="flex-1 text-center sm:text-left">
        <div className="mono text-[10px] uppercase tracking-widest text-pink">
          wager locked
        </div>
        <div className="mt-1 text-sm text-moon-white">
          <span className="mono font-bold text-mint">{amount}</span>{" "}
          <span className="mono">$BLOK</span> is wagered on{" "}
          <span className="font-bold" style={{ color: mode?.accent }}>
            {mode?.label ?? `mode ${modeId}`}
          </span>
          . Finish that run — bank to settle, die to burn.
        </div>
      </div>
      <div className="flex gap-2 whitespace-nowrap">
        <button onClick={onResume} className="btn-primary text-xs">
          Resume {mode?.label ?? "run"}
        </button>
        <button
          onClick={onForfeit}
          className="btn-secondary text-xs"
          title="Burn the wager without playing — last-resort recovery"
        >
          Forfeit
        </button>
      </div>
    </div>
  );
}

function WagerOverlay({
  modeId,
  pb,
  balance,
  placing,
  onConfirm,
  onCancel,
}: {
  modeId: number;
  pb: number;
  balance: number;
  placing: boolean;
  onConfirm: (amount: number | null) => void;
  onCancel: () => void;
}) {
  const mode = DIFFICULTY_MODES.find((m) => m.id === modeId);
  if (!mode) return null;

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-night-sky/85 backdrop-blur-md p-6">
      <div className="glass rounded-2xl p-8 max-w-md w-full">
        <div className="mono text-xs uppercase tracking-widest text-pink">
          self-wager
        </div>
        <div className="mt-2 text-2xl font-bold">
          Beat your <span style={{ color: mode.accent }}>{mode.label}</span> PB
        </div>
        <div className="mt-2 text-sm text-moon-white/60">
          Your PB is{" "}
          <span className="mono text-mint">{pb}</span>. Stake now and:
        </div>
        <ul className="mt-3 text-xs text-moon-white/70 space-y-1 mono">
          <li>✓ Beat PB: wager returned + matching bonus minted (2×)</li>
          <li>✗ Don't beat PB: wager burns, normal banks still mint</li>
          <li>✗ Die with wager active: wager burns</li>
        </ul>

        <div className="mt-6 grid grid-cols-2 gap-2">
          {WAGER_TIERS.map((t) => {
            const canAfford = balance >= t;
            return (
              <button
                key={t}
                onClick={() => onConfirm(t)}
                disabled={!canAfford || placing}
                className={`mono py-3 rounded-md border transition-all ${
                  canAfford && !placing
                    ? "border-pink text-pink hover:bg-pink/10"
                    : "border-moon-white/10 text-moon-white/30 cursor-not-allowed"
                }`}
              >
                <span className="tabular-nums font-bold">{t}</span> $BLOK
              </button>
            );
          })}
        </div>

        <div className="mt-4 text-xs text-moon-white/50">
          Wallet balance: <span className="mono text-mint">{balance}</span>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={() => onConfirm(null)}
            disabled={placing}
            className="btn-secondary flex-1 text-xs"
          >
            Skip wager
          </button>
          <button
            onClick={onCancel}
            disabled={placing}
            className="btn-secondary flex-1 text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
