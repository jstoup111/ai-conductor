# ADR 2026-07-13: Kickback→build no-op guard + zero-progress/unchanged-verdict escalation

Status: Proposed
Feature: kickback-to-build-no-op-when-target-evidence-stamped
Issue: jstoup111/ai-conductor#647

## Context

A blocking SHIP-gate review that routes rework to `build` (as-built architecture review, prd_audit,
finish verification) relies on the build step *actually re-dispatching work*. But build completion is
derived from durable on-disk task evidence (`autoheal.ts` `deriveCompletion`, consumed via
`gate-verdicts.ts` `checkGateCompletion` and `artifacts.ts` `checkStepCompletion`). When the tasks
implicated by the finding are already evidence-complete, the re-entered build gate is satisfied
immediately: build "succeeds" in seconds with zero new commits, the reviewer re-runs on identical
code and returns the identical verdict, and the loop repeats until `MAX_KICKBACKS_PER_GATE`
(`conductor.ts:196-201`) or a retry budget is exhausted, dead-ending in a generic "retries
exhausted" HALT that never states what input failed to change.

Live incident 2026-07-13 (`2026-07-12-wiring-reachability-gate`): kickback
`adr-2026-07-12-wiring-check-gate→build` at 19:45Z; build gate-passed in 23s, worktree tip
unchanged; 6 identical BLOCKED `architecture_review_as_built` results; retries wasted; operator
intervention.

## Decision

Add two deterministic guards at the existing remediation kickback→build seam; do **not** add a task-
stamp-invalidation mechanism.

### D1 — Route-into-no-op guard (`planRemediation`)

When `planRemediation` (`conductor.ts:871-930`) resolves a route whose earliest target is `build`,
after the existing append + `seedTaskStatus`, recompute build completion from disk
(`checkGateCompletion(dir, 'build', ctx)`). If build is **already satisfied** — i.e. the remediation
produced no dispatchable work (empty `tasks`, or an idempotent upsert onto an already-complete
`rem-*` task, `remediation-append.ts:100-127`) — the engine must not route into a guaranteed no-op.
Return a HALT outcome carrying the gap ledger (the blocking finding + "remediation produced no
dispatchable build work; the implicated task(s) are already evidence-complete — human needed"),
reusing the existing HALT-marker + `surfaceRemediationPr` path. Idempotent: same inputs → same
decision; audit-logged via the existing `kickback` event plus a new distinguishing field (D3).

### D2 — Zero-progress + unchanged-verdict escalation (post-build re-entry)

Track, per gate, that the current build entry was reached via a kickback and record the prior gate
verdict/finding at kickback time (`gate-verdicts.ts` `readVerdict` / `GateVerdict.kickback`). When a
build entered via a kickback ends, classify it:

- **did-work** — `headShaAfterBuild != headShaBeforeBuild` (`conductor.ts:1642`, `:2139`) OR
  `taskEvidence.lastResolvedCount` increased over the pre-kickback value (`:2243` and siblings):
  proceed as today (let the re-review run; it may now pass or produce a *different* finding).
- **no-work** — neither moved: the build derived already-complete and changed nothing. If the
  subsequent gate verdict/finding is **unchanged** from the verdict recorded at kickback time, HALT
  (fail-closed) with **both** artifacts (the reviewer finding and the "build did zero work" record)
  and a reason that names the unchanged input — never re-kick. This also caps the legitimate
  reviewer-wrong case (task genuinely complete, reviewer wrong): it HALTs with both artifacts on the
  first no-work + unchanged-verdict cycle instead of ping-ponging.

An optional config toggle (`kickback_escalation.enabled`, default `true`, mirroring
`build_progress_halt.enabled`) lets an operator revert to the prior re-kick-until-cap behaviour.

### D3 — Audit distinction (Outcome 2/3 telemetry)

The build-after-kickback outcome is recorded on the audit trail as `did-work (commits N..M /
resolved +K)` vs `derived-already-complete`, and the escalation HALT reason states the unchanged
input. Extends the existing `kickback` event (`audit-trail.ts:16,136`; rendered
`report-renderer.ts:143`).

## Non-goals (explicit)

- **No literal per-task completion-stamp invalidation.** The kickback carries an FR/ADR id, not the
  offending plan-task id; mapping a prose review finding to a plan task is an LLM matching project,
  and completion is trailer-authoritative (deleting a stamp does not demote a trailer-evidenced
  task). Rejected as tangled — see track approach 2. Issue Outcome 1's "records a new gap work-item"
  clause is already satisfied by `remediation-append`; D1 makes that path escalate loudly when it
  yields nothing.
- **No classifier for transient-vs-deterministic failure** — that is #646.
- **No change to the daemon DECIDE gate** — #644 is already fixed by PR #645.
- **No change to completion derivation** (`autoheal.ts` / `artifacts.ts`), the remediation-append
  id scheme/upsert, or `MAX_KICKBACKS_PER_GATE`.
- **No new retry budgets/ceilings** — #280 owns progress-aware budgets.

## Consequences

The incident class (silent identical-BLOCKED no-op loop) becomes a fast, informative fail-closed
HALT with both artifacts. Genuine self-heal (a real new `rem-*` task) is unaffected — those builds
are `did-work` and proceed. The change is localized to the kickback→build seam and reuses existing
signals; risk is bounded by the fail-closed HALT and the revert toggle.

## Task sketch

1. D2 progress classifier helper (pure) + RED tests.
2. D1 route-into-no-op guard in `planRemediation` + RED tests.
3. D2 escalation wiring at the kickback→build re-entry sites + prior-verdict capture + RED tests.
4. D3 audit-event distinction + reason text.
5. Regression/idempotency tests, optional config toggle, CHANGELOG, validate.
