import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone from vite.config.ts on purpose — that config is wrapped by
// @lovable.dev/vite-tanstack-config, which pulls in the TanStack Start SSR
// plugin chain, nitro, and sandbox-only server settings that a unit test
// has no business loading. Just the "@" alias tests actually need.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    globals: true,
    exclude: ["node_modules/**", "e2e/**"],
  },
});
