import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // One shared Postgres. Parallel files deadlock on cascading organization deletes.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: [
      { find: "server-only", replacement: path.resolve(__dirname, "tests/stubs/empty.ts") },
      { find: "@", replacement: path.resolve(__dirname, ".") },
    ],
  },
});
