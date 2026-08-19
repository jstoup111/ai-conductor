# Conflict Check: Recoverable build review when the blocker is mechanical, not judgement

**Date:** 2026-08-18
**Feature:** review-infrastructure-failures-are-operator-unreco (intake jstoup111/ai-conductor#1629)
**Stories scanned:** all files in `.docs/stories/` (this feature's 13 stories plus every inherited
file), with pairwise attention to the eleven build_review-area story files.
**ADR corpus scope:** `repo_wide` (`.ai-conductor/config.yml:101`). 287 ADRs enumerated; 23 excluded
as unambiguously fully superseded; 264 in the approved corpus; **24 examined in full** against these
stories; 240 narrowed out for no subject overlap. Both sets are recorded in the Appendix. No ADR with
a partial or ambiguous supersession was excluded.
**Result:** PASS — **0 blocking**, 3 resolved (1 sequencing, 1 overlap, 1 state), 0 degrading accepted.

## Conflict 1: Two features add fields to the same durable ledger entry

**Stories involved:** Story 3 (a mechanical lap costs nothing from the semantic allowance) and
Story 5 (mechanical re-attempts are bounded) vs the merged-but-unbuilt feature
`the-engine-cannot-detect-its-own-spinning-operator` (#1652)
**Files:** `.docs/stories/review-infrastructure-failures-are-operator-unreco.md` vs
`.docs/plans/the-engine-cannot-detect-its-own-spinning-operator.md`
**Type:** resource-contention (with a sequencing component)
**Severity:** degrading — resolved, not accepted as a standing compromise

**Description:**
#1652's spec is merged and its stories, plan and coherence mapping are inherited in this worktree,
but `.docs/shipped/` has no record for it and no worktree exists — it is a pending backlog item that
will be built. Its plan Task 3 adds `rubricFailures: Record<string, number>` to `KickbackGateEntry`
and to the persisted shape, and its Task 8 amends `isKickbackGateEntry`
(`.docs/plans/the-engine-cannot-detect-its-own-spinning-operator.md:117-130, 205-211`). This
feature's mechanical allowance counter lands on the same entry, the same parser, and the same
bump/reset functions.

Both additions are additive and read-tolerant by design, so this is a merge-ordering hazard rather
than a contradiction. It is recorded because BUILD must not treat this review's snapshot of
`kickback-ledger.ts` as current.

**Resolution options:**
1. Whichever feature lands second rebases and re-reads the ledger; both fields co-exist.
2. Sequence this feature behind #1652 explicitly.
3. Merge the two counters into one structure.

**Resolution taken: Option 1.** Option 3 is wrong on the merits — the two counters answer different
questions and reset on different signals. Option 2 buys nothing, since neither field reads the
other. Recorded as a plan obligation: the ledger-touching tasks re-read the current entry shape at
implementation time rather than relying on this review.

## Conflict 2: Both features assert that a mechanical fault does not tick the repetition tally

**Stories involved:** Story 3, final negative-path criterion, vs #1652 Task 7
**Files:** `.docs/stories/review-infrastructure-failures-are-operator-unreco.md` vs
`.docs/plans/the-engine-cannot-detect-its-own-spinning-operator.md:198-204`
**Type:** behavioral overlap
**Severity:** degrading — resolved

**ADR filename stem:** adr-2026-08-17-build-review-rubric-repetition-short-circuit
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "A rubric that settled as an infrastructure failure does not
tick either — that is #1629's territory and a mechanical fault is not semantic churn."
**Story opposing sentence (verbatim, before resolution):** "Given a lap that ends in a mechanical
fault, when the lap completes, then no per-rubric repetition tally advances either."

**Description:**
This is agreement, not contradiction — both assert the same behavior — but it was double-owned. Two
features each delivering the same exclusion produces one of two bad outcomes depending on merge
order: if this feature lands first, #1652's Task 7 test asserts an unreachable state (ADR D3 means a
mechanical lap never reaches the tally at all) and becomes vacuous; if #1652 lands first, a task in
this feature's plan would re-deliver work already shipped, which the completeness rubric would
reasonably flag as out of plan.

**Resolution options:**
1. Reword this feature's criterion as a preserved invariant conditional on the tally's existence,
   owned by neither plan as new work.
2. Drop the criterion here and rely on #1652.
3. Keep both and accept a redundant test.

**Resolution taken: Option 1.** Story 3's criterion is amended in place to assert the invariant
conditionally, so it holds under either merge order and is not claimed as this feature's deliverable.
Option 2 would leave the invariant unprotected if #1652 is descoped; option 3 is the vacuous-test
outcome above.

## Conflict 3: The decision resolves the review but nothing resumes the feature

**Stories involved:** Story 5 (exhaustion terminates for a human) vs Story 7 and Story 10 (the
operator records a decision; the review then passes)
**Files:** both in `.docs/stories/review-infrastructure-failures-are-operator-unreco.md`
**Type:** state-conflict
**Severity:** blocking as originally written — resolved before exit

**Description:**
Story 5 requires the terminal state to be one the autonomous loop will not clear by itself — this is
deliberate and correct (`adr-2026-07-28`, and `adr-2026-08-17` D4's finding that the daemon clears
and re-dispatches `mechanical` halts on every sweep). Story 10 then expects the next lap to derive
PASS. Nothing between them resumes the feature.

`adr-2026-08-13` §4 forecloses the obvious shortcut, verbatim: "This decision does not make the
command a general HALT clearer; existing halted-feature recovery remains authoritative." So the
reduced-coverage action must not clear the halt.

Left unresolved this would reproduce the exact defect #1629 was filed about — a recorded decision
that still leaves the operator guessing at an undocumented manual step. The distinction that makes it
acceptable is that the remaining step is a *documented, supported* recovery
(`docs/runbooks/stalled-or-stuck-feature.md:612` — remove `.pipeline/HALT` and `.pipeline/HALT.class`),
not durable-state surgery.

**Resolution options:**
1. Require the halt body to name both steps — record the decision, then clear the halt — and require
   this feature to add the recovery path to the runbook; assert the end-to-end resumption in a story.
2. Let the reduced-coverage action clear the halt, amending `adr-2026-08-13` §4.
3. Introduce a distinct resumable terminal state for this case.

**Resolution taken: Option 1.** Option 2 reopens an approved decision to save one command and would
make an operator command a halt clearer for one special case. Option 3 is a new state for a case the
existing halt already models. Story 5 and Story 10 are amended in place: the halt body must name both
steps in order, the runbook must document the recovery, and the end-to-end path (decision → documented
halt clear → re-dispatch → PASS) is now an explicit acceptance criterion.

## Pairs examined and found clean

Both directions checked ("if A is fully satisfied, does B still hold?") for every pair sharing a
behavior, entity, field or gate:

| Pair | Shared subject | Both directions hold because |
|---|---|---|
| Story 4 (mechanical lap publishes nothing) vs Story 6 (operator sees the exhausted fault) | the published review outcome | Story 4 is scoped to laps with allowance **remaining**; the exhausting lap does publish, which is what Story 6 reads. Not an oscillation: satisfying Story 4 leaves Story 6 reachable. |
| Story 3 (no semantic charge) vs Story 11 (a real finding still blocks) | the semantic allowance | Story 3's own negative path already charges a mixed lap, so "never charge" and "always block a finding" do not compete. |
| Story 8 (operator-only authority) vs Story 5 (unattended termination) | who may act | The loop terminates and waits; it never needs the authority it is denied. |
| Story 10 (covered faults pass) vs Story 11 (findings block) | the effective verdict | Disjoint blocking sets; ADR D8 relaxes exactly one and leaves `unresolvedFindingIds` untouched. |
| Story 13 (legacy state reads clean) vs Story 5 (bounded allowance) | the ledger | An absent counter folds to a fresh count, which fails open on allowance and never on coverage. |
| Story 7 (decision is durable) vs Story 13 (recreated worktree) | decision durability | Story 7 scopes durability to dispatches and to review-outcome removal; Story 13 states the worktree-deletion limitation explicitly, matching the ADR's Known limitation. |
| Story 2 (cause survives) vs Story 7 (class-scoped decision) | the fault class | Story 2 is the prerequisite that makes Story 7's scoping meaningful — Condition 1 of the architecture review, and a plan ordering obligation. |
| Story 11 vs `adr-2026-08-13` §2/§4 | finding acceptance | Story 11 asserts the ADR's rule rather than contradicting it: finding-acceptance still refuses mechanical faults. |
| This feature's stories vs `.docs/stories/build-review-rubric-dispositions-and-fan-out.md`, `repeated-build-review-semantic-failures-can-churn-.md`, `rubric-cache-identity-is-sha-anchored-*.md`, `tautology-rubric-*.md`, `out-of-plan-production-edits-*.md`, `build-review-grades-plan-vs-diff-*.md` | build_review behavior | All are merged and shipped (present in `.docs/shipped/` or already in main's tree); this feature preserves each of their asserted behaviors. The stale unmerged `spec/*` branches the overlap scan flagged carry only `.docs/` and no pending code. |

