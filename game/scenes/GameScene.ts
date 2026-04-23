import Phaser from "phaser";
import { Block, BLOCK_SIZE } from "../objects/Block";
import { NIGHT_SKY, shade } from "../config/palette";
import { GAME_EVENTS } from "../config/events";
import { SFX } from "../config/sounds";

export type GameSceneInit = {
  modeId: 0 | 1 | 2 | 3;
  blocksPerSecond: number;
  durationSec: number;
  /** Event emitter the React layer subscribes to. */
  bus: Phaser.Events.EventEmitter;
  /** Starting block number (ticker) — cosmetic, ties visuals to chain. */
  startingBlockNumber?: number;
};

/**
 * Core gameplay:
 *  - Blocks spawn at top at `blocksPerSecond` (with a random X)
 *  - Falling blocks descend at mode-dependent speed
 *  - Click/tap = shot projectile from bottom-center → hit-detect with radius
 *  - Missed blocks stack at the bottom; if any column tops out → GAME_OVER
 *  - Timer counts down; 0 = GAME_WIN
 *  - 5-hit combo clears bottom row of the stack (screen flash)
 */
export class GameScene extends Phaser.Scene {
  private cfg!: GameSceneInit;

  private blocks: Block[] = [];
  private stack: Block[][] = []; // stack[column] = array of blocks bottom→top
  private numColumns = 6;
  private columnWidth = 0;

  private score = 0;
  private combo = 0; // consecutive hits
  private comboTimer = 0; // time since last hit (ms)
  private remainingMs = 0;
  private blockNumberCounter = 0;
  private spawnAccumulator = 0;
  private elapsed = 0;
  private state: "idle" | "running" | "over" = "idle";

  private dangerBar?: Phaser.GameObjects.Graphics;
  private music?: Phaser.Sound.BaseSound;
  private projectiles: Array<{
    g: Phaser.GameObjects.Graphics;
    vx: number;
    vy: number;
    alive: boolean;
  }> = [];

  /**
   * Play a preloaded sound effect at its registered volume.
   * Swallows errors silently — a missing sound should never crash the game.
   */
  private sfx(key: string, opts?: { volume?: number; rate?: number }) {
    try {
      if (!this.cache.audio.has(key)) return;
      this.sound.play(key, { volume: opts?.volume ?? 1, rate: opts?.rate ?? 1 });
    } catch {
      /* no-op */
    }
  }

  constructor() {
    super("GameScene");
  }

  init(data: GameSceneInit) {
    // Phaser may boot-start the scene with no data if the config load races.
    // We refuse to run without a bus — prevents the silent crash in create().
    if (!data || !data.bus) {
      console.warn("GameScene.init called without data — skipping boot");
      return;
    }
    this.cfg = data;
  }

