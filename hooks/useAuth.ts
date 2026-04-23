"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMemo } from "react";
import { publicConfig } from "@/lib/config";

export type AuthState = {
  isAuthenticated: boolean;
  isLoading: boolean;
  walletAddress: string | null;
  handle: string | null;
  login: () => void;
  logout: () => void;
  /** True when Privy is wired up (NEXT_PUBLIC_PRIVY_APP_ID present). */
  privyEnabled: boolean;
};

/**
 * Unified auth hook. Always calls `usePrivy()` — the Providers tree conditionally
 * renders the PrivyProvider, so when Privy isn't configured `usePrivy` returns
 * a default unauthenticated state from the library. If the library itself
 * throws when un-provisioned, we catch that via the try/catch wrapper.
 */
export function useAuth(): AuthState {
  const privyEnabled = Boolean(publicConfig.privyAppId);
  // Call the hook unconditionally (Rules of Hooks).
  // When the provider isn't mounted, `privy.ready` is false and all values
  // are safe defaults.
  const privy = usePrivySafe();

  return useMemo<AuthState>(() => {
    if (!privyEnabled || !privy) {
      return {
        isAuthenticated: false,
        isLoading: false,
        walletAddress: null,
        handle: null,
        login: () => {
          // eslint-disable-next-line no-alert
          alert("Privy not configured. Set NEXT_PUBLIC_PRIVY_APP_ID to enable sign-in.");
        },
        logout: () => {},
        privyEnabled,
      };
    }

    const wallet =
      privy.user?.wallet?.address ??
      privy.user?.linkedAccounts?.find((a) => a.type === "wallet")?.address ??
      null;
    const twitterAccount = privy.user?.linkedAccounts?.find(
      (a) => a.type === "twitter_oauth"
    );
    const handle =
      (twitterAccount as unknown as { username?: string })?.username ?? null;

    return {
      isAuthenticated: privy.authenticated,
      isLoading: !privy.ready,
      walletAddress: wallet,
      handle,
      login: privy.login,
      logout: privy.logout,
      privyEnabled,
    };
  }, [privy, privyEnabled]);
}

/**
 * `usePrivy()` throws when called outside a PrivyProvider. The provider tree
 * renders without one when `NEXT_PUBLIC_PRIVY_APP_ID` is missing, so guard the
 * call. We return `null` in that case — the caller's useMemo selects the
 * guest-mode shape.
 */
function usePrivySafe(): ReturnType<typeof usePrivy> | null {
  try {
    return usePrivy();
  } catch {
    return null;
  }
}
