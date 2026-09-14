# Conflict Check: Selective post-rebase verification

**Date:** 2026-09-11
**Source-Ref:** jstoup111/ai-conductor#2253
**ADR corpus:** repo_wide — .ai-conductor/config.yml
**Verdict:** PASS — zero unresolved blocking or degrading conflicts

## Scope and inventory

The complete stories/specs/decision/conflict filenames and their text were screened for the affected rebase, verdict, coverage, repair, state, and finish subjects. The focused comparison used the current seven accepted stories, the governing ADRs listed below, and the related legacy and in-flight acceptance contracts. Keyword inventory is discovery evidence, not the basis for the verdict: the conclusions below compare actual scenarios in both directions.

The inventory contained 443 existing story files before adding this feature, 54 specs, 578 decision/review files, and 261 prior conflict reports. This technical feature has no PRD. Fully superseded ADRs were excluded only where their header explicitly declares full supersession; partial/ambiguous supersessions remain in the corpus. The exact examined and narrowed-out ADR inventory is appended below.

## Resolved conflict 1: Positional rebase cascade versus selective reopening

**Type:** contradiction / oscillating
**Severity:** blocking, resolved
**Confidence:** 99%, verified from the cited text
**Parties:** post-rebase-invalidation-re-runs-every-judged-gate.md and phase-9.0-rebase-on-latest.md versus this feature's Stories 1, 2, and 6.

The prior #655 story required: "Non-gate downstream steps retain today's stale semantics." The prior Phase 9 story required: "Test: file-changing rebase → build verdict becomes unsatisfied → selector returns to build."

The accepted new story requires that completed acceptance authoring and BUILD not reopen merely because of their location. Satisfying the old blanket sweep violates the new no-positional-replay guarantee; preserving those steps violates the old sweep expectation. This is a real two-way incompatibility.

**Resolution:** Apply the operator-approved selective transition in the new ADR and replace the superseded story criteria in place. Retain explicit publication continuation and ordinary non-rebase repair invalidation. No BUILD task amends old artifacts.

## Resolved conflict 2: Missing BUILD evidence versus automatic redispatch

**Type:** contradiction
**Severity:** blocking, resolved
**Confidence:** 99%, verified
**ADR filename stem:** adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch
**Story ID:** 2
**ADR opposing sentence (verbatim):** "A predicate that contradicts a persisted `done` causes the step to be **dispatched**; the step's own success path then records its outcome through the existing machinery."
**Story opposing sentence (verbatim):** "Given completed BUILD evidence cannot be established after rebase, when continuation is evaluated, then progress blocks with evidence/recovery diagnostics rather than blindly dispatching the completed task list or proceeding to publication."

Legacy #420/#655 stories also directly required BUILD redispatch when post-rebase evidence was missing. Their general ordinary-repair behavior remains correct; the completed-rebase evidence case conflicts with the accepted new recovery boundary.

**Resolution:** The new ADR D6 and the additive amendment beside the older D3 and D5 scope the exception to completed BUILD after a completed rebase. The predicate remains read-only and authoritative. Update the corresponding legacy story criteria in place. Real suite/review failures and independently established repair obligations continue through ordinary BUILD repair. Both directions now hold within their explicit triggers.

## Resolved conflict 3: Path-only validity versus proved shared-file replay

**Type:** contradiction / oscillating
**Severity:** blocking, resolved
**Confidence:** 99%, verified
**Parties:** #655 rebase stories, #817 completion stories, and adr-2026-07-22-gate-evidence-code-validity-on-redispatch versus new Stories 1 and 5.

The original #655 negative criterion said "a single feature runtime path defeats preservation." The old #817 story required a rerun whenever the baseline delta included a path in the gate's surface. The accepted new story preserves expected replay with disjoint upstream edits in that same file. Leaving the old completion rule intact would repeatedly invalidate the verdict just preserved by the rebase writer.

**Resolution:** Scope the old criteria to changed/unproved replay and add the replay-bound authority amendment beside the old ADR decision. Gate readers must consume the same preservation authority. Relevant document/input changes, unavailable bindings, and ordinary pending failures still prevent reuse.

## Examined interactions that remain compatible

