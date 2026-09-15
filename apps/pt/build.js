// Placeholder build — proves the workspace/CI wiring end-to-end before
// migration Phase 1 replaces this with CorvusPT's real Vite build.
const fs = require("fs");
fs.mkdirSync("dist/client", { recursive: true });
fs.writeFileSync(
  "dist/client/index.html",
  "<!doctype html><html><body><h1>CorvusPT — placeholder (Phase 0 scaffold)</h1></body></html>\n",
);
