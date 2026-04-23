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
import { pickWinPhrase, pickDiePhrase } from "@/lib/endGameMessaging";
import { GameErrorBoundary } from "@/components/game/GameErrorBoundary";

// Phaser + canvas → client-only
const GameCanvas = dynamic(
  () => import("@/components/game/GameCanvas").then((m) => m.GameCanvas),
  { ssr: false }
);

type ScreenState =
  | { kind: "loading" }
  | { kind: "playing" }
  | { kind: "win"; score: number }
  | { kind: "over"; score: number };

export function GameView() {
  const router = useRouter();
  const params = useSearchParams();
  const modeId = Number(params.get("mode") ?? "0") as 0 | 1 | 2 | 3;
  const mode = useMemo(() => getDifficulty(modeId), [modeId]);
  const { walletAddress, login, isAuthenticated } = useAuth();
  const { blockNumber } = useMegaEth();

  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [peakCombo, setPeakCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [remaining, setRemaining] = useState<number>(mode.durationSec);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [milestoneFlash, setMilestoneFlash] = useState<number>(0); // ticks when multiplier changes up
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

  const onScore = useCallback((s: number) => setScore(s), []);
  const onCombo = useCallback((c: number, m: number) => {
    setCombo(c);
    setMultiplier(m);
    setPeakCombo((prev) => (c > prev ? c : prev));
  }, []);
  const onTimer = useCallback((r: number) => setRemaining(r), []);
  const onGameWin = useCallback((s: number) => setScreen({ kind: "win", score: s }), []);
  const onGameOver = useCallback((s: number) => setScreen({ kind: "over", score: s }), []);

  const retry = () => {
    setScore(0);
    setCombo(0);
    setPeakCombo(0);
    setMultiplier(1);
    setRemaining(mode.durationSec);
    setScreen({ kind: "loading" });
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
          <div className="mono">
            <span className="text-moon-white/50 uppercase text-[10px]">score</span>{" "}
            <span className="tabular-nums text-moon-white font-bold">{score}</span>
          </div>
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
              registerHandle={(h) => (handleRef.current = h)}
            />
          </GameErrorBoundary>
        </div>

        {screen.kind === "loading" && <LoadingOverlay />}
        {screen.kind === "playing" && (
          <button
            onClick={() => handleRef.current?.bankEarly()}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 btn-secondary text-xs"
          >
            bank early
          </button>
        )}
        {screen.kind === "win" && (
          <SurvivedOverlay
            score={screen.score}
            modeId={modeId}
            peakCombo={peakCombo}
            token={sessionToken}
            sessionError={sessionError}
            walletAddress={walletAddress}
            isAuthenticated={isAuthenticated}
            onSignIn={login}
            onRetry={retry}
          />
        )}
        {screen.kind === "over" && (
          <DiedOverlay
            score={screen.score}
            modeId={modeId}
            peakCombo={peakCombo}
            onRetry={retry}
          />
        )}
      </div>
    </main>
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
  token,
  sessionError,
  walletAddress,
  isAuthenticated,
  onSignIn,
  onRetry,
}: {
  score: number;
  modeId: number;
  peakCombo: number;
  token: string | null;
  sessionError: string | null;
  walletAddress: string | null;
  isAuthenticated: boolean;
  onSignIn: () => void;
  onRetry: () => void;
}) {
  const phrase = pickWinPhrase({ score, combo: peakCombo, modeId });
  const [minting, setMinting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canCommit = Boolean(walletAddress && token);
  const signedInButNoSession = Boolean(walletAddress && !token);
  const isGuest = !isAuthenticated;

  const commit = async () => {
    if (!walletAddress || !token) return;
    setMinting(true);
    setError(null);
    try {
      const res = await fetch("/api/mint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, score, walletAddress, modeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "mint failed");
      setTxHash(data.txHash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "mint error");
    } finally {
      setMinting(false);
    }
  };

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

        {txHash ? (
          <div className="mt-6 space-y-3">
            <div className="mono text-xs text-mint">✓ minted onchain</div>
            <a
              href={`${publicConfig.megaethExplorer}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="mono text-xs text-sky underline break-all block"
            >
              {txHash}
            </a>
          </div>
        ) : isGuest ? (
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
        ) : signedInButNoSession ? (
          <div className="mt-6 space-y-3">
            <div className="text-xs text-rose/80">
              {sessionError
                ? `Session API error: ${sessionError}. Check the server logs.`
                : "This run started before your wallet was ready — no session token was signed. Play another round now."}
            </div>
            <button onClick={onRetry} className="btn-primary w-full">
              Play again
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={commit}
              disabled={minting || !canCommit}
              className="btn-primary mt-6 w-full disabled:opacity-50"
            >
              {minting ? "committing…" : "Commit to chain"}
            </button>
            {error && <div className="mono text-xs text-rose mt-2">{error}</div>}
          </>
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
  modeId,
  peakCombo,
  onRetry,
}: {
  score: number;
  modeId: number;
  peakCombo: number;
  onRetry: () => void;
}) {
  const phrase = pickDiePhrase({ score, combo: peakCombo, modeId });
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    `${phrase.title} I hit ${score} in Block Blaster. → https://block-blaster.app`
  )}`;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-night-sky/85 backdrop-blur-sm p-6">
      <div className="glass rounded-2xl p-8 max-w-md w-full text-center border-rose/30">
        <div className="mono text-xs uppercase tracking-widest text-rose">buried</div>
        <div className="text-3xl font-bold mt-2">{phrase.title}</div>
        <div className="text-sm text-moon-white/60 mt-2">{phrase.sub}</div>
        <div className="mono text-5xl text-moon-white/40 tabular-nums mt-6">{score}</div>
        <div className="text-xs text-moon-white/40 mt-1">unminted</div>
        <div className="mt-6 flex gap-2 justify-center">
          <button onClick={onRetry} className="btn-primary">
            Try again
          </button>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="btn-secondary">
            Share on X
          </a>
        </div>
      </div>
    </div>
  );
}
