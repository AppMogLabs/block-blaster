/**
 * Game-scene events that bubble out to React via an EventEmitter.
 */
export const GAME_EVENTS = {
  SCORE: "score",
  COMBO: "combo",
  STACK_HEIGHT: "stackHeight",
  TIMER: "timer",
  GAME_OVER: "gameOver",
  GAME_WIN: "gameWin",
  READY: "ready",
  /** Streak + heat level (0-5). Fires on every streak change. */
  STREAK: "streak",
  /** Player has a nuke banked. Fires once when charged, once when used. */
  NUKE: "nuke",
  /** Sweep fuel: 0..1. Fires ~6Hz while active or recharging. */
  SWEEP_FUEL: "sweepFuel",
} as const;

export type GameEventPayload = {
  score: { score: number };
  combo: { combo: number; multiplier: number };
  stackHeight: { fraction: number };
  timer: { remainingSec: number };
  gameOver: { score: number };
  gameWin: { score: number };
  ready: Record<string, never>;
  streak: { streak: number; heatLevel: 0 | 1 | 2 | 3 | 4 | 5 };
  nuke: { charged: boolean };
  sweepFuel: { fuel: number; available: boolean };
};
