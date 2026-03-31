# AI Footprint — Threat Model & Security Architecture

**Version:** 1.0  
**Date:** 2026-03-31  
**Classification:** Public  
**Framework:** STRIDE + EU Cyber Resilience Act (CRA) mapping

---

## 1. System Overview

AI Footprint is a Git-native provenance tracking tool that:
- Stores a **local registry** of AI-generated code snippets (`~/.ai-footprint/snippets.json`)
- **Scans** source code using a 5-tier matching pipeline (hash → fuzzy → regex-AST → tree-sitter → heuristic)
- Integrates with **git hooks** (pre-commit, commit-msg) to auto-annotate commits
- Provides a **team registry** (git-backed or API-backed) for shared snippet databases
- Exports **SBOMs** (CycloneDX 1.5 / SPDX 2.3) for compliance
- Runs an **LLM API interception proxy** to auto-register generated code
- Offers IDE plugins (**VS Code**, **JetBrains**, **Neovim**) for inline attribution
- Produces a **tamper-evident audit log** (hash-chained, append-only)

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│  TRUSTED: Local user machine                                    │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────────────┐│
│  │ CLI + Hooks   │  │ IDE Plugins   │  │ Audit Log (chained)   ││
│  │ (node process)│  │ (VS Code etc.)│  │ ~/.ai-footprint/      ││
│  └──────┬───────┘  └──────┬────────┘  │ audit.log             ││
│         │                  │           └───────────────────────┘│
│  ┌──────┴──────────────────┴───────┐                            │
│  │  Local Registry (signed)        │                            │
│  │  ~/.ai-footprint/snippets.json  │                            │
│  │  ~/.ai-footprint/signing-key    │◄── owner-only (0600)      │
│  └──────┬──────────────────────────┘                            │
│         │                                                       │
└─────────┼───────────────────────────────────────────────────────┘
          │ TRUST BOUNDARY
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  UNTRUSTED: External networks                                   │
│  ┌────────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │ LLM APIs       │  │ Team Git    │  │ Team API Server      │ │
│  │ (OpenAI, etc.) │  │ (remote)    │  │ (remote)             │ │
│  └────────────────┘  └─────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. STRIDE Threat Analysis

### T1 — Spoofing: Registry Tampering

| Property | Value |
|---|---|
| **Threat** | An attacker modifies `snippets.json` to suppress AI attribution or inject false provenance |
| **STRIDE** | Spoofing, Tampering |
| **CRA Article** | Art. 10(1) — security by design; Annex I §2.5 — integrity |
| **Severity** | HIGH |
| **Mitigation** | HMAC-SHA256 signing of registry payloads (`core/security.ts: signPayload/verifyPayload`). Signing key stored with `0600` permissions. `ai-footprint security` command verifies integrity on demand. |
| **Status** | ✅ Implemented |

### T2 — Tampering: Audit Log Manipulation

| Property | Value |
|---|---|
| **Threat** | An attacker deletes or modifies audit log entries to hide security-relevant events |
| **STRIDE** | Tampering, Repudiation |
| **CRA Article** | Art. 11 — vulnerability handling; Annex I §2.5 — integrity |
| **Severity** | HIGH |
| **Mitigation** | Hash-chained append-only audit log. Each entry contains `prevHash` (SHA-256 of previous entry), enabling tamper detection via `ai-footprint audit`. Chain break instantly detectable. |
| **Status** | ✅ Implemented |

### T3 — Command Injection via Shell Interpolation

| Property | Value |
|---|---|
| **Threat** | Malicious snippet model names, team names, git URLs, or file paths are interpolated into shell commands via `execSync`, achieving arbitrary code execution |
| **STRIDE** | Elevation of Privilege |
| **CRA Article** | Annex I §2.1 — data protection & input validation |
| **Severity** | CRITICAL |
| **Attack Vectors** | (a) `git clone ${gitUrl}` — malicious git URL<br>(b) `git commit -m "...${team}"` — malicious team name<br>(c) `git interpret-trailers ... "${value}" "${commitMsgFile}"` — malicious model name |
| **Mitigation** | All `execSync` calls replaced with `execFileSync` using argument arrays. User inputs validated with `validateGitUrl()`, `validateTeamName()`, `validateNoControlChars()`. No shell string interpolation anywhere in the codebase. |
| **Status** | ✅ Remediated |

