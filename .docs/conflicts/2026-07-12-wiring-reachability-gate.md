# Conflict Report: Wiring reachability gate

**Date:** 2026-07-12
**New stories:** .docs/stories/2026-07-12-wiring-reachability-gate.md (9 stories)
**Scanned against:** full .docs/stories/ corpus + gate-topology specs/plans (#280, #367, #417,
#420, #424, #441, #499, #505, #520, #532, #535, #549, #581, build-review seam, owner-gate config)
**Result:** 2 degrading conflicts found → RESOLVED via story amendments; re-check clean.
Zero blocking conflicts.

## Conflict 1: manual_test.prerequisites adjacency pin (state / resource contention) — RESOLVED

**Stories involved:** "wiring_check step joins the gate loop" vs
`add-a-judgement-gate-at-the-build-manual-test-seam.md` (Story 1)
**Severity:** degrading

The build-review story's Done When pins `manual_test.prerequisites === ['build_review']` with a
registry test; the wiring story repoints it to `['wiring_check']`. Intent (build_review strictly
upstream of manual_test) is preserved since `wiring_check.prerequisites = ['build_review']`.

**Resolution (applied):** wiring story amended — the registry test is updated in the same commit
to assert the new adjacency AND that build_review remains upstream. Least-disruptive option; the
old story's intent is preserved, only its literal adjacency assertion is amended.

## Conflict 2: post-rebase re-verify set omits wiring_check (sequencing/state) — RESOLVED

**Stories involved:** "wiring_check step joins the gate loop" vs
`post-rebase-build-invalidation-dispatches-a-full-b.md` (#420 Story 3) and the build-review
story's TS-5 re-verify enumeration (`conductor.ts:3454-3463` target set
`['build','build_review','manual_test']`).
**Severity:** degrading (would defeat the new gate on the rebase path)

A file-changing rebase can remove the references wiring_check verified, but the stale
`satisfied` verdict would survive (the gate verdict, not the evidence file, is authoritative to
the selector per #532) — an unwired-after-rebase feature would ship.

**Resolution (applied):** wiring story amended — `wiring_check` joins the rebase invalidation
set (`{build, build_review, wiring_check, manual_test}`); the #420 and build-review pinned-set
tests are amended in the same change.

## Decision: legacy plans with zero Wired-into lines (operator-selected)

In-flight/merged specs authored before the contract have no `Wired-into:` lines; a hard gate
would kick back their builds on engine update (#441-class trap).

**Operator disposition (2026-07-12): zero-line plan = loud advisory.** A plan with zero
`Wired-into:` lines anywhere passes with a loud advisory verdict reason; ≥1 line anywhere means
full gating on every task. A fully-undeclared NEW plan is prevented upstream (plan skill blocking
checklist + engineer land gate). Encoded as Layer 1 story negative paths. Rejected alternatives:
cutover flag (another flag to arm/remember), immediate hard gate (#441-class in-flight breakage).

## Examined clean (reasoned pairs, no conflict)

- **#532 backward-only resume clamp** — wiring_check joins the loop-region gate set generically.
- **#280 progress-aware halt** — per-attempt progress accounting is agnostic to which gate
  re-opened build; no shared counter.
- **#367 manual-test gating** — asserts enforcement/kickback, not prerequisites;
  MAX_KICKBACKS_PER_GATE counters are per-gate keyed.
- **#549 pipeline-wipe** — wiring-evidence.json is a new sibling artifact; pre-run sweep removes
  only session markers. Inherited: follow #549 ensure-dir/durability write pattern.
- **#417/#424 grammar/Files parsing** — additive line; the backtick-leak hazard into the
  BACKTICK_TOKEN prose fallback is now pinned as an explicit parser negative path.
- **Config schema (owner_gate/attribution cutovers)** — disjoint new `wiring.entry_points`
  block; no shared key or competing validator.
- **#505/#520/#581/#499/#535 attribution & finish machinery** — operate on commit trailers and
  finish derivation; orthogonal to plan-line parsing and step topology (rebase contention
  captured in Conflict 2).
- **Latent assumption (recorded, not a conflict):** wiring_check.prerequisites assumes
  build_review remains unconditional (true in shipped steps.ts); if build_review ever becomes
  opt-in, the prerequisite repoints to build.
