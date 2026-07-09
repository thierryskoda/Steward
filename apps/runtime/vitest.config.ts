import { defineConfig } from "vitest/config";

// Single-file runs: pass path (e.g. pnpm test -- src/core/env.test.ts), not substring.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
  },
});
