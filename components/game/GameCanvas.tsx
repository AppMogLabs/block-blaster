"use client";

import { useEffect, useRef } from "react";
import type Phaser from "phaser";
import { GAME_EVENTS } from "@/game/config/events";

export type GameCanvasHandle = {
  bank: () => void;
  /** Legacy alias — older callers may still reference this name. */
  bankEarly: () => void;
  triggerNuke: () => void;
  refillSweep: () => void;
  pause: () => void;
  resume: () => void;
  destroy: () => void;
};

export type GameCanvasProps = {
  modeId: 0 | 1 | 2 | 3;
  blocksPerSecond: number;
  durationSec: number;
  startingBlockNumber?: number;
  onScore: (score: number, banked: number, pending: number) => void;
  onCombo: (combo: number, multiplier: number) => void;
  onTimer: (remainingSec: number) => void;
  onGameWin: (score: number, lostPending: number) => void;
  onGameOver: (score: number, lostPending: number) => void;
  onReady?: () => void;
  onStreak?: (streak: number, heatLevel: number) => void;
  onNukeProgress?: (kills: number, threshold: number) => void;
  onSweepFuel?: (fuel: number, available: boolean) => void;
  onBank?: (banked: number, justBanked: number) => void;
  /**
   * Fired when a rare/gold block is destroyed. `x`/`y` are viewport coords
   * (already translated from the canvas) so React can drop coin sprites
   * directly onto the page. `amount` is the multiplied points awarded.
   */
  onGoldAward?: (p: { x: number; y: number; amount: number }) => void;
  registerHandle?: (h: GameCanvasHandle | null) => void;
};

export function GameCanvas(props: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<Phaser.Scene | null>(null);
  // Keep the latest callbacks in a ref so the effect can run mount-once.
  const cbRef = useRef(props);
  cbRef.current = props;

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const Phaser = (await import("phaser")).default;
      const { BootScene } = await import("@/game/scenes/BootScene");
      const { GameScene } = await import("@/game/scenes/GameScene");

      if (cancelled || !hostRef.current) return;

      const bus = new Phaser.Events.EventEmitter();
      bus.on(GAME_EVENTS.SCORE, (p: { score: number; banked: number; pending: number }) =>
        cbRef.current.onScore(p.score, p.banked, p.pending)
      );
      bus.on(GAME_EVENTS.COMBO, (p: { combo: number; multiplier: number }) =>
        cbRef.current.onCombo(p.combo, p.multiplier)
      );
      bus.on(GAME_EVENTS.TIMER, ({ remainingSec }: { remainingSec: number }) =>
        cbRef.current.onTimer(remainingSec)
      );
      bus.on(GAME_EVENTS.GAME_WIN, (p: { score: number; lostPending: number }) =>
        cbRef.current.onGameWin(p.score, p.lostPending)
      );
      bus.on(GAME_EVENTS.GAME_OVER, (p: { score: number; lostPending: number }) =>
        cbRef.current.onGameOver(p.score, p.lostPending)
      );
      bus.on(GAME_EVENTS.READY, () => cbRef.current.onReady?.());
      bus.on(GAME_EVENTS.STREAK, (p: { streak: number; heatLevel: number }) =>
        cbRef.current.onStreak?.(p.streak, p.heatLevel)
      );
      bus.on(GAME_EVENTS.NUKE_PROGRESS, (p: { kills: number; threshold: number }) =>
        cbRef.current.onNukeProgress?.(p.kills, p.threshold)
      );
      bus.on(GAME_EVENTS.SWEEP_FUEL, (p: { fuel: number; available: boolean }) =>
        cbRef.current.onSweepFuel?.(p.fuel, p.available)
      );
      bus.on(GAME_EVENTS.BANK, (p: { banked: number; justBanked: number }) =>
        cbRef.current.onBank?.(p.banked, p.justBanked)
      );
      bus.on(
        GAME_EVENTS.GOLD_AWARD,
        (p: { x: number; y: number; amount: number }) => {
          // Translate from canvas-internal coords to viewport coords so the
          // React overlay can drop coin sprites at the exact screen point.
          const host = hostRef.current;
          if (!host) return;
          const rect = host.getBoundingClientRect();
          // Phaser uses CSS-pixel coords already (Scale.RESIZE keeps the
          // canvas internal size matching the display size), so just add
          // the host's top-left offset.
          cbRef.current.onGoldAward?.({
            x: rect.left + p.x,
            y: rect.top + p.y,
            amount: p.amount,
          });
        }
      );

      const width = hostRef.current.clientWidth;
      const height = hostRef.current.clientHeight;

      const game = new Phaser.Game({
        // AUTO picks WebGL when available, falls back to Canvas. The Canvas
        // renderer chokes on per-frame thick-stroked graphics with additive
        // blend (the sweep beam does exactly that), causing frame stalls on
        // Medium+. WebGL handles it trivially.
        type: Phaser.AUTO,
        parent: hostRef.current,
        backgroundColor: "#19191A",
        width,
        height,
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        input: { activePointers: 2 },
        scene: [BootScene, GameScene], // BootScene is first — Phaser auto-starts it
        // But GameScene is registered but NOT auto-started; we launch it manually.
      });
      gameRef.current = game;

      // Once BootScene finishes, start GameScene *with* the config.
      game.events.once("boot-ready", () => {
        if (cancelled) return;
        const sceneConfig = {
          modeId: props.modeId,
          blocksPerSecond: props.blocksPerSecond,
          durationSec: props.durationSec,
          bus,
          startingBlockNumber: props.startingBlockNumber,
        };
        game.scene.start("GameScene", sceneConfig);
        // Grab a ref for bankEarly() + triggerNuke()
        const scene = game.scene.getScene("GameScene");
        sceneRef.current = scene ?? null;
      });

      cbRef.current.registerHandle?.({
        bank: () => {
          const scene = sceneRef.current as unknown as { bank?: () => void } | null;
          scene?.bank?.();
        },
        bankEarly: () => {
          const scene = sceneRef.current as unknown as { bank?: () => void } | null;
          scene?.bank?.();
        },
        triggerNuke: () => {
          const scene = sceneRef.current as unknown as {
            triggerNuke?: () => void;
          } | null;
          scene?.triggerNuke?.();
        },
        refillSweep: () => {
          const scene = sceneRef.current as unknown as {
            refillSweep?: () => void;
          } | null;
          scene?.refillSweep?.();
        },
        pause: () => {
          const scene = sceneRef.current;
          if (scene && !scene.scene.isPaused()) scene.scene.pause();
        },
        resume: () => {
          const scene = sceneRef.current;
          if (scene && scene.scene.isPaused()) scene.scene.resume();
        },
        destroy: () => game.destroy(true),
      });

      // Runtime mute toggle from <MuteToggle />
      const onMute = (e: Event) => {
        const detail = (e as CustomEvent<boolean>).detail;
        game.sound.mute = Boolean(detail);
      };
      window.addEventListener("bb:mute", onMute);
      // Store cleanup
      (game as unknown as { __bbCleanup?: () => void }).__bbCleanup = () =>
        window.removeEventListener("bb:mute", onMute);
    }

    boot();

    return () => {
      cancelled = true;
      cbRef.current.registerHandle?.(null);
      const g = gameRef.current as unknown as { __bbCleanup?: () => void } | null;
      g?.__bbCleanup?.();
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once — parent remounts via `key` to change config

  return (
    <div
      ref={hostRef}
      className="w-full h-full touch-none select-none"
    />
  );
}
