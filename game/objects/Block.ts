import Phaser from "phaser";
import {
  PALETTE,
  RARE_GOLD,
  BOMB_RED,
  BOMB_CORE,
  shade,
} from "../config/palette";

export const BLOCK_SIZE = 56;

export type BlockKind = "normal" | "rare" | "bomb";

export type BlockConfig = {
  scene: Phaser.Scene;
  x: number;
  y: number;
  speed: number;
  blockNumber: number;
  kind?: BlockKind;
  colourSeed?: number;
};

/**
 * A 3D-styled cube rendered with Phaser.Graphics:
 *   front face (base colour) + top face (lighter) + right face (darker)
 * Plus a subtle glow via an additive duplicate.
 *
 * Variants:
 *   - normal: palette colour, 1 HP, standard size
 *   - rare:   gold outline, 2 HP, 1.2x size
 *   - bomb:   pulsing red with fuse particles, 1 HP, 1.05x size
 */
export class Block extends Phaser.GameObjects.Container {
  public readonly kind: BlockKind;
  public readonly isRare: boolean;
  public readonly isBomb: boolean;
  public readonly blockNumber: number;
  public speed: number;
  public hp: number;
  public isStacked = false;
  /** Grid column index once stacked (assigned by GameScene). */
  public stackColumn = -1;

  private readonly baseColour: number;
  private readonly front: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private pulseTween?: Phaser.Tweens.Tween;
  private fuseEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(cfg: BlockConfig) {
    super(cfg.scene, cfg.x, cfg.y);
    this.kind = cfg.kind ?? "normal";
    this.isRare = this.kind === "rare";
    this.isBomb = this.kind === "bomb";
    this.blockNumber = cfg.blockNumber;
    this.speed = cfg.speed;
    this.hp = this.isRare ? 2 : 1;

    const sizeFactor = this.isRare ? 1.2 : this.isBomb ? 1.05 : 1;
    const size = BLOCK_SIZE * sizeFactor;
    this.baseColour = this.isRare
      ? RARE_GOLD
      : this.isBomb
        ? BOMB_RED
        : PALETTE[Math.abs(cfg.colourSeed ?? cfg.blockNumber) % PALETTE.length];

    this.glow = cfg.scene.add.graphics();
    this.front = cfg.scene.add.graphics();
    this.drawCube(size);

    this.label = cfg.scene.add
      .text(0, 0, this.isBomb ? "BOMB" : this.formatLabel(cfg.blockNumber), {
        fontFamily: '"Wudoo Mono", "JetBrains Mono", monospace',
        fontSize: this.isBomb ? "13px" : this.isRare ? "15px" : "13px",
        color: this.isBomb ? "#FFFFFF" : "#19191A",
        fontStyle: "bold",
        letterSpacing: 1,
      } as Phaser.Types.GameObjects.Text.TextStyle)
      .setOrigin(0.5, 0.5);

    this.add([this.glow, this.front, this.label]);
    cfg.scene.add.existing(this);
    this.setSize(size, size);
    this.setDepth(10);

    if (this.isBomb) this.startBombEffects();
  }

  /**
   * Odometer-style label: last 4 digits of the block number, zero-padded.
   * Keeps the visual tied to the chain (we start from the live block height)
   * while remaining readable as a fast-moving sequence. e.g. chain block
   * 17_384_291 → "4291", next → "4292", …
   */
  private formatLabel(n: number): string {
    return String(n % 10_000).padStart(4, "0");
  }

