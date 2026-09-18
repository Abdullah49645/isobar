// Assembles ui/src/index.html + styles.css + the esbuild engine bundle +
// app.js (+ whatif.js / pareto.js once they exist) into one self-contained
// published page at ui/dist/index.html. Run: node ui/build.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "src");
const DIST = join(__dirname, "dist");
mkdirSync(DIST, { recursive: true });

function read(path, fallback) {
  return existsSync(path) ? readFileSync(path, "utf8") : fallback || "";
}

let html = readFileSync(join(SRC, "index.html"), "utf8");
const styles = readFileSync(join(SRC, "styles.css"), "utf8");
const engine = readFileSync(join(__dirname, "..", "engine.bundle.js"), "utf8");
const logic = readFileSync(join(SRC, "logic.js"), "utf8");
const app = readFileSync(join(SRC, "app.js"), "utf8");
const whatif = read(join(SRC, "whatif.js"), "/* whatif module not built yet */");
const pareto = read(join(SRC, "pareto.js"), "/* pareto module not built yet */");
const globe = read(join(SRC, "globe.js"), "/* globe module not built yet */");
const satellite = read(join(SRC, "satellite.js"), "/* satellite module not built yet */");

html = html
  .replace("/*__STYLES__*/", () => styles)
  .replace("/*__ENGINE__*/", () => engine)
  .replace("/*__LOGIC__*/", () => logic)
  .replace("/*__WHATIF__*/", () => whatif)
  .replace("/*__PARETO__*/", () => pareto)
  .replace("/*__GLOBE__*/", () => globe)
  .replace("/*__SATELLITE__*/", () => satellite)
  .replace("/*__APP__*/", () => app);

const outPath = join(DIST, "index.html");
writeFileSync(outPath, html, "utf8");
console.log(`Built ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);
