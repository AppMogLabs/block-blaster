import { describe, it, expect, beforeEach } from "vitest";
import { sessionStore, __resetSessionStore } from "../lib/sessionStore";

describe("sessionStore (memory)", () => {
  beforeEach(() => {
    __resetSessionStore();
    const g = globalThis as {
      __bbSessions?: Map<string, number>;
      __bbMinted?: Map<string, number>;
    };
    g.__bbSessions = new Map();
    g.__bbMinted = new Map();
  });

  it("claim returns true on first call, false on repeat", async () => {
    const s = sessionStore();
    expect(await s.claim("abc")).toBe(true);
    expect(await s.claim("abc")).toBe(false);
  });

  it("separate sessionIds are independent", async () => {
    const s = sessionStore();
    expect(await s.claim("one")).toBe(true);
    expect(await s.claim("two")).toBe(true);
  });

  it("addMinted accumulates across calls", async () => {
    const s = sessionStore();
    expect(await s.addMinted("sess1", 100)).toBe(100);
    expect(await s.addMinted("sess1", 50)).toBe(150);
    expect(await s.addMinted("sess1", 250)).toBe(400);
  });

  it("addMinted is per-session", async () => {
    const s = sessionStore();
    await s.addMinted("a", 100);
    await s.addMinted("b", 999);
    expect(await s.getMinted("a")).toBe(100);
    expect(await s.getMinted("b")).toBe(999);
  });

  it("getMinted returns 0 for unseen session", async () => {
    const s = sessionStore();
    expect(await s.getMinted("never-seen")).toBe(0);
  });

  it("addMinted zero-delta keeps total stable", async () => {
    const s = sessionStore();
    expect(await s.addMinted("s", 100)).toBe(100);
    expect(await s.addMinted("s", 0)).toBe(100);
  });
});
