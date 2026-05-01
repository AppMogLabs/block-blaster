import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

/**
 * Edge-case tests for Leaderboard beyond the happy path in Leaderboard.test.ts.
 *
 * Focus areas:
 *  - Mode isolation (one mode's top 100 cannot bleed into another)
 *  - Tie handling (equal scores: later submission stays behind earlier per
 *    strict `>` bubble-up — verify that's the actual behavior)
 *  - Zero-address rejection
 *  - Zero-score acceptance (score == 0 is a valid entry, just ranks last)
 *  - filled() accessor correctness across modes
 *  - TOP_N displacement chain (filling 100, then inserting a middle-ranked score)
 */

describe("Leaderboard — edge cases", () => {
  async function deploy() {
    const [owner, alice, bob, carol] = await ethers.getSigners();
    const LB = await ethers.getContractFactory("Leaderboard");
    const lb = await LB.deploy(owner.address);
    await lb.waitForDeployment();
    return { lb, owner, alice, bob, carol };
  }

  it("zero address rejected", async () => {
    const { lb } = await deploy();
    await expect(
      lb.submitScore(ethers.ZeroAddress, 100, 0)
    ).to.be.revertedWith("Leaderboard: zero player");
  });

  it("zero score accepted and ranked last among equal scores", async () => {
    const { lb, alice, bob } = await deploy();
    await lb.submitScore(alice.address, 5, 0);
    await lb.submitScore(bob.address, 0, 0);
    const top = await lb.getTopScores(0);
    expect(top[0].player).to.equal(alice.address);
    expect(top[1].player).to.equal(bob.address);
    expect(top[1].score).to.equal(0n);
  });

  it("modes are isolated — writing mode 0 does not touch mode 1", async () => {
    const { lb, alice, bob } = await deploy();
    await lb.submitScore(alice.address, 500, 0);
    await lb.submitScore(bob.address, 100, 1);

    const mode0 = await lb.getTopScores(0);
    const mode1 = await lb.getTopScores(1);

    expect(mode0[0].player).to.equal(alice.address);
    expect(mode0[0].score).to.equal(500n);
    expect(mode0[1].score).to.equal(0n); // slot unfilled

    expect(mode1[0].player).to.equal(bob.address);
    expect(mode1[0].score).to.equal(100n);

    expect(await lb.filled(0)).to.equal(1);
    expect(await lb.filled(1)).to.equal(1);
    expect(await lb.filled(2)).to.equal(0);
    expect(await lb.filled(3)).to.equal(0);
  });

  it("equal scores: bubble-up uses strict > so earlier entry keeps higher rank", async () => {
    const { lb, alice, bob } = await deploy();
    await lb.submitScore(alice.address, 100, 0);
    await lb.submitScore(bob.address, 100, 0);
    const top = await lb.getTopScores(0);
    // The bubble uses `board[i].score > board[i-1].score` — NOT >=, so a tie
    // does NOT displace the earlier entry. Alice wins the tie.
    expect(top[0].player).to.equal(alice.address);
    expect(top[1].player).to.equal(bob.address);
  });

  it("full board — middle-ranked insertion displaces tail only, not head", async () => {
    const { lb, alice, bob } = await deploy();
    // Fill mode 0 with scores 1..100. After bubble-up, board is descending:
    // [100, 99, ..., 51, 50, 49, ..., 2, 1] at indices 0..99.
    for (let s = 1; s <= 100; s++) {
      await lb.submitScore(alice.address, s, 0);
    }
    const before = await lb.getTopScores(0);
    expect(before[0].score).to.equal(100n);
    expect(before[50].score).to.equal(50n);
    expect(before[99].score).to.equal(1n);

    // Insert bob's score of 50. Since the bubble uses strict `>`, bob
    // does NOT displace alice's earlier 50 — he lands just below it at
    // index 51, pushing alice's 49..2 down by one slot and evicting 1.
    await lb.submitScore(bob.address, 50, 0);
    const after = await lb.getTopScores(0);

    expect(after[0].score).to.equal(100n); // head untouched
    expect(after[50].player).to.equal(alice.address); // alice's 50 keeps rank
    expect(after[50].score).to.equal(50n);
    expect(after[51].player).to.equal(bob.address); // bob right below
    expect(after[51].score).to.equal(50n);
    expect(after[99].score).to.equal(2n); // alice's 1 got evicted
  });

  it("equal-to-tail score does NOT displace", async () => {
    const { lb, alice, bob } = await deploy();
    for (let s = 10; s <= 109; s++) await lb.submitScore(alice.address, s, 0);
    // Tail is 10. Submit 10 — should be ignored (score <= tail).
    await expect(lb.submitScore(bob.address, 10, 0)).to.not.emit(
      lb,
      "NewHighScore"
    );
    const top = await lb.getTopScores(0);
    expect(top[99].score).to.equal(10n);
    expect(top[99].player).to.equal(alice.address);
  });

  it("mode == MODES (4) reverts", async () => {
    const { lb, alice } = await deploy();
    await expect(lb.submitScore(alice.address, 1, 4)).to.be.revertedWith(
      "Leaderboard: bad mode"
    );
  });

  it("getTopScores reverts on invalid mode", async () => {
    const { lb } = await deploy();
    await expect(lb.getTopScores(99)).to.be.revertedWith("Leaderboard: bad mode");
  });

  it("filled reverts on invalid mode", async () => {
    const { lb } = await deploy();
    await expect(lb.filled(99)).to.be.revertedWith("Leaderboard: bad mode");
  });

  it("NewHighScore emitted with correct mode parameter", async () => {
    const { lb, alice } = await deploy();
    await expect(lb.submitScore(alice.address, 250, 2))
      .to.emit(lb, "NewHighScore")
      .withArgs(alice.address, 2, 250n);
  });

  it("timestamp recorded at block.timestamp", async () => {
    const { lb, alice } = await deploy();
    const tx = await lb.submitScore(alice.address, 42, 0);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);
    const top = await lb.getTopScores(0);
    expect(top[0].timestamp).to.equal(BigInt(block!.timestamp));
  });
});

