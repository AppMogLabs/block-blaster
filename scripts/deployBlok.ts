import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying BlokToken as ${deployer.address}`);
  const Blok = await ethers.getContractFactory("BlokToken");
  const blok = await Blok.deploy(deployer.address);
  await blok.waitForDeployment();
  const addr = await blok.getAddress();
  console.log(`✔ BlokToken deployed → ${addr}`);
  console.log(`Set BLOK_CONTRACT_ADDRESS=${addr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