## Assumptions recorded (verify-claims)

| Assumption | Confidence | Basis | Impact if wrong | Confirmation |
|---|---|---|---|---|
| #1652 is pending, not shipped, so its ledger edits are still to come | 90% | verified — its plan and stories are inherited in `.docs/`, no `.docs/shipped/` record, no worktree, no open PR | Conflict 1's ordering note is unnecessary but harmless | re-read `kickback-ledger.ts` at BUILD, per the resolution |
| The stale `spec/*` branches carry no pending code in this area | 90% | verified — sampled branch diffs contain only `.docs/`; no open PR in this area (4 open PRs, none build_review) | a real overlap could be missed | the plan's first task re-reads current `HEAD` |
| Clearing `.pipeline/HALT` + `HALT.class` is the supported resumption | 95% | verified — `docs/runbooks/stalled-or-stuck-feature.md:612,659,834` | Conflict 3's resolution names the wrong step | the runbook task in the plan re-verifies the current recovery text |

## Appendix — repo_wide ADR corpus record

### Examined in full (24)

- `adr-2026-08-13-stable-build-review-finding-dispositions` — governed and contradicted the original
  approach; resolved by operator direction (architecture review, ADR D6)
- `adr-2026-08-17-build-review-rubric-repetition-short-circuit` — Conflicts 1 and 2
- `adr-2026-08-16-closed-build-review-finding-vocabularies` — identity and `absent` reclassification
- `adr-2026-08-18-content-anchored-finding-reference-schema` — finding reference schema; no overlap
  with a non-finding record kind
