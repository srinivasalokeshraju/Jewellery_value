// Fails on any high or critical npm advisory except those listed in ALLOWED.
// Usage: node .github/scripts/audit.mjs <directory with package-lock.json>
import { spawnSync } from "node:child_process";

// Each entry needs a reason. Remove an entry as soon as a patched version exists.
const ALLOWED = new Map([
  ["GHSA-fc5q-39xc-vjpf", "picomatch <=4.0.7, no patched release yet; reached only through build tooling in agents (vite, rolldown)"],
]);

const dir = process.argv[2] ?? ".";
const run = spawnSync("npm", ["audit", "--json"], { cwd: dir, encoding: "utf8" });
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error(`npm audit in ${dir} did not return JSON:\n${run.stderr}`);
  process.exit(1);
}
if (report.error) {
  console.error(`npm audit in ${dir} failed: ${JSON.stringify(report.error)}`);
  process.exit(1);
}

const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== "object") continue;
    if (via.severity !== "high" && via.severity !== "critical") continue;
    const id = via.url.split("/").pop();
    advisories.set(id, `${via.severity} ${via.name} ${via.range}: ${via.title}`);
  }
}

let failed = false;
for (const [id, summary] of advisories) {
  if (ALLOWED.has(id)) {
    console.log(`::warning::Allowed ${id} (${summary}). Reason: ${ALLOWED.get(id)}`);
  } else {
    console.error(`::error::${id} ${summary}`);
    failed = true;
  }
}
console.log(`${dir}: ${advisories.size} high or critical advisories, ${failed ? "failing" : "passing"}.`);
process.exit(failed ? 1 : 0);
