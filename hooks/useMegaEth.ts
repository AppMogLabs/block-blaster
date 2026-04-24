"use client";

import { useEffect, useRef, useState } from "react";
import { JsonRpcProvider } from "ethers";
import { publicConfig } from "@/lib/config";

/**
 * Live MegaETH block height + rolling TPS.
 *
 * TPS estimate = (avg transactions per sampled block) × (blocks per second).
 * We can't afford to fetch every block on a 100-bps chain, so we sample one
 * block per tick and extrapolate. The math assumes transactions distribute
 * roughly uniformly across blocks — statistically true over a 5s window.
 *
 * A previous version returned `db/dt` which is blocks-per-second, mislabelled
 * as TPS. On testnet with bursty polling that typically floored to 0 or 1.
 */
export function useMegaEth(pollMs = 1000) {
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [tps, setTps] = useState<number>(0);
  const samples = useRef<Array<{ t: number; n: number; tx: number }>>([]);
  const providerRef = useRef<JsonRpcProvider | null>(null);

  useEffect(() => {
    const provider = new JsonRpcProvider(publicConfig.megaethRpcUrl);
    providerRef.current = provider;
    let alive = true;

    async function tick() {
      try {
        // getBlock("latest") returns both the number and the tx hash list —
        // one request, both data points.
        const block = await provider.getBlock("latest");
        if (!alive || !block) return;
        setBlockNumber(block.number);
        const now = Date.now();
        samples.current.push({ t: now, n: block.number, tx: block.transactions.length });
        // Keep 5 seconds of samples
        samples.current = samples.current.filter((s) => now - s.t <= 5_000);
        if (samples.current.length >= 2) {
          const first = samples.current[0];
          const last = samples.current[samples.current.length - 1];
          const dt = (last.t - first.t) / 1000;
          const db = last.n - first.n;
          if (dt > 0 && db > 0) {
            const blocksPerSec = db / dt;
            const avgTxPerBlock =
              samples.current.reduce((sum, s) => sum + s.tx, 0) /
              samples.current.length;
            setTps(Math.round(blocksPerSec * avgTxPerBlock));
          } else {
            // Chain idle or RPC gave identical block back-to-back.
            setTps(0);
          }
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
