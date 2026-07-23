# Architecture Review: cheap-gate-first BUILD tail (#879)

**Date:** 2026-07-23
**Mode:** Lightweight (Tier M) — feasibility + alignment; pre-stories pass
**Inputs reviewed:** intake jstoup111/ai-conductor#879,
`.docs/track/wiring-gaps-surface-only-after-a-paid-build-review.md`,
`.docs/complexity/…`, `.docs/architecture/…`,
`.docs/decisions/adr-2026-07-23-cheap-gate-first-wiring-before-build-review.md`,
source read of `steps.ts`, `conductor.ts`, `step-runners.ts`, `artifacts.ts`,
`rebase.ts`, `gate-invalidation.ts`, `resolved-config.ts`,
`model-table-metadata.ts`, `types/steps.ts`
**Verdict:** APPROVED

## Feasibility

- **Stack:** pure TypeScript engine change. No new packages, services, migrations, or
  infrastructure. ✓
- **Prerequisites:** none. Both halves reuse machinery that already exists and is already
  wired — the engine-native bypass branch (`conductor.ts:3249-3253`) and
  `completionCtx.wiringProbe` (`conductor.ts:1005-1030`). D1 adds one name to an existing
  condition; D2 edits three `prerequisites` arrays and swaps two adjacent `ALL_STEPS`
  entries. (Verified by direct read, ~95% confidence.)
- **Integration surface:** 5 engine modules + the generated HARNESS.md table + 1 test file.
  Within Medium bounds. ✓
- **Data implications:** none. `.pipeline` state keys are per-step-name and unchanged; the
  evidence artifact shape is unchanged; `.pipeline/` is gitignored so nothing lands in a
  commit. ✓
- **Performance:** strictly improves. D1 removes an LLM session from every build (measured
  median 118–135 s, max 1157 s) and replaces it with an in-process probe. D2 moves the
  remaining ~141 s grader behind a free gate. No new git call sites — `ctx.getHeadSha` and
  `computeWiringEvidence` are already invoked on this path. ✓
- **Worktree isolation:** both changes are per-feature-worktree; no shared state. ✓
- **Testability:** `steps.test.ts` already asserts the topology declaratively (order array,
  per-step prerequisites, per-tier presence) — the order stories are directly expressible.
  D1 is observable as "the step runner's `run()` is never called with `'wiring_check'`",
  a seam the existing conductor tests already stub.

## Alignment

- **Design Principle (CLAUDE.md/HARNESS.md) — "deterministic where possible; LLM only where
  necessary."** D1 is the canonical case: an LLM session is being spent on work an existing
  deterministic probe already performs. D2 is the canonical case of cheap-gate-first.
  Strongly ALIGNED — this change moves in the direction the principle names, and the fix is
  machinery (a bypass entry + a prerequisite edit), not prompt discipline.
- **adr-2026-07-07-build-review-judgement-gate (APPROVED):** its Decision-1 places
  build_review "strictly between build and manual_test". After D2 it still is —
  `wiring_check` is also between build and manual_test, and the pair's internal order is
  what changes. The gate's authority, freshness rules, code-stamp reuse (#817), and
  kickback shape are untouched. ALIGNED, with a positioning amendment recorded in the
  new ADR.
- **adr-2026-07-12-wiring-check-gate (APPROVED):** its Decision-1 says `wiring_check`
  is "inserted in ALL_STEPS after build_review, before manual_test". D2 supersedes the
  "after build_review" clause only. Every other clause (layered probe, Layer-2 entry
  points, fail-closed waiver resolution, `MAX_KICKBACKS_PER_GATE` escalation, never-HALT
  on the happy path) is preserved verbatim. Notably, that ADR's own step-runner note
  ("no skill dispatch") is what D1 finally makes true — D1 is a *conformance* fix to this
  ADR, not a deviation from it. ALIGNED.
- **adr-2026-07-21-completeness-as-build-review-rubric (APPROVED):** build_review remains
  the sole completion authority. The wiring gate is explicitly forbidden (in the new ADR's
  rejected sub-decision) from re-deriving completeness to decide whether to abstain.
  ALIGNED.
