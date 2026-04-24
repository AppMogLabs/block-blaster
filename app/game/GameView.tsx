"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDifficulty } from "@/lib/difficulty";
import { useAuth } from "@/hooks/useAuth";
import { useMegaEth } from "@/hooks/useMegaEth";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { publicConfig } from "@/lib/config";
import { MuteToggle } from "@/components/ui/MuteToggle";
import { WalletChip } from "@/components/ui/WalletChip";
import { pickWinPhrase, pickDiePhrase } from "@/lib/endGameMessaging";
import { GameErrorBoundary } from "@/components/game/GameErrorBoundary";
import { useBlok } from "@/hooks/useBlok";
import { useToast } from "@/components/ui/Toast";
import { txLink } from "@/lib/txLink";

// Phaser + canvas → client-only
const GameCanvas = dynamic(
  () => import("@/components/game/GameCanvas").then((m) => m.GameCanvas),
  { ssr: false }
);

type ScreenState =
  | { kind: "loading" }
  | { kind: "playing" }
  | { kind: "win"; score: number; lostPending: number }
  | { kind: "over"; score: number; lostPending: number };

export function GameView() {
  const router = useRouter();
  const params = useSearchParams();
  const modeId = Number(params.get("mode") ?? "0") as 0 | 1 | 2 | 3;
  const mode = useMemo(() => getDifficulty(modeId), [modeId]);
  const { walletAddress, login, isAuthenticated } = useAuth();
  const { blockNumber } = useMegaEth();
  const blok = useBlok(walletAddress);
  const toast = useToast();

  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const [score, setScore] = useState(0); // total = banked + pending, for any "overall" HUD
  const [banked, setBanked] = useState(0);
  const [pending, setPending] = useState(0);
  const [bankFlash, setBankFlash] = useState(0); // ticks each successful bank
  const [combo, setCombo] = useState(0);
  const [peakCombo, setPeakCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [remaining, setRemaining] = useState<number>(mode.durationSec);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [milestoneFlash, setMilestoneFlash] = useState<number>(0); // ticks when multiplier changes up
  const [streak, setStreak] = useState(0);
  const [heatLevel, setHeatLevel] = useState(0);
  // Nuke readiness is derived from `nukeKills` + wallet balance below.
  // Scene emits NUKE_PROGRESS on every hit; we track the latest here.
  const [nukeKills, setNukeKills] = useState(0);
  const [nukeThreshold, setNukeThreshold] = useState(25);

  // Personal best for the current mode — shown in HUD once > 0.
  const currentPb = blok.personalBests[modeId] ?? 0;
  // True once this run's cumulative banked total exceeds the old PB. At
  // that point the banner reads "NEW PB" with the live total.
  const beatingPb = currentPb > 0 && banked > currentPb;
  const [sweepFuel, setSweepFuel] = useState(1); // 0..1
  const [sweepAvailable, setSweepAvailable] = useState(modeId !== 0);
  const handleRef = useRef<GameCanvasHandle | null>(null);
  const lastMultiplier = useRef(1);

  // Flash the HUD combo chip when the multiplier steps up (1 → 2 at 5-combo, 2 → 3 at 10-combo).
  useEffect(() => {
    if (multiplier > lastMultiplier.current) {
      setMilestoneFlash((n) => n + 1);
    }
    lastMultiplier.current = multiplier;
  }, [multiplier]);

  // Request a session token on mount (or when wallet changes) — optional: skip for guests.
  useEffect(() => {
    if (!walletAddress) {
      setSessionToken(null);
      setSessionError(null);
      return;
    }
    setSessionError(null);
    const ctrl = new AbortController();
    fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress, modeId }),
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          throw new Error(d?.error ?? `session fetch failed (${r.status})`);
        }
        return d;
      })
      .then((d) => {
        if (d?.token) setSessionToken(d.token);
        else throw new Error("no token in response");
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[session] fetch failed:", msg);
        setSessionError(msg);
      });
    return () => ctrl.abort();
  }, [walletAddress, modeId, runKey]);

  // Once Phaser is mounted + ready, switch to playing. Until then show loading.
  const onReady = useCallback(() => setScreen({ kind: "playing" }), []);

  const onScore = useCallback((s: number, b: number, p: number) => {
    setScore(s);
    setBanked(b);
    setPending(p);
  }, []);
  const onCombo = useCallback((c: number, m: number) => {
    setCombo(c);
    setMultiplier(m);
    setPeakCombo((prev) => (c > prev ? c : prev));
  }, []);
  const onTimer = useCallback((r: number) => setRemaining(r), []);
  const postGameEnd = useCallback(
    async (outcome: "win" | "death") => {
      if (!walletAddress || !sessionToken) return;
      try {
        await fetch("/api/game-end", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: sessionToken,
            walletAddress,
            modeId,
            outcome,
          }),
        });
        // Refresh balance one more time — any wager settled by bank during
        // the run might have changed it, and game-end itself may have
        // burned an active wager.
        await blok.refresh();
      } catch {
        // Non-fatal — game is over, the player has already seen their score.
      }
    },
    [walletAddress, sessionToken, modeId, blok]
  );
  const onGameWin = useCallback(
    (s: number, lostPending: number) => {
      setScreen({ kind: "win", score: s, lostPending });
      void postGameEnd("win");
    },
    [postGameEnd]
  );
  const onGameOver = useCallback(
    (s: number, lostPending: number) => {
      setScreen({ kind: "over", score: s, lostPending });
      void postGameEnd("death");
    },
    [postGameEnd]
  );
  const onBank = useCallback(
    async (b: number, justBanked: number) => {
      // Local UI: banked bucket increments, pending resets.
      setBanked(b);
      setPending(0);
      setBankFlash((n) => n + 1);
      // Onchain: mint the just-banked amount to the player's wallet. Fire
      // and forget — if the tx takes longer than the player's next action,
      // we'll eventually see the updated balance via blok.refresh().
      if (!walletAddress || !sessionToken || justBanked <= 0) return;
      try {
        const res = await fetch("/api/bank", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: sessionToken,
            walletAddress,
            modeId,
            amount: justBanked,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "bank failed");
        // Bump local balance NOW so the next action (nuke, etc.) sees the
        // just-banked amount without waiting for the mint tx to land on
        // chain + propagate back through /api/balance. The hook also
        // re-reads chain at +1.2s to reconcile.
        blok.addOptimistic(justBanked);
        toast.push("success", `+${justBanked} $BLOK minted`, txLink(data.txHash));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "bank failed";
        toast.push("error", `bank: ${msg}`);
      }
    },
    [walletAddress, sessionToken, modeId, toast, blok]
  );
  const onBankClick = useCallback(() => {
    handleRef.current?.bank();
  }, []);
  const onStreak = useCallback((s: number, h: number) => {
    setStreak(s);
    setHeatLevel(h);
  }, []);
  const onNukeProgress = useCallback((kills: number, threshold: number) => {
    setNukeKills(kills);
    setNukeThreshold(threshold);
  }, []);
  const onSweepFuel = useCallback((f: number, a: boolean) => {
    setSweepFuel(f);
    setSweepAvailable(a);
  }, []);
  const onReloadClick = useCallback(async () => {
    // Sweep reload: 25 $BLOK to refill fuel instantly. Not available on
    // Easy (no sweep beam there anyway). Pre-checks to avoid free reload
    // if the API call fails.
    if (modeId === 0) return;
    if (sweepFuel >= 0.98) {
      toast.push("info", "sweep fuel already full");
      return;
    }
    if (!walletAddress) {
      toast.push("error", "sign in to reload sweep");
      return;
    }
    if (blok.ready && blok.balance < 25) {
      toast.push("error", `need 25 $BLOK (have ${blok.balance})`);
      return;
    }
    if (!sessionToken) return;
    try {
      const res = await fetch("/api/sweep-reload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: sessionToken, walletAddress, modeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "reload failed");
      handleRef.current?.refillSweep();
      blok.addOptimistic(-25);
      toast.push(
        "success",
        "−25 $BLOK (sweep refilled)",
        txLink(data.txHash)
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "reload failed";
      toast.push("error", msg);
    }
  }, [walletAddress, sessionToken, modeId, sweepFuel, blok, toast]);

  const onNukeClick = useCallback(async () => {
    // Affordability pre-check so we don't fire the full-screen flash for
    // free when the API call will fail downstream. Guest play (no wallet)
    // skips the cost entirely.
    if (walletAddress && blok.ready && blok.balance < 100) {
      toast.push("error", `need 100 $BLOK (have ${blok.balance})`);
      return;
    }
    // Fire the visual immediately — feels responsive, backed by the API call.
    handleRef.current?.triggerNuke();
    // Burn 100 $BLOK via the pre-authorised allowance. Guests skip.
    if (!walletAddress || !sessionToken) return;
    try {
      const res = await fetch("/api/nuke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: sessionToken, walletAddress, modeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "nuke charge failed");
      // Mirror the server-side burn locally so a subsequent action sees the
      // post-spend balance immediately.
      blok.addOptimistic(-100);
      toast.push("success", "−100 $BLOK (nuke)", txLink(data.txHash));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "nuke charge failed";
      toast.push("error", msg);
    }
  }, [walletAddress, sessionToken, modeId, toast, blok]);

  const retry = () => {
    setScore(0);
    setBanked(0);
    setPending(0);
    setCombo(0);
    setPeakCombo(0);
    setMultiplier(1);
    setRemaining(mode.durationSec);
    setScreen({ kind: "loading" });
    // Clear the previous session — each run must mint with its own token,
    // otherwise a second mint attempts to re-consume the used token
    // and the API correctly rejects it with "session already used".
    setSessionToken(null);
    setSessionError(null);
    // Reset the new mechanics — streak/heat/nuke/fuel all start fresh.
    setStreak(0);
    setHeatLevel(0);
    setNukeKills(0);
    setSweepFuel(1);
    setRunKey((k) => k + 1);
  };

  return (
    <main className="min-h-screen flex flex-col">
      {/* HUD */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-moon-white/10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/difficulty")}
            className="text-moon-white/60 hover:text-moon-white text-sm"
          >
            ← Back
          </button>
          <MuteToggle />
          {isAuthenticated && <WalletChip walletAddress={walletAddress} />}
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="mono">
            <span className="text-moon-white/50 uppercase text-[10px]">time</span>{" "}
            <span className="tabular-nums text-moon-white">{remaining}s</span>
          </div>
          <div
            key={milestoneFlash}
            className={`mono transition-transform ${
              multiplier >= 3
                ? "text-pink animate-[milestonePop_0.5s_ease-out]"
                : multiplier >= 2
                  ? "text-magenta"
                  : ""
            }`}
          >
            <span className="text-moon-white/50 uppercase text-[10px]">combo</span>{" "}
            <span className="tabular-nums">
              {combo}{" "}
              <span className={multiplier > 1 ? "font-bold" : ""}>×{multiplier}</span>
            </span>
          </div>
          <div
            className={`mono transition-colors ${
              heatLevel >= 4
                ? "text-[#dc1a1a]"
                : heatLevel >= 3
                  ? "text-[#ff6b1a]"
                  : heatLevel >= 2
                    ? "text-magenta"
                    : heatLevel >= 1
                      ? "text-pink"
                      : ""
            }`}
          >
            <span className="text-moon-white/50 uppercase text-[10px]">streak</span>{" "}
            <span className="tabular-nums font-bold">{streak}</span>
          </div>
          {isAuthenticated ? (
            // Live on-chain $BLOK balance. `blok.balance` starts at 0 while
            // the first /api/balance call is in flight; the optimistic-
            // update path in useBlok bumps it immediately on bank/nuke
            // regardless of readiness so the number tracks player actions
            // without waiting for the reconcile read.
            <div
              key={`bal-${bankFlash}`}
              className="mono transition-transform animate-[milestonePop_0.45s_ease-out]"
              title="Your live $BLOK wallet balance"
            >
              <span className="text-moon-white/50 uppercase text-[10px]">$BLOK</span>{" "}
              <span className="tabular-nums text-mint font-bold">{blok.balance}</span>
            </div>
          ) : (
            // Guest fallback: local "banked this run" counter since a
            // guest has no wallet to hold minted $BLOK.
            <div
              key={`bank-${bankFlash}`}
              className="mono transition-transform animate-[milestonePop_0.45s_ease-out]"
            >
              <span className="text-moon-white/50 uppercase text-[10px]">banked</span>{" "}
              <span className="tabular-nums text-mint font-bold">{banked}</span>
            </div>
          )}
          <div className={`mono ${pending > 0 ? "text-pink" : "text-moon-white/30"}`}>
            <span className="text-moon-white/50 uppercase text-[10px]">pending</span>{" "}
            <span className="tabular-nums font-bold">{pending}</span>
          </div>
          {/* Personal Best chip — only shown to authenticated players with
              an existing PB. Turns green + "NEW PB" once this run's banks
              exceed it so the player knows they're in record territory. */}
          {isAuthenticated && currentPb > 0 && (
            <div
              className={`mono ${
                beatingPb ? "text-mint font-bold animate-[milestonePop_0.45s_ease-out]" : "text-moon-white/50"
              }`}
              title={
                beatingPb
                  ? `Beating your PB — new high is ${banked}`
                  : `Personal best on ${mode.label}`
              }
            >
              <span className="text-moon-white/50 uppercase text-[10px]">
                {beatingPb ? "new pb" : "pb"}
              </span>{" "}
              <span className="tabular-nums">
                {beatingPb ? banked : currentPb}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Canvas host */}
      <div className="flex-1 relative">
        <div className="absolute inset-0">
          <GameErrorBoundary
            key={runKey}
            onReset={() => setRunKey((k) => k + 1)}
          >
            <GameCanvas
              modeId={modeId}
              blocksPerSecond={mode.blocksPerSecond}
              durationSec={mode.durationSec}
              startingBlockNumber={blockNumber ?? undefined}
              onScore={onScore}
              onCombo={onCombo}
              onTimer={onTimer}
              onGameWin={onGameWin}
              onGameOver={onGameOver}
              onReady={onReady}
              onStreak={onStreak}
              onNukeProgress={onNukeProgress}
              onSweepFuel={onSweepFuel}
              onBank={onBank}
              registerHandle={(h) => (handleRef.current = h)}
            />
          </GameErrorBoundary>
        </div>

        {screen.kind === "loading" && <LoadingOverlay />}
        {screen.kind === "playing" && (
          <>
            <BankButton pending={pending} onBank={onBankClick} />
            {sweepAvailable && <SweepFuelBar fuel={sweepFuel} />}
            {sweepAvailable && (
              <SweepReloadButton
                fuel={sweepFuel}
                balance={isAuthenticated ? blok.balance : 0}
                isAuthenticated={isAuthenticated}
                onActivate={onReloadClick}
              />
            )}
            <NukeButton
              kills={nukeKills}
              threshold={nukeThreshold}
              balance={isAuthenticated ? blok.balance : 0}
              isAuthenticated={isAuthenticated}
              onActivate={onNukeClick}
            />
          </>
        )}
        {screen.kind === "win" && (
          <SurvivedOverlay
            score={screen.score}
            modeId={modeId}
            peakCombo={peakCombo}
            isAuthenticated={isAuthenticated}
            onSignIn={login}
            onRetry={retry}
          />
        )}
        {screen.kind === "over" && (
          <DiedOverlay
            score={screen.score}
            lostPending={screen.lostPending}
            modeId={modeId}
            peakCombo={peakCombo}
            isAuthenticated={isAuthenticated}
            onSignIn={login}
            onRetry={retry}
          />
        )}
      </div>
    </main>
  );
}

function BankButton({
  pending,
  onBank,
}: {
  pending: number;
  onBank: () => void;
}) {
  const hasPending = pending > 0;
  return (
    <button
      onClick={onBank}
      disabled={!hasPending}
      aria-label={hasPending ? `Bank ${pending} points` : "Nothing to bank yet"}
      className={`absolute bottom-8 left-1/2 -translate-x-1/2 mono uppercase px-5 py-2 rounded-md text-xs tracking-widest transition-all ${
        hasPending
          ? "bg-mint text-night-sky font-bold shadow-[0_0_22px_rgba(144,215,159,0.55)] cursor-pointer hover:brightness-110"
          : "bg-moon-white/5 text-moon-white/30 cursor-not-allowed"
      }`}
    >
      {hasPending ? `BANK +${pending}` : "BANK"}
    </button>
  );
}

function SweepReloadButton({
  fuel,
  balance,
  isAuthenticated,
  onActivate,
}: {
  fuel: number;
  balance: number;
  isAuthenticated: boolean;
  onActivate: () => void;
}) {
  const COST = 25;
  const isFull = fuel >= 0.98;
  const canAfford = isAuthenticated && balance >= COST;
  const enabled = !isFull && canAfford;

  const label = !isAuthenticated
    ? "SIGN IN"
    : isFull
      ? "FULL"
      : canAfford
        ? `+FUEL ${COST}`
        : `${COST} $BLOK`;

  return (
    <button
      onClick={onActivate}
      disabled={!enabled}
      aria-label={
        enabled
          ? `Refill sweep fuel for ${COST} $BLOK`
          : isFull
            ? "Sweep fuel already full"
            : `Need ${COST} $BLOK (have ${balance})`
      }
      className={`absolute top-4 left-4 w-14 h-14 rounded-full p-[3px] transition-all ${
        enabled
          ? "cursor-pointer shadow-[0_0_18px_rgba(109,208,169,0.5)] animate-[milestonePop_1.6s_ease-in-out_infinite]"
          : "cursor-not-allowed"
      }`}
      style={{
        background: enabled
          ? "conic-gradient(#6DD0A9 360deg, #6DD0A9 360deg)"
          : "rgba(236,232,232,0.18)",
      }}
    >
      <span
        className={`w-full h-full rounded-full flex items-center justify-center mono text-[9px] uppercase px-1 ${
          enabled
            ? "bg-night-sky text-[#6DD0A9] font-bold"
            : "bg-night-sky text-moon-white/40"
        }`}
      >
        <span className="tabular-nums whitespace-nowrap">{label}</span>
      </span>
    </button>
  );
}

function NukeButton({
  kills,
  threshold,
  balance,
  isAuthenticated,
  onActivate,
}: {
  /** Cumulative blocks destroyed since last nuke use. */
  kills: number;
  /** Kill count required to unlock the nuke (scene-side constant). */
  threshold: number;
  /** $BLOK wallet balance (0 for guests — they can't fire the nuke). */
  balance: number;
  /** Signed-in guests see a disabled hint state rather than sign-in copy. */
  isAuthenticated: boolean;
  onActivate: () => void;
}) {
  const COST = 100;
  const killsMet = kills >= threshold;
  // Guests can't afford by definition — the nuke is a BLOK-gated action.
  const balanceMet = isAuthenticated && balance >= COST;
  const armed = killsMet && balanceMet;

  // Four spec states. Colour + pulse + centre text all shift.
  let track = "rgba(236,232,232,0.18)"; // grey ring
  let fill = "rgba(236,232,232,0.18)";
  let ringAngle = 360;
  let centreClass = "bg-night-sky text-moon-white/40";
  let centreText: string = "NUKE";
  let pulse = false;
  let shadow = "";

  if (armed) {
    // Both gates: fully lit MegaETH gold, dramatic pulse
    fill = "#ffd26d";
    track = "#ffd26d";
    centreClass = "bg-night-sky text-[#ffd26d] font-bold";
    centreText = "NUKE";
    pulse = true;
    shadow = "shadow-[0_0_24px_rgba(255,210,109,0.55)]";
  } else if (killsMet && !balanceMet) {
    // Earned but can't afford — pulse grey in the same rhythm so the
    // player feels "it's ready, pay up"
    centreClass = "bg-night-sky text-moon-white/60";
    centreText = isAuthenticated ? `${COST} $BLOK` : "SIGN IN";
    pulse = true;
    shadow = "shadow-[0_0_12px_rgba(236,232,232,0.2)]";
  } else {
    // Show kill progress toward threshold as a subtle conic fill
    const pct = Math.min(1, kills / threshold);
    ringAngle = pct * 360;
    fill = "#7EAAD4"; // sky blue — neutral "working toward it"
    centreClass = "bg-night-sky text-moon-white/40";
    centreText = `${kills}/${threshold}`;
  }

  return (
    <button
      onClick={onActivate}
      disabled={!armed}
      aria-label={
        armed
          ? "Activate nuke — 100 $BLOK"
          : killsMet
            ? `Nuke ready but needs 100 $BLOK (have ${balance})`
            : `Nuke requires ${threshold} kills (at ${kills})`
      }
      className={`absolute top-4 right-4 w-14 h-14 rounded-full p-[3px] transition-all ${
        armed ? "cursor-pointer" : "cursor-not-allowed"
      } ${pulse ? "animate-[milestonePop_1.4s_ease-in-out_infinite]" : ""} ${shadow}`}
      style={{
        background: `conic-gradient(${fill} ${ringAngle}deg, ${track} ${ringAngle}deg 360deg)`,
      }}
    >
      <span
        className={`w-full h-full rounded-full flex items-center justify-center mono text-[9px] uppercase ${centreClass}`}
      >
        <span className="tabular-nums whitespace-nowrap">{centreText}</span>
      </span>
    </button>
  );
}

function SweepFuelBar({ fuel }: { fuel: number }) {
  const pct = Math.max(0, Math.min(1, fuel)) * 100;
  return (
    <div
      className="absolute bottom-2 left-1/2 -translate-x-1/2 w-48 h-1 rounded-full overflow-hidden bg-moon-white/10"
      aria-label={`Sweep fuel ${pct.toFixed(0)}%`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-100"
        style={{
          width: `${pct}%`,
          background: pct > 30 ? "#6DD0A9" : "#F5AF94",
          boxShadow: pct > 0 ? "0 0 8px rgba(109, 208, 169, 0.6)" : "none",
        }}
      />
    </div>
  );
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-night-sky/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <div className="flex gap-2">
          {[...Array(5)].map((_, i) => (
            <span
              key={i}
              className="w-4 h-4 rounded-sm"
              style={{
                background: ["#F5AF94", "#FF8AA8", "#F786C6", "#7EAAD4", "#90D79F"][i],
                animation: `pulse 1.4s ease-in-out ${i * 0.12}s infinite`,
              }}
            />
          ))}
        </div>
        <div className="mono text-moon-white/70 text-sm">loading the chain…</div>
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.25; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}

function SurvivedOverlay({
  score,
  modeId,
  peakCombo,
  isAuthenticated,
  onSignIn,
  onRetry,
}: {
  score: number;
  modeId: number;
  peakCombo: number;
  isAuthenticated: boolean;
  onSignIn: () => void;
  onRetry: () => void;
}) {
  const phrase = pickWinPhrase({ score, combo: peakCombo, modeId });
  const isGuest = !isAuthenticated;

  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    `I scored ${score} in Block Blaster on MegaETH. Can you beat it? → https://block-blaster.app`
  )}`;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-night-sky/85 backdrop-blur-sm p-6">
      <div className="glass rounded-2xl p-8 max-w-md w-full text-center">
        <div className="mono text-xs uppercase tracking-widest text-mint">survived</div>
        <div className="mono text-7xl tabular-nums font-bold mt-2">{score}</div>
        <div className="text-lg font-semibold mt-4">{phrase.title}</div>
        <div className="text-moon-white/60 text-sm mt-1">{phrase.sub}</div>

        {isGuest ? (
          <div className="mt-6 space-y-3">
            <div className="text-xs text-moon-white/60">
              Guest scores can't be saved onchain.
              <br />
              Sign in with X to bank your next run as <span className="mono">$BLOK</span>.
            </div>
            <button onClick={onSignIn} className="btn-primary w-full">
              Sign in with X
            </button>
          </div>
        ) : (
          <div className="mt-6 text-xs text-moon-white/60">
            All banked points minted to your wallet during the run.
            <br />
            Total banked:{" "}
            <span className="mono text-mint font-bold">{score}</span>{" "}
            <span className="mono">$BLOK</span>
          </div>
        )}

        <div className="mt-3 flex gap-2 justify-center">
          <a href={shareUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
            Share on X
          </a>
          <button onClick={onRetry} className="btn-secondary text-xs">
            Play again
          </button>
        </div>
      </div>
    </div>
  );
}

function DiedOverlay({
  score,
  lostPending,
  modeId,
  peakCombo,
  isAuthenticated,
  onSignIn,
  onRetry,
}: {
  score: number;
  lostPending: number;
  modeId: number;
  peakCombo: number;
  isAuthenticated: boolean;
  onSignIn: () => void;
  onRetry: () => void;
}) {
  const phrase = pickDiePhrase({ score, combo: peakCombo, modeId });
  const isGuest = !isAuthenticated;

  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    `${phrase.title} I banked ${score} in Block Blaster. → https://block-blaster.app`
  )}`;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-night-sky/85 backdrop-blur-sm p-6">
      <div className="glass rounded-2xl p-8 max-w-md w-full text-center border-rose/30">
        <div className="mono text-xs uppercase tracking-widest text-rose">buried</div>
        <div className="text-3xl font-bold mt-2">{phrase.title}</div>
        <div className="text-sm text-moon-white/60 mt-2">{phrase.sub}</div>

        <div className="mono text-xs uppercase tracking-widest text-mint mt-6">banked</div>
        <div className="mono text-6xl tabular-nums font-bold mt-1 text-mint">{score}</div>

        {lostPending > 0 && (
          <div className="mt-3 text-xs text-rose/80 mono">
            lost {lostPending} pending — next time, bank sooner
          </div>
        )}

        {score > 0 ? (
          isGuest ? (
            <div className="mt-6 space-y-3">
              <div className="text-xs text-moon-white/60">
                Sign in with X to keep your banked{" "}
                <span className="mono">$BLOK</span> next run.
              </div>
              <button onClick={onSignIn} className="btn-primary w-full">
                Sign in with X
              </button>
            </div>
          ) : (
            <div className="mt-6 text-xs text-moon-white/60">
              Already minted to your wallet — {score}{" "}
              <span className="mono">$BLOK</span> locked in.
            </div>
          )
        ) : (
          <div className="mt-6 text-xs text-moon-white/50">
            Nothing banked this run — bank sooner next time.
          </div>
        )}

        <div className="mt-4 flex gap-2 justify-center">
          <button onClick={onRetry} className="btn-secondary text-xs">
            Try again
          </button>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
            Share on X
          </a>
        </div>
      </div>
    </div>
  );
}
