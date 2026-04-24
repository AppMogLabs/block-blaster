"use client";

import { usePrivy } from "@privy-io/react-auth";

/**
 * Opens Privy's secure export flow so the user can copy the private key
 * of their embedded wallet. Privy serves the modal from a separate origin
 * (not the dApp's) and masks the key until the user explicitly reveals it.
 *
 * Privy allows key export by default — there's no dashboard toggle. The
 * only way to block it is to configure a 2-of-2 key quorum, which we're
 * not doing. This button just surfaces the flow so users don't have to
 * know about the Privy API to self-custody.
 *
 * Safe to render whenever the player is authenticated. `exportWallet()`
 * returns early if the SDK isn't ready; we also disable the button in
 * that state so there's no visual confusion.
 */
export function ExportWalletButton({ className }: { className?: string }) {
  let ready = false;
  let authenticated = false;
  let exportWallet: (() => Promise<void>) | null = null;
  try {
    const privy = usePrivy();
    ready = privy.ready;
    authenticated = privy.authenticated;
    exportWallet = privy.exportWallet;
  } catch {
    // Privy provider not mounted (e.g., guest-only build). Render nothing.
    return null;
  }

  if (!authenticated) return null;

  const onClick = async () => {
    try {
      await exportWallet?.();
    } catch {
      /* user-cancelled or Privy popup blocked — no-op */
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={!ready}
      className={
        className ??
        "mono text-xs text-moon-white/50 hover:text-moon-white underline decoration-dotted decoration-moon-white/20 hover:decoration-moon-white/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      }
      title="View and copy your embedded wallet's private key via Privy's secure export flow"
    >
      Export wallet key
    </button>
  );
}
