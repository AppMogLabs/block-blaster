import Phaser from "phaser";
import { Block, BLOCK_SIZE, type BlockKind } from "../objects/Block";
import {
  NIGHT_SKY,
  shade,
  HEAT_EDGE,
  HEAT_ACCENT,
  HEAT_BURN,
  HEAT_VIGNETTE,
  SWEEP_GREEN,
} from "../config/palette";
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

export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** Streak thresholds map 1:1 to heat levels (25 is heat tier 5). */
const HEAT_THRESHOLDS: readonly number[] = [5, 10, 15, 20, 25];
/**
 * Nuke activation kill floor — cumulative blocks destroyed since the last
 * nuke use. Does NOT reset on streak break or bank, only on nuke use.
 * Combined with a $BLOK balance check in the React layer, this is half
 * of the dual-condition gate. Scene refuses to fire the visual unless
 * nukeProgress >= this.
 */
const NUKE_KILL_THRESHOLD = 25;
const SWEEP_FUEL_MAX_MS = 3000;
const SWEEP_RECHARGE_MS = 3000;
const SWEEP_HOLD_THRESHOLD_MS = 150;
const BOMB_RADIUS = BLOCK_SIZE * 1.5; // covers a 3x3 grid of cells
/** Safety cap: in packed bomb clusters, chains can cascade without bound.
 *  We allow up to this many recursive detonations per initial trigger; beyond
 *  that the logic still removes the caught bombs but skips their visuals. */
const MAX_CHAIN_DEPTH = 6;

/** Per-mode bomb spawn chance (before the rare-block roll wins). */
const BOMB_CHANCE: Record<0 | 1 | 2 | 3, number> = {
  0: 0.05,
  1: 0.08,
  2: 0.12,
  3: 0.15,
};

/**
 * Core gameplay:
 *  - Blocks spawn at top at `blocksPerSecond` (with a random X); some are
 *    rare (1/20) or bombs (mode-dependent).
 *  - Falling blocks descend at mode-dependent speed.
 *  - Click/tap = shot projectile from bottom-center → hit-detect with radius.
 *  - Hold + drag (Medium+) = continuous sweep beam, 3s fuel / 3s recharge.
 *  - Bombs explode (3x3) on shoot or on miss — clear descending + stack cells.
 *  - Streak resets on any miss. Heat thresholds: 5, 10, 15, 20, 25.
 *  - Reaching 25 charges a one-shot nuke; activation wipes everything.
 *  - Missed projectiles stack at the bottom; topping out → GAME_OVER.
 *  - Timer counts down; 0 = GAME_WIN.
 */
export class GameScene extends Phaser.Scene {
  private cfg!: GameSceneInit;

  private blocks: Block[] = [];
  private stack: Block[][] = []; // stack[column] = array of blocks bottom→top
  private numColumns = 6;
  private columnWidth = 0;

  /** Locked points — survives death, committed via bank(). */
  private banked = 0;
  /** At-risk points from the current streak. Lost on death, banked on win. */
  private pending = 0;
  private streak = 0; // consecutive hits without a miss
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

  // Heat + nuke state
  private heatLevel: HeatLevel = 0;
  private heatLayer?: Phaser.GameObjects.Graphics;
  private vignetteLayer?: Phaser.GameObjects.Graphics;
  /** Cumulative blocks destroyed since the last nuke use. Drives the nuke
   *  kills half of the dual-condition gate. Reset only by triggerNuke(). */
  private nukeProgress = 0;
  /** One-shot flag so the "NUKE READY" chime plays exactly once per charge. */
  private nukeChimePlayed = false;
  /** Dirty flag for the throttled HUD flush. */
  private nukeProgressDirty = false;

  // HUD emit throttle — sweep can destroy ~10 blocks per tick; emitting a
  // SCORE + COMBO + STREAK event for each one floods React with state
  // updates and stalls the main thread. We flag dirtiness and flush at
  // most every 50ms (20Hz), which is well under the HUD's visible refresh
  // rate.
  private scoreDirty = false;
  private comboDirty = false;
  private lastHudEmit = 0;

  // Sweep state
  private pointerDownAt = 0;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private pointerActive = false;
  private pointerWorldX = 0;
  private pointerWorldY = 0;
  private sweepActive = false;
  private sweepFuelMs = SWEEP_FUEL_MAX_MS;
  /** Set false after sweep depletes fuel; reset to true on pointerup so the
   *  beam can't strobe on/off while the player keeps holding. */
  private sweepArmedForThisHold = true;
  private sweepGraphics?: Phaser.GameObjects.Graphics;
  private sweepHitAccumulator = 0;
  private lastSweepFuelEmit = 0;

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

