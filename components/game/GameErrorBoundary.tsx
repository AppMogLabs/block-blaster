"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Called when the user clicks Retry. Should remount the boundary's children. */
  onReset?: () => void;
};

type State = {
  error: Error | null;
};

/**
 * Catches crashes inside the Phaser canvas + React HUD subtree. Phaser errors
 * (missing asset, WebGL context loss, scene bugs) are async and will bubble
 * up on the next React render — this boundary shows a retry card instead of
 * leaving the route blank.
 */
export class GameErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Structured log — Vercel/Datadog pick this up by level.
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        route: "game.canvas",
        event: "boundary_caught",
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
      })
    );
  }

  private handleRetry = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-night-sky/95"
        role="alert"
        aria-live="assertive"
      >
        <div className="glass rounded-lg p-6 max-w-sm text-center flex flex-col gap-4">
          <div className="mono uppercase text-xs text-moon-white/60">
            something broke
          </div>
          <div className="text-moon-white text-lg font-medium">
            The game crashed mid-run.
          </div>
          <div className="text-moon-white/60 text-xs break-words mono">
            {this.state.error.message || "unknown error"}
          </div>
          <button onClick={this.handleRetry} className="btn-primary">
            Retry
          </button>
          <a href="/" className="text-moon-white/50 text-xs hover:text-moon-white">
            ← Back to home
          </a>
        </div>
      </div>
    );
  }
}
