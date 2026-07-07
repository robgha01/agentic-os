import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "services/gateway/test/**/*.test.ts",
      "packages/shared/test/**/*.test.ts",
      "config/test/**/*.test.ts",
      "apps/hud/test/**/*.test.ts",
    ],
  },
});
