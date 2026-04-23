/**
 * Tiny structured logger. Emits one JSON line per log, suitable for Vercel's
 * log drain, Datadog, or any tail-based collector. No external dependencies.
 *
 * Use in API routes:
 *
 *   const log = logger("mint");
 *   log.info("mint_ok", { wallet, score, txHash });
 *   log.error("mint_failed", { wallet, error: msg });
 */

type Level = "debug" | "info" | "warn" | "error";

type Fields = Record<string, unknown>;

function emit(level: Level, route: string, event: string, fields: Fields = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    route,
    event,
    ...fields,
  };
  const serialized = JSON.stringify(line, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v
  );
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(serialized);
  } else if (level === "warn") {
    // eslint-disable-next-line no-console
    console.warn(serialized);
  } else {
    // eslint-disable-next-line no-console
    console.log(serialized);
  }
}

export function logger(route: string) {
  return {
    debug: (event: string, fields?: Fields) => emit("debug", route, event, fields),
    info: (event: string, fields?: Fields) => emit("info", route, event, fields),
    warn: (event: string, fields?: Fields) => emit("warn", route, event, fields),
    error: (event: string, fields?: Fields) => emit("error", route, event, fields),
  };
}

/** Truncate wallet to 0xabcd…1234 for log readability without losing identity. */
export function shortWallet(addr: string | undefined): string {
  if (!addr || addr.length < 10) return addr ?? "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
