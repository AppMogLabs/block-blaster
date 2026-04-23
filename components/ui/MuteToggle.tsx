"use client";

import { useEffect, useState } from "react";
import { MUTE_KEY } from "@/game/config/sounds";

/**
 * Tiny localStorage-backed mute toggle. Phaser's `scene.sound.mute` reads
 * the same key on scene boot (BootScene). Toggling at runtime also flips
 * any already-started AudioContext via a custom event that GameCanvas listens for.
 */
export function MuteToggle() {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_KEY) === "1");
  }, []);

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    window.dispatchEvent(new CustomEvent("bb:mute", { detail: next }));
  };

  return (
    <button
      onClick={toggle}
      className="text-moon-white/60 hover:text-moon-white text-xs mono transition-colors"
      aria-label={muted ? "Unmute" : "Mute"}
      title={muted ? "Unmute (M)" : "Mute (M)"}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
