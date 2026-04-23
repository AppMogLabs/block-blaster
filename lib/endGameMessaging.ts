/**
 * End-of-round phrasing. Ported in spirit from PhotoBlitz's
 * `EndGameMessaging.swift` — the same "contextual nudge" shape but adapted
 * to Block Blaster (no power-ups, no campaign, just score + combo + mode).
 *
 * Usage:
 *   const msg = pickWinPhrase({ score, combo, modeId });
 *   <div>{msg.title}</div>
 *   <div>{msg.sub}</div>
 */

import { DIFFICULTY_MODES } from "./difficulty";

export type EndGameContext = {
  score: number;
  combo: number; // peak combo reached
  modeId: number;
};

type Phrase = { title: string; sub: string };

// ──────────────────────────────────────────────────────────────────────────
// Survived
// ──────────────────────────────────────────────────────────────────────────

export function pickWinPhrase(ctx: EndGameContext): Phrase {
  const mode = DIFFICULTY_MODES.find((m) => m.id === ctx.modeId);
  const modeLabel = mode?.label ?? "";

  // Big combo hero
  if (ctx.combo >= 20) {
    return {
      title: "Untouchable.",
      sub: `${ctx.combo}-hit combo. The chain couldn't land a finger on you.`,
    };
  }
  if (ctx.combo >= 10) {
    return {
      title: "Cold-blooded.",
      sub: `${ctx.combo} in a row. Bank it.`,
    };
  }

  // Score milestones
  if (ctx.score >= 5_000) {
    return {
      title: "Lights out.",
      sub: `${ctx.score.toLocaleString()} on ${modeLabel}. Commit the receipts.`,
    };
  }
  if (ctx.score >= 1_000) {
    return {
      title: "Chain outpaced.",
      sub: `${ctx.score.toLocaleString()} blocks deep. Onchain it goes.`,
    };
  }
  if (ctx.score > 0) {
    return {
      title: "Survived.",
      sub: "You outran the chain. Commit the score to mint $BLOK.",
    };
  }

  // Zero-score win (banked early with nothing)
  return {
    title: "No casualties.",
    sub: "Banked clean. Nothing to mint — play for real this time.",
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Died
// ──────────────────────────────────────────────────────────────────────────

const DEATH_TITLES = [
  "Chain buried you.",
  "The chain won.",
  "Stacked out.",
  "Blocks over brain.",
  "You blinked.",
] as const;

export function pickDiePhrase(ctx: EndGameContext): Phrase {
  // Deterministic per (score, combo) so retries don't flicker between titles.
  const seed = (ctx.score * 31 + ctx.combo * 7) >>> 0;
  const title = DEATH_TITLES[seed % DEATH_TITLES.length];

  if (ctx.score === 0) {
    return { title, sub: "Zero on the board. Try again — you'll get a rhythm." };
  }
  if (ctx.combo >= 10) {
    return {
      title,
      sub: `You had a ${ctx.combo}-hit streak going. One slip and the stack buried it.`,
    };
  }
  if (ctx.score >= 1_000) {
    return {
      title,
      sub: `${ctx.score.toLocaleString()} unminted. Nothing commits on a wipe — bank early next time.`,
    };
  }
  return { title, sub: "Nothing commits on a wipe. Go again." };
}
