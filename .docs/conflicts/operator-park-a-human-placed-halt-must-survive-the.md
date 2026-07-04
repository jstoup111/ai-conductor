# Conflict Check: Operator Park (ai-conductor#236)

**Date:** 2026-07-04
**New stories:** `.docs/stories/operator-park-a-human-placed-halt-must-survive-the.md` (7 stories)
**Scanned against:** all `.docs/stories/*.md` (43 files), focused pairwise review of the 13
sharing surfaces (rekick sweep, dashboard precedence, HALT lifecycle, `.daemon/` state, daemon
CLI namespace).
**Result:** PASSED — zero blocking conflicts; 3 degrading items, all resolved/accepted below.

## Conflict 1: Dashboard precedence chain omitted GATED — RESOLVED

**Stories involved:** Park FR-6 story vs `2026-07-03-surface-owner-gated-specs-dashboard-status.md`
**Type:** resource contention (single dashboard precedence chain in `daemon-dashboard.ts`)
**Severity:** degrading

Park's original FR-6 enumerated `PARKED > HALTED > PROCESSED > IN-PROGRESS > WAITING > ELIGIBLE`,
omitting the GATED group the owner-gated spec adds (with PROCESSED > GATED). An implementer
following the enumerated chain literally would have no slot for GATED.

**Resolution applied (option 1, least disruptive):** park's story and
`adr-2026-07-04-operator-park-marker.md` §5 amended to state PARKED outranks **every** existing
group while the interior order among existing groups is unchanged — robust to sibling group
additions, no change to the owner-gated spec.

## Conflict 2: Shared rekickSweep skip chain with content-aware dedup — ACCEPTED (coordination note)

**Stories involved:** Park FR-3 story vs `content-aware-shipped-work-dedup-never-re-dispatch.md`
Story 5 (isProcessed consulted before re-kick actions)
**Type:** overlap/sequencing on shared code (`rekickSweep`/`RekickSweepDeps`)
**Severity:** degrading

Compatible: the dedup story places `isProcessed` before the abort/clear actions but does NOT
claim it runs first among all guards. Required combined order: **parked → isProcessed →
lastRekickSha guard**. Note the two checks carry different fail directions by design:
`isProcessed` fails OPEN (error → treated unprocessed), the parked check fails TOWARD PARKED
(error → treated parked). Both policies coexist in the sweep; the plan must sequence park's
check ahead of the isProcessed branch and keep both fail policies intact.

## Conflict 3: Terminology collision — "parked"/"un-park" legacy usage — ACCEPTED (naming note)

**Stories involved:** Park (all) vs `daemon-halt-reconciliation.md`,
`2026-07-03-daemon-issue-priority-scheduling.md`, `phase-9.0-rebase-on-latest.md`,
`harness-self-host-guardrails.md`
**Type:** overlap (vocabulary, not behavior)
**Severity:** degrading

Older accepted stories use "parked" to mean *halted* and "un-park path" to mean the PR-#109
halt-cleared re-dispatch. This feature introduces PARKED as a distinct operator-owned state and
a literal `daemon unpark` verb. No behavioral contradiction, but real implementation-confusion
risk. **Plan requirement:** code comments, log lines, and docs for this feature must say
"operator-parked (`.daemon/parked/` marker)" when meaning the new state, and never re-word the
legacy halt-lifecycle comments as part of this change.

## Notes (clean surfaces)

- `dependency-ordered-intake-and-dispatch.md` (WAITING group): preserved by the amended
  precedence statement.
- `daemon-owner-gate.md` FR-3 fail-open: park is a separate, pre-owner-gate eligibility
  dimension (same layering content-aware dedup already established) — "content-eligible" reads
  as excluding parked.
- `bin-conduct-unknown-subcommand-guard.md`: reinforcing — park's verbs register under the
  `daemon` group so the guard recognizes them; the typo negative path depends on it.
- `finish-should-rewrite…`, `rebase-resolution-skill.md`, `phase-9.0-rebase-on-latest.md`,
  `harness-self-host-guardrails.md`, `multi-operator-ownership-{hardening,slice-b}.md`: clean.

## Gate

Zero blocking conflicts remain. Degrading items 2 and 3 accepted with the coordination/naming
requirements above carried into `/plan`.
