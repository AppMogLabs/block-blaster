/**
 * Score drift pinning.
 *
 * Keeps the runtime scoring in `game/scenes/GameScene.ts` in lockstep with the
 * plausibility-ceiling formula in `lib/difficulty.ts`. If you legitimately
 * change scoring, update BOTH files AND the expectations below in the same
 * commit — the test failure is the intended speed bump.
 *
 * This test reads the source files as text and regex-matches the literal
 * values. It does not import them at runtime (GameScene depends on Phaser,
 * which pulls in the browser DOM).
 */

import { expect } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolve relative to the Hardhat project root (which is cwd when tests run).
const ROOT = resolve(process.cwd());

function readSrc(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

/**
 * Port of `maxPlausibleScore` from `lib/difficulty.ts`. Duplicated here
 * (rather than imported) so Hardhat can run this test under Node ESM
 * without resolving `.ts` modules in `lib/`. If you change the formula in
 * `lib/difficulty.ts`, update this copy — the regex assertions below will
 * force you to.
 */
const DIFFICULTY = [
  { id: 0, blocksPerSecond: 1, durationSec: 90 },
  { id: 1, blocksPerSecond: 10, durationSec: 60 },
  { id: 2, blocksPerSecond: 50, durationSec: 45 },
  { id: 3, blocksPerSecond: 100, durationSec: 30 },
] as const;

function maxPlausibleScore(modeId: number, elapsedSec: number): number {
  const mode = DIFFICULTY.find((m) => m.id === modeId);
  if (!mode) throw new Error(`bad mode ${modeId}`);
  const capped = Math.min(elapsedSec, mode.durationSec + 5);
  return Math.ceil(mode.blocksPerSecond * capped * 14.5 * 3 * 1.25);
}

describe("Score drift — GameScene vs difficulty.ts", () => {
  const scene = readSrc("game/scenes/GameScene.ts");
  const difficulty = readSrc("lib/difficulty.ts");

  it("normal block points (10) still match", () => {
    // `const base = b.isRare ? 100 : 10;`
    expect(scene).to.match(/b\.isRare\s*\?\s*100\s*:\s*10/);
  });

  it("rare block ratio (every 20th) still matches", () => {
    // `this.blockNumberCounter % 20 === 0`
    expect(scene).to.match(/blockNumberCounter\s*%\s*20\s*===\s*0/);
  });

  it("streak multiplier bands still match (5→2x, 10→3x)", () => {
    // `this.streak >= 10 ? 3 : this.streak >= 5 ? 2 : 1`
    // appears in scoreDestroyed + emitCombo — use global flag
    const matches = scene.match(
      /this\.streak\s*>=\s*10\s*\?\s*3\s*:\s*this\.streak\s*>=\s*5\s*\?\s*2\s*:\s*1/g
    );
    expect(matches, "multiplier formula missing or drifted").to.not.be.null;
    expect(matches!.length).to.be.greaterThanOrEqual(1);
  });

  it("plausibility formula constants match the expected values", () => {
    // If these change, the drift test needs an update alongside the formula.
    // Slack was raised from 1.05 → 1.25 when bombs/nuke/sweep landed, to
    // reflect sustained-3x becoming measurably more achievable.
    expect(difficulty).to.match(/avgPointsPerBlock\s*=\s*14\.5/);
    expect(difficulty).to.match(/peakComboMultiplier\s*=\s*3/);
    expect(difficulty).to.match(/slack\s*=\s*1\.25/);
  });

  it("avgPointsPerBlock is consistent with 1/20 rare ratio", () => {
    // E[pts/block] = 0.95 * 10 + 0.05 * 100 = 14.5
    const rareRatio = 1 / 20;
    const normal = 10;
    const rare = 100;
    const expectedAvg = (1 - rareRatio) * normal + rareRatio * rare;
    expect(expectedAvg).to.equal(14.5);
  });

  it("maxPlausibleScore stays tight against a known cheat", () => {
    // Easy (mode 0): 1 block/sec, 90s → 90 blocks. Ceiling with 3x + 5% slack
    //   ≈ ceil(1 × 90 × 14.5 × 3 × 1.05) = 4 111
    // A score of 50 000 after 30 s is clearly impossible.
    expect(maxPlausibleScore(0, 30)).to.be.lessThan(2000);
    // A score equal to the run's 45-s legitimate peak is allowed.
    expect(maxPlausibleScore(0, 45)).to.be.greaterThan(2000);
  });

  it("impossible-score check clamps at durationSec + buffer", () => {
    // Even if the client lies and reports a huge elapsedSec, the ceiling caps
    // at (durationSec + 5) seconds — otherwise a stalled client could always
    // beat the bound. Easy mode: durationSec = 90, so the cap is at 95s.
    const atCap = maxPlausibleScore(0, 95);
    const wayOver = maxPlausibleScore(0, 10_000);
    expect(wayOver).to.equal(atCap);
    // And the cap is strictly > the un-capped-durationSec value
    expect(atCap).to.be.greaterThan(maxPlausibleScore(0, 90));
  });
});
