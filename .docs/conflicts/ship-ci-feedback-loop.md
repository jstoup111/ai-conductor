# Conflict Check: ship→CI feedback loop + fixture-portability guards
**Date:** 2026-07-07
**New stories:** .docs/stories/ship-ci-feedback-loop.md
**Scanned against:** all .docs/stories/ (56 files), sweep/label/remediation specs and plans
(auto-resolve-open-pr-conflicts, daemon-pr-labels, halt-pr-presentation-reliability,
finish-should-rewrite-stale-needs-remediation-titl, daemon-false-ship-guard,
manual-test-fail-routing, remediation-comment-upsert)
**Result:** PASSED — 1 conflict found and resolved in stories; 0 blocking remain

## Conflict: Dispatch precedence on a PR both CONFLICTING and checks-failed

**Stories involved:** "Bounded CI-fix dispatch seam" (new) vs "Sticky escalation and cooldown
gate every attempt" / serial-guard stories in auto-resolve-open-pr-conflicts.md
**Type:** behavioral overlap (resource contention on the same watched PR within one sweep tick)
**Severity:** degrading (serial guard already prevents concurrent git work; ambiguity was in
ordering + attempt accounting)

**Description:** Both the Task-17 conflict autoresolve and the new CI-fix dispatch select
candidates from the same watch registry in the same tick. A PR that is simultaneously
CONFLICTING and checks-failed was claimable by both; neither artifact stated precedence, and a
CI-fix attempt on a conflicted PR would act on stale check results and burn an attempt for
nothing.

**Resolution applied (story-level, option 1 — least disruptive):** CI-fix eligibility requires
`mergeable ≠ CONFLICTING`. Conflict resolution runs first; after a successful rebase-push, CI
re-runs and the CI-fix path acts on fresh results. Skip is logged and consumes no
`ciFixAttempts`. Negative path added to the "Bounded CI-fix dispatch seam" story. No ADR change
(the injected eligibility seam already accommodates the gate; ADR's eligibility list names
"sticky labels, serial guard, cooldown, cap" — CONFLICTING-exclusion is one more gate).

## Verified-clean pairs (reasoned, not assumed)

- **needs-remediation semantics** — new exhaustion path *applies* the label exactly as the
  existing escalation stories define it (sticky suppressor, REST helpers, duplicate-comment
  suppression via remediation-comment-upsert). Same meaning, new trigger. No contradiction.
- **mergeable label logic** — a checks-failed PR is already `!isMergeable`; the new `ci-failed`
  label coexists without touching FR-10/11/12 behavior (daemon-pr-labels stories unchanged).
- **Watch registry writes** — both dispatch passes mutate the same in-memory survivors array in
  one sequential sweep invocation followed by a single rewrite; no cross-process contention
  introduced.
- **Counter fields** — `ciFixAttempts`/`lastCiFixAt` are new fields parallel to
  `resolveAttempts`/`lastResolveAt` (distinct keys, same normalization pattern); no reuse of the
  existing counters, so autoresolve accounting is untouched.
- **daemon-false-ship-guard (#337)** — complementary: it gates ship evidence at DONE-time; this
  feature observes post-ship health. Enrollment (verified ship only) is the shared seam and is
  unchanged.
- **manual-test-fail-routing (#368)** — operates during BUILD/SHIP inside a live conductor run;
  the CI loop operates on shipped PRs after teardown. Disjoint phases.
- **`ci-failed` / `ci_failed` naming** — no existing artifact uses either token; no semantic
  collision.

## Accepted degrading conflicts

None outstanding — the single finding was resolved in stories.
