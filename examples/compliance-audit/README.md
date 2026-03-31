# Compliance Audit Example

This example demonstrates how to build enterprise AI code governance on top of AI Footprint's scan results.

## Policy rules

| Rule | Severity | Description |
|------|----------|-------------|
| AI-001 | Critical | AI code ratio must not exceed 40% of codebase |
| AI-002 | High | All AI-generated code must be attributed |
| AI-003 | High | All AI snippets must be registered in the registry |
| AI-004 | Medium | Fuzzy matches should be reviewed and registered |

## Usage

```bash
# Run the audit with simulated data
npx tsx examples/compliance-audit/run-audit.ts
```

Expected output:

```
=== Enterprise AI Code Governance Policy v1.0.0 ===
Enforcement: block

✅ [AI-001] AI code ratio must not exceed 40% of total codebase
   AI code ratio: 19.7% (limit: 40%)
   28 of 142 files
❌ [AI-002] All AI-generated code must be attributed (no suspicious unattributed code)
   3 file(s) contain unattributed AI code
✅ [AI-003] All AI snippets must be registered in the snippet registry
   22 snippet(s) registered and matched
✅ [AI-004] Fuzzy matches should be reviewed and registered
   4 fuzzy match(es) — within tolerance

AUDIT FAILED
```

## Integration with CI

Add the audit as a post-scan step in your GitHub Action workflow:

```yaml
- name: AI Footprint Scan
  uses: ./action
  with:
    fail-on-unattributed: "true"
    fail-threshold: "0"

- name: Run Compliance Audit
  run: npx tsx examples/compliance-audit/run-audit.ts
```

## Customization

Edit `audit-policy.ts` to adjust:

- **Thresholds** — change the 40% AI code ratio limit
- **Enforcement** — `warn` (log only), `block` (fail CI), `report` (post comment)
- **Rules** — add custom checks for your organization's requirements
