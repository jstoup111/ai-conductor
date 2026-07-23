# Conflict Check: cheap-gate-first — wiring_check before build_review (#879)

**Date:** 2026-07-23
**New stories:** `.docs/stories/wiring-gaps-surface-only-after-a-paid-build-review.md` (5 stories, Accepted)
**Scope:** every `.docs/stories/*.md` matching the seam
(`build_review`, `wiring_check`, `wiring-reachability`) — 20 files — plus the two
positioning ADRs and `adr-2026-07-10-validation-group-join`. Highest-risk pairs read in full.
**Advisory overlap scan:** `conduct-ts overlap-scan` → *no overlap detected; no open blockers*
(2026-07-23).
**Result:** CLEAN for shipping — **1 expected supersession** and **1 stale-assertion fix**,
both scoped into the new stories. Zero unresolved contradictions.

## Pairs examined (verified, not assumed)

1. **vs `.docs/stories/2026-07-12-wiring-reachability-gate.md` — DIRECT CONTRADICTION,
   deliberate supersession** (confidence ~98%). Lines 127–175 pin the exact clauses TR-2
   inverts: *"wiring_check step joins the gate loop between build_review and manual_test"*,
   *"wiring_check.prerequisites === ['build_review'] (build_review remains strictly
   upstream)"*, *"manual_test.prerequisites now reads ['wiring_check']"*. This is the
   original wiring-gate feature and its ADR (`adr-2026-07-12-wiring-check-gate`,
   Decision-1). The new ADR amends exactly this positioning clause and nothing else in that
   story's contract — the layered probe, evidence shape, fail-closed waiver resolution, and
   `MAX_KICKBACKS_PER_GATE` escalation all survive verbatim.
   **Resolution:** supersession, not conflict. Story TR-5 requires the ADR pointer; the
   superseded story file gets a supersession note in the same PR so a future conflict-check
   does not re-flag it. **Blocking until the note exists** — an unannotated Accepted story
   asserting the old order is exactly the drift the #526 precedent (pair 4 of the #859 check)
   left behind.

2. **vs `.docs/stories/add-a-judgement-gate-at-the-build-manual-test-seam.md` (#324)** —
   COMPATIBLE (confidence ~95%). Its live assertions survive the swap unchanged:
   *"build's gate unsatisfied ⇒ build_review NOT selected (earliest-unsatisfied ordering
   holds)"* (still true — `build` is still upstream of both gates);
   *"build_review dispatched between build and manual_test"* (still true — the swap keeps
   both gates strictly inside that seam); the fresh-session/`resume:false` grader dispatch
   contract and the input-assembly rules are untouched by this feature.
   Its line 54 (*"flag off ⇒ manual_test selected directly after build"*) was **already**
   stale when `wiring_check` was inserted in 2026-07-12 — pre-existing drift, neither caused
   nor worsened here. Noted for hygiene only.

3. **vs `.docs/stories/s-tier-pipeline-knobs.md` Story 6** — STALE ASSERTION, fixed in scope
   (confidence ~95%). Its criterion *"an end-to-end resolution of an S feature **dispatches**
   `build_review`, `wiring_check`, `manual_test` and `finish`"* is falsified by TR-1:
   `wiring_check` will no longer be dispatched at all. The *intent* of that story — no
   evidence gate is tier-weakened for S — is fully preserved (`shouldSkipForTier('wiring_check',
   'S') === false` remains asserted, and TR-2 re-pins it for all three tiers). The wording
   conflates "runs" with "dispatches".
   **Resolution:** TR-1's Done-When already requires the model-table/rationale correction;
   the S-tier story's wording is corrected in the same PR to "resolves … producing a verdict
   for each" so the tier-invariant is asserted without asserting a dispatch that no longer
   happens. Non-blocking once corrected.

