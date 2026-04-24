/**
 * Shared chain helpers for API routes. Keeps provider/signer/contract
 * creation in one place so we don't re-parse env or re-import ethers
 * across every endpoint. Lazy-initialized so missing env only throws
 * when a route that needs it actually runs (important for CI / local
 * dev without contracts).
 */

import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { getServerConfig } from "./config";
import { BLOK_ABI, LEADERBOARD_ABI, GAMEREWARDS_ABI } from "./contracts";

export type ChainClients = {
  provider: JsonRpcProvider;
  signer: Wallet;
  blok: Contract;
  leaderboard: Contract;
  gameRewards: Contract | null;
};

let _cached: ChainClients | null = null;

/**
 * Build the chain client bundle using the server config. The GameRewards
 * contract is optional — returns null if GAMEREWARDS_CONTRACT_ADDRESS is
 * unset, so routes that don't need it can still work on partial deploys.
 */
export function getChain(): ChainClients {
  if (_cached) return _cached;
  const cfg = getServerConfig();
  const provider = new JsonRpcProvider(cfg.megaethRpcUrl);
  const signer = new Wallet(cfg.backendWalletKey, provider);
  const blok = new Contract(cfg.blokAddress, BLOK_ABI, signer);
  const leaderboard = new Contract(cfg.leaderboardAddress, LEADERBOARD_ABI, signer);
  const gameRewardsAddr = process.env.GAMEREWARDS_CONTRACT_ADDRESS;
  const gameRewards = gameRewardsAddr
    ? new Contract(gameRewardsAddr, GAMEREWARDS_ABI, signer)
    : null;
  _cached = { provider, signer, blok, leaderboard, gameRewards };
  return _cached;
}

/** Test hook to reset cached clients. */
export function __resetChain() {
  _cached = null;
}
