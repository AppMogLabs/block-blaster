"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { publicConfig } from "@/lib/config";

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = publicConfig.privyAppId;

  // Fail-open: if Privy isn't configured, the app still runs in guest-only mode.
  if (!appId) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["twitter"],
        appearance: {
          theme: "dark",
          accentColor: "#F786C6",
          logo: undefined,
        },
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
          requireUserPasswordOnCreate: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
