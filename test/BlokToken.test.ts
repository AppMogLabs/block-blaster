import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("BlokToken", () => {
  async function deploy() {
    const [owner, alice] = await ethers.getSigners();
    const Blok = await ethers.getContractFactory("BlokToken");
    const blok = await Blok.deploy(owner.address);
    await blok.waitForDeployment();
    return { blok, owner, alice };
  }

  it("decimals is zero", async () => {
    const { blok } = await deploy();
    expect(await blok.decimals()).to.equal(0);
  });

  it("owner can mint", async () => {
    const { blok, alice } = await deploy();
    await blok.mint(alice.address, 42n);
    expect(await blok.balanceOf(alice.address)).to.equal(42n);
  });

  it("non-owner / non-minter cannot mint", async () => {
    const { blok, alice } = await deploy();
    // BlokToken v2 added a `minter` slot alongside owner, with a unified
    // `onlyMinter` modifier that reverts with BlokUnauthorized.
    await expect(blok.connect(alice).mint(alice.address, 1n)).to.be.revertedWithCustomError(
      blok,
      "BlokUnauthorized"
    );
  });

  it("emits Transfer from zero on mint", async () => {
    const { blok, owner, alice } = await deploy();
    await expect(blok.mint(alice.address, 7n))
      .to.emit(blok, "Transfer")
      .withArgs(ethers.ZeroAddress, alice.address, 7n);
  });
});
