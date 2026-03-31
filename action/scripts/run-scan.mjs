#!/usr/bin/env node
// Run the AI Footprint scan and set GitHub Actions outputs.

import { resolve } from "node:path";
import { appendFileSync } from "node:fs";
import { scan } from "../../cli/scanner.js";

const scanPath = resolve(process.env.SCAN_PATH || ".");
const threshold = parseFloat(process.env.FUZZY_THRESHOLD || "0.6");

const report = scan(scanPath, {
  fuzzy: true,
  fuzzyThreshold: threshold,
});

// Write outputs
const outputFile = process.env.GITHUB_OUTPUT;
const envFile = process.env.GITHUB_ENV;

function setOutput(name, value) {
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`::set-output name=${name}::${value}`);
}

setOutput("files-analyzed", report.filesAnalyzed);
setOutput("ai-attributed", report.aiAttributedFiles);
setOutput("unattributed-suspicious", report.unattributedSuspicious);
setOutput("top-model", report.topModel ?? "none");
setOutput("total-matches", report.matches.length);
setOutput("report-json", JSON.stringify(report));

// Store report in env for downstream steps
if (envFile) {
  appendFileSync(envFile, `AI_FOOTPRINT_REPORT<<EOF\n${JSON.stringify(report)}\nEOF\n`);
}

// Console summary
console.log("");
console.log("AI Footprint Report");
console.log("-------------------");
console.log(`Files analyzed:          ${report.filesAnalyzed}`);
console.log(`AI-attributed files:     ${report.aiAttributedFiles}`);
console.log(`Top model:               ${report.topModel ?? "(none)"}`);
console.log(`Unattributed suspicious: ${report.unattributedSuspicious} file(s)`);
console.log(`Total matches:           ${report.matches.length}`);
console.log("");