| Pair | If the new behavior holds, does the existing obligation hold? | Reverse check |
|---|---|---|
| Stories 1–3 vs #2211 / open #2453 | Yes: active documents still invalidate affected gates; replay proof does not replace its resolver/projection. | Yes: the old matrix without replay proof retains its behavior; the new proof refines feature contribution only. |
| Story 7 vs #1207/#2515 | Yes: entry policy is untouched and re-kick still imports the target base. | Yes: actual completed rebases still reach the new selective policy. |
| Stories 2/7 vs #415 / open #2495 | Yes: recovery runs before preservation and must succeed first. | Yes: recovery outcome feeds the existing shared completion seam. |
| Story 3 vs coverage-binding D4–D9 | Yes: same input pairs, digest cache, judge, envelope, disabled outcome, and refusal owner. | Yes: a refresh need not select neighboring lifecycle steps. |
| Story 4 vs suite proof/drift policy | Yes: native proof remains authority; test failure and infrastructure failure stay distinct. | Yes: valid proof reuse does not require a redundant command execution. |
| Stories 4/5 vs BUILD-repair member reuse and finish fence | Yes: actual repair revalidates; publication still checks current authority. | Yes: validated preserved authority is current evidence, not an unconditional bypass. |
| Story 6 vs mutation port and operator rewind #2181 | Yes: explicit expected-value batches preserve unrelated fields; operator rewind semantics do not change. | Yes: an operator's intentional rewind remains separate from automatic rebase refresh. |
| Story 6 vs convergence-credit D2 | Yes: credit only actual build_review invalidation, once per operation. | Yes: repeated application cannot issue another credit or erase a later failure. |
| Stories 2/7 vs seal, translation, and full-replay intent guards | Yes: success of existing guards is still required before new authority is considered. | Yes: guard success alone does not prove an unchanged replay or permit stale reviews. |
| Stories 5/6 vs newer ordinary failure | Yes: original PASS cannot mask a later repair obligation. | Yes: genuine recovery can complete without an unrelated rebase resurrecting the old PASS. |

## Seven-story pair review

All pairs sharing a gate were checked in both directions. Story 1's preserve case and Story 2's changed/unproved case have disjoint evidence preconditions. Story 3 refreshes coverage without granting implementation completion. Story 4's actual failure disables Story 1/5 preservation for its repair obligations. Story 5 checks authority at readers; Story 6 prevents partial persistence from granting it. Story 7 scopes entry/noop behavior before the new transition. No resource exclusivity or ordering cycle is introduced: prerequisite PRs land first, then this implementation; it does not ask them to consume this feature.

## Ownership and sequencing

#2211/#2453 and #415/#2495 remain implementation prerequisites. Their open branches and documents were inspected read-only and were not amended. Mechanical dependency links are a pre-handoff requirement, not something this report claims already exists. #2462 and #2488 retain their independent issue scope. No conflicting provider-specific behavior is introduced.

## Resolution authority and result

The operator approved the whole-flow policy, its conservative evidence-recovery boundary, and the seven stories before this pass. The edits apply those approved decisions to the contradictory older clauses; they introduce no new product or architectural choice. ADR changes are additive notes beside the governing assertions; story changes replace superseded text without amendment records.

Re-check result: zero unresolved blocking conflicts; zero accepted degrading conflicts. All six conflict categories were considered. A review marker is written because this pass reconciled historical conflicts.

## ADR corpus inventory

### Examined

- adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md
- adr-2026-07-11-verdict-aware-resume-entry.md
- adr-2026-07-12-rebase-evidence-stamp-translation.md
- adr-2026-07-20-post-rebase-delta-aware-invalidation.md
- adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md
- adr-2026-07-25-content-addressed-full-suite-proof.md
- adr-2026-07-26-protected-artifact-seal-rebaseline.md
- adr-2026-07-26-rebase-tail-current-branch-before-publication.md
- adr-2026-08-01-conduct-state-mutation-port.md
- adr-2026-08-01-rebase-full-replay-intent-validation.md
- adr-2026-08-03-build-repair-member-reuse-validity.md
- adr-2026-08-16-restore-the-current-head-publication-fence.md
- adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence.md
- adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md
- adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md
- adr-2026-08-31-coverage-binding-judge-step.md
- adr-2026-09-11-finish-mergeability-respects-active-review-inputs.md
- adr-2026-09-11-selective-post-rebase-verification.md

<details>
<summary>Approved ADRs narrowed out: unrelated subjects</summary>

