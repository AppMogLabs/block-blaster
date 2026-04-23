/**
 * Mainnet pre-launch verification. Runs against MegaETH mainnet (or testnet)
 * using BACKEND_WALLET_PRIVATE_KEY. Five checks:
 *   1. $BLOK contract exists and returns symbol() = "BLOK"
 *   2. Leaderboard contract exists and getTopScores(0) is callable
 *   3. Backend wallet is the owner of both
 *   4. Test mint of 1 $BLOK to a disposable test address succeeds
 *   5. Test submitScore to leaderboard succeeds (mode 0, tiny score to avoid top-100 pollution)
 *
 * Exits 0 on all pass, 1 otherwise.
 */
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });
dotenvConfig();

// ABI fragments duplicated from lib/contracts.ts. Inlined here so this script
// can run under Node ESM without extension-resolution plumbing.
const BLOK_ABI = [
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
const LEADERBOARD_ABI = [
  "function submitScore(address player, uint256 score, uint8 mode) external",
  "function getTopScores(uint8 mode) view returns (tuple(address player, uint256 score, uint256 timestamp, uint8 difficultyMode)[100])",
  "function filled(uint8 mode) view returns (uint8)",
];
const OWNABLE_ABI = ["function owner() view returns (address)"];

async function main() {
  const rpc = process.env.MEGAETH_RPC_URL;
  const key = process.env.BACKEND_WALLET_PRIVATE_KEY;
  const blokAddr = process.env.BLOK_CONTRACT_ADDRESS;
  const lbAddr = process.env.LEADERBOARD_CONTRACT_ADDRESS;
  if (!rpc || !key || !blokAddr || !lbAddr) {
    console.error("Missing env: MEGAETH_RPC_URL, BACKEND_WALLET_PRIVATE_KEY, BLOK_CONTRACT_ADDRESS, LEADERBOARD_CONTRACT_ADDRESS");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(rpc);
  const signer = new Wallet(key, provider);
  const blok = new Contract(blokAddr, [...BLOK_ABI, ...OWNABLE_ABI], signer);
  const lb = new Contract(lbAddr, [...LEADERBOARD_ABI, ...OWNABLE_ABI], signer);

  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const test = (name: string, ok: boolean, detail: string) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "✔" : "✘"} ${name}  ${detail}`);
  };

  try {
    const sym = await blok.symbol();
    test("BLOK.symbol() === BLOK", sym === "BLOK", `got ${sym}`);
  } catch (e) {
    test("BLOK.symbol()", false, String(e));
  }

  try {
    const top = await lb.getTopScores(0);
    test("Leaderboard.getTopScores(0)", Array.isArray(top), `array length ${top.length}`);
  } catch (e) {
    test("Leaderboard.getTopScores", false, String(e));
  }

  try {
    const blokOwner = await blok.owner();
    const lbOwner = await lb.owner();
    const match =
      blokOwner.toLowerCase() === signer.address.toLowerCase() &&
      lbOwner.toLowerCase() === signer.address.toLowerCase();
    test("backend signer is owner of both contracts", match, `blok=${blokOwner} lb=${lbOwner}`);
  } catch (e) {
    test("owner check", false, String(e));
  }

  // Use a deterministic burn-style test address that will never appear in top 100
  const testAddr = "0x000000000000000000000000000000000000dEaD";
  try {
    const before = await blok.balanceOf(testAddr);
    const tx = await blok.mint(testAddr, 1);
    await tx.wait();
    const after = await blok.balanceOf(testAddr);
    test("test mint of 1 BLOK", after === before + 1n, `${before} → ${after}`);
  } catch (e) {
    test("test mint", false, String(e));
  }

  try {
    const tx = await lb.submitScore(testAddr, 1, 0);
    await tx.wait();
    test("test leaderboard submit", true, `tx ${tx.hash}`);
  } catch (e) {
    test("test leaderboard submit", false, String(e));
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed. Ready for launch.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
