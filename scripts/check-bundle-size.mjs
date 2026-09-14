import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 250 * 1024;
const ROUTE = "(app)/p/[projectId]/board/page";
const manifestPath = `.next/server/app/${ROUTE}_client-reference-manifest.js`;

if (!existsSync(manifestPath)) {
  console.error(`Board client manifest not found at ${manifestPath}`);
  process.exit(1);
}

const source = readFileSync(manifestPath, "utf8");
const match = source.match(/= (\{.*\});?\s*$/s);
if (!match?.[1]) {
  console.error(`Could not parse board client manifest at ${manifestPath}`);
  process.exit(1);
}
const manifest = JSON.parse(match[1]);
const files = manifest.entryJSFiles?.[`[project]/src/app/${ROUTE}`];
if (!files) {
  console.error("Board route chunks not found in its client manifest");
  process.exit(1);
}

let total = 0;
for (const file of new Set(files)) {
  if (!file.endsWith(".js")) continue;
  const fullPath = path.join(".next", file);
  statSync(fullPath);
  total += gzipSync(readFileSync(fullPath)).length;
}

const kilobytes = (total / 1024).toFixed(1);
if (total > BUDGET_BYTES) {
  console.error(
    `Board route first-load JS is ${kilobytes} KB gzipped — over the ${BUDGET_BYTES / 1024} KB budget.`,
  );
  process.exit(1);
}

console.log(
  `Board route first-load JS: ${kilobytes} KB gzipped (budget ${BUDGET_BYTES / 1024} KB).`,
);