- adr-002-engineer-store-and-retro-redirect.md
- adr-003-registry-write-and-integration.md
- adr-005-non-autonomy-and-read-only-governor.md
- adr-006-flywheel-lesson-selection-and-provenance.md
- adr-008-agent-hosted-loop-and-in-chat-authoring.md
- adr-009-intake-adapter-port.md
- adr-010-pidfile-lock-daemon-liveness.md
- adr-011-async-intake-queue-and-github-source.md
- adr-012-durable-intake-ledger-sole-dedup-authority.md
- adr-014-otel-observability-exporter.md
- adr-015-daemon-pr-labeling-sweep.md
- adr-2026-06-29-architecture-before-stories-convergent-kickback.md
- adr-2026-06-29-brainstorm-rename-migration.md
- adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md
- adr-2026-06-29-explore-prd-split-track-in-explore.md
- adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration.md
- adr-2026-06-29-memory-resilience-write-fallback-and-reconcile.md
- adr-2026-06-29-per-project-memory-provider-selection.md
- adr-2026-06-29-per-provider-retrieval-guidance-location.md
- adr-2026-06-29-platform-adoption-and-removal-surface.md
- adr-2026-06-29-rebase-conflict-resolution-dispatch.md
- adr-2026-06-29-safe-reversible-memory-migration.md
- adr-2026-06-29-shared-memory-store-placement-and-durability.md
- adr-2026-06-29-track-marker-location.md
- adr-2026-06-30-background-intake-brain-loop.md
- adr-2026-06-30-engineer-worktree-authoring-isolation.md
- adr-2026-06-30-grandfather-cutover-merge-time.md
- adr-2026-06-30-halt-based-release-gates.md
- adr-2026-06-30-origin-seeded-intake-routing.md
- adr-2026-06-30-owner-gate-identity-resolution.md
- adr-2026-06-30-owner-provenance-recording.md
- adr-2026-06-30-sandbox-build-isolation.md
- adr-2026-06-30-self-host-detection-seam.md
- adr-2026-07-01-machine-scoped-operator-identity.md
- adr-2026-07-03-daemon-auto-restart-stale-engine.md
- adr-2026-07-03-dependency-fail-closed-and-cache.md
- adr-2026-07-03-dependency-gate-backlog-waiting-channel.md
- adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.md
- adr-2026-07-03-gated-writeback-announcements.md
- adr-2026-07-03-generated-model-table-single-source.md
- adr-2026-07-03-halt-pr-rehabilitation-at-finish.md
- adr-2026-07-03-harness-daemon-profile.md
- adr-2026-07-03-issue-dependencies-api-surface.md
- adr-2026-07-03-owner-gate-gated-channel.md
- adr-2026-07-03-post-rebase-force-with-lease.md
- adr-2026-07-03-pr-timing-config-key.md
- adr-2026-07-03-pr-timing-self-host-precedence.md
- adr-2026-07-03-priority-fetch-fail-soft.md
- adr-2026-07-03-priority-from-linked-issue-labels.md
- adr-2026-07-03-prose-to-link-migration.md
- adr-2026-07-03-reactive-model-fallback-ladder.md
- adr-2026-07-03-version-gate-semver-escalation.md
- adr-2026-07-04-auth-failure-park-and-poll.md
- adr-2026-07-04-autoresolve-state-and-config.md
- adr-2026-07-04-claim-time-delivery-evidence-guard.md
- adr-2026-07-04-durable-pause-marker.md
- adr-2026-07-04-event-driven-halt-clear-wake.md
- adr-2026-07-04-kickback-event-emission-and-log-prominence.md
- adr-2026-07-04-park-unpark-cli-verbs.md
- adr-2026-07-04-pending-restart-queue.md
- adr-2026-07-04-resolution-worktree-lifecycle.md
- adr-2026-07-04-respawn-in-place-restart.md
- adr-2026-07-04-versioned-engine-store-atomic-flip.md
- adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep.md
- adr-2026-07-05-daemon-rate-limit-episode-coordinator.md
- adr-2026-07-05-halt-pr-presentation-reliability.md
- adr-2026-07-05-retry-as-escalation-ladder.md
- adr-2026-07-05-standalone-bin-update.md
- adr-2026-07-06-daemon-false-ship-guard.md
- adr-2026-07-06-installed-root-resolution-for-global-writes.md
- adr-2026-07-06-manual-test-fail-routing.md
- adr-2026-07-06-migration-gate-waiver.md
- adr-2026-07-06-stale-engine-respawn-in-place.md
- adr-2026-07-07-audit-trail-event-sink.md
- adr-2026-07-07-daemon-owned-build-credential.md
- adr-2026-07-07-finish-record-primitive.md
- adr-2026-07-07-ship-ci-feedback-loop.md
- adr-2026-07-07-single-generation-stale-respawn.md
- adr-2026-07-07-task-trailer-id-alias.md
- adr-2026-07-08-halt-issue-closure-sweep.md
- adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md
- adr-2026-07-09-deterministic-evidence-attribution-enforcement.md
- adr-2026-07-09-setup-failure-triage.md
- adr-2026-07-10-concurrent-group-core.md
- adr-2026-07-10-daemon-stall-remediation.md
- adr-2026-07-10-evidence-range-anchor-resolution.md
- adr-2026-07-10-inline-work-attribution-enforcement.md
- adr-2026-07-10-intake-claim-priority-banding.md
- adr-2026-07-10-intra-step-build-progress-events.md
- adr-2026-07-10-observed-close-watch-registry.md
- adr-2026-07-10-park-marker-main-root-resolution.md
- adr-2026-07-10-retire-migration-grandfather.md
- adr-2026-07-10-session-hook-task-stamping.md
- adr-2026-07-10-validation-group-join.md
- adr-2026-07-11-attribution-abstain-or-loud.md
- adr-2026-07-11-attribution-spot-audit-measurement.md
- adr-2026-07-11-attribution-verdict-interface.md
- adr-2026-07-11-evidence-judge-cli-and-cutover.md
- adr-2026-07-11-finish-step-engine-completion-machinery.md
- adr-2026-07-11-pipeline-state-durability.md
- adr-2026-07-11-semantic-attribution-verification-lane.md
- adr-2026-07-12-judged-attribution-verdict-persistence.md
- adr-2026-07-12-progress-aware-build-halt.md
- adr-2026-07-12-wired-into-contract.md
- adr-2026-07-13-kickback-build-no-op-escalation.md
- adr-2026-07-13-park-all-dispatch-paths.md
- adr-2026-07-13-retry-classify-rerun-vs-route.md
- adr-2026-07-13-session-fresh-verdict-artifacts.md
- adr-2026-07-17-verify-only-judged-closure.md
- adr-2026-07-20-bounded-dirname-path-corroboration.md
- adr-2026-07-20-ci-fix-dispatch-via-steprunner.md
- adr-2026-07-20-ci-fix-startup-preflight-and-error-classification.md
- adr-2026-07-21-decide-time-unmerged-overlap-scan.md
- adr-2026-07-21-demote-task-stamping-to-telemetry.md
- adr-2026-07-21-engine-owned-acceptance-red-execution.md
- adr-2026-07-21-intake-only-enforcement.md
- adr-2026-07-21-no-diff-task-evidence-stamp.md
- adr-2026-07-21-owner-stamped-at-authoring.md
- adr-2026-07-21-s-tier-pipeline-knobs.md
- adr-2026-07-21-serena-removal-path.md
- adr-2026-07-22-attempts-counter-on-crash-recovery.md
- adr-2026-07-22-build-dispatch-json-usage-capture.md
- adr-2026-07-22-canonical-tagged-source-ref.md
- adr-2026-07-22-canonical-tracker-client-seam.md
- adr-2026-07-22-coherence-gate-placement-and-validation-split.md
- adr-2026-07-22-coherence-waiver-and-duplicate-claim.md
- adr-2026-07-22-daemon-level-missing-credential-gate.md
- adr-2026-07-22-examples-state-isolation.md
- adr-2026-07-22-headless-vs-guided-examples.md
- adr-2026-07-22-heartbeat-lease-deferred.md
- adr-2026-07-22-intake-closed-issue-reconciliation.md
- adr-2026-07-22-origin-refresh-before-engine-rebuild.md
- adr-2026-07-22-per-feature-cost-rollup-in-shipped-record.md
- adr-2026-07-22-per-task-work-happened-floor.md
- adr-2026-07-22-phase-scoped-docs-write-guard.md
- adr-2026-07-22-requeue-claimed-distinct-from-reopen.md
- adr-2026-07-22-stale-claim-staleness-window-default.md
- adr-2026-07-22-token-liveness-probe-via-cli-invocation.md
- adr-2026-07-23-build-review-fresh-base-disposition.md
- adr-2026-07-23-intake-label-authority-scoped-replace.md
- adr-2026-07-23-session-hook-repair-before-halt.md
- adr-2026-07-23-trailer-union-build-step-routing.md
- adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md
- adr-2026-07-25-custom-step-completion-artifacts.md
- adr-2026-07-25-fail-closed-durable-shipment-evidence.md
- adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation.md
- adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation.md
- adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md
- adr-2026-07-26-daemon-decide-preseed-ownership.md
- adr-2026-07-26-event-sink-registry-exhaustiveness.md
- adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates.md
- adr-2026-07-27-ancestry-proven-park-reconciliation.md
- adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md
- adr-2026-07-27-cold-start-within-step-retries.md
- adr-2026-07-27-cost-unmetered-is-a-first-class-state.md
- adr-2026-07-27-daemon-decide-kickback-halt.md
- adr-2026-07-27-project-config-scaffolder.md
- adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md
- adr-2026-07-28-feature-aware-artifact-resolution.md
- adr-2026-07-28-total-halt-classification-legacy-boundary.md
- adr-2026-07-29-codex-readiness-probe-failure-disposition.md
- adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main.md
- adr-2026-07-29-deterministic-build-verification-fanout.md
- adr-2026-07-29-engine-observed-provider-time-partition.md
- adr-2026-07-29-operator-park-scheduling-unit-boundary.md
- adr-2026-07-29-ship-start-draft-pr.md
- adr-2026-07-30-contract-aware-same-file-wiring.md
- adr-2026-07-30-pinned-remote-theme-for-pages-navigation.md
- adr-2026-07-30-provider-preparation-lifecycle-supervision.md
- adr-2026-08-01-bot-owned-release-pr.md
- adr-2026-08-01-engine-owned-resumable-finish-publication.md
- adr-2026-08-01-engine-owned-scoped-test-invocation.md
- adr-2026-08-01-multi-proof-park-deletion-authority.md
- adr-2026-08-01-scoped-run-verb-release-surface.md
- adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate.md
- adr-2026-08-02-live-tier-asserts-outcomes-not-scripts.md
- adr-2026-08-02-plan-scope-containment-at-commit-boundary.md
- adr-2026-08-03-fail-closed-decide-entry.md
- adr-2026-08-03-ledgered-per-block-migration-execution.md
- adr-2026-08-04-classify-before-spend-release-smoke-gate.md
- adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md
- adr-2026-08-04-live-tier-provisions-its-own-provider-home.md
- adr-2026-08-04-unresolved-step-command-fails-by-name.md
- adr-2026-08-05-blocked-classification-after-dedup.md
- adr-2026-08-05-blocked-is-a-distinct-state-from-halted.md
- adr-2026-08-05-build-settle-outcome-stamp.md
- adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever.md
- adr-2026-08-05-provenance-based-protected-artifact-inheritance.md
- adr-2026-08-05-token-first-stories-reference-normalization.md
- adr-2026-08-05-worktree-classification-evidence-derived-reasons.md
- adr-2026-08-06-bounded-progress-allowance-for-finish-publication.md
- adr-2026-08-06-honest-park-termination-boundary.md
- adr-2026-08-06-publication-progress-is-its-own-disposition.md
- adr-2026-08-07-project-teardown-hook-contract-and-containment.md
- adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.md
- adr-2026-08-07-smoke-gate-goes-live-without-precharacterization.md
- adr-2026-08-07-worktree-removal-coverage-guard.md
- adr-2026-08-08-finish-human-required-halt-rendering.md
- adr-2026-08-08-pipeline-owned-closeout-timestamps.md
- adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition.md
- adr-2026-08-08-single-adr-approval-parser-three-rungs.md
- adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md
- adr-2026-08-09-adr-contradiction-detection-in-two-halves.md
- adr-2026-08-09-adr-layer-gated-by-committed-adr-signal.md
- adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md
- adr-2026-08-09-checkout-is-sole-version-identity-authority.md
- adr-2026-08-09-conductor-block-single-source-of-truth.md
- adr-2026-08-09-declared-pattern-replication-in-build.md
- adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md
- adr-2026-08-09-hook-owned-containment-event-ledger.md
- adr-2026-08-09-legacy-json-seed-migration-rule.md
- adr-2026-08-09-non-blocking-plan-scope-containment.md
- adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md
- adr-2026-08-09-operator-only-scoped-artifact-reseal.md
- adr-2026-08-09-recorded-red-exception-for-remediation.md
- adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag.md
- adr-2026-08-09-reseal-audit-rides-the-existing-event-spine.md
- adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator.md
- adr-2026-08-09-seal-rotation-authorship-predicate.md
- adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag.md
- adr-2026-08-09-worktree-local-provider-scratch.md
- adr-2026-08-11-deprecated-no-op-step-retirement.md
- adr-2026-08-11-halt-events-ride-the-persisted-spine.md
- adr-2026-08-12-cumulative-build-review-convergence-bound.md
- adr-2026-08-12-execution-lifecycle-completeness-for-timing.md
- adr-2026-08-12-fail-closed-intake-ledger-durability.md
- adr-2026-08-12-live-provider-coverage-from-plugin-registry.md
- adr-2026-08-12-operator-reseal-as-second-scope-justification.md
- adr-2026-08-12-per-provider-live-smoke-legs.md
- adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md
- adr-2026-08-13-durable-base-advance-attribution.md
- adr-2026-08-13-engine-managed-build-review-rubric-branches.md
- adr-2026-08-13-markdown-default-inversion.md
- adr-2026-08-13-stable-build-review-finding-dispositions.md
- adr-2026-08-14-retire-build-review-wiring-rubric.md
- adr-2026-08-16-closed-build-review-finding-vocabularies.md
- adr-2026-08-17-framework-agnostic-tautology-scoped-run.md
- adr-2026-08-17-structural-live-checkout-containment.md
- adr-2026-08-18-content-anchored-finding-reference-schema.md
- adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md
- adr-2026-08-19-engine-stamped-rubric-judged-result-envelope.md
- adr-2026-08-19-live-provider-stream-observation.md
- adr-2026-08-19-operator-step-rewind-through-the-mutation-port.md
- adr-2026-08-19-unretryable-step-runner-failures-route-by-kind.md
- adr-2026-08-21-engine-identity-in-build-review-cache-key.md
- adr-2026-08-21-review-bound-by-plan-done-when-criteria.md
- adr-2026-08-22-as-built-review-runs-always-with-plan-gap.md
- adr-2026-08-22-build-review-opt-in-rubric-container.md
- adr-2026-08-22-done-when-evidence-at-task-close.md
- adr-2026-08-22-one-owner-per-review-question.md
- adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback.md
- adr-2026-08-23-committed-halt-record.md
- adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote.md
- adr-2026-08-23-criterion-layer-is-structural-at-land.md
- adr-2026-08-23-diff-locality-is-an-authored-disposition.md
- adr-2026-08-24-evidentiary-defects-are-not-waivable.md
- adr-2026-08-24-one-dispatch-member-on-the-provider-contract.md
- adr-2026-08-24-over-scope-decision-block-and-durable-refusals.md
- adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope.md
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route.md
- adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot.md
- adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity.md
- adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal.md
- adr-2026-08-26-music-vocabulary-player-composer-rename.md
- adr-2026-08-26-remove-retrospectives-one-shot.md
- adr-2026-08-26-setup-once-per-worktree-marker.md
- adr-2026-08-26-shared-coherence-parser-at-discovery.md
- adr-2026-08-27-daemon-dispatcher-executor-seam.md
- adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class.md
- adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md
- adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded.md
- adr-2026-08-30-shared-plan-task-reference-resolver.md
- adr-2026-08-31-kickback-ledger-read-fails-closed.md
- adr-2026-09-02-adr-decision-citability-contract.md
- adr-2026-09-05-gh-cli-version-floor-and-environment-gate.md
- adr-2026-09-06-engine-owned-test-quality-scope.md
- adr-2026-09-06-inbound-intake-trust-boundary.md
- adr-2026-09-06-reopened-task-resolution.md
- adr-2026-09-07-durable-prd-widening-decision-reconciliation.md
- adr-2026-09-10-portable-build-review-policy.md
- adr-2026-09-10-separate-custom-review-coverage-identity.md
- adr-2026-09-10-shared-step-lifecycle-telemetry.md

</details>

<details>
<summary>Explicitly fully superseded ADRs excluded</summary>

- adr-2026-07-04-operator-park-marker.md
- adr-2026-07-12-wiring-check-gate.md
- adr-2026-07-21-completeness-as-build-review-rubric.md
- adr-2026-07-25-content-addressed-full-suite-proof.md
- adr-2026-07-30-finish-only-mergeability-gate.md
- adr-2026-08-12-removal-anchored-tautology-exemption.md
- adr-2026-08-15-verify-only-anchored-tautology-exemption.md
- adr-2026-08-16-preservation-anchored-completeness-exemption.md
- adr-2026-08-29-build-review-remediate-case-adjudication.md
- adr-2026-08-29-operator-authorized-kickback-budget-recovery.md

</details>
