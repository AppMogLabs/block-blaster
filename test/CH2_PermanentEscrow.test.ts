import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

/**
 * CH-2 (post-fix): the previous attack — "rotate minter to 0 + renounce
 * GameRewards.owner() to permanently strand escrow" — is now blocked by:
 *   - BlokToken.proposeMinter rejects address(0) (ZeroMinter)
 *   - GameRewards.renounceOwnership reverts (RenounceDisabled)
 *   - Player can self-rescue via emergencyCancelWager()
 *
 * This test asserts each of those three guards fires.
 */
describe("CH-2 Permanent Escrow — fix verified", () => {
  const MAX = (1n << 256n) - 1n;

  it("renounceOwnership reverts; proposeMinter(0) reverts; player can self-rescue escrow", async () => {
    const [owner, player] = await ethers.getSigners();

    const Blok = await ethers.getContractFactory("BlokToken");
    const blok = await Blok.deploy(owner.address);
    await blok.waitForDeployment();

    const GameRewards = await ethers.getContractFactory("GameRewards");
    const rewards = await GameRewards.deploy(owner.address, await blok.getAddress());
    await rewards.waitForDeployment();

    // 2-step minter handover.
    await blok.proposeMinter(await rewards.getAddress());
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await blok.acceptMinter();

    await blok.mint(player.address, 10_000n);
    await blok.connect(player).approve(await rewards.getAddress(), MAX);

    // Establish PB and place wager.
    await rewards.recordBank(player.address, 0, 100n);
    await rewards.placeWager(player.address, 0, 500n);
    expect(await blok.balanceOf(await rewards.getAddress())).to.equal(500n);

    // ── Guard 1: proposeMinter(0) rejected ──
    await expect(blok.proposeMinter(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(blok, "ZeroMinter");

    // ── Guard 2: GameRewards.renounceOwnership reverts ──
    await expect(rewards.renounceOwnership())
      .to.be.revertedWithCustomError(rewards, "RenounceDisabled");
    expect(await rewards.owner()).to.equal(owner.address);

    // ── Guard 3: even if backend goes silent, player self-rescues escrow ──
    const balBefore = await blok.balanceOf(player.address);
    await rewards.connect(player).emergencyCancelWager();
    expect(await blok.balanceOf(player.address)).to.equal(balBefore + 500n);
    expect(await blok.balanceOf(await rewards.getAddress())).to.equal(0n);
    const [wAmt] = await rewards.activeWager(player.address);
    expect(wAmt).to.equal(0n);

    // ── Leaderboard same protection ──
    const Lb = await ethers.getContractFactory("Leaderboard");
    const lb = await Lb.deploy(owner.address);
    await lb.waitForDeployment();
    await expect(lb.renounceOwnership())
      .to.be.revertedWithCustomError(lb, "RenounceDisabled");
  });
});