- `adr-2026-08-12-cumulative-build-review-convergence-bound` — the semantic cap and its PASS reset
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` — the ledger, per-tree reset, reason-text
  instability
- `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` — the non-charging allowance shape
- `adr-2026-08-06-publication-progress-is-its-own-disposition` — the non-charging re-entry precedent
- `adr-2026-07-13-retry-classify-rerun-vs-route` — the `absent` mapping
- `adr-2026-07-13-kickback-build-no-op-escalation` — the D2 escalation, untouched
- `adr-2026-07-27-daemon-decide-kickback-halt` — cap-first halt reason ordering
- `adr-2026-07-28-total-halt-classification-legacy-boundary` — halt class permitted set
- `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` — Conflict 3
- `adr-2026-08-05-blocked-is-a-distinct-state-from-halted` — considered for the terminal state; halt
  is correct, `BLOCKED` is a daemon-level state for a different concern
- `adr-2026-08-08-finish-human-required-halt-rendering` — halt body rendering
- `adr-2026-08-11-halt-events-ride-the-persisted-spine` — no per-emit-site payloads
- `adr-2026-07-01-machine-scoped-operator-identity` — the authority standard
- `adr-2026-08-09-operator-only-scoped-artifact-reseal` — operator-only precedent
- `adr-2026-07-23-build-review-fresh-base-disposition` — the stale-base exit that precedes this lane
- `adr-2026-08-13-engine-managed-build-review-rubric-branches` — branch management and cache re-stamp
- `adr-2026-08-03-build-repair-member-reuse-validity` — no on-disk verdict is sufficient authority
- `adr-2026-07-26-event-sink-registry-exhaustiveness` — additive event field sink decisions
- `adr-2026-08-06-honest-park-termination-boundary` — park versus halt
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` — the amendment rule applied to the
  PRD and to these stories

