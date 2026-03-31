# Enterprise CI Pipeline Example

This example shows a production-grade GitHub Actions workflow that:

1. **Matrix scans** — runs AI Footprint across 5 microservices in parallel
2. **Compliance gate** — blocks the PR if governance rules are violated
3. **Audit trail** — uploads scan reports as build artifacts
4. **Alerting** — notifies the security team on failures

## Workflow overview

```
PR opened
  │
  ├── ai-footprint-scan (platform-api)
  ├── ai-footprint-scan (mobile-app)
  ├── ai-footprint-scan (data-service)     ← matrix jobs (parallel)
  ├── ai-footprint-scan (auth-service)
  └── ai-footprint-scan (web-frontend)
          │
          ▼
  compliance-gate                            ← blocks merge if audit fails
          │
          ▼ (on failure)
  notify                                     ← alerts security team
```

## Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| `fuzzy-threshold` | 0.6 | Minimum similarity for fuzzy matching |
| `fail-on-unattributed` | true | Block PR if unattributed AI code found |
| `fail-threshold` | 5 | Allow up to 5 unattributed files before failing |
| `post-comment` | true | Post results table on the PR |

## Usage

Copy `workflow.yml` to `.github/workflows/ai-governance.yml` in your repo:

```bash
cp examples/enterprise-ci-pipeline/workflow.yml .github/workflows/ai-governance.yml
```

Adjust the `matrix.service` list to match your monorepo structure.
