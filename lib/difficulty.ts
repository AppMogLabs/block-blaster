/**
 * Canonical difficulty definitions. Used by the client game, the session API,
 * and the score plausibility check. If you change values here, the anti-cheat
 * upper bound updates automatically — do NOT hardcode these elsewhere.
 */

export const DIFFICULTY_MODES = [
  { id: 0, key: "easy", label: "Easy", blocksPerSecond: 1, durationSec: 90, accent: "#90D79F", tagline: "1 in 100 blocks descends" },
  { id: 1, key: "medium", label: "Medium", blocksPerSecond: 5, durationSec: 60, accent: "#7EAAD4", tagline: "1 in 20 blocks descends" },
  { id: 2, key: "hard", label: "Hard", blocksPerSecond: 15, durationSec: 45, accent: "#F786C6", tagline: "Roughly 1 in 7 blocks descends" },
  { id: 3, key: "realtime", label: "Real-time", blocksPerSecond: 100, durationSec: 30, accent: "#FF8AA8", tagline: "Every block. Good luck." },
] as const;

export type DifficultyId = 0 | 1 | 2 | 3;

export function getDifficulty(id: number) {
  const d = DIFFICULTY_MODES.find((m) => m.id === id);
  if (!d) throw new Error(`Unknown difficulty mode: ${id}`);
  return d;
}

/**
 * Upper bound on a plausible score for a given (mode, elapsedSec).
 *
 * Assumptions:
 * - max 1 destroyed block per spawn (aggregate — bombs can clear many blocks
 *   per input, but the blocks they destroy are still blocks that were spawned,
 *   so the per-block score ceiling still applies)
 * - base 10 pts, rare blocks at 1/20 ratio @ 100 pts  → avg ≈ 14.5 pts/block
 * - 3x streak multiplier as the theoretical peak sustained over a full run
 * - Slack bumped to 1.25 to accommodate the new mechanics (bomb AOE + sweep
 *   beam + streak-to-25 trajectory make sustained-3x measurably more
 *   achievable than in v1). Nukes do NOT score, so they don't factor in.
 *
 * Total ≈ blocksPerSec × elapsed × 14.5 × 3 × 1.25
 */
export function maxPlausibleScore(modeId: number, elapsedSec: number): number {
  const mode = getDifficulty(modeId);
  const capped = Math.min(elapsedSec, mode.durationSec + 5);
  const avgPointsPerBlock = 14.5;
  const peakComboMultiplier = 3;
  const slack = 1.25;
  return Math.ceil(
    mode.blocksPerSecond * capped * avgPointsPerBlock * peakComboMultiplier * slack
  );
}
