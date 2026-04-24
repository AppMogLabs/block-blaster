"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type ToastKind = "info" | "success" | "error";
export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastContextValue = {
  push: (kind: ToastKind, message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fail soft — toasts are nice-to-have, not critical. Return a no-op
    // rather than throwing so components don't crash on unmounted providers.
    return { push: () => {} };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, message }]);
    // Auto-dismiss after 3.5s — errors linger slightly longer.
    const timeout = kind === "error" ? 5000 : 3500;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, timeout);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center pointer-events-none"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`mono text-xs uppercase px-4 py-2 rounded-md backdrop-blur-md pointer-events-auto ${
              t.kind === "error"
                ? "bg-rose/20 border border-rose/50 text-rose"
                : t.kind === "success"
                  ? "bg-mint/20 border border-mint/50 text-mint"
                  : "bg-moon-white/10 border border-moon-white/30 text-moon-white"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