### T4 — Open Proxy / SSRF via LLM Interception

| Property | Value |
|---|---|
| **Threat** | The interception proxy forwards requests to arbitrary hosts, enabling SSRF against internal network services or use as an open relay |
| **STRIDE** | Spoofing, Information Disclosure |
| **CRA Article** | Annex I §2.1 — protection against unauthorized access |
| **Severity** | HIGH |
| **Mitigation** | Default allowlist of known LLM API hosts (`DEFAULT_LLM_HOSTS` in `core/security.ts`). Unknown hosts blocked with 403. Azure OpenAI wildcard (`*.openai.azure.com`) and localhost supported. Custom allowlist via `--allowed-hosts`. Hop-by-hop headers stripped to prevent request smuggling. |
| **Status** | ✅ Remediated |

### T5 — Path Traversal (Read & Write)

| Property | Value |
|---|---|
| **Threat** | User-controlled `--file` or `--output` arguments resolve to paths outside the project directory, enabling reading sensitive files or writing to critical locations |
| **STRIDE** | Information Disclosure, Tampering |
| **CRA Article** | Annex I §2.1 — data protection |
| **Severity** | MEDIUM |
| **Mitigation** | `validateOutputPath()` ensures SBOM output stays within CWD. `safePath()` utility available for path confinement. CLI `--file` used only for project files (owned by the same user running the CLI). |
| **Status** | ✅ Remediated |

### T6 — API Key Exposure

| Property | Value |
|---|---|
| **Threat** | API keys passed via `--api-key` CLI argument visible in `ps` output, shell history, `/proc/<pid>/cmdline` |
| **STRIDE** | Information Disclosure |
| **CRA Article** | Annex I §2.1 — data confidentiality |
| **Severity** | MEDIUM |
| **Mitigation** | `AI_FOOTPRINT_API_KEY` environment variable supported (preferred). Config files (`team.json`) written with `0600` permissions. `ai-footprint security` command hardens permissions. |
| **Status** | ✅ Remediated |

### T7 — Denial of Service via Unbounded Input

| Property | Value |
|---|---|
| **Threat** | (a) Extremely large files cause OOM during scan. (b) Unbounded HTTP request/response bodies cause OOM in the proxy. |
| **STRIDE** | Denial of Service |
| **CRA Article** | Annex I §2.2 — availability |
| **Severity** | MEDIUM |
| **Mitigation** | `MAX_FILE_SIZE` (100 MB) enforced in scanner. `MAX_BODY_SIZE` (50 MB) enforced in proxy via `collectBodyLimited()`. Files exceeding limits are skipped with no crash. |
| **Status** | ✅ Remediated |

### T8 — Symlink Traversal

| Property | Value |
|---|---|
| **Threat** | A symlink in the project directory points to sensitive files outside the project; the scanner follows it and processes/exposes the content |
| **STRIDE** | Information Disclosure |
| **CRA Article** | Annex I §2.1 — data protection |
| **Severity** | LOW |
| **Mitigation** | `lstatSync()` check added in both `scanner.ts` and `registry.ts` directory walkers. Symlinks are skipped entirely. |
| **Status** | ✅ Remediated |

### T9 — Prototype Pollution via Untrusted Data