    // Heat + vignette layers sit above the game, below the flash overlays.
    this.heatLayer = this.add.graphics().setDepth(400).setScrollFactor(0);
    this.vignetteLayer = this.add.graphics().setDepth(401).setScrollFactor(0);
    this.sweepGraphics = this.add.graphics().setDepth(120);

    // Input: pointer down/up/move — distinguishes tap (shoot) from hold+drag (sweep)
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointermove", this.onPointerMove, this);

    this.scale.on("resize", this.handleResize, this);

    this.state = "running";
    this.startMusic();
    this.emitSweepFuel(true);
    this.cfg.bus.emit(GAME_EVENTS.READY, {});
    // `triggerNuke` and `bank` are already public class methods — the
    // GameCanvas handle invokes them directly via `scene.triggerNuke()`.
    // An earlier assignment replaced the method with a self-referencing
    // arrow function, causing infinite recursion on nuke activation.
  }

  /**
   * Start the background music. Guards against duplicate instances: if a
   * previous track is still playing (or hasn't been destroyed yet), stop
   * and discard it first. Without this guard, subsequent nuke/win events
   * that used to call play() stacked multiple overlapping playbacks.
   */
  private startMusic() {
    if (!this.cache.audio.has(SFX.MUSIC)) return;
    this.killMusic();
    try {
      this.music = this.sound.add(SFX.MUSIC, { loop: true, volume: 0.6 });
      const m = this.music as Phaser.Sound.BaseSound & { volume?: number };
      if ("volume" in m) m.volume = 0;
      this.music.play();
      // Fade in so the transition from silence isn't a hard cut.
      this.tweens.add({ targets: m, volume: 0.6, duration: 600 });
    } catch {
      /* no-op */
    }
  }

  /** Fade out + stop the current music, but keep the reference for tidy-up. */
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

  /** Immediately stop + destroy the current music instance. Used to prevent
   *  overlapping playbacks when restarting mid-run. */
  private killMusic() {
    if (!this.music) return;
    try {
      this.music.stop();
      this.music.destroy();
    } catch {
      /* no-op */
    }
    this.music = undefined;
  }

  /** Stop whatever's playing and start fresh from the beginning. */
  private restartMusic() {
    this.killMusic();
    this.startMusic();
  }

  private handleResize(size: Phaser.Structs.Size) {
    this.cameras.main.setSize(size.width, size.height);
    this.redrawHeat();
  }

  update(_time: number, delta: number) {
    if (!this.cfg || this.state !== "running") return;
    this.elapsed += delta;
    this.remainingMs -= delta;
    this.comboTimer += delta;

    if (this.comboTimer > 1000 && this.streak > 0) {
      // Hit timeout only *trims* streak visually — it doesn't break it,
      // because the player may be between targets. Combo reset only on
      // explicit misses (projectile fly-off / block lands).
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
      b.updateFxPosition();
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
        this.onMiss();
      } else {
        this.checkHit(p);
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);

    // Sweep beam
    this.tickSweep(delta);

    // Throttled HUD emit
    this.flushHudIfDirty();

    // Danger
    this.drawDangerBar(this.stackFraction());

    // Topped out?
    if (this.stackFraction() >= 0.99) {
      this.endGame("over");
    }
  }

  // ─── Spawning ────────────────────────────────────────────────────────────

  private spawnBlock() {
    const col = Phaser.Math.Between(0, this.numColumns - 1);
    const x = col * this.columnWidth + this.columnWidth / 2;
    const kind = this.pickKind();
    const speed = 140 + this.cfg.blocksPerSecond * 2.2;
    const block = new Block({
      scene: this,
      x,
      y: -BLOCK_SIZE,
      speed,
      blockNumber: ++this.blockNumberCounter,
      kind,
      colourSeed: this.blockNumberCounter,
    });
    block.stackColumn = col;
    this.blocks.push(block);
  }

  private pickKind(): BlockKind {
    // Rare wins first (1/20). Otherwise roll bomb vs normal.
    if (this.blockNumberCounter > 0 && this.blockNumberCounter % 20 === 0) {
      return "rare";
    }
    const bombChance = BOMB_CHANCE[this.cfg.modeId];
    if (Math.random() < bombChance) return "bomb";
    return "normal";
  }

  // ─── Input routing ────────────────────────────────────────────────────────

  private onPointerDown = (p: Phaser.Input.Pointer) => {
    if (this.state !== "running") return;
    this.pointerDownAt = this.time.now;
    this.pointerDownX = p.worldX;
    this.pointerDownY = p.worldY;
    this.pointerActive = true;
    this.pointerWorldX = p.worldX;
    this.pointerWorldY = p.worldY;
    // A new press always re-arms the sweep for this hold. The beam still
    // requires the 150ms + fuel threshold before actually activating.
    this.sweepArmedForThisHold = true;
    // Immediate tap feel — fire a projectile on every press. Sweep kicks in
    // as a secondary mode if the player keeps holding AND we're above Easy.
    this.shootAt(p.worldX, p.worldY);
  };

  private onPointerMove = (p: Phaser.Input.Pointer) => {
    this.pointerWorldX = p.worldX;
    this.pointerWorldY = p.worldY;
  };

  private onPointerUp = () => {
    this.pointerActive = false;
    // Disarm until the next press so an unreleased hold can't re-trigger
    // the beam the moment fuel recharges back up.
    this.sweepArmedForThisHold = false;
    this.stopSweep();
  };

  // ─── Shooting ────────────────────────────────────────────────────────────

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
        p.alive = false;
        p.g.destroy();
        this.hitBlock(b);
        return;
      }
    }
  }

  /**
   * Handles a block-hit regardless of source (projectile, sweep beam). Bombs
   * explode, everything else scores normally + ticks the streak.
   *
   * Defensive: the same block can be passed here twice within a tick if the
   * sweep loop is iterating a snapshot and an AOE has already destroyed it.
   * Skip gracefully.
   */
  private hitBlock(b: Block) {
    if (!b.active) return;
    if (!this.blocks.includes(b)) return;
    if (b.isBomb) {
      this.explodeAt(b.x, b.y, true, 0);
      return;
    }
    const dead = b.takeHit();
    if (!dead) return;
    this.scoreDestroyed(b);
    b.destroyWithBurst();
  }

  private scoreDestroyed(b: Block) {
    this.blocks = this.blocks.filter((x) => x !== b);
    const base = b.isRare ? 100 : 10;
    this.streak += 1;
    this.comboTimer = 0;

    // Pitch rises slightly with streak for audio feedback — caps at +40%.
    const pitchBoost = Math.min(1.4, 1 + this.streak * 0.02);
    this.sfx(SFX.HIT, { volume: b.isRare ? 0.75 : 0.5, rate: pitchBoost });

    const multiplier = this.streak >= 10 ? 3 : this.streak >= 5 ? 2 : 1;
    // Points land in the "pending" pot — at risk until the player banks.
    this.pending += base * multiplier;

    // Heat milestones — streak-based (resets on bank/miss)
    if (HEAT_THRESHOLDS.includes(this.streak)) {
      this.sfx(SFX.STREAK, { volume: 0.7 });
    }

    // Nuke readiness is dual-gated (cumulative kills >= 25 AND balance >= 100).
    // The balance half lives in React (via useBlok), so the scene only
    // tracks and emits the kill count. Fire a one-shot "NUKE READY" chime
    // + flash the first time kills crosses the threshold.
    this.nukeProgress += 1;
    this.nukeProgressDirty = true;
    if (this.nukeProgress === NUKE_KILL_THRESHOLD && !this.nukeChimePlayed) {
      this.nukeChimePlayed = true;
      this.sfx(SFX.STREAK, { volume: 0.9, rate: 1.3 });
      this.flashText("NUKE READY", 0xffd26d);
    }

    this.applyHeat();
    // Defer the HUD event to the next throttled tick — see flushHudIfDirty().
    this.scoreDirty = true;
    this.comboDirty = true;
  }

  // ─── Bomb explosions ─────────────────────────────────────────────────────

  /**
   * 3x3 AOE destruction. Triggered by a direct hit (playerTriggered=true) or
   * by a bomb reaching the stack (playerTriggered=false). Direct hits keep
   * the player's streak rolling and score each destroyed descending block.
   * Auto-detonations clear terrain but count as a miss for streak purposes.
   *
   * `chainDepth` caps recursive chain reactions — without this, a packed
   * stack of bombs can cascade into dozens of concurrent particle bursts
   * and shockwaves and drop the frame rate through the floor.
   */
  private explodeAt(cx: number, cy: number, playerTriggered: boolean, chainDepth: number) {
    const drawFx = chainDepth < MAX_CHAIN_DEPTH;

    if (drawFx) {
      // Screenshake proportional to bomb — moderate, not nuke-level.
      // Only the first few explosions shake; deeper chains just run logic.
      this.cameras.main.shake(220, 0.012);
      this.sfx(SFX.BOMB, { volume: 0.75, rate: 0.9 + Math.random() * 0.1 });

      // Particle burst — slimmed down from 30 to 16 now that chains
      // routinely fire several in quick succession.
      const sparkKey = this.textures.exists("spark") ? "spark" : "__DEFAULT";
      const burst = this.add.particles(cx, cy, sparkKey, {
        lifespan: { min: 300, max: 650 },
        speed: { min: 180, max: 460 },
        angle: { min: 0, max: 360 },
        scale: { start: sparkKey === "spark" ? 0.8 : 1.6, end: 0 },
        alpha: { start: 1, end: 0 },
        rotate: { start: 0, end: 360 },
        quantity: 16,
        tint: [0xff9d3a, 0xff3a3a, 0xffd26d],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      });
      burst.explode(16);
      this.time.delayedCall(800, () => burst.destroy());

      // Shockwave via a Graphics ring + alpha tween — cheaper than a
      // per-frame onUpdate that re-reads tween target props.
      const ring = this.add.graphics().setDepth(110);
      ring.lineStyle(3, 0xff9d3a, 1);
      ring.strokeCircle(0, 0, BOMB_RADIUS);
      ring.setPosition(cx, cy);
      ring.setScale(0.2);
      this.tweens.add({
        targets: ring,
        scale: 1.4,
        alpha: 0,
        duration: 420,
        ease: "Cubic.out",
        onComplete: () => ring.destroy(),
      });
    }

    // Remove the bomb itself from the arrays (descending OR stacked). Tolerate
    // missing bomb — by the time a chained explodeAt runs, the source bomb may
    // have already been filtered out.
    const bomb = this.blocks.find((x) => x.x === cx && x.y === cy && x.isBomb);
    if (bomb) {
      if (bomb.isStacked) {
        const col = this.stack[bomb.stackColumn];
        if (col) {
          const idx = col.indexOf(bomb);
          if (idx >= 0) col.splice(idx, 1);
        }
      }
      this.blocks = this.blocks.filter((x) => x !== bomb);
      bomb.destroyQuiet();
    }

    // Destroy all descending blocks in radius (score each if player-triggered)
    const caught: Block[] = [];
    for (const b of this.blocks) {
      if (b.isStacked) continue;
      if (Phaser.Math.Distance.Between(cx, cy, b.x, b.y) <= BOMB_RADIUS) {
        caught.push(b);
      }
    }
    for (const b of caught) {
      if (b.isBomb) {
        // Chain-detonate — capture coords BEFORE destroying; Phaser resets
        // x/y on destroyed objects, which would produce chain explosions at
        // (0, 0) and freeze the frame on a storm of particle managers.
        const bx = b.x;
        const by = b.y;
        this.blocks = this.blocks.filter((x) => x !== b);
        b.destroyQuiet();
        this.time.delayedCall(50, () =>
          this.explodeAt(bx, by, playerTriggered, chainDepth + 1)
        );
        continue;
      }
      if (playerTriggered) {
        this.scoreDestroyed(b);
      } else {
        this.blocks = this.blocks.filter((x) => x !== b);
      }
      b.destroyQuiet();
    }

    // Clear stack cells within radius (survival benefit, no score)
    for (let col = 0; col < this.stack.length; col++) {
      const cellX = col * this.columnWidth + this.columnWidth / 2;
      if (Math.abs(cellX - cx) > BOMB_RADIUS) continue;
      const newCol: Block[] = [];
      for (const s of this.stack[col]) {
        if (Phaser.Math.Distance.Between(cellX, s.y, cx, cy) <= BOMB_RADIUS) {
          s.destroyQuiet();
        } else {
          newCol.push(s);
        }
      }
      this.stack[col] = newCol;
      // Resettle column
      for (let i = 0; i < newCol.length; i++) {
        newCol[i].y = this.scale.height - (i + 1) * BLOCK_SIZE + BLOCK_SIZE / 2;
      }
    }

    if (!playerTriggered && chainDepth === 0) {
      // Auto-detonation counts as a miss for streak — but only for the
      // ORIGINAL auto-detonation, not for chained bombs.
      this.onMiss();
    }
  }

  // ─── Miss / streak-break ─────────────────────────────────────────────────

  private onMiss() {
    if (this.streak > 0) {
      this.streak = 0;
      // nukeChimePlayed + nukeProgress persist across misses — cumulative
      // kill counter only resets on nuke use.
      this.sfx(SFX.STREAK_BREAK, { volume: 0.5, rate: 0.8 });
      this.applyHeat();
      // Streak reset is important visually — flush immediately so the HUD
      // snaps back to 0 without waiting for the next throttled tick.
      this.emitCombo();
      this.comboDirty = false;
    }
  }

  private emitCombo() {
    const multiplier = this.streak >= 10 ? 3 : this.streak >= 5 ? 2 : 1;
    this.cfg.bus.emit(GAME_EVENTS.COMBO, { combo: this.streak, multiplier });
    this.cfg.bus.emit(GAME_EVENTS.STREAK, {
      streak: this.streak,
      heatLevel: this.heatLevel,
    });
  }

  /**
   * Sweep + bomb AOE can destroy many blocks per frame. Emitting SCORE +
   * COMBO + STREAK per block floods React with state updates (~30 re-renders
   * per 80ms tick during active sweep), stalling the main thread enough to
   * feel like a freeze. Throttle to 20Hz — the HUD updates visually smooth
   * and the score/combo counters stay in lockstep.
   */
  private flushHudIfDirty() {
    if (!this.scoreDirty && !this.comboDirty && !this.nukeProgressDirty) return;
    if (this.time.now - this.lastHudEmit < 50) return;
    if (this.scoreDirty) {
      this.cfg.bus.emit(GAME_EVENTS.SCORE, {
        score: this.banked + this.pending,
        banked: this.banked,
        pending: this.pending,
      });
      this.scoreDirty = false;
    }
    if (this.comboDirty) {
      this.emitCombo();
      this.comboDirty = false;
    }
    if (this.nukeProgressDirty) {
      this.cfg.bus.emit(GAME_EVENTS.NUKE_PROGRESS, {
        kills: this.nukeProgress,
        threshold: NUKE_KILL_THRESHOLD,
      });
      this.nukeProgressDirty = false;
    }
    this.lastHudEmit = this.time.now;
  }

  // ─── Heat system ─────────────────────────────────────────────────────────

  private computeHeat(): HeatLevel {
    if (this.streak >= 25) return 5;
    if (this.streak >= 20) return 4;
    if (this.streak >= 15) return 3;
    if (this.streak >= 10) return 2;
    if (this.streak >= 5) return 1;
    return 0;
  }

  private applyHeat() {
    const next = this.computeHeat();
    if (next === this.heatLevel) return;
    this.heatLevel = next;
    this.redrawHeat();

    // Music pitch rises with heat (subtle — and only if music is playing)
    const m = this.music as (Phaser.Sound.BaseSound & { rate?: number }) | undefined;
    if (m && "rate" in m) {
      const rate = 1 + next * 0.035;
      this.tweens.add({ targets: m, rate, duration: 300 });
    }

    // "UNSTOPPABLE" flash at heat 4 (streak 20+). Nuke charging is now
    // cumulative-kill-based, announced separately by scoreDestroyed().
    if (next === 4) {
      this.flashText("UNSTOPPABLE", HEAT_VIGNETTE);
    }
  }

  private redrawHeat() {
    if (!this.heatLayer || !this.vignetteLayer) return;
    const { width, height } = this.scale;
    this.heatLayer.clear();
    this.vignetteLayer.clear();

    if (this.heatLevel === 0) return;

    // Edge pulse — thin coloured frame around the scene
    const edgeWidth =
      this.heatLevel >= 4 ? 22 : this.heatLevel >= 3 ? 16 : this.heatLevel >= 2 ? 10 : 6;
    const edgeColour =
      this.heatLevel >= 4
        ? HEAT_VIGNETTE
        : this.heatLevel >= 3
          ? HEAT_BURN
          : this.heatLevel >= 2
            ? HEAT_ACCENT
            : HEAT_EDGE;
    const edgeAlpha = 0.25 + this.heatLevel * 0.08;

    this.heatLayer.fillStyle(edgeColour, edgeAlpha);
    // Top / bottom / left / right strips — a frame built out of 4 rects.
    this.heatLayer.fillRect(0, 0, width, edgeWidth);
    this.heatLayer.fillRect(0, height - edgeWidth, width, edgeWidth);
    this.heatLayer.fillRect(0, 0, edgeWidth, height);
    this.heatLayer.fillRect(width - edgeWidth, 0, edgeWidth, height);

    // Vignette — radial-ish darkening emulated via 3 concentric rects with
    // increasing alpha at the corners. Phaser Graphics doesn't ship radial
    // gradients; this is cheap and reads right.
    if (this.heatLevel >= 4) {
      const vAlpha = this.heatLevel === 5 ? 0.32 : 0.22;
      this.vignetteLayer.fillStyle(HEAT_VIGNETTE, vAlpha * 0.4);
      this.vignetteLayer.fillRect(0, 0, width, height);
      this.vignetteLayer.fillStyle(HEAT_VIGNETTE, vAlpha * 0.6);
      this.vignetteLayer.fillRect(0, 0, width, height * 0.2);
      this.vignetteLayer.fillRect(0, height * 0.8, width, height * 0.2);
    }
  }

  private flashText(msg: string, colour: number) {
    const t = this.add
      .text(this.scale.width / 2, this.scale.height / 2, msg, {
        fontFamily: '"Wudoo Mono", "JetBrains Mono", monospace',
        fontSize: "48px",
        color: "#" + colour.toString(16).padStart(6, "0"),
        fontStyle: "bold",
      } as Phaser.Types.GameObjects.Text.TextStyle)
      .setOrigin(0.5, 0.5)
      .setDepth(600)
      .setAlpha(0);
    this.tweens.add({
      targets: t,
      alpha: 1,
      scale: { from: 0.6, to: 1.3 },
      duration: 200,
      yoyo: true,
      hold: 300,
      onComplete: () => t.destroy(),
    });
  }

  // ─── Nuke ────────────────────────────────────────────────────────────────

  public triggerNuke() {
    // Kill gate — dual-condition balance check happens React-side.
    // Refuse if cumulative kills below threshold or game is over.
    if (this.state !== "running" || this.nukeProgress < NUKE_KILL_THRESHOLD) return;
    // Reset the kill counter + chime flag so the next nuke must be re-earned.
    this.nukeProgress = 0;
    this.nukeChimePlayed = false;
    this.nukeProgressDirty = true;

    this.cameras.main.shake(600, 0.05);

    // Full-screen white flash. Hold at full opacity for 120ms before
    // fading so on Real-time (100 bps respawning behind the flash) the
    // "nuke just happened" beat is unambiguous.
    const flash = this.add
      .rectangle(
        this.scale.width / 2,
        this.scale.height / 2,
        this.scale.width,
        this.scale.height,
        0xffffff,
        1
      )
      .setDepth(700);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 700,
      delay: 120,
      ease: "Cubic.out",
      onComplete: () => flash.destroy(),
    });

    // Big "NUKE" text in the middle of the flash so players in chaotic
    // modes can't miss that it actually fired.
    this.flashText("NUKE", 0xffd26d);

    // Particle sheet — 50 is plenty against the flash + shake. 80 was
    // a measurable hitch on Real-time where the game loop is already
    // spawning 100 blocks/sec.
    const sparkKey = this.textures.exists("spark") ? "spark" : "__DEFAULT";
    const burst = this.add.particles(this.scale.width / 2, this.scale.height / 2, sparkKey, {
      lifespan: { min: 400, max: 900 },
      speed: { min: 260, max: 700 },
      angle: { min: 0, max: 360 },
      scale: { start: sparkKey === "spark" ? 1.1 : 2.2, end: 0 },
      alpha: { start: 1, end: 0 },
      rotate: { start: 0, end: 360 },
      quantity: 50,
      tint: [0xffffff, 0xffd26d, 0xff9d3a, 0xff3a3a],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    burst.explode(50);
    this.time.delayedCall(1100, () => burst.destroy());

    // Destroy all descending blocks + all stacked blocks. Nuke is a survival
    // tool, not a scoring tool — cleared blocks don't score.
    for (const b of this.blocks) b.destroyQuiet();
    this.blocks = [];
    for (let col = 0; col < this.stack.length; col++) {
      for (const s of this.stack[col]) s.destroyQuiet();
      this.stack[col] = [];
    }

    // Reset streak to zero per the spec.
    this.streak = 0;
    this.applyHeat();
    this.emitCombo();
  }

  // ─── Sweep beam ──────────────────────────────────────────────────────────

  private tickSweep(delta: number) {
    // Not available in Easy mode.
    if (this.cfg.modeId === 0) {
      this.sweepGraphics?.clear();
      return;
    }

    const held = this.pointerActive;
    const heldLongEnough = held && this.time.now - this.pointerDownAt >= SWEEP_HOLD_THRESHOLD_MS;

    if (
      heldLongEnough &&
      !this.sweepActive &&
      this.sweepArmedForThisHold &&
      this.sweepFuelMs > SWEEP_FUEL_MAX_MS * 0.08
    ) {
      this.startSweep();
    }

    if (this.sweepActive) {
      this.sweepFuelMs -= delta;
      if (this.sweepFuelMs <= 0) {
        this.sweepFuelMs = 0;
        // Burn-out: disarm until pointerup → next pointerdown rearms. This
        // stops the beam from strobing on/off while fuel recharges under
        // a still-held finger.
        this.sweepArmedForThisHold = false;
        this.stopSweep();
      } else {
        this.drawSweep();
        this.damageWithSweep(delta);
      }
    } else if (this.sweepFuelMs < SWEEP_FUEL_MAX_MS) {
      // Recharging while idle — linear over SWEEP_RECHARGE_MS
      const rechargeRate = SWEEP_FUEL_MAX_MS / SWEEP_RECHARGE_MS;
      this.sweepFuelMs = Math.min(
        SWEEP_FUEL_MAX_MS,
        this.sweepFuelMs + rechargeRate * delta
      );
      this.sweepGraphics?.clear();
    } else {
      this.sweepGraphics?.clear();
    }

    // Emit fuel at ~6Hz to drive the HUD without flooding React
    if (this.time.now - this.lastSweepFuelEmit > 160) {
      this.emitSweepFuel(false);
    }
  }

  private startSweep() {
    this.sweepActive = true;
    this.cameras.main.shake(180, 0.004, true);
    // One-shot whoosh on activation — looping a short .wav on mobile
    // WebAudio triggers constant buffer-source scheduling and stalls frames.
    // If a dedicated looping sweep sample lands later, switch back; until
    // then a single play gives the sensory feedback without the frame cost.
    this.sfx(SFX.SWEEP, { volume: 0.4, rate: 1.1 });
  }

  private stopSweep() {
    if (!this.sweepActive) return;
    this.sweepActive = false;
    this.sweepGraphics?.clear();
  }

  private drawSweep() {
    if (!this.sweepGraphics) return;
    const g = this.sweepGraphics;
    g.clear();
    const startX = this.scale.width / 2;
    const startY = this.scale.height - 8;
    const endX = this.pointerWorldX;
    const endY = this.pointerWorldY;

    // Two-band beam: glow (semi-transparent, 10px) + bright core (2px white).
    // The earlier 3-layer additive-blend build froze Canvas-renderer builds
    // on Medium+ — per-frame thick-stroked additive lines are one of the
    // Canvas 2D path's worst code paths. Two passes, no additive blend.
    g.lineStyle(10, SWEEP_GREEN, 0.55);
    g.beginPath();
    g.moveTo(startX, startY);
    g.lineTo(endX, endY);
    g.strokePath();

    g.lineStyle(2, 0xffffff, 0.95);
    g.beginPath();
    g.moveTo(startX, startY);
    g.lineTo(endX, endY);
    g.strokePath();
  }

  private damageWithSweep(delta: number) {
    // Damage cadence: ~every 100ms a block inside the beam line takes a hit.
    this.sweepHitAccumulator += delta;
    if (this.sweepHitAccumulator < 100) return;
    this.sweepHitAccumulator = 0;

    const ax = this.scale.width / 2;
    const ay = this.scale.height - 8;
    const bx = this.pointerWorldX;
    const by = this.pointerWorldY;
    if (!Number.isFinite(bx) || !Number.isFinite(by)) return;

    // Snapshot at the start of the tick. A single hit (especially a bomb)
    // can destroy many other blocks via AOE — we must NOT re-hit anything
    // that another block's side-effect already removed from the live
    // `this.blocks` array, or we'll double-explode bombs and double-score
    // normals, stacking redundant visuals.
    const snapshot = this.blocks.slice();
    for (const block of snapshot) {
      if (block.isStacked) continue;
      if (!this.blocks.includes(block)) continue; // removed by a prior hit this tick
      const d = this.pointToSegmentDistance(block.x, block.y, ax, ay, bx, by);
      if (d <= block.halfSize() + 8) {
        this.hitBlock(block);
      }
    }
  }

  private pointToSegmentDistance(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
  ): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  private emitSweepFuel(force: boolean) {
    if (!force && this.cfg.modeId === 0) return;
    this.lastSweepFuelEmit = this.time.now;
    this.cfg.bus.emit(GAME_EVENTS.SWEEP_FUEL, {
      fuel: this.sweepFuelMs / SWEEP_FUEL_MAX_MS,
      available: this.cfg.modeId !== 0,
    });
  }

  // ─── Stack / topout ──────────────────────────────────────────────────────

  private tryStack(b: Block) {
    const col = b.stackColumn;
    const stackHere = this.stack[col];
    const stackTopY =
      this.scale.height - stackHere.length * BLOCK_SIZE - BLOCK_SIZE / 2;
    if (b.y >= stackTopY) {
      // Bomb lands → auto-detonate at the top of the stack
      if (b.isBomb) {
        b.y = stackTopY;
        this.explodeAt(b.x, b.y, false, 0);
        return;
      }
      b.y = stackTopY;
      b.isStacked = true;
      b.setDepth(5);
      stackHere.push(b);
      // Every stacked block is a missed block → break the streak
      this.onMiss();
    }
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
    this.stopSweep();
    // On win: restart the music from the beginning so the celebratory
    // track plays fresh for the overlay without stacking on top of the
    // existing loop. On death: fade out so the die SFX stands alone.
    if (kind === "win") {
      this.restartMusic();
    } else {
      this.stopMusic();
    }

    // Timer-up (win) auto-banks pending so the player doesn't lose a streak
    // they never had the chance to bank manually. Death (over) forfeits
    // pending — that's the risk/reward core of the game loop.
    //
    // CRITICAL: we emit a BANK event for the timer-end auto-bank so the
    // React layer mints the final pending amount via /api/bank. Without
    // this emit, the player's last streak is silently moved to the
    // scene-side `banked` bucket but never actually sent to chain.
    const lostPending = kind === "over" ? this.pending : 0;
    if (kind === "win" && this.pending > 0) {
      const justBanked = this.pending;
      this.banked += justBanked;
      this.pending = 0;
      this.cfg.bus.emit(GAME_EVENTS.BANK, {
        banked: this.banked,
        justBanked,
      });
    } else {
      this.pending = 0;
    }

    // Force-flush any pending HUD updates so the overlay reads the final
    // score/combo, not a 50ms-stale value.
    this.cfg.bus.emit(GAME_EVENTS.SCORE, {
      score: this.banked,
      banked: this.banked,
      pending: 0,
    });
    this.scoreDirty = false;
    if (this.comboDirty) {
      this.emitCombo();
      this.comboDirty = false;
    }

    // Only play the death stinger on loss — the restarted music covers
    // the win case so we don't layer two copies of the same track.
    if (kind === "over") {
      this.sfx(SFX.DIE, { volume: 0.6 });
    }
    const evt = kind === "win" ? GAME_EVENTS.GAME_WIN : GAME_EVENTS.GAME_OVER;
    this.cfg.bus.emit(evt, { score: this.banked, lostPending });
  }

  /**
   * Commit pending points to banked. Resets streak — player has to rebuild
   * from 1x to earn the next 3x window. No-op if pending is zero. Does NOT
   * end the game.
   */
  public bank() {
    if (this.state !== "running") return;
    if (this.pending <= 0) return;

    const justBanked = this.pending;
    this.banked += this.pending;
    this.pending = 0;
    this.streak = 0;
    // Banking doesn't touch nukeProgress / nukeChimePlayed — kills
    // accumulate toward the nuke regardless of how the player earns them.

    this.sfx(SFX.STREAK, { volume: 0.55, rate: 1.25 });

    // Flash + tiny camera bump so the commit feels satisfying.
    const flash = this.add
      .rectangle(
        this.scale.width / 2,
        this.scale.height / 2,
        this.scale.width,
        this.scale.height,
        0x6dd0a9,
        0.25
      )
      .setDepth(450);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 260,
      onComplete: () => flash.destroy(),
    });
    this.cameras.main.shake(120, 0.004);

    // Banking collapses heat — the streak is gone.
    this.applyHeat();
    this.emitCombo();

    this.cfg.bus.emit(GAME_EVENTS.BANK, {
      banked: this.banked,
      justBanked,
    });
    this.cfg.bus.emit(GAME_EVENTS.SCORE, {
      score: this.banked,
      banked: this.banked,
      pending: 0,
    });
  }

  /**
   * Kept as an alias so external handles that call `bankEarly()` still work.
   * The semantics changed: it no longer ends the game — it banks pending
   * and returns the player to active play.
   */
  public bankEarly() {
    this.bank();
  }

  /**
   * Instantly refill the sweep fuel bar. Called after /api/sweep-reload
   * confirms a 25-$BLOK spend. Safe to call mid-game; the beam picks up
   * from a full tank on the next hold.
   */
  public refillSweep() {
    if (this.state !== "running") return;
    if (this.cfg.modeId === 0) return; // no sweep on Easy
    this.sweepFuelMs = SWEEP_FUEL_MAX_MS;
    this.sweepArmedForThisHold = true;
    this.emitSweepFuel(true);
    const flash = this.add
      .rectangle(
        this.scale.width / 2,
        this.scale.height / 2,
        this.scale.width,
        this.scale.height,
        0x6dd0a9,
        0.2
      )
      .setDepth(450);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 260,
      onComplete: () => flash.destroy(),
    });
  }
}
