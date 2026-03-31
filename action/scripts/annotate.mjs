#!/usr/bin/env node
// Post GitHub Actions check annotations for each AI-code match.

const report = JSON.parse(process.env.AI_FOOTPRINT_REPORT || "{}");
const matches = report.matches || [];

for (const m of matches) {
  const level = m.confidence === "high" ? "warning" : "notice";
  const title = m.snippet
    ? `AI code detected (${m.matchType ?? "exact"}) — ${m.snippet.model ?? m.snippet.source}`
    : `AI code pattern: ${m.pattern}`;
  const message = m.similarity != null
    ? `${title} [${Math.round(m.similarity * 100)}% similar]`
    : title;

  console.log(`::${level} file=${m.file},line=${m.line},title=AI Footprint::${message}`);
}

if (matches.length > 0) {
  console.log(`\n::notice::AI Footprint found ${matches.length} match(es) across ${report.filesAnalyzed} files.`);
}
