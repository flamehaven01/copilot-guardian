<div align="center">

<img src="docs/Logo.png" alt="Copilot Guardian Logo" width="400"/>

# Copilot Guardian

### The CI Healer That Knows When AI Is Wrong

When GitHub Actions fails, Guardian analyzes logs with multi-hypothesis reasoning,
proposes risk-stratified patches, and blocks unsafe AI output before it touches your code.

**Production-ready** | **90-second setup** | **Full audit trail**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/flamehaven01/copilot-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/flamehaven01/copilot-guardian/actions/workflows/ci.yml)
[![Version: 0.2.7](https://img.shields.io/badge/version-0.2.7-blue.svg?style=flat-square)](https://github.com/flamehaven01/copilot-guardian/releases)
[![Release: v0.2.7](https://img.shields.io/badge/release-v0.2.7-0A66C2.svg?style=flat-square)](https://github.com/flamehaven01/copilot-guardian/releases/tag/v0.2.7)
[![npm version](https://img.shields.io/npm/v/copilot-guardian?style=flat-square&logo=npm&color=CB3837)](https://www.npmjs.com/package/copilot-guardian)<br/>
[![Copilot CLI Challenge](https://img.shields.io/badge/GitHub-Copilot_Challenge-181717.svg?style=flat-square&logo=github&logoColor=white)](https://dev.to/challenges/github-2026-01-21)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Enabled-FF5722.svg?style=flat-square)](https://modelcontextprotocol.io/)
[![Real Output Examples](https://img.shields.io/badge/Real_Output-Examples-green.svg?style=flat-square)](examples/real-output/)

[Demo GIF](#demo-gif) | [Why This Matters](#why-this-matters) | [Real Output Showcase](#real-output-showcase) | [Judge Quick Test](#judge-quick-test-90-seconds) | [Quick Start](#quick-start) | [How It Works](#how-it-works) | [Output Files](#output-files)

</div>

---

Quick demo:
```bash
npx copilot-guardian@latest run --repo YOUR/REPO --last-failed --show-options --fast --max-log-chars 20000
```

---

## Demo (GIF)

![Judge Quick Test Demo](docs/screenshots/final-demo.gif)

**Runtime:** 3m43s | **Profile:** `--fast --max-log-chars 20000`

What happens in this run:
1. Analyze a real CI failure with multi-hypothesis reasoning.
2. Generate three strategies: Conservative, Balanced, Aggressive.
3. Run independent quality review for each strategy.
4. Block malformed AI output with fail-closed guardrails.
5. Export raw artifacts for full auditability.

Browse exact files from this run:
- [examples/real-output/standard/](examples/real-output/standard/)

---

## Why This Matters

Problem:
- AI-assisted CI fixes can silently introduce unsafe edits or malformed outputs.
- A green-looking suggestion is not proof of safe behavior.

Guardian's approach:
- Generate multiple hypotheses and patch strategies instead of one guess.
- Validate every candidate with deterministic controls.
- Fail closed (`NO_GO`) when output is malformed or risky.

Real case from this demo:
1. Copilot returned malformed quality JSON for Conservative review.
2. Deterministic guard detected parse failure.
3. Guardian blocked with `NO_GO`.
4. Broken output was never auto-applied.

---

## Real Output Showcase

> Not a mock. Files below are unmodified outputs from actual Guardian runs.

### Fail-Closed in Action: AI Gets It Wrong, Guardian Blocks It

Conservative strategy was automatically rejected due to malformed Copilot JSON:

```json
{
  "verdict": "NO_GO",
  "risk_level": "high",
  "slop_score": 1,
  "reasons": [
    "Parse error: Unbalanced JSON object in Copilot response - missing closing brace"
  ]
}
```

Source:
- [examples/real-output/standard/quality_review.conservative.json](examples/real-output/standard/quality_review.conservative.json)
- [examples/real-output/standard/copilot.quality.conservative.raw.txt](examples/real-output/standard/copilot.quality.conservative.raw.txt)

### Patch Quality Spectrum

| Strategy | Target File | Risk Level | Verdict | Slop Score | What It Does |
|---|---|---|---|---|---|
| Conservative | `src/engine/github.ts` | HIGH | **NO_GO** | 1.0 | Blocked due to malformed quality response |
| Balanced | `src/engine/github.ts` | LOW | **GO** | 0.08 | Adds null-safe fallback for `workflowPath` |
| Aggressive | `tests/quality_guard_regression_matrix.test.ts` | LOW | **GO** | 0.08 | Updates test expectation value |

Source:
- [examples/real-output/standard/patch_options.json](examples/real-output/standard/patch_options.json)
- [examples/real-output/standard/fix.balanced.patch](examples/real-output/standard/fix.balanced.patch)
- [examples/real-output/standard/fix.aggressive.patch](examples/real-output/standard/fix.aggressive.patch)

Generated artifact sets:
- Standard run: [examples/real-output/standard/](examples/real-output/standard/)
- Abstain evidence: [examples/real-output/abstain/guardian.report.json](examples/real-output/abstain/guardian.report.json)

Takeaway:
- Guardian does not trust AI blindly.
- Deterministic checks can override model output.

---

## Judge Quick Test (90 seconds)

Prerequisites:
- `gh auth status` succeeds
- GitHub Copilot is enabled for your account/session

```bash
npx copilot-guardian@latest run \
  --repo flamehaven01/copilot-guardian \
  --last-failed \
  --show-options \
  --fast \
  --max-log-chars 20000
```

Expected:
1. Structured diagnosis in `analysis.json`
2. Strategy index in `patch_options.json`
3. Safety verdicts in `quality_review.*.json`

For extended trace mode (slower), add `--show-reasoning`.

---

## Quick Start

### Prerequisites

- Node.js >=18
- GitHub CLI (`gh`) authenticated
- GitHub Copilot subscription (SDK access)

### Installation

```bash
npm i -g copilot-guardian@latest
# or
npx copilot-guardian@latest --help
```

Package:
- https://www.npmjs.com/package/copilot-guardian

### Core Commands

```bash
# Stable demo profile
copilot-guardian run \
  --repo owner/repo \
  --last-failed \
  --show-options \
  --fast \
  --max-log-chars 20000

# Analysis only
copilot-guardian analyze \
  --repo owner/repo \
  --run-id <run_id> \
  --fast \
  --max-log-chars 20000

# Evaluate multiple failed runs
copilot-guardian eval \
  --repo owner/repo \
  --failed-limit 5 \
  --fast \
  --max-log-chars 50000

# Interactive follow-up
copilot-guardian debug \
  --repo owner/repo \
  --last-failed
```

---

## How It Works

Full architecture:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

```mermaid
graph TB
    A[GitHub Actions Failure] --> B[Guardian CLI]
    B --> C[Context Fetch]
    C --> D[Multi-Hypothesis Analysis]
    D --> E[Copilot SDK]
    E --> F[Patch Strategies]
    F --> G[Deterministic Quality Guard]
    G --> H{GO?}
    H -->|NO_GO| I[Reject and Re-diagnose]
    H -->|GO| J[Patch Candidate]
    J --> K[Safe Branch PR or Auto-Heal]
```

### Key Modules

| Layer | Module | Purpose |
|---|---|---|
| Detection | `src/engine/github.ts` | Collect failure context |
| Intelligence | `src/engine/analyze.ts` | Multi-hypothesis diagnosis |
| Decision | `src/engine/patch_options.ts` | Strategy generation |
| Validation | Deterministic + model review | Slop and bypass control |
| Action | `src/engine/auto-apply.ts` | Safe branch/PR workflow |

---

## Forced Abstain Policy (Not Patchable)

Guardian abstains for non-patchable classes:
- `401/403` auth failures
- token permission errors
- API rate-limit or infra-unavailable patterns

When abstaining:
- `abstain.report.json` is emitted
- patch generation is skipped

---

## Why This Is a Copilot CLI Challenge Submission

This project demonstrates five advanced Copilot usage patterns under real CI failures:
1. Multi-hypothesis reasoning with explicit confidence and evidence
2. Patch synthesis across conservative, balanced, and aggressive strategies
3. Deterministic fail-closed guardrails against slop and bypass patterns
4. MCP-enriched context to improve diagnosis quality
5. Transparent artifact trail (`analysis.json`, raw responses, patch index)

Runtime clarification:
- Copilot Guardian is a terminal CLI tool.
- Copilot requests use `@github/copilot-sdk` as the default path.
- `gh copilot` is available as an optional terminal fallback for local reproducibility.

---

## Output Files

Artifacts are generated under `.copilot-guardian/`:

| File | Purpose | Example |
|---|---|---|
| `analysis.json` | Diagnosis + selected hypothesis | [demo context](examples/demo-failure/README.md) |
| `reasoning_trace.json` | Hypothesis trace | [demo context](examples/demo-failure/README.md) |
| `patch_options.json` | Strategy index + verdicts | [view](examples/real-output/standard/patch_options.json) |
| `fix.*.patch` | Patch files | [view](examples/real-output/standard/fix.balanced.patch) |
| `quality_review.*.json` | Per-strategy quality results | [view](examples/real-output/standard/quality_review.conservative.json) |
| `abstain.report.json` | Forced abstain classification | [view](examples/real-output/abstain/guardian.report.json) |
| `copilot.*.raw.txt` | Raw model output snapshots | [view](examples/real-output/standard/copilot.quality.conservative.raw.txt) |

---

## Documentation Links

- Real output evidence: [examples/real-output/README.md](examples/real-output/README.md)
- Demo walkthrough: [examples/demo-failure/README.md](examples/demo-failure/README.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Security: [SECURITY.md](SECURITY.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT License. See [LICENSE](LICENSE).

## Credits

Built by Flamehaven (Yun) for the [GitHub Copilot CLI Challenge](https://dev.to/challenges/github-2026-01-21).

---

## Try It Now

```bash
# Test on your repo (90 seconds)
npx copilot-guardian@latest run \
  --repo YOUR/REPO \
  --last-failed \
  --fast

# Or reproduce this exact demo
npx copilot-guardian@latest run \
  --repo flamehaven01/copilot-guardian \
  --last-failed \
  --fast
```

Questions:
- [Open an issue](https://github.com/flamehaven01/copilot-guardian/issues)
- [Read the architecture docs](docs/ARCHITECTURE.md)
- [View real output examples](examples/real-output/)

---

<div align="center">

Built by [Flamehaven (Yun)](https://github.com/flamehaven01) for the [GitHub Copilot CLI Challenge](https://dev.to/challenges/github-2026-01-21)

**Trust is built on receipts, not promises.**

[![GitHub stars](https://img.shields.io/github/stars/flamehaven01/copilot-guardian?style=social)](https://github.com/flamehaven01/copilot-guardian)

</div>
