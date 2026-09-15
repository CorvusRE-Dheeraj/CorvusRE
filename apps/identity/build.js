// Placeholder build — proves the workspace/CI wiring end-to-end before
// migration Phase 5 replaces this with the real shared sign-in app.
const fs = require("fs");
fs.mkdirSync("dist/client", { recursive: true });
fs.writeFileSync(
  "dist/client/index.html",
  "<!doctype html><html><body><h1>CorvusRE identity — placeholder (Phase 0 scaffold)</h1></body></html>\n",
);