  private drawCube(size: number) {
    const half = size / 2;
    const depth = size * 0.16;

    const top = shade(this.baseColour, 1.25);
    const right = shade(this.baseColour, 0.75);
    const outline = this.isRare
      ? RARE_GOLD
      : this.isBomb
        ? BOMB_CORE
        : shade(this.baseColour, 0.55);

    // Soft glow (additive blend) — bombs get a larger, hotter halo
    const glowPadding = this.isBomb ? 10 : 6;
    const glowAlpha = this.isBomb ? 0.55 : 0.35;
    this.glow.clear();
    this.glow.fillStyle(this.isBomb ? BOMB_CORE : this.baseColour, glowAlpha);
    this.glow.fillRoundedRect(
      -half - glowPadding,
      -half - glowPadding,
      size + glowPadding * 2,
      size + glowPadding * 2,
      10
    );
    this.glow.setBlendMode(Phaser.BlendModes.ADD);

    this.front.clear();

    // Top face (parallelogram)
    this.front.fillStyle(top, 1);
    this.front.beginPath();
    this.front.moveTo(-half, -half);
    this.front.lineTo(-half + depth, -half - depth);
    this.front.lineTo(half + depth, -half - depth);
    this.front.lineTo(half, -half);
    this.front.closePath();
    this.front.fillPath();

    // Right face
    this.front.fillStyle(right, 1);
    this.front.beginPath();
    this.front.moveTo(half, -half);
    this.front.lineTo(half + depth, -half - depth);
    this.front.lineTo(half + depth, half - depth);
    this.front.lineTo(half, half);
    this.front.closePath();
    this.front.fillPath();

    // Front face (base)
    this.front.fillStyle(this.baseColour, 1);
    this.front.fillRoundedRect(-half, -half, size, size, 6);

    // Outline
    this.front.lineStyle(this.isRare || this.isBomb ? 3 : 1.5, outline, 1);
    this.front.strokeRoundedRect(-half, -half, size, size, 6);

    if (this.isRare) {
      // Extra rare shimmer ring
      this.front.lineStyle(1, 0xffffff, 0.6);
      this.front.strokeRoundedRect(-half + 4, -half + 4, size - 8, size - 8, 4);
    }

    if (this.isBomb) {
      // Bright inner cross to make the bomb read as dangerous even at
      // small sizes on mobile. A vertical "fuse slot" on top.
      this.front.lineStyle(2, BOMB_CORE, 1);
      this.front.beginPath();
      this.front.moveTo(0, -half + 4);
      this.front.lineTo(0, half - 4);
      this.front.strokePath();
      this.front.beginPath();
      this.front.moveTo(-half + 4, 0);
      this.front.lineTo(half - 4, 0);
      this.front.strokePath();
    }
  }

  private startBombEffects() {
    // Pulsing glow — re-tweens the glow alpha continuously.
    this.pulseTween = this.scene.tweens.add({
      targets: this.glow,
      alpha: { from: 0.85, to: 0.35 },
      duration: 480,
      ease: "Sine.inOut",
      yoyo: true,
      repeat: -1,
    });

    // Fuse particles — small upward sparks from the top-centre of the block.
    // Frequency is bumped to 110ms so multiple bombs on-screen don't eat the
    // particle budget on mobile.
    const sparkKey = this.scene.textures.exists("spark") ? "spark" : "__DEFAULT";
    this.fuseEmitter = this.scene.add.particles(this.x, this.y - this.halfSize(), sparkKey, {
      lifespan: { min: 180, max: 320 },
      speed: { min: 30, max: 90 },
      angle: { min: 250, max: 290 }, // mostly up-ish
      scale: { start: sparkKey === "spark" ? 0.3 : 0.6, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [BOMB_CORE, 0xffcc66],
      blendMode: Phaser.BlendModes.ADD,
      frequency: 110,
      quantity: 1,
    });
    this.fuseEmitter.setDepth(11);
  }

  public halfSize(): number {
    const factor = this.isRare ? 1.2 : this.isBomb ? 1.05 : 1;
    return (BLOCK_SIZE * factor) / 2;
  }

  /** Returns true if the block is destroyed by this hit. */
  public takeHit(): boolean {
    this.hp -= 1;
    if (this.hp > 0) {
      // Flash on surviving a hit
      this.scene.tweens.add({
        targets: this,
        alpha: 0.3,
        yoyo: true,
        duration: 80,
      });
      return false;
    }
    return true;
  }

  public destroyWithBurst() {
    this.cleanupFx();
    const { x, y } = this;
    const colour = this.baseColour;
    const sparkKey = this.scene.textures.exists("spark") ? "spark" : "__DEFAULT";
    const count = this.isRare ? 14 : 10;
    const particles = this.scene.add.particles(x, y, sparkKey, {
      lifespan: { min: 300, max: 550 },
      speed: { min: 100, max: 260 },
      angle: { min: 0, max: 360 },
      scale: { start: sparkKey === "spark" ? 0.5 : 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      rotate: { start: 0, end: 360 },
      quantity: count,
      tint: colour,
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    particles.explode(count);
    this.scene.time.delayedCall(700, () => particles.destroy());
    this.destroy();
  }

  /**
   * Variant for silent destruction (used by bomb AOE + nuke so we don't
   * stack N full particle bursts on top of the explosion burst).
   */
  public destroyQuiet() {
    this.cleanupFx();
    this.destroy();
  }

  private cleanupFx() {
    this.pulseTween?.stop();
    this.pulseTween = undefined;
    this.fuseEmitter?.destroy();
    this.fuseEmitter = undefined;
  }

  /** Keep fuse sparks attached to the block as it falls. */
  public updateFxPosition() {
    if (this.fuseEmitter) {
      this.fuseEmitter.setPosition(this.x, this.y - this.halfSize());
    }
  }
}