4. **vs `.docs/stories/parallel-validation-phase-fan-out-manual-test-prd-.md` +
   adr-2026-07-10-validation-group-join** — NO CONTENTION (confidence ~95%). The group is
   `manual_test, prd_audit, architecture_review_as_built` (`steps.ts:310-313`); neither
   reordered step is a member. Its story text says the group fans out *"after build_review"*
   — which remains literally true after the swap (`build_review` is still the last step
   before `manual_test`). `getGroupForStep` is a `Map` lookup and
   `resolveGroupMembership` reads `group.members` directly, so no contiguity/anchor
   invariant can be violated. The one artifact needing correction is the **prose** at
   `types/steps.ts:113-118` claiming a registry-builder positioning check that does not
   exist — scoped into TR-5's negative path.

5. **vs `.docs/stories/post-rebase-invalidation-re-runs-every-judged-gate.md` +
   ADR-2026-07-20** — COMPATIBLE (confidence ~90%). `GATE_SURFACE`
   (`gate-invalidation.ts:44-52`) is a keyed record and `classifyGateInvalidation` iterates
   `Object.entries`, returning name lists — order-free by construction. Per-gate surface
   kinds (`build_review: 'any-codetest'`, `wiring_check: 'all-runtime'`) are unchanged, so
   every preserve/invalidate decision is bit-identical. Only the *emission order* of the
   re-open kickback events changes, which TR-3 pins deliberately.

6. **vs `.docs/stories/gate-step-completion-validates-against-code-state-.md` (#817
   code-stamp preservation)** — COMPATIBLE (confidence ~90%). `build_review`'s
   `codeStamp`/`gateVerdictStillValid` preservation path (`artifacts.ts:1789-1817`) is keyed
   on code surface, not on step position. After the swap the stamped HEAD that a preserved
   PASS refers to is still the HEAD the grader saw — `wiring_check` running first writes only
   to gitignored `.pipeline/`, so it cannot move HEAD (and, per TR-1, it no longer runs a
   session that could commit). If anything TR-1 *strengthens* this story by removing a
   HEAD-mover between the stamp and its check.

7. **vs `.docs/stories/kickback-to-build-no-op-when-target-evidence-stamped.md` and
   `retry-classify-rerun-vs-route.md`** — NO CONTENTION (confidence ~85%). `kickbackCounts`
   is keyed per gate name and `MAX_KICKBACKS_PER_GATE` is applied per key
   (`conductor.ts:4482-4487`), so `wiring_check` running earlier cannot consume
   `build_review`'s budget or vice versa. Retry classification is per step and unaffected by
   position.

8. **vs `.docs/stories/trailer-union-build-completion.md` /
   `demote-task-stamping-to-telemetry.md` / `per-task-work-happened-floor.md`
   (build-completeness family)** — NO CONTRADICTION, one acknowledged interaction
   (confidence ~85%). These make `build_review` the sole completeness authority. TR-2 lets a
   deterministic gate speak *before* that authority, so an incomplete build can be reported
   as a wiring gap first. Both route to `build`; neither gate re-derives the other's verdict.
   The new ADR's "rejected sub-decision" section records this explicitly and forbids the
   wiring gate from inferring completeness — which is what would have been the real conflict.

9. **Resource contention (state/artifact writers)** — NONE (confidence ~95%). The two gates
   write disjoint artifacts (`.pipeline/build-review.json` vs
   `.pipeline/wiring-evidence.json`), both gitignored. No step-status key is added, renamed,
   or shared. `task-status.json` is untouched.

## Cross-branch (non-story) overlap

**Intake #878 (trailer-scan caching)** is concurrently editing `conductor.ts`,
`autoheal.ts`, `daemon-cli.ts`. This feature edits `conductor.ts` at three disjoint regions
(dispatch bypass `:3247-3271`, wiring kickback restage `:4505-4509`, rebase re-open list
`:5505-5512`) and does not touch `autoheal.ts` or `daemon-cli.ts`. No semantic conflict
identified; expect a textual rebase in `conductor.ts`. Recorded, not coordinated.

## Blocking items

1. Add a supersession note to `.docs/stories/2026-07-12-wiring-reachability-gate.md`
   (pair 1) — folded into TR-5.
2. Correct the "dispatches" wording in `.docs/stories/s-tier-pipeline-knobs.md` Story 6
   (pair 3) — folded into TR-1.

Both are in-scope edits of this feature's own PR. No story needs re-authoring; no scope
change. **Conflict check passes.**
