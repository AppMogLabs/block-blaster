import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

/**
 * CH-5 (post-fix): the previous "single-key compromise drains, mints, and
 * seals atomically" attack is now bounded by:
 *   - SPEND_COOLDOWN gate per player (one spend per cooldown window)
 *   - 2-step proposeMinter+acceptMinter with 2-day delay (no instant mint hijack)
 *   - renounceOwnership reverts on GameRewards & Leaderboard
 * The compromise still hurts in the long run (the trust model is unchanged),
 * but the SINGLE-BLOCK destructive payload is no longer possible.
 */
describe("CH-5: compromise destructive payload — fix verified", () => {
  const MAX = (1n << 256n) - 1n;

  it("instant drain blocked by cooldown; instant mint blocked by delay; renounce blocked", async () => {
    const [owner, playerA, playerB, attacker] = await ethers.getSigners();

    const Blok = await ethers.getContractFactory("BlokToken");
    const blok = await Blok.deploy(owner.address);
    await blok.waitForDeployment();

    const GameRewards = await ethers.getContractFactory("GameRewards");
    const rewards = await GameRewards.deploy(owner.address, await blok.getAddress());
    await rewards.waitForDeployment();

    const Leaderboard = await ethers.getContractFactory("Leaderboard");
    const leaderboard = await Leaderboard.deploy(owner.address);
    await leaderboard.waitForDeployment();

    // 2-step minter handover — legitimate setup.
    await blok.proposeMinter(await rewards.getAddress());
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await blok.acceptMinter();

    await blok.mint(playerA.address, 5_000n);
    await blok.mint(playerB.address, 5_000n);
    await blok.connect(playerA).approve(await rewards.getAddress(), MAX);
    await blok.connect(playerB).approve(await rewards.getAddress(), MAX);

    await rewards.recordBank(playerA.address, 0, 1000n);
    await rewards.placeWager(playerA.address, 0, 500n);

    // ── Guard 1: spendNuke records lastSpendTime and exposes SpendTooFast error ──
    // (SPEND_COOLDOWN behavior is exercised in detail by the dedicated foundry
    //  test test-foundry/H4_OwnerDrain.t.sol; here we only assert the gate exists.)
    await rewards.spendNuke(playerA.address);
    expect(await rewards.lastSpendTime(playerA.address)).to.be.gt(0n);
    expect(await rewards.SPEND_COOLDOWN()).to.equal(1n);
    // The error symbol must exist in the ABI.
    expect(rewards.interface.fragments.some((f: any) =>
      f.type === "error" && f.name === "SpendTooFast"
    )).to.equal(true);

    // ── Guard 2: instant mint hijack blocked — proposeMinter + delay required ──
    await blok.connect(owner).proposeMinter(attacker.address);
    // Attacker tries to mint immediately — fails because acceptMinter has not been called.
    await expect(blok.connect(attacker).mint(attacker.address, 10n ** 30n))
      .to.be.revertedWithCustomError(blok, "BlokUnauthorized");
    // Even owner can't accept yet — must wait MINTER_DELAY.
    await expect(blok.acceptMinter())
      .to.be.revertedWithCustomError(blok, "MinterDelayNotMet");

    // ── Guard 3: renounceOwnership reverts on both contracts ──
    await expect(rewards.connect(owner).renounceOwnership())
      .to.be.revertedWithCustomError(rewards, "RenounceDisabled");
    await expect(leaderboard.connect(owner).renounceOwnership())
      .to.be.revertedWithCustomError(leaderboard, "RenounceDisabled");
    expect(await rewards.owner()).to.equal(owner.address);
    expect(await leaderboard.owner()).to.equal(owner.address);

    // ── Aggregate: player escrow recoverable post-attack via emergencyCancelWager ──
    const balBefore = await blok.balanceOf(playerA.address);
    await rewards.connect(playerA).emergencyCancelWager();
    expect(await blok.balanceOf(playerA.address)).to.equal(balBefore + 500n);
  });
});
