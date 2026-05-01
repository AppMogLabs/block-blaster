import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("Leaderboard", () => {
  async function deploy() {
    const [owner, alice, bob] = await ethers.getSigners();
    const LB = await ethers.getContractFactory("Leaderboard");
    const lb = await LB.deploy(owner.address);
    await lb.waitForDeployment();
    return { lb, owner, alice, bob };
  }

  it("rejects out-of-range mode", async () => {
    const { lb, alice } = await deploy();
    await expect(lb.submitScore(alice.address, 10, 99)).to.be.revertedWith(
      "Leaderboard: bad mode"
    );
  });

  it("records scores sorted descending", async () => {
    const { lb, alice, bob } = await deploy();
    await lb.submitScore(alice.address, 100, 0);
    await lb.submitScore(bob.address, 250, 0);
    const top = await lb.getTopScores(0);
    expect(top[0].player).to.equal(bob.address);
    expect(top[0].score).to.equal(250n);
    expect(top[1].player).to.equal(alice.address);
    expect(top[1].score).to.equal(100n);
  });

  it("emits NewHighScore on first entry", async () => {
    const { lb, alice } = await deploy();
    await expect(lb.submitScore(alice.address, 50, 1))
      .to.emit(lb, "NewHighScore")
      .withArgs(alice.address, 1, 50n);
  });

  it("non-owner rejected", async () => {
    const { lb, alice } = await deploy();
    await expect(lb.connect(alice).submitScore(alice.address, 1, 0)).to.be.revertedWithCustomError(
      lb,
      "OwnableUnauthorizedAccount"
    );
  });

  it("101st score displaces lowest when greater", async () => {
    const { lb, alice, bob } = await deploy();
    // Fill with scores 1..100 (all from alice for simplicity)
    for (let s = 1; s <= 100; s++) {
      await lb.submitScore(alice.address, s, 0);
    }
    expect(await lb.filled(0)).to.equal(100);
    const before = await lb.getTopScores(0);
    expect(before[0].score).to.equal(100n);
    expect(before[99].score).to.equal(1n);

    // Submit a score that beats the lowest
    await lb.submitScore(bob.address, 500, 0);
    const after = await lb.getTopScores(0);
    expect(after[0].score).to.equal(500n);
    expect(after[0].player).to.equal(bob.address);
    expect(after[99].score).to.equal(2n); // 1 got displaced
  });

  it("101st score does nothing when below lowest", async () => {
    const { lb, alice, bob } = await deploy();
    for (let s = 50; s < 150; s++) await lb.submitScore(alice.address, s, 0);
    const before = await lb.getTopScores(0);
    await expect(lb.submitScore(bob.address, 10, 0)).to.not.emit(lb, "NewHighScore");
    const after = await lb.getTopScores(0);
    expect(after[99].score).to.equal(before[99].score);
  });
});
