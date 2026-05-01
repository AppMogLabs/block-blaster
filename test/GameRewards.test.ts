import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

/**
 * GameRewards covers the onchain mechanics layer: BLOK spends (nuke,
 * sweep reload), wager lock/settle, and personal-best storage.
 *
 * The contract is owner-only — only the backend wallet calls it — but
 * it reads allowances/balances from the player's address. Setup below
 * mirrors production: deploy BLOK, deploy GameRewards, grant minter, and
 * have each test player approve GameRewards to spend their BLOK.
 */

describe("GameRewards", () => {
  const MAX = (1n << 256n) - 1n;

  async function setup() {
    const [owner, player, other] = await ethers.getSigners();
    const Blok = await ethers.getContractFactory("BlokToken");
    const blok = await Blok.deploy(owner.address);
    await blok.waitForDeployment();

    const GameRewards = await ethers.getContractFactory("GameRewards");
    const rewards = await GameRewards.deploy(owner.address, await blok.getAddress());
    await rewards.waitForDeployment();

    // Grant GameRewards the mint slot — it needs this to pay wager bonuses.
    // 2-step minter handover: propose, wait MINTER_DELAY, accept.
    await blok.proposeMinter(await rewards.getAddress());
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await blok.acceptMinter();

    // Give the test player a generous starting balance.
    await blok.mint(player.address, 10_000n);
    // Player approves GameRewards to spend their BLOK (the one-time approval
    // the frontend prompts via Privy).
    await blok.connect(player).approve(await rewards.getAddress(), MAX);

    return { owner, player, other, blok, rewards };
  }

  // ─── Spend: nuke ─────────────────────────────────────────────────────

  describe("spendNuke", () => {
    it("burns 100 BLOK from the player", async () => {
      const { player, blok, rewards } = await setup();
      const before = await blok.balanceOf(player.address);
      const supplyBefore = await blok.totalSupply();
      await rewards.spendNuke(player.address);
      expect(await blok.balanceOf(player.address)).to.equal(before - 100n);
      expect(await blok.totalSupply()).to.equal(supplyBefore - 100n);
    });

    it("emits NukeSpent", async () => {
      const { player, rewards } = await setup();
      await expect(rewards.spendNuke(player.address))
        .to.emit(rewards, "NukeSpent")
        .withArgs(player.address, 100n);
    });

    it("reverts when player balance is insufficient", async () => {
      const { owner, blok, rewards } = await setup();
      // Fresh account with no balance
      const broke = (await ethers.getSigners())[5];
      await blok.connect(broke).approve(await rewards.getAddress(), MAX);
      await expect(rewards.spendNuke(broke.address)).to.be.reverted;
      void owner;
    });

    it("reverts when not approved", async () => {
      const { owner, blok, rewards } = await setup();
      const unauthed = (await ethers.getSigners())[5];
      await blok.mint(unauthed.address, 500n);
      await expect(rewards.spendNuke(unauthed.address)).to.be.reverted;
      void owner;
    });

    it("non-owner cannot call spendNuke", async () => {
      const { player, other, rewards } = await setup();
      await expect(
        rewards.connect(other).spendNuke(player.address)
      ).to.be.revertedWithCustomError(rewards, "OwnableUnauthorizedAccount");
    });

    it("rejects zero-address player", async () => {
      const { rewards } = await setup();
      await expect(rewards.spendNuke(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        rewards,
        "ZeroPlayer"
      );
    });
  });

  // ─── Spend: sweep reload ─────────────────────────────────────────────

  describe("spendSweepReload", () => {
    it("burns 25 BLOK from the player", async () => {
      const { player, blok, rewards } = await setup();
      const before = await blok.balanceOf(player.address);
      await rewards.spendSweepReload(player.address);
      expect(await blok.balanceOf(player.address)).to.equal(before - 25n);
    });

    it("emits SweepReloadSpent", async () => {
      const { player, rewards } = await setup();
      await expect(rewards.spendSweepReload(player.address))
        .to.emit(rewards, "SweepReloadSpent")
        .withArgs(player.address, 25n);
    });
  });

  // ─── Wagers: place ───────────────────────────────────────────────────

  describe("placeWager", () => {
    it("requires a valid tier (50/100/200/500)", async () => {
      const { player, rewards } = await setup();
      // seed a PB so placeWager doesn't fail on the PB gate
      await rewards.recordBank(player.address, 0, 1000);
      for (const bad of [0, 1, 49, 51, 99, 499, 1000]) {
        await expect(rewards.placeWager(player.address, 0, bad))
          .to.be.revertedWithCustomError(rewards, "BadTier");
      }
    });

    it("requires an existing personal best", async () => {
      const { player, rewards } = await setup();
      await expect(rewards.placeWager(player.address, 0, 100))
        .to.be.revertedWithCustomError(rewards, "NoPersonalBest");
    });

    it("locks wager into the contract on success", async () => {
      const { player, blok, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 500);
      const before = await blok.balanceOf(player.address);
      await rewards.placeWager(player.address, 0, 100);
      expect(await blok.balanceOf(player.address)).to.equal(before - 100n);
      expect(await blok.balanceOf(await rewards.getAddress())).to.equal(100n);
      expect(await rewards.activeWagerAmount(player.address)).to.equal(100n);
      expect(await rewards.activeWagerMode(player.address)).to.equal(0);
    });

    it("rejects a second wager while one is active", async () => {
      const { player, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 500);
      await rewards.placeWager(player.address, 0, 100);
      await expect(rewards.placeWager(player.address, 0, 50))
        .to.be.revertedWithCustomError(rewards, "WagerActive");
    });

    it("rejects invalid mode", async () => {
      const { player, rewards } = await setup();
      await expect(rewards.placeWager(player.address, 4, 100))
        .to.be.revertedWithCustomError(rewards, "BadMode");
    });

    it("emits WagerPlaced", async () => {
      const { player, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 500);
      await expect(rewards.placeWager(player.address, 0, 200))
        .to.emit(rewards, "WagerPlaced")
        .withArgs(player.address, 0, 200n);
    });
  });

  // ─── Bank: wager settlement ──────────────────────────────────────────

  describe("recordBank — wager settlement", () => {
    it("returns wager + mints matching bonus on a PB-beat", async () => {
      const { player, blok, rewards } = await setup();
      // establish PB 500, then wager 100 on mode 0
      await rewards.recordBank(player.address, 0, 500);
      const afterPB = await blok.balanceOf(player.address);
      await rewards.placeWager(player.address, 0, 100);
      expect(await blok.balanceOf(player.address)).to.equal(afterPB - 100n);

      // Bank a 700 run — beats old PB of 500 → win
      await rewards.recordBank(player.address, 0, 700);

      // Wager returned (100) + matching bonus minted (100) = net +100 vs post-placeWager
      expect(await blok.balanceOf(player.address)).to.equal(afterPB - 100n + 100n + 100n);
      expect(await rewards.activeWagerAmount(player.address)).to.equal(0n);
      expect(await rewards.personalBest(player.address, 0)).to.equal(700n);
    });

    it("burns the wager on a non-beat", async () => {
      const { player, blok, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 500);
      const before = await blok.balanceOf(player.address);
      const supplyBefore = await blok.totalSupply();

      await rewards.placeWager(player.address, 0, 100);
      // Bank a 400 run — didn't beat PB of 500 → burn wager
      await rewards.recordBank(player.address, 0, 400);

      expect(await blok.balanceOf(player.address)).to.equal(before - 100n);
      expect(await blok.totalSupply()).to.equal(supplyBefore - 100n);
      expect(await rewards.personalBest(player.address, 0)).to.equal(500n); // unchanged
    });

    it("burns the wager on a tie (must strictly exceed PB)", async () => {
      const { player, blok, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 500);
      await rewards.placeWager(player.address, 0, 50);
      const before = await blok.balanceOf(player.address);

      await rewards.recordBank(player.address, 0, 500); // tie → lose
      expect(await blok.balanceOf(player.address)).to.equal(before - 0n); // wager already taken
      expect(await rewards.personalBest(player.address, 0)).to.equal(500n);
    });

    it("emits WagerWon on a beat", async () => {
      const { player, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 100);
      await rewards.placeWager(player.address, 0, 100);
      await expect(rewards.recordBank(player.address, 0, 500))
        .to.emit(rewards, "WagerWon")
        .withArgs(player.address, 0, 100n, 500n);
    });

    it("emits WagerLost on a miss", async () => {
      const { player, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 500);
      await rewards.placeWager(player.address, 0, 100);
      await expect(rewards.recordBank(player.address, 0, 300))
        .to.emit(rewards, "WagerLost")
        .withArgs(player.address, 0, 100n, 300n);
    });

    it("updates PB even without a wager", async () => {
      const { player, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 100);
      expect(await rewards.personalBest(player.address, 0)).to.equal(100n);
      await rewards.recordBank(player.address, 0, 350);
      expect(await rewards.personalBest(player.address, 0)).to.equal(350n);
      await rewards.recordBank(player.address, 0, 200);
      expect(await rewards.personalBest(player.address, 0)).to.equal(350n);
    });

    it("rejects bank when wager mode doesn't match bank mode", async () => {
      const { player, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 500);
      await rewards.recordBank(player.address, 1, 500);
      await rewards.placeWager(player.address, 0, 100);
      await expect(rewards.recordBank(player.address, 1, 1000))
        .to.be.revertedWithCustomError(rewards, "WagerModeMismatch");
    });
  });

  // ─── Death: wager burns ──────────────────────────────────────────────

  describe("recordDeath", () => {
    it("burns any active wager", async () => {
      const { player, blok, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 500);
      await rewards.placeWager(player.address, 0, 200);
      const supplyBefore = await blok.totalSupply();

      await rewards.recordDeath(player.address);

      expect(await rewards.activeWagerAmount(player.address)).to.equal(0n);
      expect(await blok.balanceOf(await rewards.getAddress())).to.equal(0n);
      expect(await blok.totalSupply()).to.equal(supplyBefore - 200n);
    });

    it("is a no-op when no active wager", async () => {
      const { player, blok, rewards } = await setup();
      const supplyBefore = await blok.totalSupply();
      await rewards.recordDeath(player.address);
      expect(await blok.totalSupply()).to.equal(supplyBefore);
    });

    it("does NOT update PB on death", async () => {
      const { player, rewards } = await setup();
      await rewards.recordBank(player.address, 0, 200);
      await rewards.recordDeath(player.address); // no wager, no effect
      expect(await rewards.personalBest(player.address, 0)).to.equal(200n);
    });
  });

  // ─── Views / housekeeping ────────────────────────────────────────────

  describe("misc", () => {
    it("activeWager returns 0/0 when none", async () => {
      const { player, rewards } = await setup();
      const [amt, mode] = await rewards.activeWager(player.address);
      expect(amt).to.equal(0n);
      expect(mode).to.equal(0);
    });

    it("constants match spec", async () => {
      const { rewards } = await setup();
      expect(await rewards.NUKE_COST()).to.equal(100n);
      expect(await rewards.SWEEP_RELOAD_COST()).to.equal(25n);
      expect(await rewards.MODES()).to.equal(4);
    });

    it("rejects deploy with zero BLOK address", async () => {
      const [owner] = await ethers.getSigners();
      const GR = await ethers.getContractFactory("GameRewards");
      await expect(GR.deploy(owner.address, ethers.ZeroAddress)).to.be.reverted;
    });
  });
});

describe("BlokToken — burn + minter slot", () => {
  async function setup() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Blok = await ethers.getContractFactory("BlokToken");
    const blok = await Blok.deploy(owner.address);
    await blok.waitForDeployment();
    await blok.mint(alice.address, 1000n);
    return { owner, alice, bob, blok };
  }

  it("burn(amount) reduces caller balance + total supply", async () => {
    const { alice, blok } = await setup();
    const supplyBefore = await blok.totalSupply();
    await blok.connect(alice).burn(100n);
    expect(await blok.balanceOf(alice.address)).to.equal(900n);
    expect(await blok.totalSupply()).to.equal(supplyBefore - 100n);
  });

  it("burnFrom requires allowance", async () => {
    const { alice, bob, blok } = await setup();
    await expect(blok.connect(bob).burnFrom(alice.address, 50n)).to.be.reverted;
    await blok.connect(alice).approve(bob.address, 100n);
    await blok.connect(bob).burnFrom(alice.address, 50n);
    expect(await blok.balanceOf(alice.address)).to.equal(950n);
  });

  it("proposeMinter+acceptMinter grants mint rights after MINTER_DELAY", async () => {
    const { owner, alice, bob, blok } = await setup();
    await expect(blok.connect(bob).mint(alice.address, 1n)).to.be.revertedWithCustomError(
      blok,
      "BlokUnauthorized"
    );
    // Propose, then jump past the cooldown, then accept.
    await blok.proposeMinter(bob.address);
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await blok.acceptMinter();
    await blok.connect(bob).mint(alice.address, 500n);
    expect(await blok.balanceOf(alice.address)).to.equal(1500n);
    // Owner still mints
    await blok.connect(owner).mint(alice.address, 10n);
    expect(await blok.balanceOf(alice.address)).to.equal(1510n);
  });

  it("acceptMinter emits MinterUpdated; proposeMinter emits MinterProposed", async () => {
    const { bob, blok } = await setup();
    await expect(blok.proposeMinter(bob.address)).to.emit(blok, "MinterProposed");
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    // Setup() already accepted the rewards minter, so previous = rewards address.
    await expect(blok.acceptMinter())
      .to.emit(blok, "MinterUpdated")
      .withArgs((await blok.minter()), bob.address);
  });

  it("proposeMinter rejects address(0)", async () => {
    const { blok } = await setup();
    await expect(blok.proposeMinter(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      blok,
      "ZeroMinter"
    );
  });

  it("acceptMinter reverts before delay elapses", async () => {
    const { bob, blok } = await setup();
    await blok.proposeMinter(bob.address);
    await expect(blok.acceptMinter()).to.be.revertedWithCustomError(
      blok,
      "MinterDelayNotMet"
    );
  });

  it("renounceOwnership reverts (would brick minting)", async () => {
    const { blok } = await setup();
    await expect(blok.renounceOwnership()).to.be.revertedWithCustomError(
      blok,
      "BlokUnauthorized"
    );
  });
});
