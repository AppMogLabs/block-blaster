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

  console.log(`Granting mint rights to GameRewards on BLOK…`);
  const blok = await ethers.getContractAt("BlokToken", blokAddr);
  const tx = await blok.setMinter(rewardsAddr);
  await tx.wait();
  console.log(`✔ setMinter tx: ${tx.hash}`);

  console.log(`\nSet GAMEREWARDS_CONTRACT_ADDRESS=${rewardsAddr}`);
  console.log(`Set NEXT_PUBLIC_GAMEREWARDS_CONTRACT_ADDRESS=${rewardsAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
