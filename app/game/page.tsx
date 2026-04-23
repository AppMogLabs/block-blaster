"use client";

import { Suspense } from "react";
import { GameView } from "./GameView";

export default function GamePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center mono text-moon-white/60">loading…</div>}>
      <GameView />
    </Suspense>
  );
}
