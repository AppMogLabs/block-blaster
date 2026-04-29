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
  /** Cumulative kills since last nuke use. Drives the nuke kills gate. */
  NUKE_PROGRESS: "nukeProgress",
  /** Sweep fuel: 0..1. Fires ~6Hz while active or recharging. */
  SWEEP_FUEL: "sweepFuel",
  /** Player committed pending → banked. Game continues. */
  BANK: "bank",
  /**
   * Rare/gold block destroyed. Triggers the coin-scatter animation in
   * React. `x`/`y` are canvas-pixel coords; GameCanvas converts to viewport
   * coords before forwarding to the React callback. `amount` is the
   * multiplied points awarded for that destruction.
   */
  GOLD_AWARD: "goldAward",
} as const;

export type GameEventPayload = {
  score: { score: number; banked: number; pending: number };
  combo: { combo: number; multiplier: number };
  stackHeight: { fraction: number };
  timer: { remainingSec: number };
  gameOver: { score: number; lostPending: number };
  gameWin: { score: number; lostPending: number };
  ready: Record<string, never>;
  streak: { streak: number; heatLevel: 0 | 1 | 2 | 3 | 4 | 5 };
  nukeProgress: { kills: number; threshold: number };
  sweepFuel: { fuel: number; available: boolean };
  bank: { banked: number; justBanked: number };
  goldAward: { x: number; y: number; amount: number };
};