| Property | Value |
|---|---|
| **Threat** | Malicious API responses or tampered registry files inject `__proto__`, `constructor`, or `prototype` keys, polluting Object prototype |
| **STRIDE** | Elevation of Privilege |
| **CRA Article** | Annex I §2.1 — protection against unauthorized access |
| **Severity** | MEDIUM |
| **Mitigation** | `validateSnippet()` rejects objects with `__proto__`, `constructor`, or `prototype` keys. `validateRegistry()` sanitises loaded registries. API response deserialization uses schema validation before casting. |
| **Status** | ✅ Remediated |

### T10 — Repudiation of AI Attribution

| Property | Value |
|---|---|
| **Threat** | A developer claims code was human-written to avoid compliance requirements, and there is no evidence trail |
| **STRIDE** | Repudiation |
| **CRA Article** | Art. 10(9) — documented evidence of conformity |
| **Severity** | MEDIUM |
| **Mitigation** | Hash-chained audit log records all snippet additions, scans, team syncs, and SBOM exports. Git commit trailers provide in-VCS evidence. SBOM export includes AI provenance metadata. |
| **Status** | ✅ Implemented |

---

## 3. EU Cyber Resilience Act (CRA) Compliance Matrix

| CRA Requirement | Article / Annex | AI Footprint Implementation | Evidence |
|---|---|---|---|
| **Security by design** | Art. 10(1) | HMAC-SHA256 signed registry; hash-chained audit log; input validation at all trust boundaries; zero runtime dependencies | `core/security.ts` |
| **Vulnerability handling** | Art. 11 | Audit trail with tamper detection; `ai-footprint audit` for verification; security status command for permission hardening | `core/security.ts: verifyAuditLog()` |
| **Data protection** | Annex I §2.1 | Input sanitisation (control chars, shell metacharacters); path traversal prevention; API key via env var; file permissions hardening (0600) | `validateNoControlChars()`, `safePath()`, `validateOutputPath()` |
| **Availability** | Annex I §2.2 | File size limits (100 MB scan, 50 MB proxy); graceful degradation (tree-sitter optional); no single point of failure | `MAX_FILE_SIZE`, `collectBodyLimited()` |
| **Integrity** | Annex I §2.5 | SHA-256 content fingerprints; HMAC-SHA256 registry signatures; hash-chained audit log; SBOM export for supply chain verification | `signPayload()`, `verifyPayload()`, `verifyAuditLog()` |
| **Confidentiality** | Annex I §2.1 | Owner-only file permissions; env var for secrets; proxy host allowlist blocks SSRF; hop-by-hop header stripping | `hardenConfigPermissions()`, `isAllowedLLMHost()` |
| **Software updates** | Art. 10(12) | Zero runtime dependencies; npm package distribution; semantic versioning | `package.json` |
| **SBOM provision** | Art. 10(7) | CycloneDX 1.5 and SPDX 2.3 export with AI provenance metadata | `cli/sbom.ts` |
| **Evidence of conformity** | Art. 10(9) | This threat model document; audit log; SBOM; signed registries | `docs/THREAT-MODEL.md` |
| **Secure default configuration** | Annex I §2.6 | Host allowlist enabled by default; strict file permissions; tree-sitter graceful fallback; no open proxy | Default `isAllowedLLMHost()` |

---

## 4. Security Controls Summary

### 4.1 Cryptographic Integrity

| Control | Implementation | Location |
|---|---|---|
| Content fingerprinting | SHA-256 hash of normalised code | `core/hasher.ts` |
| Registry signing | HMAC-SHA256 with 256-bit local key | `core/security.ts: signPayload()` |
| Registry verification | Timing-safe HMAC comparison | `core/security.ts: verifyPayload()` |
| Audit log chaining | SHA-256 hash chain (each entry links to previous) | `core/security.ts: audit()` |
| Canonical serialisation | Deterministic JSON (sorted keys) for stable signatures | `core/security.ts: canonicalJSON()` |

### 4.2 Input Validation

