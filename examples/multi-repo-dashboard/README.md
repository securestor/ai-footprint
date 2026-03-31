# Multi-Repo Dashboard Example

This example generates synthetic scan history for 5 enterprise repositories to demonstrate the AI Footprint dashboard with realistic data.

## Simulated repositories

| Repo | Files | AI Files | Primary Model | Profile |
|------|-------|----------|---------------|---------|
| platform-api | 340 | 45 | gpt-4.1 | Backend microservice |
| mobile-app | 220 | 62 | claude-3.5-sonnet | React Native app |
| data-service | 180 | 28 | gpt-4.1 | ETL pipeline |
| auth-service | 95 | 12 | codex | Authentication |
| web-frontend | 410 | 98 | gpt-4.1 | Next.js frontend |

## Setup

```bash
# Generate 30 days of synthetic scan history
npx tsx examples/multi-repo-dashboard/setup-demo.ts

# Launch the dashboard
ai-footprint dashboard
# → http://localhost:3120
```

## What you'll see

- **Stat cards** with aggregated numbers from the latest scans
- **Trend chart** showing AI code growth over the past 30 days
- **5 repo cards** each with their own sparkline trend
- **Match table** with the latest detection results

## Dashboard API

```bash
# Get all scan history
curl http://localhost:3120/api/history | jq '.entries | length'
# → 150

# Get per-repo summaries
curl http://localhost:3120/api/repos | jq '.[].repo'
# → "platform-api", "mobile-app", "data-service", "auth-service", "web-frontend"

# Trigger a live scan
curl -X POST http://localhost:3120/api/scan | jq '.report.filesAnalyzed'
```

## Extending

To add your own repos to the dashboard, simply run `ai-footprint scan` from each repo's root — results are automatically persisted and appear in the dashboard on next load.