The excluded (fully superseded) and narrowed-out sets follow.

### Excluded — unambiguously fully superseded (23)

- `adr-004-engineer-authoring-and-cross-repo-isolation`
- `adr-007-interactive-loop-routing-and-pr-handoff`
- `adr-013-daemon-main-advance-rekick`
- `adr-2026-07-03-committed-shipped-record-dispatch-dedup`
- `adr-2026-07-07-build-review-judgement-gate`
- `adr-2026-07-09-mid-run-merged-pr-guard`
- `adr-2026-07-12-wiring-check-gate`
- `adr-2026-07-21-build-end-plan-completeness-gate`
- `adr-2026-07-23-built-in-provider-model-policies`
- `adr-2026-07-23-provider-policies-with-deeper-discovery-effort`
- `adr-2026-07-24-provider-aware-step-execution`
- `adr-2026-07-25-changelog-pr-link-finalization`
- `adr-2026-07-25-codex-unattended-readiness-and-bounded-execution`
- `adr-2026-07-25-content-addressed-full-suite-proof`
- `adr-2026-07-25-direct-claude-configured-verifier-interface`
- `adr-2026-07-25-notable-change-release-trigger`
- `adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness`
- `adr-2026-07-25-provider-neutral-safety-authority`
- `adr-2026-07-26-codex-auth-evidence-and-recovery-backoff`
- `adr-2026-07-26-serial-ship-tail-publication`
- `adr-2026-07-30-mergeability-first-integration-gate`
- `adr-2026-08-04-smoke-capability-declaration-and-single-entry-point`
- `adr-2026-08-11-wiring-judged-in-build-review`

### Narrowed out — approved, no subject overlap with these stories (240)

