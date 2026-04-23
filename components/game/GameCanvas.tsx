"use client";

import { useEffect, useRef } from "react";
import type Phaser from "phaser";
import { GAME_EVENTS } from "@/game/config/events";

export type GameCanvasHandle = {
  bankEarly: () => void;
  destroy: () => void;
};

export type GameCanvasProps = {
  modeId: 0 | 1 | 2 | 3;
  blocksPerSecond: number;
  durationSec: number;
  startingBlockNumber?: number;
  onScore: (score: number) => void;
  onCombo: (combo: number, multiplier: number) => void;
  onTimer: (remainingSec: number) => void;
  onGameWin: (score: number) => void;
  onGameOver: (score: number) => void;
  onReady?: () => void;
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
      bus.on(GAME_EVENTS.SCORE, ({ score }: { score: number }) => cbRef.current.onScore(score));
      bus.on(GAME_EVENTS.COMBO, (p: { combo: number; multiplier: number }) =>
        cbRef.current.onCombo(p.combo, p.multiplier)
      );
      bus.on(GAME_EVENTS.TIMER, ({ remainingSec }: { remainingSec: number }) =>
        cbRef.current.onTimer(remainingSec)
      );
      bus.on(GAME_EVENTS.GAME_WIN, ({ score }: { score: number }) => cbRef.current.onGameWin(score));
      bus.on(GAME_EVENTS.GAME_OVER, ({ score }: { score: number }) => cbRef.current.onGameOver(score));
      bus.on(GAME_EVENTS.READY, () => cbRef.current.onReady?.());

      const width = hostRef.current.clientWidth;
      const height = hostRef.current.clientHeight;

      const game = new Phaser.Game({
        type: Phaser.CANVAS,
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
        // Grab a ref for bankEarly()
        const scene = game.scene.getScene("GameScene");
        sceneRef.current = scene ?? null;
      });

      cbRef.current.registerHandle?.({
        bankEarly: () => {
          const scene = sceneRef.current as unknown as { bankEarly?: () => void } | null;
          scene?.bankEarly?.();
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
