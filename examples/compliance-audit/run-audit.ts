import { ENTERPRISE_POLICY, runAudit } from "./audit-policy.js";
import type { AuditContext } from "./audit-policy.js";

// Simulate scan results (in practice, parse from `ai-footprint scan --json`)
const context: AuditContext = {
  totalFiles: 142,
  aiAttributedFiles: 28,
  unattributedSuspicious: 3,
  topModel: "gpt-4.1",
  fuzzyMatches: 4,
  exactMatches: 22,
  patternMatches: 9,
};

const audit = runAudit(ENTERPRISE_POLICY, context);
console.log(audit.summary);
process.exit(audit.passed ? 0 : 1);