- `adr-001-rebase-insertion-mechanism`
- `adr-002-engineer-store-and-retro-redirect`
- `adr-003-registry-write-and-integration`
- `adr-005-non-autonomy-and-read-only-governor`
- `adr-006-flywheel-lesson-selection-and-provenance`
- `adr-008-agent-hosted-loop-and-in-chat-authoring`
- `adr-009-intake-adapter-port`
- `adr-010-pidfile-lock-daemon-liveness`
- `adr-011-async-intake-queue-and-github-source`
- `adr-012-durable-intake-ledger-sole-dedup-authority`
- `adr-014-otel-observability-exporter`
- `adr-015-daemon-pr-labeling-sweep`
- `adr-2026-06-29-architecture-before-stories-convergent-kickback`
- `adr-2026-06-29-brainstorm-rename-migration`
- `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting`
- `adr-2026-06-29-explore-prd-split-track-in-explore`
- `adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration`
- `adr-2026-06-29-memory-resilience-write-fallback-and-reconcile`
- `adr-2026-06-29-per-project-memory-provider-selection`
- `adr-2026-06-29-per-provider-retrieval-guidance-location`
- `adr-2026-06-29-platform-adoption-and-removal-surface`
- `adr-2026-06-29-rebase-conflict-resolution-dispatch`
- `adr-2026-06-29-safe-reversible-memory-migration`
- `adr-2026-06-29-shared-memory-store-placement-and-durability`
- `adr-2026-06-29-track-marker-location`
- `adr-2026-06-30-background-intake-brain-loop`
- `adr-2026-06-30-engineer-worktree-authoring-isolation`
- `adr-2026-06-30-grandfather-cutover-merge-time`
- `adr-2026-06-30-halt-based-release-gates`
- `adr-2026-06-30-origin-seeded-intake-routing`
- `adr-2026-06-30-owner-gate-identity-resolution`
- `adr-2026-06-30-owner-provenance-recording`
- `adr-2026-06-30-sandbox-build-isolation`
- `adr-2026-06-30-self-host-detection-seam`
- `adr-2026-07-03-daemon-auto-restart-stale-engine`
- `adr-2026-07-03-dependency-fail-closed-and-cache`
- `adr-2026-07-03-dependency-gate-backlog-waiting-channel`
- `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land`
- `adr-2026-07-03-gated-snapshot-status-read-model`
- `adr-2026-07-03-gated-writeback-announcements`
- `adr-2026-07-03-generated-model-table-single-source`
- `adr-2026-07-03-halt-pr-rehabilitation-at-finish`
- `adr-2026-07-03-harness-daemon-profile`
- `adr-2026-07-03-issue-dependencies-api-surface`
- `adr-2026-07-03-owner-gate-gated-channel`
- `adr-2026-07-03-post-rebase-force-with-lease`
- `adr-2026-07-03-pr-timing-config-key`
- `adr-2026-07-03-pr-timing-self-host-precedence`
- `adr-2026-07-03-priority-fetch-fail-soft`
- `adr-2026-07-03-priority-from-linked-issue-labels`
- `adr-2026-07-03-prose-to-link-migration`
- `adr-2026-07-03-reactive-model-fallback-ladder`
- `adr-2026-07-03-version-gate-semver-escalation`
- `adr-2026-07-04-auth-failure-park-and-poll`
- `adr-2026-07-04-autoresolve-state-and-config`
- `adr-2026-07-04-claim-time-delivery-evidence-guard`
- `adr-2026-07-04-durable-pause-marker`
- `adr-2026-07-04-event-driven-halt-clear-wake`
- `adr-2026-07-04-kickback-event-emission-and-log-prominence`
- `adr-2026-07-04-operator-park-marker`
- `adr-2026-07-04-park-unpark-cli-verbs`
- `adr-2026-07-04-pending-restart-queue`
- `adr-2026-07-04-resolution-worktree-lifecycle`
- `adr-2026-07-04-respawn-in-place-restart`
- `adr-2026-07-04-versioned-engine-store-atomic-flip`
- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`
- `adr-2026-07-05-daemon-rate-limit-episode-coordinator`
- `adr-2026-07-05-engine-owned-task-status`
- `adr-2026-07-05-halt-pr-presentation-reliability`
- `adr-2026-07-05-retry-as-escalation-ladder`
- `adr-2026-07-05-standalone-bin-update`
- `adr-2026-07-06-daemon-false-ship-guard`
- `adr-2026-07-06-installed-root-resolution-for-global-writes`
- `adr-2026-07-06-manual-test-fail-routing`
- `adr-2026-07-06-migration-gate-waiver`
- `adr-2026-07-06-stale-engine-respawn-in-place`
- `adr-2026-07-07-audit-trail-event-sink`
- `adr-2026-07-07-daemon-owned-build-credential`
- `adr-2026-07-07-finish-record-primitive`
- `adr-2026-07-07-ship-ci-feedback-loop`
- `adr-2026-07-07-single-generation-stale-respawn`
- `adr-2026-07-07-task-trailer-id-alias`
- `adr-2026-07-08-halt-issue-closure-sweep`
- `adr-2026-07-08-main-checkout-leak-triage-and-write-fence`
- `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify`
- `adr-2026-07-09-deterministic-evidence-attribution-enforcement`
- `adr-2026-07-09-setup-failure-triage`
- `adr-2026-07-10-concurrent-group-core`
- `adr-2026-07-10-daemon-stall-remediation`
- `adr-2026-07-10-evidence-range-anchor-resolution`
- `adr-2026-07-10-inline-work-attribution-enforcement`
- `adr-2026-07-10-intake-claim-priority-banding`
- `adr-2026-07-10-intra-step-build-progress-events`
- `adr-2026-07-10-observed-close-watch-registry`
- `adr-2026-07-10-park-marker-main-root-resolution`
- `adr-2026-07-10-retire-migration-grandfather`
- `adr-2026-07-10-session-hook-task-stamping`
- `adr-2026-07-10-validation-group-join`
- `adr-2026-07-11-attribution-abstain-or-loud`
- `adr-2026-07-11-attribution-spot-audit-measurement`
- `adr-2026-07-11-attribution-verdict-interface`
- `adr-2026-07-11-evidence-judge-cli-and-cutover`
- `adr-2026-07-11-finish-step-engine-completion-machinery`
- `adr-2026-07-11-pipeline-state-durability`
- `adr-2026-07-11-semantic-attribution-verification-lane`
- `adr-2026-07-11-verdict-aware-resume-entry`
- `adr-2026-07-12-judged-attribution-verdict-persistence`
- `adr-2026-07-12-progress-aware-build-halt`
- `adr-2026-07-12-rebase-evidence-stamp-translation`
- `adr-2026-07-12-wired-into-contract`
- `adr-2026-07-13-park-all-dispatch-paths`
- `adr-2026-07-13-session-fresh-verdict-artifacts`
- `adr-2026-07-17-verify-only-judged-closure`
- `adr-2026-07-20-bounded-dirname-path-corroboration`
- `adr-2026-07-20-ci-fix-dispatch-via-steprunner`
- `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification`
- `adr-2026-07-20-post-rebase-delta-aware-invalidation`
- `adr-2026-07-21-completeness-as-build-review-rubric`
- `adr-2026-07-21-decide-time-unmerged-overlap-scan`
- `adr-2026-07-21-demote-task-stamping-to-telemetry`
- `adr-2026-07-21-engine-owned-acceptance-red-execution`
- `adr-2026-07-21-intake-only-enforcement`
- `adr-2026-07-21-no-diff-task-evidence-stamp`
- `adr-2026-07-21-owner-stamped-at-authoring`
- `adr-2026-07-21-s-tier-pipeline-knobs`
- `adr-2026-07-21-serena-removal-path`
- `adr-2026-07-22-attempts-counter-on-crash-recovery`
- `adr-2026-07-22-auth-failure-classification-observed-401-patterns`
- `adr-2026-07-22-build-dispatch-json-usage-capture`
- `adr-2026-07-22-canonical-tagged-source-ref`
- `adr-2026-07-22-canonical-tracker-client-seam`
- `adr-2026-07-22-coherence-gate-placement-and-validation-split`
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim`
- `adr-2026-07-22-daemon-level-missing-credential-gate`
- `adr-2026-07-22-examples-state-isolation`
- `adr-2026-07-22-gate-evidence-code-validity-on-redispatch`
- `adr-2026-07-22-headless-vs-guided-examples`
- `adr-2026-07-22-heartbeat-lease-deferred`
- `adr-2026-07-22-intake-closed-issue-reconciliation`
- `adr-2026-07-22-origin-refresh-before-engine-rebuild`
- `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record`
- `adr-2026-07-22-per-task-work-happened-floor`
- `adr-2026-07-22-phase-scoped-docs-write-guard`
- `adr-2026-07-22-requeue-claimed-distinct-from-reopen`
- `adr-2026-07-22-stale-claim-staleness-window-default`
- `adr-2026-07-22-token-liveness-probe-via-cli-invocation`
- `adr-2026-07-23-commit-movement-liveness-floor`
- `adr-2026-07-23-intake-label-authority-scoped-replace`
- `adr-2026-07-23-session-hook-repair-before-halt`
- `adr-2026-07-23-trailer-union-build-step-routing`
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
- `adr-2026-07-25-custom-step-completion-artifacts`
- `adr-2026-07-25-fail-closed-durable-shipment-evidence`
- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation`
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation`
- `adr-2026-07-26-daemon-decide-preseed-ownership`
- `adr-2026-07-26-protected-artifact-seal-rebaseline`
- `adr-2026-07-26-rebase-tail-current-branch-before-publication`
- `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates`
- `adr-2026-07-27-ancestry-proven-park-reconciliation`
- `adr-2026-07-27-codex-never-resumes-a-harness-minted-session`
- `adr-2026-07-27-cold-start-within-step-retries`
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state`
- `adr-2026-07-27-project-config-scaffolder`
- `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`
- `adr-2026-07-28-feature-aware-artifact-resolution`
- `adr-2026-07-29-codex-readiness-probe-failure-disposition`
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main`
- `adr-2026-07-29-deterministic-build-verification-fanout`
- `adr-2026-07-29-engine-observed-provider-time-partition`
- `adr-2026-07-29-operator-park-scheduling-unit-boundary`
- `adr-2026-07-29-ship-start-draft-pr`
- `adr-2026-07-30-contract-aware-same-file-wiring`
- `adr-2026-07-30-finish-only-mergeability-gate`
- `adr-2026-07-30-pinned-remote-theme-for-pages-navigation`
- `adr-2026-07-30-provider-preparation-lifecycle-supervision`
- `adr-2026-08-01-bot-owned-release-pr`
- `adr-2026-08-01-conduct-state-mutation-port`
- `adr-2026-08-01-engine-owned-resumable-finish-publication`
- `adr-2026-08-01-engine-owned-scoped-test-invocation`
- `adr-2026-08-01-multi-proof-park-deletion-authority`
- `adr-2026-08-01-rebase-full-replay-intent-validation`
- `adr-2026-08-01-scoped-run-verb-release-surface`
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`
- `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`
- `adr-2026-08-02-plan-scope-containment-at-commit-boundary`
- `adr-2026-08-03-fail-closed-decide-entry`
- `adr-2026-08-03-ledgered-per-block-migration-execution`
- `adr-2026-08-03-uncommitted-work-floor-under-build-completion`
- `adr-2026-08-04-classify-before-spend-release-smoke-gate`
- `adr-2026-08-04-live-tier-provisions-its-own-provider-home`
- `adr-2026-08-04-unresolved-step-command-fails-by-name`
- `adr-2026-08-05-blocked-classification-after-dedup`
- `adr-2026-08-05-build-settle-outcome-stamp`
- `adr-2026-08-05-provenance-based-protected-artifact-inheritance`
- `adr-2026-08-05-token-first-stories-reference-normalization`
- `adr-2026-08-05-worktree-classification-evidence-derived-reasons`
- `adr-2026-08-07-project-teardown-hook-contract-and-containment`
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts`
- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization`
- `adr-2026-08-07-worktree-removal-coverage-guard`
- `adr-2026-08-08-pipeline-owned-closeout-timestamps`
- `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition`
- `adr-2026-08-08-single-adr-approval-parser-three-rungs`
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance`
- `adr-2026-08-09-adr-contradiction-detection-in-two-halves`
- `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`
- `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config`
- `adr-2026-08-09-checkout-is-sole-version-identity-authority`
- `adr-2026-08-09-conductor-block-single-source-of-truth`
- `adr-2026-08-09-declared-pattern-replication-in-build`
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`
- `adr-2026-08-09-hook-owned-containment-event-ledger`
- `adr-2026-08-09-legacy-json-seed-migration-rule`
- `adr-2026-08-09-non-blocking-plan-scope-containment`
- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`
- `adr-2026-08-09-recorded-red-exception-for-remediation`
- `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`
- `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`
- `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator`
- `adr-2026-08-09-seal-rotation-authorship-predicate`
- `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag`
- `adr-2026-08-09-worktree-local-provider-scratch`
- `adr-2026-08-11-deprecated-no-op-step-retirement`
- `adr-2026-08-12-execution-lifecycle-completeness-for-timing`
- `adr-2026-08-12-fail-closed-intake-ledger-durability`
- `adr-2026-08-12-live-provider-coverage-from-plugin-registry`
- `adr-2026-08-12-operator-reseal-as-second-scope-justification`
- `adr-2026-08-12-per-provider-live-smoke-legs`
- `adr-2026-08-12-removal-anchored-tautology-exemption`
- `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns`
- `adr-2026-08-13-durable-base-advance-attribution`
- `adr-2026-08-13-markdown-default-inversion`
- `adr-2026-08-14-retire-build-review-wiring-rubric`
- `adr-2026-08-15-verify-only-anchored-tautology-exemption`
- `adr-2026-08-16-preservation-anchored-completeness-exemption`
- `adr-2026-08-16-restore-the-current-head-publication-fence`
- `adr-2026-08-17-framework-agnostic-tautology-scoped-run`
- `adr-2026-08-17-structural-live-checkout-containment`
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`