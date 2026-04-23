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
};

function memoryStore(): Store {
  const m: Map<string, number> =
    (globalThis as any).__bbSessions ??
    ((globalThis as any).__bbSessions = new Map<string, number>());
  return {
    async claim(id: string) {
      // GC anything older than 2×TTL
      const cutoff = Date.now() - TTL_SEC * 2 * 1000;
      if (m.size > 5000) for (const [k, t] of m) if (t < cutoff) m.delete(k);
      if (m.has(id)) return false;
      m.set(id, Date.now());
      return true;
    },
  };
}

function kvStore(url: string, token: string): Store {
  // Vercel KV / Upstash REST: POST /pipeline with array of commands, or
  // simple GET/SET style. We use the single-command endpoint.
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
  };
}

function pickStore(): Store {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return kvStore(url, token);
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[session] No KV configured in production — using in-memory store. " +
        "Set KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV or Upstash) to fix."
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
