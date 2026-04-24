/**
 * Sound registry. Keys are stable strings — scene code uses SFX.X, not raw
 * paths. Volumes are balanced relative to each other so a global mix slider
 * works predictably.
 *
 * Several keys map to shared files at launch — once dedicated assets arrive,
 * swap the `src` path here and the scene code picks up the change.
 */
export const SFX = {
  SHOOT: "shoot",
  HIT: "hit",
  STREAK: "streak",
  STREAK_BREAK: "streak_break",
  WIN: "win",
  DIE: "die",
  TAP: "tap",
  MUSIC: "music",
  BOMB: "bomb",
  NUKE: "nuke",
  SWEEP: "sweep",
} as const;

export type SfxKey = (typeof SFX)[keyof typeof SFX];

export const SOUND_FILES: Record<SfxKey, { src: string; volume: number }> = {
  [SFX.SHOOT]: { src: "/sounds/laser_shoot.wav", volume: 0.25 },
  [SFX.HIT]: { src: "/sounds/photo_destroyed.wav", volume: 0.45 },
  [SFX.STREAK]: { src: "/sounds/streak_milestone.wav", volume: 0.55 },
  [SFX.STREAK_BREAK]: { src: "/sounds/photo_shielded.wav", volume: 0.55 },
  [SFX.WIN]: { src: "/sounds/finish_success.mp3", volume: 0.65 },
  [SFX.DIE]: { src: "/sounds/game_over.wav", volume: 0.55 },
  [SFX.TAP]: { src: "/sounds/finish_tap.wav", volume: 0.5 },
  [SFX.MUSIC]: { src: "/sounds/background_music.mp3", volume: 0.2 },
  // Bomb explosion — reuse the destroyed SFX at lower pitch for now.
  [SFX.BOMB]: { src: "/sounds/photo_destroyed.wav", volume: 0.7 },
  // Nuke — finish_success is triumphant enough; replace when a proper nuke SFX exists.
  [SFX.NUKE]: { src: "/sounds/finish_success.mp3", volume: 0.85 },
  // Sweep beam — continuous laser; reuse the shoot SFX looped at low volume.
  [SFX.SWEEP]: { src: "/sounds/laser_shoot.wav", volume: 0.3 },
};

export const MUTE_KEY = "bb:muted";