| Input | Validator | Rejects |
|---|---|---|
| Git URLs | `validateGitUrl()` | Shell metacharacters, non-standard schemes |
| API URLs | `validateApiUrl()` | Non-HTTPS (except localhost) |
| Team names | `validateTeamName()` | Non-alphanumeric, >128 chars |
| Port numbers | `validatePort()` | Non-integer, <1 or >65535 |
| File paths | `safePath()` / `validateOutputPath()` | Traversal outside allowed root |
| All string inputs | `validateNoControlChars()` | Null bytes, control characters |
| Snippets from network | `validateSnippet()` | Proto pollution, missing fields, invalid hashes |
| Registry from disk/network | `validateRegistry()` | Non-object, missing fields, invalid snippets |

### 4.3 Access Control

| Resource | Control |
|---|---|
| `~/.ai-footprint/signing-key` | `0600` (owner read/write only) |
| `~/.ai-footprint/team.json` | `0600` (contains API key) |
| `~/.ai-footprint/snippets.json` | `0600` (sensitive provenance data) |
| `~/.ai-footprint/audit.log` | `0600` (evidence trail) |
| Config directory | `0700` (owner access only) |

### 4.4 Network Security

| Control | Implementation |
|---|---|
| Default host allowlist | Known LLM API hosts only (prevents open proxy / SSRF) |
| Hop-by-hop header stripping | Removes `Connection`, `Transfer-Encoding`, `Upgrade`, etc. |
| Protocol detection fix | Correct HTTP/HTTPS detection from `X-Forwarded-Proto` |
| Body size limits | 50 MB max for proxy requests/responses |
| HTTPS enforcement | API URLs must use HTTPS (localhost exempt for dev) |

### 4.5 Audit Trail

Every security-relevant operation is logged to a hash-chained, append-only audit file:

| Event Category | Actions Logged |
|---|---|
| Snippet management | `snippet.add`, `snippet.delete` |
| Registry integrity | `registry.sign`, `registry.verify`, `registry.tampered` |
| Team operations | `team.pull`, `team.push`, `team.config` |
| Scanning | `scan.run`, `scan.match` |
| SBOM export | `sbom.export` |
| Proxy operations | `proxy.start`, `proxy.intercept` |
| Git hooks | `hook.pre-commit`, `hook.commit-msg` |
| Security events | `security.key-generated`, `security.permission-fix`, `security.path-violation`, `security.input-violation`, `security.body-limit-exceeded`, `security.host-blocked` |

---

## 5. Residual Risks

| Risk | Severity | Reason | Mitigation Path |
|---|---|---|---|
| Local signing key compromise | LOW | If an attacker has local file access, they likely own the user already | Consider OS keychain integration (macOS Keychain, Linux Secret Service) |
| Network MITM on git-backed registry | LOW | Git uses SSH or HTTPS with its own TLS | Ensure `GIT_SSL_NO_VERIFY` is never set |
| Audit log deletion (not tampering) | LOW | Attacker with file access can `rm` the log | Ship logs to external SIEM via syslog integration (future) |
| Tree-sitter native library supply chain | LOW | Optional dependency loaded dynamically | Verify npm package checksums; use lockfile |
| ReDoS in AI pattern matching | VERY LOW | Current regex patterns are simple alternation, no nested quantifiers | Monitor regex complexity on pattern additions |

---

## 6. Verification Commands

```bash
# Verify audit log integrity (hash chain)
ai-footprint audit

# Full security check (permissions + registry + audit)
ai-footprint security

# Check tree-sitter status
ai-footprint treesitter

# Team registry with validated inputs
ai-footprint team config --git-url git@github.com:org/registry.git --team backend

# Intercept proxy with default host allowlist
ai-footprint intercept --verbose

# Intercept proxy with custom host allowlist
ai-footprint intercept --allowed-hosts api.openai.com,api.anthropic.com
```

---

## 7. Change Log

| Date | Version | Change |
|---|---|---|
| 2026-03-31 | 1.0 | Initial threat model. Full STRIDE analysis, CRA mapping, 10 threats identified and mitigated. |
