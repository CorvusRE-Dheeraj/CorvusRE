import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Same SITE_BASE convention as apps/pt and apps/dp -- defaults to "/" for
// local dev, set to "/auth/" in CI so this builds for its real path under
// the CorvusRE hub.
const base = process.env.SITE_BASE || "/";

export default defineConfig({
  base,
  plugins: [react()],
  // Matches apps/pt and apps/dp's TanStack Start output path so the CI
  // workflow's artifact-upload step (apps/identity/dist/client) doesn't
  // need a special case for this app being a plain Vite SPA.
  build: {
    outDir: "dist/client",
  },
});
