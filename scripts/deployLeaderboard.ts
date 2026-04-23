import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying Leaderboard as ${deployer.address}`);
  const LB = await ethers.getContractFactory("Leaderboard");
  const lb = await LB.deploy(deployer.address);
  await lb.waitForDeployment();
  const addr = await lb.getAddress();
  console.log(`✔ Leaderboard deployed → ${addr}`);
  console.log(`Set LEADERBOARD_CONTRACT_ADDRESS=${addr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
