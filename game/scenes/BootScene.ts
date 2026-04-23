import Phaser from "phaser";
import { SFX, SOUND_FILES, MUTE_KEY } from "../config/sounds";

/**
 * Boot scene: preloads sounds + particle textures, creates a 2×2 white pixel
 * fallback. Emits `boot-ready` on the global game event bus once done —
 * GameCanvas then launches GameScene with config.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload() {
    // Placeholder white texture for ad-hoc particles
    if (!this.textures.exists("__DEFAULT")) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 2, 2);
      g.generateTexture("__DEFAULT", 2, 2);
      g.destroy();
    }

    // Particle textures from PhotoBlitz
    this.load.image("spark", "/textures/spark.png");
    this.load.image("softcircle_pink", "/textures/softcircle_pink.png");
    this.load.image("softcircle_cyan", "/textures/softcircle_cyan.png");

    // Sounds — Phaser will pick WebAudio or HTML5 based on browser support
    for (const [key, def] of Object.entries(SOUND_FILES)) {
      this.load.audio(key, def.src);
    }

    // Graceful fallback when a file 404s (e.g. adblockers that strip /sounds/)
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      console.warn(`[boot] asset failed to load: ${file.key} (${file.src})`);
    });
  }

  create() {
    // Respect any persisted mute preference before GameScene starts using the manager.
    const muted =
      typeof window !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
    this.sound.mute = muted;
    this.game.events.emit("boot-ready");
  }
}

// Re-export for convenience — scenes import SFX to reference keys.
export { SFX };
