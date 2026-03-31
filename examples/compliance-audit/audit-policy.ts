
export interface AuditPolicy {
  name: string;
  version: string;
  rules: AuditRule[];
  enforcement: "warn" | "block" | "report";
}

export interface AuditRule {
  id: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  check: (context: AuditContext) => AuditResult;
}

export interface AuditContext {
  totalFiles: number;
  aiAttributedFiles: number;
  unattributedSuspicious: number;
  topModel: string | null;
  fuzzyMatches: number;
  exactMatches: number;
  patternMatches: number;
}

export interface AuditResult {
  passed: boolean;
  message: string;
  details?: string;
}

// ── Enterprise compliance rules ──────────────────────────────────────

export const ENTERPRISE_POLICY: AuditPolicy = {
  name: "Enterprise AI Code Governance Policy",
  version: "1.0.0",
  enforcement: "block",
  rules: [
    {
      id: "AI-001",
      description: "AI code ratio must not exceed 40% of total codebase",
      severity: "critical",
      check: (ctx) => {
        const ratio = ctx.totalFiles > 0 ? ctx.aiAttributedFiles / ctx.totalFiles : 0;
        return {
          passed: ratio <= 0.4,
          message: `AI code ratio: ${(ratio * 100).toFixed(1)}% (limit: 40%)`,
          details: `${ctx.aiAttributedFiles} of ${ctx.totalFiles} files`,
        };
      },
    },
    {
      id: "AI-002",
      description: "All AI-generated code must be attributed (no suspicious unattributed code)",
      severity: "high",
      check: (ctx) => ({
        passed: ctx.unattributedSuspicious === 0,
        message: ctx.unattributedSuspicious === 0
          ? "All AI code is attributed"
          : `${ctx.unattributedSuspicious} file(s) contain unattributed AI code`,
      }),
    },
    {
      id: "AI-003",
      description: "All AI snippets must be registered in the snippet registry",
      severity: "high",
      check: (ctx) => ({
        passed: ctx.patternMatches === 0 || ctx.exactMatches > 0,
        message: ctx.exactMatches > 0
          ? `${ctx.exactMatches} snippet(s) registered and matched`
          : "No registered snippets found — patterns detected without attribution",
      }),
    },
    {
      id: "AI-004",
      description: "Fuzzy matches should be reviewed and registered",
      severity: "medium",
      check: (ctx) => ({
        passed: ctx.fuzzyMatches <= 5,
        message: ctx.fuzzyMatches <= 5
          ? `${ctx.fuzzyMatches} fuzzy match(es) — within tolerance`
          : `${ctx.fuzzyMatches} fuzzy match(es) — review and register these snippets`,
      }),
    },
  ],
};

// ── Audit runner ─────────────────────────────────────────────────────

export function runAudit(policy: AuditPolicy, context: AuditContext): {
  passed: boolean;
  results: Array<{ rule: AuditRule; result: AuditResult }>;
  summary: string;
} {
  const results = policy.rules.map((rule) => ({
    rule,
    result: rule.check(context),
  }));

  const passed = results.every((r) => r.result.passed);

  const summary = [
    `=== ${policy.name} v${policy.version} ===`,
    `Enforcement: ${policy.enforcement}`,
    "",
    ...results.map((r) => {
      const icon = r.result.passed ? "✅" : "❌";
      return `${icon} [${r.rule.id}] ${r.rule.description}\n   ${r.result.message}${r.result.details ? `\n   ${r.result.details}` : ""}`;
    }),
    "",
    passed ? "AUDIT PASSED" : "AUDIT FAILED",
  ].join("\n");

  return { passed, results, summary };
}
