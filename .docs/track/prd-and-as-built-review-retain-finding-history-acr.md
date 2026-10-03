# Track: PRD and as-built review retain finding history across laps

Track: technical

Scope boundary: Operator confirmed the complete #2440 slice: finding continuity within PRD audit and as-built review across laps and restarts, covering criterion and NC findings, prior decisions, attempted repairs, resolution evidence, source-complete reconciliation, recurrence, explicit recoverable history failures, and Claude/Codex parity. Preserve #2429 widening authority. Combined routing/budget changes belong to #2060; cross-gate equivalence belongs to #2441. Existing verdict-parser migrations remain owned by #2188 and #2521; consume their landed contracts without adding a new Markdown parser.

Review-engine reliability and state continuity are internal harness capabilities; acceptance criteria belong in stories, with no PRD. The operator selected approach A (extend durable cases with separate gate authority) and the technical track on 2026-09-30.

## Current-main validation

Verified GitHub main and this worktree base are both 99d077d837f6b5cbeb2a3fcbde21ed1a036a50c4 on 2026-09-30. Issue #2440 remains open. Its original build_review-only case-store observation is historical: #2429 shipped PRD widening history in #2479, and #2188 shipped typed as-built inputs/verdicts in #2748.

The remaining gap is verified in current source. `buildPrdWideningContext` selects OVER_SCOPE findings with NC identifiers; it is not general criterion-finding history. `buildAsBuiltProjection` reads `readPendingAsBuiltRemediationFindings`; that projection excludes complete prior decision/attempt/resolution history. As-built records repaired findings in its current typed verdict after success, then clears the pending list; the next projection reads pending findings rather than that complete history. The shared case-store envelope contains build_review and prd_widening cases only.

This is a source-level gap validation, not a reproduction of a particular historical daemon incident. #2521 remains open and its migration is not part of this slice.
