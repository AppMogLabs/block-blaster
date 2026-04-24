import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest runs pure-TypeScript module tests from test/unit/. Hardhat keeps
 * its Solidity/Scene tests in test/ (top-level) and has its own runner —
 * the two don't overlap.
 */
export default defineConfig({
  test: {
    include: ["vitest-tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
