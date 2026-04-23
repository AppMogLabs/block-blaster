"use client";

import { useMegaEth } from "@/hooks/useMegaEth";

/**
 * Small live MegaETH block / TPS ticker. Shows last-known values when RPC is
 * briefly unreachable (never flashes empty).
 */
export function BlockTicker({ className = "" }: { className?: string }) {
  const { blockNumber, tps } = useMegaEth();
  return (
    <div className={`mono text-xs text-moon-white/70 flex items-center gap-3 ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-mint" />
        </span>
        MegaETH
      </span>
      <span className="tabular-nums">
        #{blockNumber !== null ? blockNumber.toLocaleString() : "—"}
      </span>
      <span className="text-moon-white/50">·</span>
      <span className="tabular-nums">{tps} TPS</span>
    </div>
  );
}
