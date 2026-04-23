"use client";

import { useEffect, useRef, useState } from "react";
import { JsonRpcProvider } from "ethers";
import { publicConfig } from "@/lib/config";

/**
 * Live MegaETH block height + rolling TPS. Polls `eth_blockNumber` every
 * second. On MegaETH mainnet, block time is ~10ms so the "latest block"
 * value moves fast; 1s polling is sufficient for a ticker.
 *
 * For tighter latency use WebSocket `miniBlocks` (see references/frontend-patterns.md
 * in the megaeth skill) — not needed here.
 */
export function useMegaEth(pollMs = 1000) {
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [tps, setTps] = useState<number>(0);
  const samples = useRef<Array<{ t: number; n: number }>>([]);
  const providerRef = useRef<JsonRpcProvider | null>(null);

  useEffect(() => {
    const provider = new JsonRpcProvider(publicConfig.megaethRpcUrl);
    providerRef.current = provider;
    let alive = true;

    async function tick() {
      try {
        const n = await provider.getBlockNumber();
        if (!alive) return;
        setBlockNumber(n);
        const now = Date.now();
        samples.current.push({ t: now, n });
        // Keep 5 seconds of samples
        samples.current = samples.current.filter((s) => now - s.t <= 5_000);
        if (samples.current.length >= 2) {
          const first = samples.current[0];
          const last = samples.current[samples.current.length - 1];
          const dt = (last.t - first.t) / 1000;
          const db = last.n - first.n;
          if (dt > 0 && db >= 0) setTps(Math.round(db / dt));
        }
      } catch {
        // Swallow — preserve last-known values.
      }
    }

    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
      provider.destroy?.();
    };
  }, [pollMs]);

  return { blockNumber, tps };
}
