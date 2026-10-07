# Conflict check: Remediation disposition native contract

Source: jstoup111/ai-conductor#2522. Date: 2026-10-06.
Verdict: PASS after operator-approved reconciliation. Zero unresolved blocking or degrading conflicts.
ADR corpus: change set (the three ADRs amended by this spec). All three amendments agree with the
new stories. The findings concerned legacy assertions in older accepted stories and gaps in the
new stories; no implementation, publishing or merge is proposed.

## Resolution 1: Whole-plan rejection replaces drop-and-route

Type: contradiction / oscillating. Severity: blocking. Confidence: 95%.

Old `an-unrecognized-remediation-disposition-is-dropped.md` Story 3 routed the valid entry and
dropped an unknown one; new Story 4 rejects the whole plan. Same pattern in
`plan-growth-allowance-is-spent-on-work-existing-ta.md` Story 2 and
`accept-the-documented-unanswerable-halt-category-a.md` Story 2.

Applied: mixed plans are whole-plan rejections that are retried, then reach the caller's
existing no-plan handling. The per-entry `remediation_disposition_rejected` events (#2187) remain.

## Resolution 2: The skill no longer owns ids, vocabulary or format

Type: contradiction. Severity: blocking. Confidence: 85–95%.

These stories pinned id grammar, disposition shape, trigger entries, or the plan-append contract
in skill prose, against new Story 9:

- `daemon-mode-route-halt-user-input-required-through.md` (stall-question contract)
- `remediate-routes-buildable-review-gaps-to-plan-hal.md` Stories 1–2
- `remediation-gap-ids-have-no-admissible-form-on-a-n.md` Stories 1–3
- `prd-audit-kickback-preserves-task-status.md` Slice 2

Applied:

- These rules are now engine validator, schema, or appender assertions.
- Criterion references use engine `S<story>.<ordinal>` ids with case-normalized matching.
- The HALT-category set is the engine enum, not a counted prose list.
- The skill keeps judgment guidance.

## Resolution 3: Named mechanical faults replace absent/stale/unparseable plan files

Type: contradiction / sequencing. Severity: degrading. Confidence: 55–90%.

Affected stories:

- `remediable-as-built-blocked-verdict-halts-needs-hu.md`
- `fence-ship-validator-verdict-artifacts-from-build-.md`
- `parallel-validation-phase-fan-out-manual-test-prd-.md`
- `over-scope-refusal-should-route-to-build-rework-in.md`
- `one-transient-failure-in-a-validation-group-member.md`

Applied:

- Halts name the mechanical fault after retry exhaustion; mtime is irrelevant.
- Gap planning has no file inputs or writes.
- Validation-group references are typed.
- The manual-test kickback and the refused-widening HALT survive.
- Empty-task refusals go through rejection and exhaustion.

## Resolution 4: Engine-stamped as-built ids

Type: contradiction. Severity: degrading. Confidence: 85%.

Affected stories:

- `every-as-built-blocked-verdict-halts-needs-human-i.md` Story 1
- `as-built-review-receives-bounded-inputs-and-return.md`

Applied: findings carry engine-stamped ids; a provider id is a schema violation; a mismatch is a
validator rejection that is retried, then halts needs-human.

## Resolution 5: Gaps in the new stories and design

Operator-approved additions:

- **New Story 5:** retry exhaustion keeps the manual-test kickback, the refused-widening HALT,
  the build-stall question HALT, and the finish-verification halt. A thrown dispatch counts as
  an attempt.
- **New Story 3:** criterion matching is case-normalized.
- **New Story 8:** legacy pending entries keep their ids as history.
- **New Story 9:** keeps the sealed-set prose and the #1620 pointer guidance as mode-neutral
  judgment, and covers `agents/remediation-planner.md`.
- **Architecture review Decisions 6 and 9:** updated to match.

## Re-check

A second full pass over the new stories, the 13 corrected stories and the amended ADRs found no
remaining blocking conflicts. Its residual findings were resolved as listed above. Structural
checks passed: ids, Status lines, Given/When/Then, negative paths, Done When, and no amendment
records in story files.
