import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

/**
 * H-2 (post-fix): inflated personalBest is no longer permanent.
 *  - recordBank rejects scores > MAX_SCORE (BadScore)
 *  - Owner can call resetPersonalBest as operational recovery
 */
describe("H-2: PB inflation — fix verified", () => {
  const MAX = (1n << 256n) - 1n;

  it("recordBank rejects out-of-bounds scores; owner can reset PB", async () => {
    const [owner, player] = await ethers.getSigners();

    const Blok = await ethers.getContractFactory("BlokToken");
    const blok = await Blok.deploy(owner.address);
    await blok.waitForDeployment();

    const GameRewards = await ethers.getContractFactory("GameRewards");
    const rewards = await GameRewards.deploy(owner.address, await blok.getAddress());
    await rewards.waitForDeployment();

    await blok.proposeMinter(await rewards.getAddress());
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await blok.acceptMinter();

    await blok.mint(player.address, 10_000n);
    await blok.connect(player).approve(await rewards.getAddress(), MAX);

    const mode = 0;

    // ── Guard 1: MAX_UINT256 score rejected ──
    await expect(rewards.recordBank(player.address, mode, MAX))
      .to.be.revertedWithCustomError(rewards, "BadScore");

    // ── Guard 2: anything above MAX_SCORE rejected ──
    const MAX_SCORE = await rewards.MAX_SCORE();
    await expect(rewards.recordBank(player.address, mode, MAX_SCORE + 1n))
      .to.be.revertedWithCustomError(rewards, "BadScore");

    // ── Sanity: scores within bounds still succeed ──
    await rewards.recordBank(player.address, mode, 1234n);
    expect(await rewards.personalBest(player.address, mode)).to.equal(1234n);

    // ── Guard 3: even if PB got inflated some other way, owner can reset ──
    // Simulate by first establishing PB at MAX_SCORE (the ceiling), then resetting.
    await rewards.recordBank(player.address, mode, MAX_SCORE);
    expect(await rewards.personalBest(player.address, mode)).to.equal(MAX_SCORE);
    await expect(rewards.resetPersonalBest(player.address, mode))
      .to.emit(rewards, "PersonalBestReset")
      .withArgs(player.address, mode, MAX_SCORE);
    expect(await rewards.personalBest(player.address, mode)).to.equal(0n);

    // ── Player can wager again after reset (assuming PB seeded normally) ──
    await rewards.recordBank(player.address, mode, 100n);
    await rewards.placeWager(player.address, mode, 50n);
    expect(await rewards.activeWagerAmount(player.address)).to.equal(50n);
  });
});
