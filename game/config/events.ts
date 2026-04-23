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
} as const;

export type GameEventPayload = {
  score: { score: number };
  combo: { combo: number; multiplier: number };
  stackHeight: { fraction: number };
  timer: { remainingSec: number };
  gameOver: { score: number };
  gameWin: { score: number };
  ready: {};
};
