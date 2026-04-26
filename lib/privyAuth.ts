import { PrivyClient } from "@privy-io/server-auth";
import { getServerConfig } from "./config";
import { logger } from "./logger";

const log = logger("privy-auth");

/**
 * Server-side Privy authentication helper. Verifies a Privy identity token
 * (passed by the client as `Authorization: Bearer <token>`) and returns the
 * authenticated user's embedded wallet address.
 *
 * Identity tokens are JWTs signed by Privy (ES256). They embed `linked_accounts`
 * directly in the payload, so verification is purely cryptographic — no
 * round-trip to Privy's API. We use ID tokens rather than access tokens for
 * exactly this reason.
 *
 * Endpoints that perform privileged on-behalf-of-user actions (faucet-drip,
 * forfeit, etc.) MUST call this and check the claimed wallet matches the
 * walletAddress in the request body. Without this any attacker can drain the
 * backend wallet by submitting random 0x… addresses.
 */

let _client: PrivyClient | null = null;
function client(): PrivyClient {
  if (_client) return _client;
  const cfg = getServerConfig();
  if (!cfg.privyAppSecret) {
    throw new Error("PRIVY_APP_SECRET not configured");
  }
  _client = new PrivyClient(cfg.privyAppId, cfg.privyAppSecret);
  return _client;
}

export type PrivyAuth = {
  /** Privy user ID (DID-style identifier). */
  userId: string;
  /** The user's embedded wallet address (lower-cased), or null if none. */
  walletAddress: string | null;
};

/**
 * Verify the `Authorization: Bearer <idToken>` header on a request and
 * return the authenticated user's wallet address. Returns null if the
 * header is missing, the token is invalid, or verification fails.
 */
export async function verifyRequest(
  req: Request
): Promise<PrivyAuth | null> {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;
  try {
    const user = await client().getUserFromIdToken(token);
    const walletAddress = user.wallet?.address?.toLowerCase() ?? null;
    return { userId: user.id, walletAddress };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "verification failed";
    log.warn("token_invalid", { error: msg });
    return null;
  }
}
