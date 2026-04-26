"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMemo } from "react";
import { publicConfig } from "@/lib/config";

export type AuthState = {
  isAuthenticated: boolean;
  isLoading: boolean;
  walletAddress: string | null;
  /** X / Twitter handle, when the user signed in via X. Null otherwise. */
  handle: string | null;
  /**
   * Best-effort display label for the current user. Prefers X handle (with
   * leading @), falls back to Google first-name, then email-local-part, then
   * a short wallet snippet. Always non-null when authenticated.
   */
  displayName: string | null;
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
        displayName: null,
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
    const accounts = privy.user?.linkedAccounts ?? [];
    const twitterAccount = accounts.find((a) => a.type === "twitter_oauth") as
      | { username?: string }
      | undefined;
    const googleAccount = accounts.find((a) => a.type === "google_oauth") as
      | { name?: string | null; email?: string }
      | undefined;
    const emailAccount = accounts.find((a) => a.type === "email") as
      | { address?: string }
      | undefined;

    const handle = twitterAccount?.username ?? null;

    // Prefer the most personable identifier available. Trim Google "name" to
    // first word so the button stays compact.
    let displayName: string | null = null;
    if (handle) {
      displayName = `@${handle}`;
    } else if (googleAccount?.name) {
      displayName = googleAccount.name.split(/\s+/)[0] ?? googleAccount.name;
    } else if (googleAccount?.email) {
      displayName = googleAccount.email.split("@")[0] ?? null;
    } else if (emailAccount?.address) {
      displayName = emailAccount.address.split("@")[0] ?? null;
    } else if (wallet) {
      displayName = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
    }

    return {
      isAuthenticated: privy.authenticated,
      isLoading: !privy.ready,
      walletAddress: wallet,
      handle,
      displayName,
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
