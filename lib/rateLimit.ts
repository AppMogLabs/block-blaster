/**
 * Wallet-keyed fixed-window rate limiter.
 *
 * Backend: same Upstash / Vercel KV REST endpoint as `sessionStore.ts`.
 * Uses INCR + EXPIRE under the hood (fixed window, cheap, good enough for
 * abuse prevention — not a token bucket, not precise under heavy contention).
 *
 * Dev fallback: in-memory Map. A single serverless cold start wipes it, so
 * production without KV set is trivially bypassable — `pickLimiter()` logs
 * a warning in that case.
 */

import { logger } from "./logger";

const log = logger("rateLimit");

export type RateLimit = {
  /** Returns `{ ok: true }` if the caller is within the limit; `{ ok: false, retryAfterSec }` otherwise. */
  check(key: string): Promise<{ ok: true } | { ok: false; retryAfterSec: number }>;
};

type MemEntry = { count: number; windowStart: number };

function memoryLimiter(limit: number, windowSec: number): RateLimit {
  const m: Map<string, MemEntry> =
    (globalThis as { __bbRateLimit?: Map<string, MemEntry> }).__bbRateLimit ??
    ((globalThis as { __bbRateLimit?: Map<string, MemEntry> }).__bbRateLimit =
      new Map());
  return {
    async check(key: string) {
      const now = Date.now();
      const existing = m.get(key);
      if (!existing || now - existing.windowStart >= windowSec * 1000) {
        m.set(key, { count: 1, windowStart: now });
        return { ok: true };
      }
      if (existing.count >= limit) {
        const retryAfterSec = Math.ceil(
          (existing.windowStart + windowSec * 1000 - now) / 1000
        );
        return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
      }
      existing.count += 1;
      return { ok: true };
    },
  };
}

function kvLimiter(
  url: string,
  token: string,
  limit: number,
  windowSec: number
): RateLimit {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  return {
    async check(key: string) {
      const k = `bb:rl:${key}`;
      try {
        // Upstash REST pipeline: [INCR key, EXPIRE key windowSec NX]
        // Returns [incrResult, expireResult] — if INCR returns 1, we just created it, so EXPIRE sets TTL.
        const resp = await fetch(`${url}/pipeline`, {
          method: "POST",
          headers,
          cache: "no-store",
          body: JSON.stringify([
            ["INCR", k],
            ["EXPIRE", k, String(windowSec), "NX"],
          ]),
        });
        if (!resp.ok) {
          log.error("kv_fetch_failed", { status: resp.status });
          // Fail-open: don't block legitimate users when KV is down.
          return { ok: true };
        }
        const data = (await resp.json()) as Array<{ result: number | string | null }>;
        const count = Number(data[0]?.result ?? 0);
        if (count > limit) {
          // Read TTL to tell the client when to retry.
          const ttlResp = await fetch(`${url}/ttl/${encodeURIComponent(k)}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          let retryAfterSec = windowSec;
          if (ttlResp.ok) {
            const ttlData = (await ttlResp.json()) as { result: number };
            if (typeof ttlData.result === "number" && ttlData.result > 0) {
              retryAfterSec = ttlData.result;
            }
          }
          return { ok: false, retryAfterSec };
        }
        return { ok: true };
      } catch (e) {
        log.error("kv_exception", { error: e instanceof Error ? e.message : "unknown" });
        return { ok: true };
      }
    },
  };
}

export function createRateLimit(opts: { limit: number; windowSec: number }): RateLimit {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return kvLimiter(url, token, opts.limit, opts.windowSec);
  if (process.env.NODE_ENV === "production") {
    log.warn("no_kv_in_prod", {
      hint: "Set KV_REST_API_URL + KV_REST_API_TOKEN to enable distributed rate limiting.",
    });
  }
  return memoryLimiter(opts.limit, opts.windowSec);
}

/** Pre-configured limiters for the endpoints that need them. */
let _sessionLimit: RateLimit | null = null;
let _mintLimit: RateLimit | null = null;
let _wagerLimit: RateLimit | null = null;
let _faucetLimit: RateLimit | null = null;

export function sessionRateLimit(): RateLimit {
  return (_sessionLimit ??= createRateLimit({ limit: 12, windowSec: 60 }));
}

/**
 * Covers the hot in-game spend path (bank / nuke / sweep-reload / game-end).
 * Raised from 10/min to 30/min because a single active run can legitimately
 * fire: ~5 banks + 1-2 nukes + a reload or two + game-end. 10 was blocking
 * players mid-minute on reasonable activity.
 */
export function mintRateLimit(): RateLimit {
  return (_mintLimit ??= createRateLimit({ limit: 30, windowSec: 60 }));
}

/**
 * Wagers happen pre-game, at most a few times per minute even with
 * aggressive retry. Separate limiter so a player mid-run who hits the
 * in-game cap doesn't then fail their next wager.
 */
export function wagerRateLimit(): RateLimit {
  return (_wagerLimit ??= createRateLimit({ limit: 6, windowSec: 60 }));
}

/**
 * Faucet drip — 1 successful drip per wallet per 24 hours. The drip
 * endpoint itself ALSO checks the wallet's on-chain balance and skips if
 * already funded, so this rate-limit only needs to prevent rapid repeat
 * drip attempts for abusive signups.
 */
export function faucetRateLimit(): RateLimit {
  return (_faucetLimit ??= createRateLimit({ limit: 1, windowSec: 24 * 60 * 60 }));
}

/** Test hook. */
export function __resetRateLimits() {
  _sessionLimit = null;
  _mintLimit = null;
  _wagerLimit = null;
  _faucetLimit = null;
}
