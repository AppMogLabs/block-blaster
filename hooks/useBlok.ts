"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { BrowserProvider, Contract, MaxUint256 } from "ethers";
import { publicConfig } from "@/lib/config";
import { BLOK_ABI } from "@/lib/contracts";

export type BlokState = {
  /** Current $BLOK balance. */
  balance: number;
  /** Allowance granted to GameRewards. "max" means effectively unlimited. */
  allowance: number | "max";
  /** True when balance/allowance/PBs are loaded for the current wallet. */
  ready: boolean;
  /** Personal best per mode (0..3). 0 = never played that mode. */
  personalBests: Record<0 | 1 | 2 | 3, number>;
  /** Active wager amount (0 if none). */
  activeWagerAmount: number;
  /** Active wager mode (meaningful only when activeWagerAmount > 0). */
  activeWagerMode: number;
  /** Wallet address (lower-cased) this state is for, or null. */
  walletAddress: string | null;
  /** True iff the player has granted an unlimited allowance to GameRewards. */
  approved: boolean;
  error: string | null;
};

type Actions = {
  /** Fetch fresh balance + allowance + PBs from /api/balance. */
  refresh: () => Promise<void>;
  /** Prompt Privy to sign an `approve(gameRewards, MAX_UINT)` tx on BlokToken. */
  approve: () => Promise<string>;
  /**
   * Optimistically adjust local balance. Positive for mint, negative for
   * spend. Use right after a tx submits so the UI reflects the intended
   * state before the mint/burn confirms on chain. Also schedules a
   * verification refresh ~1s later to reconcile with on-chain truth.
   */
  addOptimistic: (delta: number) => void;
};

/**
 * Live $BLOK state for the signed-in player. Reads server-side via the
 * /api/balance endpoint (which queries chain) rather than calling RPC from
 * the browser directly — keeps tx-shape + Privy chain config concerns on
 * the server and gives the client one consistent data shape.
 *
 * Auto-refreshes on mount and whenever the connected wallet changes. Call
 * `refresh()` after any action that changes balance/allowance.
 */
export function useBlok(walletAddressProp?: string | null): BlokState & Actions {
  const { wallets } = useWallets();
  const walletAddress = useMemo(
    () => (walletAddressProp ?? null)?.toLowerCase() || null,
    [walletAddressProp]
  );

  const [state, setState] = useState<BlokState>(() => ({
    balance: 0,
    allowance: 0,
    ready: false,
    personalBests: { 0: 0, 1: 0, 2: 0, 3: 0 },
    activeWagerAmount: 0,
    activeWagerMode: 0,
    walletAddress: null,
    approved: false,
    error: null,
  }));

  // Keep the latest wallet address in a ref so stale fetches don't overwrite state.
  const currentWalletRef = useRef<string | null>(walletAddress);
  currentWalletRef.current = walletAddress;

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setState((s) => ({ ...s, ready: true, walletAddress: null, balance: 0 }));
      return;
    }
    try {
      const res = await fetch(`/api/balance?wallet=${walletAddress}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `balance fetch ${res.status}`);
      // Skip stale updates if the wallet changed mid-fetch.
      if (currentWalletRef.current !== walletAddress) return;
      setState({
        balance: Number(data.balance ?? 0),
        allowance: data.allowance === "max" ? "max" : Number(data.allowance ?? 0),
        ready: true,
        personalBests: data.personalBests ?? { 0: 0, 1: 0, 2: 0, 3: 0 },
        activeWagerAmount: Number(data.activeWagerAmount ?? 0),
        activeWagerMode: Number(data.activeWagerMode ?? 0),
        walletAddress,
        approved: data.allowance === "max" || Number(data.allowance) > 0,
        error: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "balance error";
      setState((s) => ({ ...s, ready: true, error: msg }));
    }
  }, [walletAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // One-shot faucet drip: hit /api/faucet-drip whenever we have a fresh
  // wallet. The endpoint is rate-limited + on-chain-balance-gated, so
  // repeat calls are cheap: already-funded wallets get an immediate
  // "skipped" response, rate-limited wallets get a 429. We fire and
  // forget — the response time doesn't gate UX.
  const drippedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!walletAddress) return;
    if (drippedFor.current === walletAddress) return;
    drippedFor.current = walletAddress;
    fetch("/api/faucet-drip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    })
      .then(async (r) => {
        // If we actually got a drip, refresh — the new ETH isn't the same
        // as BLOK but Privy uses the ETH balance for gas estimation.
        const data = await r.json().catch(() => ({}));
        if (r.ok && !data.skipped) {
          // Small delay to let the tx confirm before any downstream Privy
          // action that might estimate gas from an empty wallet.
          await new Promise((res) => setTimeout(res, 300));
        }
      })
      .catch(() => {
        // Non-fatal — player can still manually fund if needed.
      });
  }, [walletAddress]);

  const addOptimistic = useCallback(
    (delta: number) => {
      if (!delta) return;
      setState((s) => ({ ...s, balance: Math.max(0, s.balance + delta) }));
      // Reconcile with on-chain truth shortly. 1.2s gives the tx enough
      // time to land on MegaETH (10ms blocks + RPC propagation).
      setTimeout(() => {
        refresh();
      }, 1200);
    },
    [refresh]
  );

  const approve = useCallback(async (): Promise<string> => {
    if (!walletAddress) throw new Error("no wallet");
    if (!publicConfig.blokAddress || !publicConfig.gameRewardsAddress) {
      throw new Error("contracts not configured");
    }
    const embedded = wallets.find((w) => w.walletClientType === "privy");
    if (!embedded) throw new Error("no embedded wallet — sign in first");

    const provider = await embedded.getEthereumProvider();
    const ethers = new BrowserProvider(provider);
    const signer = await ethers.getSigner();
    const blok = new Contract(publicConfig.blokAddress, BLOK_ABI, signer);
    const tx = await blok.approve(publicConfig.gameRewardsAddress, MaxUint256);
    await tx.wait();
    await refresh();
    return tx.hash as string;
  }, [wallets, walletAddress, refresh]);

  return { ...state, refresh, approve, addOptimistic };
}
