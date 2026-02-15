# Real Output Examples

Source:
- Standard run artifacts copied from `.test-output/`
- Abstain evidence copied from `.test-output-run-abstain/`

These files are unmodified evidence snapshots used in README demonstrations.

## Context

- Runtime profile: `--fast --max-log-chars 20000`
- Scenario: CI failure triage with multi-strategy patch generation
- Goal: prove deterministic fail-closed behavior with transparent receipts

## Key Finding: Fail-Closed Works

Conservative strategy was blocked as `NO_GO` due to malformed Copilot JSON.

See:
- `standard/quality_review.conservative.json`
- `standard/copilot.quality.conservative.raw.txt`

## Strategy Results

- Conservative: `NO_GO`, `risk_level=high`, `slop_score=1.0`
- Balanced: `GO`, `risk_level=low`, `slop_score=0.08`
- Aggressive: `GO`, `risk_level=low`, `slop_score=0.08`

See:
- `standard/patch_options.json`
- `standard/quality_review.balanced.json`
- `standard/quality_review.aggressive.json`

## Files

Standard run:
- `standard/patch_options.json`
- `standard/fix.conservative.patch`
- `standard/fix.balanced.patch`
- `standard/fix.aggressive.patch`
- `standard/quality_review.conservative.json`
- `standard/quality_review.balanced.json`
- `standard/quality_review.aggressive.json`
- `standard/copilot.patch.options.raw.txt`
- `standard/copilot.patch.options.raw.attempt1.txt`
- `standard/copilot.quality.conservative.raw.txt`
- `standard/copilot.quality.balanced.raw.txt`
- `standard/copilot.quality.aggressive.raw.txt`

Abstain run:
- `abstain/guardian.report.json`

## Why This Matters

1. Real output, not synthetic examples.
2. Deterministic guard can override AI output.
3. Full audit trail is preserved for postmortem and review.
4. Safety behavior is demonstrable and reproducible.

Back to project root: [README.md](../../README.md)
