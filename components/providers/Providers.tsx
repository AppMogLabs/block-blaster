"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { publicConfig } from "@/lib/config";
import { ToastProvider } from "@/components/ui/Toast";

/**
 * MegaETH chain descriptor for Privy. Privy uses viem-style chain objects —
 * id, name, rpcUrls, nativeCurrency. Without this the embedded wallet
 * defaults to Ethereum mainnet and any tx the app asks it to sign targets
 * the wrong chain.
 */
const megaEthChain = {
  id: publicConfig.megaethChainId,
  name: publicConfig.megaethChainId === 4326 ? "MegaETH" : "MegaETH Testnet",
  network: "megaeth",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [publicConfig.megaethRpcUrl] },
    public: { http: [publicConfig.megaethRpcUrl] },
  },
  blockExplorers: {
    default: { name: "MegaETH Explorer", url: publicConfig.megaethExplorer },
  },
} as const;

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = publicConfig.privyAppId;

  // Fail-open: if Privy isn't configured, the app still runs in guest-only mode.
  if (!appId) {
    return <ToastProvider>{children}</ToastProvider>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["twitter", "email", "google"],
        appearance: {
          theme: "dark",
          accentColor: "#F786C6",
          logo: undefined,
        },
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
          requireUserPasswordOnCreate: false,
        },
        // Any tx signed via the embedded wallet targets this chain.
        defaultChain: megaEthChain,
        supportedChains: [megaEthChain],
      }}
    >
      <ToastProvider>{children}</ToastProvider>
    </PrivyProvider>
  );
}