describe("BlokToken — edge cases", () => {
  async function deploy() {
    const [owner, alice] = await ethers.getSigners();
    const Blok = await ethers.getContractFactory("BlokToken");
    const blok = await Blok.deploy(owner.address);
    await blok.waitForDeployment();
    return { blok, owner, alice };
  }

  it("name and symbol match spec", async () => {
    const { blok } = await deploy();
    expect(await blok.name()).to.equal("Block Blaster Token");
    expect(await blok.symbol()).to.equal("BLOK");
  });

  it("minting 0 is a no-op that still emits Transfer", async () => {
    const { blok, alice } = await deploy();
    await expect(blok.mint(alice.address, 0n))
      .to.emit(blok, "Transfer")
      .withArgs(ethers.ZeroAddress, alice.address, 0n);
    expect(await blok.balanceOf(alice.address)).to.equal(0n);
  });

  it("minting to zero address reverts via OZ 5.x ERC20InvalidReceiver", async () => {
    const { blok } = await deploy();
    await expect(
      blok.mint(ethers.ZeroAddress, 1n)
    ).to.be.revertedWithCustomError(blok, "ERC20InvalidReceiver");
  });

  it("totalSupply tracks mints", async () => {
    const { blok, alice } = await deploy();
    expect(await blok.totalSupply()).to.equal(0n);
    await blok.mint(alice.address, 100n);
    await blok.mint(alice.address, 50n);
    expect(await blok.totalSupply()).to.equal(150n);
  });

  it("ownership transfer works and new owner can mint", async () => {
    const { blok, owner, alice } = await deploy();
    await blok.transferOwnership(alice.address);
    expect(await blok.owner()).to.equal(alice.address);
    await expect(blok.mint(alice.address, 1n)).to.be.revertedWithCustomError(
      blok,
      "BlokUnauthorized"
    );
    await blok.connect(alice).mint(alice.address, 1n);
    expect(await blok.balanceOf(alice.address)).to.equal(1n);
  });
});
