# Architecture

## Overview

AI Footprint is a modular system for detecting, attributing, and tracking AI-generated code within Git repositories. It operates at four layers: **core engine**, **CLI**, **CI/CD integration**, and **developer tooling**.

```
┌──────────────────────────────────────────────────────┐
│                    Developer                         │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ VS Code  │  │   CLI    │  │    Dashboard       │  │
│  │Extension │  │          │  │  (localhost:3120)   │  │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
│       │              │                 │              │
├───────┴──────────────┴─────────────────┴──────────────┤
│                  Core Engine                          │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ Hasher   │  │ Matcher  │  │  Fuzzy Engine       │  │
│  │ SHA-256  │  │ Exact +  │  │  N-gram + Jaccard   │  │
│  │          │  │ Pattern  │  │  + Structural       │  │
│  └──────────┘  └──────────┘  └────────────────────┘  │
├───────────────────────────────────────────────────────┤
│               Storage & Integration                   │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ Snippet  │  │   Git    │  │   GitHub Action     │  │
│  │ Registry │  │  Hooks   │  │  (CI/CD pipeline)   │  │
│  │  (JSON)  │  │          │  │                     │  │
│  └──────────┘  └──────────┘  └────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

## Component details

### Core engine (`core/`)

The detection and matching logic shared by all consumers:

| Module | Responsibility |
|--------|----------------|
| `hasher.ts` | Normalize whitespace, compute SHA-256 fingerprints |
| `matcher.ts` | Orchestrate exact, fuzzy, and pattern matching |
| `fuzzy.ts` | N-gram shingling, Jaccard similarity, structural tokenization |
| `types.ts` | Shared interfaces (`Snippet`, `ScanMatch`, `ScanReport`, `ScanOptions`) |

**Matching pipeline** (executed in order):

1. **Exact match** — sliding-window SHA-256 comparison. O(files × snippets × lines).
2. **Fuzzy match** — tokenize → shingle → Jaccard similarity. Configurable threshold (default 60%). Uses both token-level and structural (variable-agnostic) n-grams with a weighted combination (40/60).
3. **Pattern match** — line-by-line regex against known AI markers.

Deduplication: fuzzy matches are suppressed for lines already exact-matched.

### CLI (`cli/`)

| File | Purpose |
|------|---------|
| `index.ts` | Entry point, command router, report printer |
| `registry.ts` | Manage `~/.ai-footprint/snippets.json` (init, load, add) |
| `scanner.ts` | Walk file tree, apply matching, aggregate results |

### Git hooks (`git-hooks/`)

| Hook | Trigger | Action |
|------|---------|--------|
| `pre-commit` | Before commit | Scan staged diff, warn on AI code |
| `commit-msg` | After message written | Append `AI-Footprint:` trailer via `git interpret-trailers` |

Trailers are Git-native metadata: no external storage, fully portable, queryable with `git log --grep`.

### VS Code extension (`extension/`)

Self-contained TypeScript extension (independent build, own `tsconfig.json`):

- **CodeLens** — inline labels above AI-detected lines
- **Diagnostics** — entries in the Problems panel (configurable severity)
- **Decorations** — line highlights with hover details (model, similarity %)
- **Status bar** — live match count
- **Report panel** — webview with full scan results

The extension inlines core matching logic to avoid cross-package dependencies.

### GitHub Action (`action/`)

Composite action with four stages:

1. **run-scan.mjs** — execute scan, set GitHub Actions outputs
2. **annotate.mjs** — post `::warning` / `::notice` annotations per match
3. **comment.mjs** — post formatted summary table as a PR comment
4. **enforce.mjs** — fail the check if unattributed AI code exceeds configurable threshold

### Dashboard (`dashboard/`)

Zero-dependency HTTP server + embedded single-page app:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard UI |
| `/api/scan` | POST | Trigger scan, persist to history |
| `/api/history` | GET | Full scan history |
| `/api/repos` | GET | Per-repo summaries with trend data |
| `/api/health` | GET | Health check |

Scan history is persisted to `~/.ai-footprint/history/scans.json`.

## Data flow

```
            snippet.ts
                │
    ┌───────────▼──────────┐
    │  ai-footprint init   │
    │  ai-footprint add    │
    └───────────┬──────────┘
                │
      ~/.ai-footprint/snippets.json
                │
    ┌───────────▼──────────┐
    │  Scan / Hook         │──── pattern matches (regex)
    │  ┌────────────┐      │
    │  │ Exact hash │      │──── exact matches (SHA-256)
    │  │ Fuzzy sim  │      │──── fuzzy matches (Jaccard ≥ threshold)
    │  └────────────┘      │
    └───────────┬──────────┘
                │
    ┌───────────▼──────────┐     ┌──────────────────┐
    │  ScanReport          │────▶│  Dashboard        │
    │  (JSON)              │     │  (trend storage)  │
    └───────────┬──────────┘     └──────────────────┘
                │
    ┌───────────▼──────────┐     ┌──────────────────┐
    │  Git commit trailer  │     │  PR comment       │
    │  AI-Footprint: ...   │     │  (GitHub Action)  │
    └──────────────────────┘     └──────────────────┘
```

## Design principles

1. **Git-native** — provenance lives in commit metadata, not a database
2. **Zero runtime dependencies** — Node.js standard library only
3. **Modular** — each layer (core, CLI, extension, action, dashboard) compiles independently
4. **Progressive detection** — exact → fuzzy → heuristic, with confidence scoring
5. **Enterprise-ready** — configurable thresholds, CI enforcement, audit trail
