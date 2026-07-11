# Complexity: evidence-gate-validates-provenance-proxies-not-whe

Tier: L

## Rationale
- Net-new engine subsystem (semantic verification lane at the build gate), not an
  extension of a single existing seam: fresh-context judge dispatch, per-task verdict
  consumption, engine-recorded evidence stamps with a new provenance form, and a
  no-whitewash negative path.
- Hard external composition constraint: the verdict interface must be shaped as the
  #469/#500 `BranchOutcome` discriminated union (`verdict`/`no-verdict`/`skipped`)
  so the spot-audit later runs as an ordinary validation-group member — coupling to
  an unmerged spec's types requires explicit ADR treatment.
- Continuous accuracy measurement (sampled spot-audit of fast-lane attributions,
  agreement tracking, divergence surfacing) is its own stateful sub-feature with
  observable outputs — beyond the M-tier "three surfaces on existing seams" shape
  of the #505 spec.
- Attribution splitting (one diff satisfying several tasks) and interleaved-commit
  tolerance are forward requirements from #474 concurrent task streams.
- Acceptance corpus is three real stranded builds with three distinct residue shapes
  (mono-attributed bundle, zero evidence, rebase-rewritten history) — replay-style
  acceptance work is L-scale.
- New model-selection table entry (opus-tier adversarial judge class) and a config
  cutover flag following the attribution_enforcement_cutover shape.
