# Conflict Check: Kickback cap halts at the remediation→build transition (#2753)

**Date:** 2026-09-29
**Result:** PASS: zero blocking conflicts remain after resolution
**ADR corpus:** `repo_wide` (from `.ai-conductor/config.yml`)

## Inventory

- **Stories.** The new Stories 1–5 were compared against every accepted story file in
  `.docs/stories/`. Files were found by keyword grep across 508 files; the relevant ones were read
  in full.
  - Read in full: build-review-re-judges-what-the-plan-architecture-,
    a-halted-feature-only-re-runs-when-a-human-clears-, offer-ship-or-continue-at-remediation-budget,
    every-as-built-blocked-verdict-halts-needs-human-i, as-built-review-receives-bounded-inputs-and-return,
    plan-growth-allowance-is-spent-on-work-existing-ta, remediation-halts-when-the-owning-plan-task-is-alr,
    the post-rebase stories (post-rebase-build-invalidation-dispatches-a-full-b,
    post-rebase-invalidation-re-runs-every-judged-gate, file-changing-rebase-rewinds-past-test-suite-and-r),
    build-repair-preserves-stale-wiring-pass-and-halts, parallel-validation-phase-fan-out-manual-test-prd-.
- **ADRs.** All 299 APPROVED ADRs were scored by term density, and about 30 were read in full.
  Narrowed out, as outside the design's scope:
  - build_review convergence and rubric ADRs
  - DECIDE kickback halts
  - build-progress and liveness halts
  - halt PR, telemetry and event ADRs
  - plan-scope and seal ADRs
  No APPROVED ADR was found fully superseded.
- **Conflict types.** All six were evaluated in both directions: contradiction, overlap, state,
  resource, sequencing and oscillating. No oscillating pair was found.

## Resolved blocking conflicts

### B1: The cap is checked before any task is appended (shipped stories)

**Involved:** build-review-re-judges-what-the-plan-architecture- Story 10 (#1805);
every-as-built-blocked-verdict-halts-needs-human-i Story 4; and
offer-ship-or-continue-at-remediation-budget Story 2 (#2185), all against new Stories 1–3.
**Type:** contradiction. **Confidence:** 95%, verified verbatim.
- #1805 S10: "The cap is checked before any task is added; going over adds nothing and stops the run".
- New S1: "remediate is dispatched, its admitted tasks are appended to the plan and committed, and the feature halts with class kickback-cap before build is dispatched."

**Resolution:** Option 1, reword the shipped stories to the build-transition timing. The land stem
gate refuses foreign-stem story edits, so those rewordings ship in a companion main-based PR that
merges together with this spec. That PR also carries the degrading rewordings D1–D3 below.

### B2: One-owner principle: "only under its cap"

**ADR filename stem:** adr-2026-08-22-one-owner-per-review-question, as restated in
adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 5.
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "a gate may fail a lap or halt, but only prd_audit may append plan tasks, and only under its cap"
**Story opposing sentence (verbatim):** "remediate is dispatched, its admitted tasks are appended to the plan and committed, and the feature halts with class kickback-cap before build is dispatched."
**Type:** contradiction.

**Resolution:** An additive amendment to adr-2026-08-25 decision 5. The cap bounds the BUILD
dispatch that builds the appended tasks, and unsettled tasks never build without an in-cap
settlement or a consumed raise. The single appender is unchanged.

## Resolved degrading conflicts

- **D1: raised caps are honored at append (a-halted-feature-only-re-runs-when-a-human-clears- S5).**
  The companion PR rewords this to honor the raised cap when the pending charge settles.
- **D2: existing-task lap timing (plan-growth-allowance-is-spent-on-work-existing-ta S4 and
  adr-2026-09-06-reopened-task-resolution D2).**
  - The companion PR rewords S4.
  - An additive amendment to adr-2026-09-06 D2 charges prd_audit and as-built existing-task laps at
    dispatch, uses the obligation id as the receipt, and leaves coverage_binding unchanged.
  - New Story 3 and Story 5 criteria pin this: an exhausted existing-task round re-stages and then
    halts at the transition, a replay makes no double charge, and coverage_binding is unchanged.
- **D3: as-built gate-settle halt wording (as-built-review-receives-bounded-inputs-and-return S6).**
  Reworded in the companion PR.
- **D4: authored-count derivation against pre-existing `rem-*` tasks (#1805 S10).** A new Story 3
  criterion keys exclusion on the recorded pending charge, never on the task-id prefix.
- **D5: no-op guard terminology and stale pending repair.**
  - adr-2026-08-25 D4 and adr-2026-07-13 D1/D2 disagreed with Story 5's wording. Story 5 now names
    the route-into-no-op guard.
  - That guard discards the pending repair without charging it. Architecture review Condition 9 was
    added as an amendment.
- **D6: malformed pending state (adr-2026-08-31-kickback-ledger-read-fails-closed D1/D3).** The
  #2753 amendment to adr-2026-08-22 D6 now fails closed, scoped to the prd_audit, as-built and
  growth allowances. A new Story 3 criterion covers this, and review Condition 7 was added.
- **D7: an unreadable ledger at append (offer-ship S1).** A new Story 3 criterion covers the
  fail-closed halt before append.

## Not conflicts (verified)

- **Rebase BUILD pre-verify** (adr-2026-07-08, adr-2026-08-19, and the rebase stories). It is gated
  on `build === 'done'`, so the non-done BUILD with pending tasks keeps its repair owner, which
  matches Story 4.
- **Verdict-aware resume and selective post-rebase verification** (adr-2026-07-11,
  adr-2026-09-11 D3/D4/D6). Both clamp to BUILD.
- **Kickback-budget recovery** (adr-2026-08-29 needs-human-halt-class). Cap evidence is written
  before the halt, and the authorization is consumed on the daemon side.
- **Over-scope ADRs and stories.** An undecided or refused OVER_SCOPE finding halts before
  remediate, so it never coexists with a pending repair.
- **The #2755 hotfix** has no ADR and no stories.
- **adr-2026-08-05-build-settle-outcome-stamp D3.** It is APPROVED but unwired. Review Condition 9
  orders settlement after any pre-dispatch refusal.
