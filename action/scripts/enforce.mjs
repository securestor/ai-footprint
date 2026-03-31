#!/usr/bin/env node
// Enforce policy: fail the build if unattributed AI code exceeds threshold.

const report = JSON.parse(process.env.AI_FOOTPRINT_REPORT || "{}");
const threshold = parseInt(process.env.FAIL_THRESHOLD || "0", 10);
const unattributed = report.unattributedSuspicious ?? 0;

if (threshold === 0 && unattributed > 0) {
  console.error(`::error::AI Footprint policy violation: ${unattributed} file(s) contain unattributed AI-generated code.`);
  process.exit(1);
} else if (threshold > 0 && unattributed > threshold) {
  console.error(`::error::AI Footprint policy violation: ${unattributed} unattributed file(s) exceed threshold of ${threshold}.`);
  process.exit(1);
} else {
  console.log(`AI Footprint policy check passed (${unattributed} unattributed, threshold: ${threshold || "any"}).`);
}
