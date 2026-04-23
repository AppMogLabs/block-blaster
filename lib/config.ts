/**
 * Validated runtime configuration.
 *
 * - Server-only values throw at import time when missing (on the server).
 * - Client-safe values (NEXT_PUBLIC_*) are exposed via publicConfig.
 *
 * Next.js bundles modules that use only NEXT_PUBLIC_* vars for the client
 * without leaking server-only values. Keep the `serverConfig` export guarded
 * by `typeof window` checks to avoid accidental client import.
 */

type ConfigError = { name: string; hint?: string };

function required(name: string, hint?: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    const err = new Error(
      `Missing environment variable: ${name}${hint ? ` — ${hint}` : ""}. ` +
        `Copy .env.local.example to .env.local and fill in the required values.`
    );
    (err as Error & { code?: string }).code = "ENV_MISSING";
    throw err;
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/**
 * IMPORTANT: `process.env.NEXT_PUBLIC_*` must be referenced *directly* here.
 * Next.js inlines these at build time via webpack's DefinePlugin, but only
 * for literal accesses — a computed/helper indirection like
 * `process.env[name]` defeats the replacement and yields undefined in the
 * client bundle.
 */
export const publicConfig = {
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
  megaethRpcUrl:
    process.env.NEXT_PUBLIC_MEGAETH_RPC_URL ?? "https://carrot.megaeth.com/rpc",
  megaethChainId: Number(process.env.NEXT_PUBLIC_MEGAETH_CHAIN_ID ?? "6343"),
  megaethExplorer:
    process.env.NEXT_PUBLIC_MEGAETH_EXPLORER ??
    "https://megaeth-testnet-v2.blockscout.com",
  blokAddress: process.env.NEXT_PUBLIC_BLOK_CONTRACT_ADDRESS ?? "",
  leaderboardAddress:
    process.env.NEXT_PUBLIC_LEADERBOARD_CONTRACT_ADDRESS ?? "",
};

/**
 * Server-only config. Importing this from a client component is a build error
 * only at runtime — never re-export its values from a "use client" module.
 */
export function getServerConfig() {
  const errors: ConfigError[] = [];
  const get = (name: string, hint?: string) => {
    const v = process.env[name];
    if (!v) errors.push({ name, hint });
    return v ?? "";
  };

  const cfg = {
    privyAppId: get("NEXT_PUBLIC_PRIVY_APP_ID"),
    // PRIVY_APP_SECRET is optional — only needed for server-side Privy ops
    // (verifying auth tokens, user lookups). Block Blaster doesn't call those.
    privyAppSecret: process.env.PRIVY_APP_SECRET ?? "",
    megaethRpcUrl: get("MEGAETH_RPC_URL", "MegaETH RPC endpoint"),
    backendWalletKey: get(
      "BACKEND_WALLET_PRIVATE_KEY",
      "signer that owns BLOK + Leaderboard"
    ),
    blokAddress: get("BLOK_CONTRACT_ADDRESS"),
    leaderboardAddress: get("LEADERBOARD_CONTRACT_ADDRESS"),
    sessionSecret: get("SESSION_SECRET", "openssl rand -hex 32"),
  };

  if (errors.length > 0) {
    const list = errors.map((e) => `  • ${e.name}${e.hint ? ` (${e.hint})` : ""}`).join("\n");
    throw new Error(
      `Server config is incomplete. Missing variables:\n${list}\n\n` +
        `Copy .env.local.example → .env.local and fill in the required values.`
    );
  }

  return cfg;
}

export type ServerConfig = ReturnType<typeof getServerConfig>;
export { required as requireEnv };
