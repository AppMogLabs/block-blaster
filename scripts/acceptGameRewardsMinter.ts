import hre from "hardhat";
const { ethers } = hre;

/**
 * Step 2 of the BlokToken minter handover (post audit fix).
 * Run AFTER scripts/deployGameRewards.ts and AFTER MINTER_DELAY (2 days)
 * has elapsed. Promotes the pending minter (= GameRewards) to active.
 *
 * Reads BLOK_CONTRACT_ADDRESS from env. Reverts with MinterDelayNotMet if
 * called too early; reverts with NoPendingMinter if there is nothing staged.
 */
async function main() {
  const blokAddr = process.env.BLOK_CONTRACT_ADDRESS;
  if (!blokAddr) {
    throw new Error("BLOK_CONTRACT_ADDRESS env var required");
  }

  const blok = await ethers.getContractAt("BlokToken", blokAddr);
  const pendingAddr: string = await blok.pendingMinterAddr();
  const pendingTime: bigint = await blok.pendingMinterTime();
  if (pendingTime === 0n) {
    throw new Error("No pending minter to accept. Run deployGameRewards first.");
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < pendingTime) {
    const wait = pendingTime - now;
    throw new Error(
      `Too early to accept — wait ${wait} more seconds (~${new Date(
        Number(pendingTime) * 1000
      ).toISOString()}).`
    );
  }

  console.log(`Accepting pending minter: ${pendingAddr}`);
  const tx = await blok.acceptMinter();
  await tx.wait();
  console.log(`✔ acceptMinter tx: ${tx.hash}`);

  const minter = await blok.minter();
  console.log(`Active minter is now: ${minter}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
