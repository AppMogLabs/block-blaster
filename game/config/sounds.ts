/**
 * Sound registry. Keys are stable strings — scene code uses SFX.X, not raw
 * paths. Volumes are balanced relative to each other so a global mix slider
 * works predictably.
 */
export const SFX = {
  SHOOT: "shoot",
  HIT: "hit",
  STREAK: "streak",
  WIN: "win",
  DIE: "die",
  TAP: "tap",
  MUSIC: "music",
} as const;

export type SfxKey = (typeof SFX)[keyof typeof SFX];

export const SOUND_FILES: Record<SfxKey, { src: string; volume: number }> = {
  [SFX.SHOOT]: { src: "/sounds/laser_shoot.wav", volume: 0.25 },
  [SFX.HIT]: { src: "/sounds/photo_destroyed.wav", volume: 0.45 },
  [SFX.STREAK]: { src: "/sounds/streak_milestone.wav", volume: 0.55 },
  [SFX.WIN]: { src: "/sounds/finish_success.mp3", volume: 0.65 },
  [SFX.DIE]: { src: "/sounds/game_over.wav", volume: 0.55 },
  [SFX.TAP]: { src: "/sounds/finish_tap.wav", volume: 0.5 },
  [SFX.MUSIC]: { src: "/sounds/background_music.mp3", volume: 0.2 },
};

export const MUTE_KEY = "bb:muted";
