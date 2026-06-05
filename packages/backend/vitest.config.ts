import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["./test/helpers/globalSetup.ts"],
    // Embedded Postgres takes a few seconds to boot; allow headroom.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // One Postgres instance is shared, so run files serially to keep test
    // isolation deterministic (each test calls resetDb()).
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
