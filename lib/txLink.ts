import { publicConfig } from "./config";

/**
 * Build a { label, href } pair suitable for passing as the `link` option on
 * a toast push. Shortens the hash to `0x1234…abcd` so the toast stays
 * compact, and targets the configured MegaETH explorer's /tx/ route.
 * Returns undefined if the hash is missing so callers can spread it into
 * a toast call without conditionals.
 */
export function txLink(hash: string | null | undefined) {
  if (!hash) return undefined;
  const short = `${hash.slice(0, 6)}…${hash.slice(-4)}`;
  return {
    label: `tx ${short}`,
    href: `${publicConfig.megaethExplorer}/tx/${hash}`,
  };
}
