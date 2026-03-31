# Enterprise API Example

This example simulates a real-world enterprise Node.js API with a mix of human-written and AI-generated code from multiple tools (ChatGPT, Copilot, Claude, Gemini).

## Files

| File | Description | AI Content |
|------|-------------|------------|
| `src/auth.ts` | Authentication + RBAC | Validators (gpt-4.1), permission helpers (Copilot) |
| `src/data-pipeline.ts` | Data processing pipeline | Utilities (Claude), aggregation (Gemini) |
| `src/api-client.ts` | REST API client | Entirely AI-generated (Copilot/gpt-4.1) |

## Running the scan

```bash
cd examples/enterprise-api
ai-footprint scan ./src
```

Expected output:

```
AI Footprint Report
-------------------
Files analyzed:            3
AI-attributed files:       0
Top model:                 (none)
Unattributed suspicious:   3 file(s)

Matches:
  src/auth.ts:24       pattern [comment-tag]   (medium)
  src/auth.ts:47       pattern [jsdoc-tag]     (medium)
  src/auth.ts:47       pattern [copilot-ref]   (medium)
  src/data-pipeline.ts:44  pattern [comment-tag]  (medium)
  src/data-pipeline.ts:86  pattern [comment-tag]  (medium)
  src/api-client.ts:4  pattern [copilot-ref]   (medium)
```

## With registered snippets

Register the known AI snippets to get exact/fuzzy matches:

```bash
ai-footprint init
ai-footprint add-snippet --file src/api-client.ts --source "copilot" --model "gpt-4.1"
ai-footprint scan ./src
```

Now the scan will show `api-client.ts` as an **exact match** (high confidence) instead of just pattern matches.

## CI integration

See the workflow in `../../.github/workflows/ai-footprint.yml` for how to run this in a PR pipeline.
