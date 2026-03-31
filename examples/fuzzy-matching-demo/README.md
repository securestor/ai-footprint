# Fuzzy Matching Demo

This example demonstrates AI Footprint's fuzzy matching engine — how it detects AI-generated code even after a developer has renamed variables, changed types, or added parameters.

## Files

| File | Description |
|------|-------------|
| `original-snippet.ts` | The original AI-generated code (registered as a snippet) |
| `modified-code.ts` | A modified version with renamed variables and different types |

## What changed

| Original | Modified |
|----------|----------|
| `parseQueryString` | `extractQueryParams` |
| `Record<string, string>` | `Map<string, string>` |
| `params` | `result` |
| `queryString` | `qs` |
| `pair` | `segment` |
| `key, value` | `k, v` |
| `buildQueryString` | `constructQueryString` |
| *(no filter param)* | `filter?: (key: string) => boolean` |

Despite **8 differences**, the structural logic is identical — AI Footprint detects this.

## How it works

1. **Structural tokenization** — replaces identifiers with `ID`, strings with `STR`, numbers with `NUM`
2. **N-gram shingling** — creates overlapping 3-token windows from both files
3. **Jaccard similarity** — compares shingle sets (`intersection / union`)
4. **Weighted score** — `0.4 × token_similarity + 0.6 × structural_similarity`

## Running the demo

```bash
# Register the original snippet
ai-footprint init
ai-footprint add-snippet --file examples/fuzzy-matching-demo/original-snippet.ts \
  --source chatgpt --model gpt-4.1

# Scan the modified file
ai-footprint scan examples/fuzzy-matching-demo/modified-code.ts
```

Expected output:

```
AI Footprint Report
-------------------
Files analyzed:            1
AI-attributed files:       1
Top model:                 gpt-4.1
Unattributed suspicious:   0

Matches:
  modified-code.ts:6    fuzzy   similarity=0.82  (gpt-4.1 via chatgpt)
```

The modified code is flagged as a **fuzzy match** with ~82% similarity to the registered snippet.
