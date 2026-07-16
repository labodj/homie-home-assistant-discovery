import { execFileSync } from "node:child_process";

const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const packResult = JSON.parse(raw);
const [pack] = Array.isArray(packResult) ? packResult : Object.values(packResult);
const files = pack.files.map((entry) => entry.path).sort();

const allowedFilePatterns = [
  /^README\.md$/,
  /^DOCS\.md$/,
  /^LICENSE$/,
  /^NOTICE$/,
  /^CITATION\.cff$/,
  /^package\.json$/,
  /^dist\/[^.][\w./-]*$/,
  /^docs\/[^.][\w./-]*\.md$/,
  /^examples\/[^.][\w./-]*\.json$/,
];

const requiredFiles = [
  "README.md",
  "DOCS.md",
  "LICENSE",
  "NOTICE",
  "CITATION.cff",
  "package.json",
  "dist/index.js",
  "dist/index.d.ts",
];

const unexpected = files.filter(
  (file) =>
    file.split("/").some((segment) => segment.startsWith(".")) ||
    !allowedFilePatterns.some((pattern) => pattern.test(file)),
);
const missing = requiredFiles.filter((file) => !files.includes(file));

if (unexpected.length > 0 || missing.length > 0) {
  if (unexpected.length > 0) {
    console.error(`Unexpected package files:\n${unexpected.join("\n")}`);
  }
  if (missing.length > 0) {
    console.error(`Missing package files:\n${missing.join("\n")}`);
  }
  process.exit(1);
}

console.log(`Verified ${files.length} packaged file(s).`);
