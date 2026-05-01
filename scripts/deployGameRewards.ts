import hre from "hardhat";
const { ethers } = hre;

/**
 * Deploy GameRewards and wire it into the existing BlokToken as the
 * secondary minter.
 *
 * Reads BLOK_CONTRACT_ADDRESS from the env — expects the new BlokToken
 * (post ERC20Burnable redeploy) to already be at that address.
 */
async function main() {
  const blokAddr = process.env.BLOK_CONTRACT_ADDRESS;
  if (!blokAddr) {
    throw new Error("BLOK_CONTRACT_ADDRESS env var required");
  }

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying GameRewards as ${deployer.address}`);
  console.log(`  BLOK: ${blokAddr}`);

  const GR = await ethers.getContractFactory("GameRewards");
  const rewards = await GR.deploy(deployer.address, blokAddr);
  await rewards.waitForDeployment();
  const rewardsAddr = await rewards.getAddress();
  console.log(`✔ GameRewards deployed → ${rewardsAddr}`);

  // 2-step minter handover (post audit fix). proposeMinter stages the
  // address; after MINTER_DELAY (2 days) the deployer must run acceptMinter.
  console.log(`Proposing GameRewards as the BLOK minter…`);
  const blok = await ethers.getContractAt("BlokToken", blokAddr);
  const tx = await blok.proposeMinter(rewardsAddr);
  await tx.wait();
  console.log(`✔ proposeMinter tx: ${tx.hash}`);

  const delay = await blok.MINTER_DELAY();
  const acceptableAt = new Date(Date.now() + Number(delay) * 1000);
  console.log(
    `\n⚠ MINTER NOT YET ACTIVE.` +
      `\n  Wait ${delay} seconds (~${acceptableAt.toISOString()}), then run:` +
      `\n    npx hardhat run scripts/acceptGameRewardsMinter.ts --network <net>`
  );

  console.log(`\nSet GAMEREWARDS_CONTRACT_ADDRESS=${rewardsAddr}`);
  console.log(`Set NEXT_PUBLIC_GAMEREWARDS_CONTRACT_ADDRESS=${rewardsAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
