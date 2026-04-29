"use client";

import { useEffect, useRef, useState } from "react";

type Coin = {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  delay: number;
};

export type GoldAward = {
  /** Unique id per award event so React can track in-flight coins. */
  id: number;
  /** Burst origin in viewport pixels (already translated from canvas). */
  x: number;
  y: number;
  amount: number;
};

/**
 * Listens for gold-block awards and renders a flock of coin sprites
 * scattering from the burst point and flying to the player's $BLOK / banked
 * chip. Uses CSS custom properties + a single keyframe so the cost scales
 * cleanly when several gold blocks chain in quick succession.
 *
 * Pure cosmetic — the points have already landed in the pending pot by the
 * time this fires. On the final coin's arrival, `onArrive` is called so the
 * HUD chip can flash via its existing milestonePop animation.
 */
export function CoinFlight({
  awards,
  targetRef,
  onArrive,
}: {
  awards: GoldAward[];
  targetRef: React.RefObject<HTMLDivElement>;
  onArrive: (id: number) => void;
}) {
  const [coins, setCoins] = useState<Coin[]>([]);
  const seenRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (awards.length === 0) return;
    // Spawn coins for any award we haven't processed yet.
    const next: Coin[] = [];
    for (const a of awards) {
      if (seenRef.current.has(a.id)) continue;
      seenRef.current.add(a.id);
      const target = targetRef.current?.getBoundingClientRect();
      if (!target) {
        // No chip on screen yet — bail and let the award expire silently.
        onArrive(a.id);
        continue;
      }
      const toX = target.left + target.width / 2;
      const toY = target.top + target.height / 2;
      // Six coins fan out from the burst point with small jitter for parallax.
      const COUNT = 6;
      for (let i = 0; i < COUNT; i++) {
        next.push({
          id: a.id * 100 + i,
          fromX: a.x + (Math.random() - 0.5) * 32,
          fromY: a.y + (Math.random() - 0.5) * 32,
          toX,
          toY,
          delay: i * 55,
        });
      }
      // The last coin lands ~700ms + last delay into the future.
      const FLIGHT_MS = 700;
      const arriveAt = (COUNT - 1) * 55 + FLIGHT_MS;
      window.setTimeout(() => onArrive(a.id), arriveAt);
    }
    if (next.length === 0) return;
    setCoins((prev) => [...prev, ...next]);
    // Clean up coin DOM after the last one finishes — keeps the overlay
    // from accumulating ghost spans across many gold destroys.
    const cleanupAt = (5 * 55) + 800;
    window.setTimeout(() => {
      setCoins((prev) =>
        prev.filter((c) => !next.some((n) => n.id === c.id))
      );
    }, cleanupAt);
  }, [awards, targetRef, onArrive]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[700]">
      {coins.map((c) => (
        <span
          key={c.id}
          className="bb-coin absolute block"
          style={
            {
              "--from-x": `${c.fromX}px`,
              "--from-y": `${c.fromY}px`,
              "--to-x": `${c.toX}px`,
              "--to-y": `${c.toY}px`,
              "--delay": `${c.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
      <style>{`
        .bb-coin {
          left: 0;
          top: 0;
          width: 14px;
          height: 14px;
          border-radius: 9999px;
          background: radial-gradient(circle at 35% 30%, #fff7c2 0%, #ffd700 55%, #b8860b 100%);
          box-shadow: 0 0 10px rgba(255, 215, 0, 0.8), 0 0 4px rgba(255, 255, 255, 0.6);
          transform: translate(var(--from-x), var(--from-y)) scale(1);
          animation: bb-coin-fly 700ms cubic-bezier(0.55, 0.1, 0.4, 1) var(--delay) forwards;
        }
        @keyframes bb-coin-fly {
          0% {
            transform: translate(var(--from-x), var(--from-y)) scale(1);
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          100% {
            transform: translate(var(--to-x), var(--to-y)) scale(0.35);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
