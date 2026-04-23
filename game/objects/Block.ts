import Phaser from "phaser";
import { PALETTE, RARE_GOLD, shade } from "../config/palette";

export const BLOCK_SIZE = 56;

export type BlockConfig = {
  scene: Phaser.Scene;
  x: number;
  y: number;
  speed: number;
  blockNumber: number;
  isRare?: boolean;
  colourSeed?: number;
};

/**
 * A 3D-styled cube rendered with Phaser.Graphics:
 *   front face (base colour) + top face (lighter) + right face (darker)
 * Plus a subtle glow via an additive duplicate.
 *
 * Rare blocks: gold outline, 1.2x size, 2 HP.
 */
export class Block extends Phaser.GameObjects.Container {
  public readonly isRare: boolean;
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

  constructor(cfg: BlockConfig) {
    super(cfg.scene, cfg.x, cfg.y);
    this.isRare = Boolean(cfg.isRare);
    this.blockNumber = cfg.blockNumber;
    this.speed = cfg.speed;
    this.hp = this.isRare ? 2 : 1;

    const size = BLOCK_SIZE * (this.isRare ? 1.2 : 1);
    this.baseColour = this.isRare
      ? RARE_GOLD
      : PALETTE[Math.abs(cfg.colourSeed ?? cfg.blockNumber) % PALETTE.length];

    this.glow = cfg.scene.add.graphics();
    this.front = cfg.scene.add.graphics();
    this.drawCube(size);

    this.label = cfg.scene.add
      .text(0, 0, this.formatLabel(cfg.blockNumber), {
        fontFamily: '"Wudoo Mono", "JetBrains Mono", monospace',
        fontSize: this.isRare ? "15px" : "13px",
        color: "#19191A",
        fontStyle: "bold",
        letterSpacing: 1,
      } as Phaser.Types.GameObjects.Text.TextStyle)
      .setOrigin(0.5, 0.5);

    this.add([this.glow, this.front, this.label]);
    cfg.scene.add.existing(this);
    this.setSize(size, size);
    this.setDepth(10);
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
    const outline = this.isRare ? RARE_GOLD : shade(this.baseColour, 0.55);

    // Soft glow (additive blend)
    this.glow.clear();
    this.glow.fillStyle(this.baseColour, 0.35);
    this.glow.fillRoundedRect(-half - 6, -half - 6, size + 12, size + 12, 8);
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
    this.front.lineStyle(this.isRare ? 3 : 1.5, outline, 1);
    this.front.strokeRoundedRect(-half, -half, size, size, 6);

    if (this.isRare) {
      // Extra rare shimmer ring
      this.front.lineStyle(1, 0xffffff, 0.6);
      this.front.strokeRoundedRect(-half + 4, -half + 4, size - 8, size - 8, 4);
    }
  }

  public halfSize(): number {
    return (BLOCK_SIZE * (this.isRare ? 1.2 : 1)) / 2;
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
}
