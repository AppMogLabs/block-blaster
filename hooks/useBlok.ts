"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSendTransaction, useWallets } from "@privy-io/react-auth";
import { Interface, MaxUint256 } from "ethers";
import { publicConfig } from "@/lib/config";
import { BLOK_ABI } from "@/lib/contracts";

export type WalletWarmupState = "pending" | "ready" | "failed";

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
  /**
   * Embedded-wallet warm-up state. For X login the wallet is connected by
   * the time the user lands on the home screen. For Email/Google the wallet
   * is created lazily and `useWallets()` returns it before it's actually
   * ready to sign. We proactively wait for `isConnected()` and switch the
   * chain so the first signing call (approve) doesn't hang on Privy's
   * "connect" modal. UI gates the Approve button on `walletWarmup === "ready"`.
   */
  walletWarmup: WalletWarmupState;
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
  // Privy-native tx send. Handles embedded-wallet provisioning (lazy for
  // social logins like Google/Email), opens Privy's confirm UI, and waits
  // for the receipt — avoids the "User exited before wallet could be
  // connected" failure mode when going through ethers BrowserProvider on a
  // not-yet-warmed wallet.
  const { sendTransaction } = useSendTransaction();
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
    walletWarmup: "pending",
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
      setState((prev) => ({
        balance: Number(data.balance ?? 0),
        allowance: data.allowance === "max" ? "max" : Number(data.allowance ?? 0),
        ready: true,
        personalBests: data.personalBests ?? { 0: 0, 1: 0, 2: 0, 3: 0 },
        activeWagerAmount: Number(data.activeWagerAmount ?? 0),
        activeWagerMode: Number(data.activeWagerMode ?? 0),
        walletAddress,
        approved: data.allowance === "max" || Number(data.allowance) > 0,
        // Preserve warm-up state — it's tracked by a separate effect.
        walletWarmup: prev.walletWarmup,
        error: null,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "balance error";
      setState((s) => ({ ...s, ready: true, error: msg }));
    }
  }, [walletAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Embedded-wallet warm-up: drive the wallet to a fully-signable state
  // BEFORE the user is offered any signing UI. Without this, Email/Google
  // sessions return a wallet object from useWallets() that is "present"
  // but not yet connected — calling sendTransaction on it makes Privy open
  // a connect-wallet modal that can hang on mobile. After this effect
  // resolves to "ready", the approve button can fire reliably.
  useEffect(() => {
    if (!walletAddress) {
      setState((s) => ({ ...s, walletWarmup: "pending" }));
      return;
    }
    const embedded = wallets.find((w) => w.walletClientType === "privy");
    if (!embedded) {
      // Wallet object hasn't appeared yet — Privy may still be provisioning.
      // Stay "pending"; this effect re-runs as `wallets` updates.
      setState((s) => ({ ...s, walletWarmup: "pending" }));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const connected = await Promise.race([
          embedded.isConnected(),
          new Promise<boolean>((res) => setTimeout(() => res(false), 12_000)),
        ]);
        if (cancelled) return;
        if (!connected) {
          setState((s) => ({ ...s, walletWarmup: "failed" }));
          return;
        }
        // Best-effort chain switch — bound at 5s. The 1.92 Privy SDK
        // returns immediately for already-correct chains, so this is fast
        // on the warm path.
        try {
          await Promise.race([
            embedded.switchChain(publicConfig.megaethChainId),
            new Promise<void>((res) => setTimeout(res, 5_000)),
          ]);
        } catch {
          // Non-fatal — we'll fail loudly in approve() if the chain truly
          // isn't reachable.
        }
        if (cancelled) return;
        setState((s) => ({ ...s, walletWarmup: "ready" }));
      } catch {
        if (cancelled) return;
        setState((s) => ({ ...s, walletWarmup: "failed" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallets, walletAddress]);

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

    // Pre-flight: the warm-up effect above already ran isConnected +
    // switchChain. If something went wrong we surface a clear error here
    // rather than letting Privy's provider open a "connect wallet" modal
    // that could hang. Belt-and-suspenders: also probe isConnected one
    // more time with a short timeout in case the wallet just provisioned.
    if (state.walletWarmup === "failed") {
      throw new Error(
        "wallet not ready — refresh the page or sign out and back in"
      );
    }
    if (state.walletWarmup !== "ready") {
      const connected = await Promise.race([
        embedded.isConnected(),
        new Promise<boolean>((res) => setTimeout(() => res(false), 4000)),
      ]);
      if (!connected) {
        throw new Error(
          "wallet still provisioning — wait a moment and try again"
        );
      }
    }

    const iface = new Interface(BLOK_ABI);
    const data = iface.encodeFunctionData("approve", [
      publicConfig.gameRewardsAddress,
      MaxUint256,
    ]) as `0x${string}`;

    // Hard timeout on the actual signing call. If Privy's modal never
    // surfaces (mobile popup blocker, hung provisioning) we fail fast
    // with an actionable error instead of spinning forever.
    const receipt = (await Promise.race([
      sendTransaction(
        {
          to: publicConfig.blokAddress as `0x${string}`,
          data,
          chainId: publicConfig.megaethChainId,
        },
        {
          header: "Approve $BLOK spending",
          description:
            "One-time approval so Block Blaster can spend your $BLOK on Nuke, Sweep reload, and wagers.",
          buttonText: "Approve",
        }
      ),
      new Promise<never>((_, rej) =>
        setTimeout(
          () =>
            rej(
              new Error(
                "approve timed out — check the wallet popup, or skip approve and play normally"
              )
            ),
          45_000
        )
      ),
    ])) as { transactionHash: string };
    await refresh();
    return receipt.transactionHash;
  }, [wallets, walletAddress, refresh, sendTransaction, state.walletWarmup]);

  return { ...state, refresh, approve, addOptimistic };
}