  create() {
    if (!this.cfg || !this.cfg.bus) return;
    this.cameras.main.setBackgroundColor(NIGHT_SKY);
    const { width, height } = this.scale;

    this.columnWidth = Math.max(BLOCK_SIZE + 4, Math.floor(width / this.numColumns));
    this.numColumns = Math.max(4, Math.floor(width / this.columnWidth));
    this.stack = Array.from({ length: this.numColumns }, () => []);

    this.remainingMs = this.cfg.durationSec * 1000;
    this.blockNumberCounter = this.cfg.startingBlockNumber ?? 0;

    // Vertical gridlines (decorative)
    const grid = this.add.graphics();
    grid.lineStyle(1, 0xece8e8, 0.04);
    for (let i = 1; i < this.numColumns; i++) {
      const x = i * this.columnWidth;
      grid.beginPath();
      grid.moveTo(x, 0);
      grid.lineTo(x, height);
      grid.strokePath();
    }

    // Danger bar on the left
    this.dangerBar = this.add.graphics().setDepth(50);
    this.drawDangerBar(0);

    // Input: click / tap → shoot
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.state !== "running") return;
      this.shootAt(p.worldX, p.worldY);
    });

    this.scale.on("resize", this.handleResize, this);

    this.state = "running";
    this.startMusic();
    this.cfg.bus.emit(GAME_EVENTS.READY, {});
  }

  private startMusic() {
    if (!this.cache.audio.has(SFX.MUSIC)) return;
    try {
      this.music = this.sound.add(SFX.MUSIC, { loop: true, volume: 0.18 });
      // Fade in so the title sting and the music don't clash.
      const m = this.music as Phaser.Sound.BaseSound & { volume?: number };
      if ("volume" in m) m.volume = 0;
      this.music.play();
      this.tweens.add({
        targets: m,
        volume: 0.18,
        duration: 800,
      });
    } catch {
      /* no-op */
    }
  }

  private stopMusic() {
    const m = this.music as (Phaser.Sound.BaseSound & { volume?: number }) | undefined;
    if (!m) return;
    this.tweens.add({
      targets: m,
      volume: 0,
      duration: 400,
      onComplete: () => m.stop(),
    });
  }

  private handleResize(size: Phaser.Structs.Size) {
    this.cameras.main.setSize(size.width, size.height);
  }

  update(_time: number, delta: number) {
    if (!this.cfg || this.state !== "running") return;
    this.elapsed += delta;
    this.remainingMs -= delta;
    this.comboTimer += delta;

    if (this.comboTimer > 1000 && this.combo > 0) {
      this.combo = 0;
      this.emitCombo();
    }

    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      this.endGame("win");
      return;
    }

    this.cfg.bus.emit(GAME_EVENTS.TIMER, {
      remainingSec: Math.ceil(this.remainingMs / 1000),
    });

    // Spawning — accumulator-based so low rates (1/s) and high rates (100/s) behave
    this.spawnAccumulator += (delta / 1000) * this.cfg.blocksPerSecond;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      this.spawnBlock();
    }

    // Update falling blocks
    for (const b of this.blocks) {
      if (b.isStacked) continue;
      b.y += b.speed * (delta / 1000);
      this.tryStack(b);
    }

    // Update projectiles
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.g.x += p.vx * (delta / 1000);
      p.g.y += p.vy * (delta / 1000);
      if (p.g.y < -50 || p.g.x < -50 || p.g.x > this.scale.width + 50) {
        p.alive = false;
        p.g.destroy();
        this.breakCombo();
      } else {
        this.checkHit(p);
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);

    // Danger
    this.drawDangerBar(this.stackFraction());

    // Topped out?
    if (this.stackFraction() >= 0.99) {
      this.endGame("over");
    }
  }

  private spawnBlock() {
    const col = Phaser.Math.Between(0, this.numColumns - 1);
    const x = col * this.columnWidth + this.columnWidth / 2;
    const isRare = this.blockNumberCounter > 0 && this.blockNumberCounter % 20 === 0;
    const speed = 140 + this.cfg.blocksPerSecond * 2.2;
    const block = new Block({
      scene: this,
      x,
      y: -BLOCK_SIZE,
      speed,
      blockNumber: ++this.blockNumberCounter,
      isRare,
      colourSeed: this.blockNumberCounter,
    });
    block.stackColumn = col;
    this.blocks.push(block);
  }

  private tryStack(b: Block) {
    const col = b.stackColumn;
    const stackHere = this.stack[col];
    const stackTopY =
      this.scale.height - stackHere.length * BLOCK_SIZE - BLOCK_SIZE / 2;
    if (b.y >= stackTopY) {
      b.y = stackTopY;
      b.isStacked = true;
      b.setDepth(5);
      stackHere.push(b);
    }
  }

  private shootAt(x: number, y: number) {
    const startX = this.scale.width / 2;
    const startY = this.scale.height - 8;
    const dx = x - startX;
    const dy = y - startY;
    const len = Math.hypot(dx, dy) || 1;
    const speed = 1400;
    const vx = (dx / len) * speed;
    const vy = (dy / len) * speed;

    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, 0, 4);
    g.setPosition(startX, startY);
    g.setDepth(100);
    g.setBlendMode(Phaser.BlendModes.ADD);

    this.projectiles.push({ g, vx, vy, alive: true });

    // Slight pitch variation keeps rapid-fire from sounding machine-gun-monotone.
    this.sfx(SFX.SHOOT, { volume: 0.35, rate: 0.95 + Math.random() * 0.1 });
  }

  private checkHit(p: {
    g: Phaser.GameObjects.Graphics;
    alive: boolean;
  }) {
    const radius = this.cfg.modeId >= 2 ? 30 : 40;
    for (const b of this.blocks) {
      if (b.isStacked) continue;
      if (Phaser.Math.Distance.Between(p.g.x, p.g.y, b.x, b.y) <= radius + b.halfSize()) {
        const dead = b.takeHit();
        p.alive = false;
        p.g.destroy();
        if (dead) {
          this.onBlockDestroyed(b);
        }
        return;
      }
    }
  }

  private onBlockDestroyed(b: Block) {
    this.blocks = this.blocks.filter((x) => x !== b);
    const base = b.isRare ? 100 : 10;
    this.combo += 1;
    this.comboTimer = 0;

    // Pitch rises slightly with combo for audio feedback — caps at +40%.
    const pitchBoost = Math.min(1.4, 1 + this.combo * 0.02);
    this.sfx(SFX.HIT, { volume: b.isRare ? 0.75 : 0.5, rate: pitchBoost });

    // 5-combo = bottom-row clear (combo-clear reward)
    if (this.combo > 0 && this.combo % 5 === 0) {
      this.comboClear();
      this.sfx(SFX.STREAK, { volume: 0.7 });
    }

    const multiplier = this.combo >= 10 ? 3 : this.combo >= 5 ? 2 : 1;
    this.score += base * multiplier;
    b.destroyWithBurst();

    this.cfg.bus.emit(GAME_EVENTS.SCORE, { score: this.score });
    this.emitCombo();
  }

  private breakCombo() {
    if (this.combo > 0) {
      this.combo = 0;
      this.emitCombo();
    }
  }

  private emitCombo() {
    const multiplier = this.combo >= 10 ? 3 : this.combo >= 5 ? 2 : 1;
    this.cfg.bus.emit(GAME_EVENTS.COMBO, { combo: this.combo, multiplier });
  }

  private comboClear() {
    // Clear bottom row across all columns, drop the rest down.
    for (const col of this.stack) {
      const removed = col.shift();
      if (removed) removed.destroyWithBurst();
    }
    // Shift remaining stacked blocks down by BLOCK_SIZE visually
    for (const col of this.stack) {
      for (let i = 0; i < col.length; i++) {
        col[i].y = this.scale.height - (i + 1) * BLOCK_SIZE + BLOCK_SIZE / 2;
      }
    }
    // Brief screen flash
    const flash = this.add
      .rectangle(
        this.scale.width / 2,
        this.scale.height / 2,
        this.scale.width,
        this.scale.height,
        0xffffff,
        0.4
      )
      .setDepth(500);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 200,
      onComplete: () => flash.destroy(),
    });
  }

  private stackFraction(): number {
    const maxRows = Math.floor(this.scale.height / BLOCK_SIZE);
    const highest = Math.max(0, ...this.stack.map((c) => c.length));
    return Math.min(1, highest / maxRows);
  }

  private drawDangerBar(fraction: number) {
    if (!this.dangerBar) return;
    const h = this.scale.height;
    const w = 6;
    const filled = Math.max(0.02, fraction) * h;
    let colour = 0x90d79f; // green
    if (fraction >= 0.66) colour = 0xff8aa8;
    else if (fraction >= 0.33) colour = 0xf5af94;
    this.dangerBar.clear();
    this.dangerBar.fillStyle(shade(colour, 0.3), 0.5);
    this.dangerBar.fillRect(4, 0, w, h);
    this.dangerBar.fillStyle(colour, 1);
    this.dangerBar.fillRect(4, h - filled, w, filled);
  }

  private endGame(kind: "win" | "over") {
    if (this.state === "over") return;
    this.state = "over";
    this.stopMusic();
    this.sfx(kind === "win" ? SFX.WIN : SFX.DIE, { volume: 0.6 });
    const evt = kind === "win" ? GAME_EVENTS.GAME_WIN : GAME_EVENTS.GAME_OVER;
    this.cfg.bus.emit(evt, { score: this.score });
  }

  /** Externally-triggered early bank. */
  public bankEarly() {
    this.endGame("win");
  }
}
