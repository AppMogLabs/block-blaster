export const PALETTE = [
  0xf5af94, 0xf5949d, 0xff8aa8, 0xf786c6, 0x90d79f, 0x6dd0a9, 0x7eaad4, 0x70bad2,
] as const;

export const NIGHT_SKY = 0x19191a;
export const MOON_WHITE = 0xece8e8;
export const RARE_GOLD = 0xffd700;

export function shade(color: number, factor: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const nr = Math.max(0, Math.min(255, Math.round(r * factor)));
  const ng = Math.max(0, Math.min(255, Math.round(g * factor)));
  const nb = Math.max(0, Math.min(255, Math.round(b * factor)));
  return (nr << 16) | (ng << 8) | nb;
}

export function pickColour(seed: number): number {
  return PALETTE[Math.abs(seed) % PALETTE.length];
}
