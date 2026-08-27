# Architecture Review: Remove retrospectives (full and micro) from feature delivery

**Date:** 2026-08-26
**Feature:** remove-retrospectives-full-and-micro-from-feature- (jstoup111/ai-conductor#1905)
**Stories reviewed:** none yet (pre-stories review per adr-2026-06-29-architecture-before-stories-convergent-kickback); input = intake issue #1905 + `.docs/track/remove-retrospectives-full-and-micro-from-feature-.md` + `.docs/architecture/remove-retrospectives-full-and-micro-from-feature-.md`
**Verdict:** APPROVED

## Feasibility

- Pure removal within the existing stack: no new packages, services, migrations, or infra.
- The `StepName` union makes ~10 exhaustive `Record<StepName, …>` sites compiler-enforced;
  deleting the union member enumerates them (verified: types/steps.ts:23 root).
- The one silent hazard is the dangling `rebase.prerequisites: ['retro']` edge: no step-graph
  validator exists for built-ins, and an unknown prerequisite reads as permanently `pending`,
  producing a gate-blocked no-HALT no-ship (verified: gates.ts:11-33, state.ts:203-206,
  conductor.ts:7555-7580). The rewire to `['architecture_review_as_built']` lands in the same
  change as the deletion.
- Hand-written runtime string lists escape the compiler and must be edited explicitly:
  `complete-verifier.ts:8` (`SHIP_GATING_STEPS`), `step-runners.ts:874` (`oneShotSteps`),
  `phase-marker.ts:64` (`DOCS_WRITE_ALLOWLIST`).
- Lockstep pairs that must change atomically: `events.ts:597` obligation union +
  `closeout-cli.ts:7` allowlist (`satisfies` enforces); `skills/retro/` deletion + the ~40
  cross-skill references (integrity check 4 hard-fails on dangling `/retro` refs) +
  `model-table-metadata.ts:57` + regenerated HARNESS.md (check 5a drift gate) +
  `skill-invocation.ts:41` (adr-2026-08-04 preflight fails by name otherwise).

## Complexity

High (tier L, recorded in `.docs/complexity/`): cross-cutting removal across engine, types,
skills, docs, templates, legacy `bin/conduct`, and ~89 conductor test files, with
ordering-sensitive co-changes. No spike needed — every touchpoint is enumerated on this branch.

## Alignment

- Full repo-wide ADR pass run over all 510 `.docs/decisions/` files plus root
  `.memory/decisions/`. Ten artifacts amended in this DECIDE pass (additive notes, per
  adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts):
  adr-2026-07-26-rebase-tail-current-branch-before-publication, adr-002-engineer-store-and-
  retro-redirect (superseded in part), adr-2026-08-08-pipeline-owned-closeout-timestamps,
  adr-2026-07-22-phase-scoped-docs-write-guard, adr-2026-07-07-audit-trail-event-sink,
  architecture-review-2026-07-07-audit-trail-write-completeness,
  architecture-review-2026-07-26-ship-tail-serial-publication-922, 001-harness-architecture
  (Decision 5 retired), adr-006-flywheel-lesson-selection-and-provenance,
  adr-2026-07-10-session-hook-task-stamping.
- **adr-2026-08-11-deprecated-no-op-step-retirement conflict:** explicitly waived by the
  operator on 2026-08-26 for this change only (breaking change accepted). Recorded in
  adr-2026-08-26-remove-retrospectives-one-shot; the two-phase contract stays in force for
  future retirements.
- Cite-and-comply, no edit needed: adr-2026-07-10-validation-group-join,
  adr-2026-07-21-s-tier-pipeline-knobs (retro not in the tier-invariant gate set; the pinning
  test must be checked for step-name enumeration), adr-2026-08-03-fail-closed-decide-entry,
  adr-2026-07-13-session-fresh-verdict-artifacts, adr-2026-07-05-retry-as-escalation-ladder,
  adr-2026-07-22-per-feature-cost-rollup-in-shipped-record,
  adr-2026-07-21-demote-task-stamping-to-telemetry, adr-2026-08-24-refused-step-status,
  adr-2026-08-04-unresolved-step-command-fails-by-name (mandatory co-change captured above).
- Root-checkout memory record `/home/james-stoup/code/ai-conductor/.memory/decisions/serial-ship-tail-922.md`
  must be rewritten to the new tail (`… → architecture_review_as_built → rebase → finish`).
  It lives outside this worktree; the operator applies it at merge (not a BUILD task — it is
  not a spec artifact and must not be edited from a self-host build).

## Domain Integrity

Removal-shaped: no new types, states, or primitives introduced. The `obligation` union and
`StepName` union shrink; `satisfies` clauses keep exhaustiveness. One retained-but-unexercised
branch: the advisory-enforcement path loses its only built-in instance (custom steps can still
declare it) — documented in the ADR, no action.

## Wiring Surface

No new production surfaces are introduced. Changed surfaces and their production callers:

- `rebase.prerequisites` → consumed by the existing gate loop (`checkGate`, engine/gates.ts)
  at SHIP dispatch — unchanged consumer, changed edge.
- Batch-boundary closeout gate roster (skills/pipeline SKILL.md + closeout enforcement) →
  consumed by the BUILD batch gate; shrinks by one obligation.
- `emitEngineerSignal` (engineer-store) → still called from daemon-runner completion; loses
  its `done`-narrative provider branch, keeps halt narratives and structured signal.
- Regenerated HARNESS.md model table → consumed by session-start context and integrity check 5a.
- Everything else is deletion: no caller remains by design (verified against the touchpoint
  map; the as-built reachability sweep at SHIP checks the survivors, not the deletions).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Dangling `rebase→retro` edge survives → silent no-ship | Technical | Low | High | Rewire in the same commit as the union deletion; a test pins the new SHIP tail ordering |
| Live worktree `conduct-state.json` or consumer `steps.retro.*` config hits `Unknown step: retro` | Integration | Medium | Medium | Operator-waived breaking change (ADR); land between dispatches; park/finish in-flight features at cutover; major-class release metadata |
| Integrity check 4/5a hard-fail from a missed `/retro` ref or stale model table | Technical | Medium | Low | Delete refs + regenerate HARNESS.md atomically; run `test/test_harness_integrity.sh` before commit |
| Batch gate blocks on missing micro-retro closeout event | Technical | Low | High | Shrink the enforced obligation roster in the same change (adr-2026-08-08 amendment) |
| `retroTierSkipped` removal changes narrative behavior for halted runs | Technical | Low | Medium | Halt-narrative path is independent (`renderHaltNarrative`, no provider call); pinned by existing engineer-store tests |
| Flywheel signal quality degrades without done-narratives | Knowledge | Medium | Low | Accepted by operator (full purge); structured signal (kickbacks/halts/retry hotspots) remains |

## ADRs Created

- `adr-2026-08-26-remove-retrospectives-one-shot` (DRAFT → pending operator approval):
  one-shot deletion with the operator's waiver of adr-2026-08-11, supersession-in-part of
  adr-002, and the atomic co-change set.

## Conditions

None — verdict is APPROVED, contingent only on the drafted ADR reaching APPROVED before
`/stories` (§7b hard gate).