- **adr-2026-07-10-validation-group-join (APPROVED):** group membership
  (`manual_test, prd_audit, architecture_review_as_built`) is unchanged and neither
  reordered step is a member. The prose in `types/steps.ts:113-118` claims a registry-builder
  anchor/contiguity check; no such check exists in code (`getGroupForStep` is a `Map`
  lookup, and `resolveGroupMembership` reads `group.members` directly). The swap therefore
  cannot violate a constraint that is not enforced — but the stale prose should be corrected
  in the same PR so a future reader is not misled. ALIGNED (with a docs correction).
- **ADR-2026-07-20 post-rebase gate invalidation (APPROVED):** `GATE_SURFACE` is a keyed
  record; `classifyGateInvalidation` iterates `Object.entries` and returns name lists.
  Order-independent by construction. The reordering of the *navigation target arrays* in
  `conductor.ts` / `rebase.ts` changes emission order only. ALIGNED.
- **Docs-track-features convention:** `docs/daemon-operations.md` and
  `src/conductor/README.md` describe the BUILD tail order and must be updated in the same
  PR; the HARNESS.md model table is generated and must be regenerated.

## Wiring Surface

New/changed production surfaces and where they are reached from (design-time commitment).
This change adds **no new exported symbols** — it is a topology and dispatch-condition
change to existing wired code. Declared per task so `/plan` can derive `Wired-into:` lines:

- **No new exported symbol.** `wiring_check`'s dispatch bypass is an added disjunct in the
  existing `step.name !== …` condition and the existing ternary chain at
  `conductor.ts:3247-3271` — both already on the live dispatch path.
- `ALL_STEPS` entries for `build_review` / `wiring_check` / `manual_test` are consumed by
  `getStepDefinition`, `tryGetStepIndex`, the selector, `checkGate`, `navigateBack`,
  `markDownstreamStale`, and `resolveGroupMembership` — all pre-existing consumers; the
  edit is to data those consumers already read.
- The reordered target arrays at `conductor.ts:5505-5512` and `rebase.ts:927,935` are
  literals inside already-wired functions.
- `WIRING_CHECK_RATIONALE` (the model-table metadata string) is consumed by
  `bin/generate-model-table` → `HARNESS.md`; pre-existing wiring.

Consequently every implementation task's `Wired-into:` line is expected to be
`none (no new production surface)` or `same as Task N`. Any task that finds itself needing
a *new* exported helper should be treated as a scope signal and re-scoped, not waived.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| An in-flight feature resumes with `build_review: done` and `wiring_check: pending` under the new prerequisite chain and deadlocks or skips a gate | Medium (a daemon is running now) | High (a silent skipped gate is a false-ship path, the #367/#364 class) | ADR D4 makes this an explicit negative-path story with a regression test over a persisted old-topology state file. Fail direction must be "re-run the gate", never "advance". |
| Removing the `wiring_check` dispatch also removes a side effect something silently depended on (e.g. the session happening to commit staged work) | Low | Medium | The step has no `skillName` and its prompt is a documented sentinel; nothing reads a `wiring_check` session id. Story TR-1 asserts the runner is never invoked for the step and that the verdict is still produced. |
| `wiring_check` now runs first and burns its kickback budget on symptoms of an incomplete build, HALTing where build_review would have given a clearer message | Low–Medium | Medium | Kickback counters are per-gate and independent; the outcome (kickback to `build`) is identical. Mitigated by a message-only change to the wiring kickback hint. Explicitly considered and bounded in the ADR. |
| Textual rebase conflict in `conductor.ts` with concurrent intake #878 | Medium | Low | Regions are disjoint (dispatch bypass / kickback restage / rebase re-open vs. build-completion + re-kick). Flagged in the ADR; resolve at rebase time. |
| The predicted disappearance of the 22 stale-evidence retries does not materialise | Low | Low | Not load-bearing — asserted as an observable outcome, not a requirement. If it persists there is a second HEAD-mover to find, which the story's evidence line will surface. |

## Conditions of approval

1. The new ADR must be APPROVED before the spec lands (it is).
2. The in-flight-state negative path (D4) must be a real regression test, not a comment.
3. The stale `types/steps.ts:113-118` anchor prose must be corrected in the same PR.
4. `docs/daemon-operations.md`, `src/conductor/README.md`, and the generated HARNESS.md
   model table must be updated in the same PR (repo Documentation Upkeep rule).
