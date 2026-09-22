/**
 * The compose file shown in docs/deployment.md is the one the release ships.
 *
 * The page shows compose.yaml in full, so an operator reads what they are
 * about to run; a copy that drifted from the file would describe an instance
 * nobody gets. This gate compares the two, byte for byte.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const doc = readFileSync(path.join(ROOT, "docs", "deployment.md"), "utf8");
const compose = readFileSync(path.join(ROOT, "compose.yaml"), "utf8");

const shown = /<!-- compose\.yaml: begin -->\n```yaml\n([\s\S]*?)```\n<!-- compose\.yaml: end -->/.exec(doc)?.[1];
if (shown === undefined) {
  console.error("✗ docs/deployment.md does not show compose.yaml between its markers");
  process.exit(1);
}
if (shown !== compose) {
  console.error("✗ the compose.yaml shown in docs/deployment.md differs from the file — copy the file into the page");
  process.exit(1);
}
console.log("✓ docs/deployment.md shows compose.yaml as it is");
