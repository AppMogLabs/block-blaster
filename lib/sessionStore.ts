/**
 * Session-ID single-use store.
 *
 * Production (Vercel): set KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV or
 * Upstash Redis — the REST API is compatible). The store uses `SET … NX EX`
 * for atomic claim-once semantics.
 *
 * Dev: if neither env var is set, we fall back to an in-memory `Map` stashed
 * on `globalThis` so hot-reloads don't lose state. A single serverless node
 * can cheat this across cold starts — that's fine for local testing, NOT for
 * production traffic.
 */

const TTL_SEC = 20 * 60; // 2× session lifetime — plenty of room for slow clients

type Store = {
  /** Atomically claim `sessionId`. Returns true if this call won the race. */
  claim(sessionId: string): Promise<boolean>;
  /**
   * Atomically increment the cumulative minted total for a session. Used by
   * the bank API so multiple banks per run can't exceed the plausibility
   * ceiling for the total elapsed time. Returns the NEW cumulative total.
   */
  addMinted(sessionId: string, delta: number): Promise<number>;
  /** Read the current cumulative minted total. Zero if unseen. */
  getMinted(sessionId: string): Promise<number>;
};

function memoryStore(): Store {
  const m: Map<string, number> =
    (globalThis as { __bbSessions?: Map<string, number> }).__bbSessions ??
    ((globalThis as { __bbSessions?: Map<string, number> }).__bbSessions =
      new Map<string, number>());
  const minted: Map<string, number> =
    (globalThis as { __bbMinted?: Map<string, number> }).__bbMinted ??
    ((globalThis as { __bbMinted?: Map<string, number> }).__bbMinted =
      new Map<string, number>());
  return {
    async claim(id: string) {
      // GC anything older than 2×TTL
      const cutoff = Date.now() - TTL_SEC * 2 * 1000;
      if (m.size > 5000) for (const [k, t] of m) if (t < cutoff) m.delete(k);
      if (m.has(id)) return false;
      m.set(id, Date.now());
      return true;
    },
    async addMinted(id: string, delta: number) {
      const next = (minted.get(id) ?? 0) + delta;
      minted.set(id, next);
      return next;
    },
    async getMinted(id: string) {
      return minted.get(id) ?? 0;
    },
  };
}

function kvStore(url: string, token: string): Store {
  // Vercel KV / Upstash REST: POST /pipeline with array of commands, or
  // simple GET/SET style. We use the single-command endpoint.
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  return {
    async claim(id: string) {
      const key = `bb:sess:${id}`;
      const resp = await fetch(`${url}/set/${encodeURIComponent(key)}/1?nx=true&ex=${TTL_SEC}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!resp.ok) {
        // On KV failure, refuse to claim — safer than allowing replays.
        console.error("[session] KV claim failed", resp.status);
        return false;
      }
      const data = (await resp.json()) as { result: string | null };
      // Upstash returns { result: "OK" } on successful NX set, { result: null } when key exists.
      return data.result === "OK";
    },
    async addMinted(id: string, delta: number) {
      const key = `bb:mint:${id}`;
      // INCRBY + EXPIRE in a pipeline. EXPIRE NX only sets TTL on first INCR.
      const resp = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify([
          ["INCRBY", key, String(Math.trunc(delta))],
          ["EXPIRE", key, String(TTL_SEC), "NX"],
        ]),
      });
      if (!resp.ok) {
        console.error("[session] KV addMinted failed", resp.status);
        // Fail-closed: return Infinity so the caller's ceiling check rejects.
        return Number.POSITIVE_INFINITY;
      }
      const data = (await resp.json()) as Array<{ result: number | string | null }>;
      return Number(data[0]?.result ?? 0);
    },
    async getMinted(id: string) {
      const key = `bb:mint:${id}`;
      const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!resp.ok) return 0;
      const data = (await resp.json()) as { result: string | null };
      return Number(data.result ?? 0);
    },
  };
}

function pickStore(): Store {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return kvStore(url, token);
  // Hard fail in production. Without KV the in-memory Map is per-instance,
  // which means a session token can be replayed across Vercel serverless
  // instances and the single-use guarantee collapses → double-mint
  // exposure. Crashing here is loud but safe; an empty memory store
  // silently fooling production is the failure mode we want to prevent.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "sessionStore: KV not configured in production. Set KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV or Upstash) before deploying."
    );
  }
  return memoryStore();
}

let _store: Store | null = null;
export function sessionStore(): Store {
  return (_store ??= pickStore());
}

/** Test hook — resets the singleton so unit tests can swap implementations. */
export function __resetSessionStore() {
  _store = null;
}
