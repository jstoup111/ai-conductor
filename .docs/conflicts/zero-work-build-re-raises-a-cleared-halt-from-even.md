# Conflict Check: BUILD settles without a dispatch when no work is owed (#3659)

**Date:** 2026-11-15
**New stories:** `.docs/stories/zero-work-build-re-raises-a-cleared-halt-from-even.md` (5 stories)
**Result:** passed. Zero blocking conflicts. Seven overlaps were found and resolved in the stories
during this pass; none remains. No ADR was superseded.

**ADR corpus:** repo-wide, 383 ADR files, 10 fully superseded and excluded. Narrowed by subject to
28 examined closely:
- stall and remediation: `adr-2026-07-10-daemon-stall-remediation` (with this spec's three
  amendment notes), remediation-closure-judgement, kickback-build-no-op-escalation,
  cross-dispatch-kickback-livelock-bound, kickback-budget-recovery-uses-needs-human-halt-class;
- BUILD completion and dispatch: tree-attesting-gates-recheck-before-dispatch,
  build-settle-outcome-stamp, uncommitted-work-floor-under-build-completion,
  commit-movement-liveness-floor, progress-aware-build-halt, retry-as-escalation-ladder,
  verdict-aware-resume-entry, per-child-build-region;
- routing and restack: routed-whole-feature-repair, operator-route-round-for-closed-stacked-children,
  post-rebase-gate-first-mechanical-reverify, selective-post-rebase-verification;
- halts: total-halt-classification-legacy-boundary, retryable-halt-cleared-at-dispatch-boundary,
  every-dispatch-outcome-leaves-an-operator-lever, event-driven-halt-clear-wake,
  halt-state-clear-is-marker-and-label-atomic, committed-halt-record;
- events and cost: halt-events-ride-the-persisted-spine, cost-unmetered-is-a-first-class-state,
  execution-lifecycle-completeness-for-timing, per-feature-cost-rollup-in-shipped-record,
  shared-step-lifecycle-telemetry.

Narrowed out after a look (22): session-fresh-verdict-artifacts,
judged-attribution-verdict-persistence, custom-step-completion-artifacts,
retry-classify-rerun-vs-route, deprecated-no-op-step-retirement,
publication-progress-is-its-own-disposition, as-built-remediable-findings-bounded-build-route,
as-built-finding-reconciliation, portable-build-review-policy,
halt-resolution-queue-derived-from-markers, operator-step-rewind-through-the-mutation-port,
child-projected-dispatch-otel, per-dispatch-engine-pinned-executor,
provider-aware-step-execution-fresh-session-scope, unretryable-step-runner-failures-route-by-kind,
adr-014-otel-observability-exporter, stacked-restack-journaled-replay,
stacked-child-plans-identity-and-state, routed-audit-fixes-fold-onto-owners-before-publish,
intra-step-build-progress-events, operator-recorded-restack-conflict-resolution,
operator-decision-for-stacked-restack-conflicts. The remaining ADRs did not match the stories'
subject: providers, memory, intake, release, DECIDE tooling, daemon process and UI.

**Story corpus:** 720 files. 689 narrowed out by subject. 31 examined, in full or in the relevant
part, covering build-stall remediation, the kickback no-op guard, the BUILD completion predicate,
unmetered step completions, routed and revalidate rounds, the per-child BUILD region, and HALT
clearing and re-kick.

Every pair sharing a behaviour, gate, state field or event was checked in both directions.

## Resolved overlaps

Each was a one-direction overlap caused by an undefined term in the new stories. Each was resolved
by tightening the new story text. No existing behaviour changes.

| # | Existing artifact | Overlap | Resolution in the new stories |
|---|---|---|---|
| 1 | `prd-audit-kickback-preserves-task-status.md`, `trailer-union-build-completion.md`: a plan with no parseable tasks never yields a `done` verdict | "Every planned task complete" is trivially true for an empty plan | Story 1 negative path: an empty or missing plan is never settled as `no-work-owed` |
| 2 | `trailer-union-build-completion.md`: the halt marker keeps precedence over evidence | "No work owed" did not mention a live marker | Story 1 negative path: with the marker present, BUILD is not settled |
| 3 | `prd-audit-kickback-preserves-task-status.md`: completion is never trusted from status rows alone | "Complete" was undefined | The definition now names the engine's existing completion check; Story 1 negative path covers rows with no commits |
| 4 | `routed-residue-finding-lands-on-a-taskless-host-an.md` Story 2: no no-op settle at region entry for revalidate and operator rounds | Story 2 said the settle happened "when the round is entered" | Story 2 now settles when the engine reaches the BUILD step; a negative path keeps region entry unchanged |
| 5 | `adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary` decision 1: the daemon clears a mechanical or legacy HALT itself | Story 5's uncleared-halt negative path named no halt class | Story 5 negative path now names a `needs-human` HALT |
| 6 | `adr-2026-08-05-build-settle-outcome-stamp` D3: the no-op-cycle refusal can fire before a BUILD re-entry | Story 2 promised a dispatch after a failed gate with no exception | Story 2 negative path now defers to that refusal |
| 7 | `daemon-mode-route-halt-user-input-required-through.md`, "/remediate stall-question contract and docs": the guidance describes two outcomes | This spec adds a third | The superseded sentence in that story was replaced in place to name the `no-work-owed` verdict |

One design statement was also corrected. Every stall remediation dispatch already charges one
remediation round, so a contradicted `no-work-owed` verdict adds no further charge. The new ADR's
decision 7, this spec's amendment note on `adr-2026-07-10-daemon-stall-remediation` D3, and
Story 3 were revised to say so.

## Pairs reasoned through and found compatible

- **kickback-build-no-op-escalation D1 and Story 1.** D1 runs when a remediation routes work into
  a complete BUILD. A pending repair authorization is work owed, so Story 1 never settles there.
- **tree-attesting-gates-recheck-before-dispatch D3 and Story 1.** D3 governs re-checking a
  persisted `done`. Story 1 requires BUILD not yet done.
- **build-settle-outcome-stamp D4 and Story 1.** D4 stamps the outcomes of a BUILD attempt. The
  settle opens no attempt.
- **routed-whole-feature-repair decisions 7 and 14 and Story 2.** Decision 14's re-run list does
  not include BUILD. The audit-round settle and the taskless-host dispatch are unchanged.
- **commit-movement-liveness-floor, progress-aware-build-halt, retry-as-escalation-ladder and
  Story 3.** Remediation rounds are a separate budget from retry attempts.
- **cost-unmetered-is-a-first-class-state and Story 1.** The `no-owned-criteria` settle already
  emits the same unmetered `step_completed`.
- **The `no_task_progress` stall stories (#569) and Story 3.** That stall requires a completion
  miss, so the check finds work and BUILD resumes; its never-halt rule is unchanged.
- **Existing stories where BUILD is dispatched after a failed gate, for a taskless host, or with
  pending tasks.** Each has a precondition the new stories define as work owed.

## Assumptions carried to the plan

| Assumption | Basis | Confidence | How it is confirmed |
|---|---|---|---|
| A remediation case whose task is complete but whose closure has not been judged is still an open case eligible for BUILD, so BUILD is dispatched and the closure judgement runs | inferred | 80% | The plan's first task confirms it from the case store before the check is written; if wrong, the check gains an unjudged-closure condition |
| After the kickback no-op guard halts and an operator clears that HALT, a BUILD settle followed by the same gate failing again returns to the same `needs-human` HALT; a human is in every lap, so it is not an unattended loop, and it costs one fewer BUILD dispatch per lap than today | inferred | 75% | A plan test drives that sequence |
