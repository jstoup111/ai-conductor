# Conflict Check: Sequential and parallel telemetry parity

Date: 2026-09-10
Verdict: CLEAN
Blocking conflicts: 0
Degrading conflicts: 0
ADR corpus: repo_wide, from .ai-conductor/config.yml

## Inventory and scope

The repository-wide file inventory contains 1061 story/spec/decision/conflict artifacts. Subject searches ran across the stories/specs corpus for lifecycle events, telemetry, metrics, spans, duration, dispatch accounting, and parallel groups. Comparisons below use the relevant contracts; unrelated story subjects are outside the interaction set. No PRD is introduced on the technical track.

## Examined ADRs

- adr-014-otel-observability-exporter
- adr-2026-07-10-concurrent-group-core
- adr-2026-07-10-validation-group-join
- adr-2026-07-26-event-sink-registry-exhaustiveness
- adr-2026-07-29-engine-observed-provider-time-partition
- adr-2026-08-12-execution-lifecycle-completeness-for-timing
- adr-2026-08-24-refused-step-status
- adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity
- adr-2026-09-10-shared-step-lifecycle-telemetry

Partial amendments were retained: ADR-014's single MetricsListener and bounded-dimension amendments, the group-join amendments preserving sibling evidence, and verdict identity's code-validity refinement remain in force. None of these selected ADRs was discarded as superseded.

## Interaction review

| New stories | Existing contract | Two-directional judgement |
| --- | --- | --- |
| 1, 3, 5, 7 | parallel-validation-phase-fan-out-manual-test-prd-; concurrent-group-core; validation-group-join | Member telemetry does not alter caps, width-one serial selection, detached sessions, retry policy, or join state writes. Keeping those policies does not prevent per-member measurement. |
| 4, 6 | shipped-record-timing-never-reaches-measured-the-l; execution-lifecycle-completeness-for-timing | New identity prevents false pairing; legacy repeated starts remain counted and incomplete. Catchable closures do not fabricate historical terminals. |
| 4, 5 | a-gate-halt-marks-a-completed-build-failed-and-the; refused-step-status | Refusal projects distinctly but remains non-satisfying. A completed runner does not authorize a gate pass; deferred classification retains its own elapsed boundary. |
| 2, 3, 6 | stop-counting-provider-free-step-completions-as-un; export-the-telemetry-dimensions-the-engine-already | Existing authoritative attempts and compatibility completions retain one-dispatch semantics. Correlation cannot borrow sibling dimensions. The 2026-09-10 single-listener operator clarification is retained. |
| 1, 2, 6 | no-daemon-level-metrics-queue-depth-halts-and-gate; ADR-014 | One metric listener owns projection and per-dispatch visualizers remain spans-only. IDs are excluded from both metric Resource and point label paths. |
| 4, 7 | mechanically-enforce-otel-handler-coverage-for-ote; event-sink-registry-exhaustiveness | Deliberately changing a sink declaration and adding its real handlers preserves exhaustive coverage. Untraced events remain untraced; no backdoor subscriptions bypass the registry. |
| 2, 5 | engine-stamped-ship-tail-verdict-run-identity | Execution correlation is a separate lifetime from verdict attempt identity. Its introduction neither replaces runId stamps nor weakens the post-dispatch handshake. |
| 1, 6 | engine-observed-provider-time-partition | Each member's duration remains distinct while feature elapsed is an interval union. Provider reported time is not substituted; extra overlapping intervals do not inflate the union. |

All 21 new-story pairs were considered. Shared timing/identity pairs (1/2/3/4/6) compose by execution scope; state/terminal pairs (4/5) preserve the gate-vs-execution distinction; registry coverage (7) observes each behavior without owning production policy. No pair requires mutually exclusive writes, status, order, or measurement. Existing diagrams and historical stories sometimes describe earlier implementation placement; approved amendments govern those historical descriptions, and this spec does not direct BUILD to restore obsolete duplicate metric recording.

The six checks were applied: contradiction, incompatible overlap, state conflict, resource contention, sequencing, and oscillation. There is no new shared mutable current-step slot, second metric recorder, premature gate success, timing sum over concurrent members, or inference-based historical closure in the approved design.

## Resolutions

None required; no accepted compromise and no superseding ADR. The old feature-specific boundaries that excluded OTel work from provider-time attribution do not ban this separately authorized telemetry feature.

## Narrowed-out ADR inventory

The following ADR subjects are outside this feature's telemetry identity, timing, terminal, or group-ownership comparison. They remain authoritative for their own behavior; exclusion here is not supersession.

- .docs/decisions/adr-002-engineer-store-and-retro-redirect.md
- .docs/decisions/adr-003-registry-write-and-integration.md
- .docs/decisions/adr-005-non-autonomy-and-read-only-governor.md
- .docs/decisions/adr-006-flywheel-lesson-selection-and-provenance.md
- .docs/decisions/adr-008-agent-hosted-loop-and-in-chat-authoring.md
- .docs/decisions/adr-009-intake-adapter-port.md
- .docs/decisions/adr-010-pidfile-lock-daemon-liveness.md
- .docs/decisions/adr-011-async-intake-queue-and-github-source.md
- .docs/decisions/adr-012-durable-intake-ledger-sole-dedup-authority.md
- .docs/decisions/adr-015-daemon-pr-labeling-sweep.md
- .docs/decisions/adr-2026-06-29-architecture-before-stories-convergent-kickback.md
- .docs/decisions/adr-2026-06-29-brainstorm-rename-migration.md
- .docs/decisions/adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md
- .docs/decisions/adr-2026-06-29-explore-prd-split-track-in-explore.md
- .docs/decisions/adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration.md
- .docs/decisions/adr-2026-06-29-memory-resilience-write-fallback-and-reconcile.md
- .docs/decisions/adr-2026-06-29-per-project-memory-provider-selection.md
- .docs/decisions/adr-2026-06-29-per-provider-retrieval-guidance-location.md
- .docs/decisions/adr-2026-06-29-platform-adoption-and-removal-surface.md
- .docs/decisions/adr-2026-06-29-rebase-conflict-resolution-dispatch.md
- .docs/decisions/adr-2026-06-29-safe-reversible-memory-migration.md
- .docs/decisions/adr-2026-06-29-shared-memory-store-placement-and-durability.md
- .docs/decisions/adr-2026-06-29-track-marker-location.md
- .docs/decisions/adr-2026-06-30-background-intake-brain-loop.md
- .docs/decisions/adr-2026-06-30-engineer-worktree-authoring-isolation.md
- .docs/decisions/adr-2026-06-30-grandfather-cutover-merge-time.md
- .docs/decisions/adr-2026-06-30-halt-based-release-gates.md
- .docs/decisions/adr-2026-06-30-origin-seeded-intake-routing.md
- .docs/decisions/adr-2026-06-30-owner-gate-identity-resolution.md
- .docs/decisions/adr-2026-06-30-owner-provenance-recording.md
- .docs/decisions/adr-2026-06-30-sandbox-build-isolation.md
- .docs/decisions/adr-2026-06-30-self-host-detection-seam.md
- .docs/decisions/adr-2026-07-01-machine-scoped-operator-identity.md
- .docs/decisions/adr-2026-07-03-daemon-auto-restart-stale-engine.md
- .docs/decisions/adr-2026-07-03-dependency-fail-closed-and-cache.md
- .docs/decisions/adr-2026-07-03-dependency-gate-backlog-waiting-channel.md
- .docs/decisions/adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.md
- .docs/decisions/adr-2026-07-03-gated-snapshot-status-read-model.md
- .docs/decisions/adr-2026-07-03-gated-writeback-announcements.md
- .docs/decisions/adr-2026-07-03-generated-model-table-single-source.md
- .docs/decisions/adr-2026-07-03-halt-pr-rehabilitation-at-finish.md
- .docs/decisions/adr-2026-07-03-harness-daemon-profile.md
- .docs/decisions/adr-2026-07-03-issue-dependencies-api-surface.md
- .docs/decisions/adr-2026-07-03-owner-gate-gated-channel.md
- .docs/decisions/adr-2026-07-03-post-rebase-force-with-lease.md
- .docs/decisions/adr-2026-07-03-pr-timing-config-key.md
- .docs/decisions/adr-2026-07-03-pr-timing-self-host-precedence.md
- .docs/decisions/adr-2026-07-03-priority-fetch-fail-soft.md
- .docs/decisions/adr-2026-07-03-priority-from-linked-issue-labels.md
- .docs/decisions/adr-2026-07-03-prose-to-link-migration.md
- .docs/decisions/adr-2026-07-03-reactive-model-fallback-ladder.md
- .docs/decisions/adr-2026-07-03-version-gate-semver-escalation.md
- .docs/decisions/adr-2026-07-04-auth-failure-park-and-poll.md
- .docs/decisions/adr-2026-07-04-autoresolve-state-and-config.md
- .docs/decisions/adr-2026-07-04-claim-time-delivery-evidence-guard.md
- .docs/decisions/adr-2026-07-04-durable-pause-marker.md
- .docs/decisions/adr-2026-07-04-event-driven-halt-clear-wake.md
- .docs/decisions/adr-2026-07-04-kickback-event-emission-and-log-prominence.md
- .docs/decisions/adr-2026-07-04-operator-park-marker.md
- .docs/decisions/adr-2026-07-04-park-unpark-cli-verbs.md
- .docs/decisions/adr-2026-07-04-pending-restart-queue.md
- .docs/decisions/adr-2026-07-04-resolution-worktree-lifecycle.md
- .docs/decisions/adr-2026-07-04-respawn-in-place-restart.md
- .docs/decisions/adr-2026-07-04-versioned-engine-store-atomic-flip.md
- .docs/decisions/adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep.md
- .docs/decisions/adr-2026-07-05-daemon-rate-limit-episode-coordinator.md
- .docs/decisions/adr-2026-07-05-engine-owned-task-status.md
- .docs/decisions/adr-2026-07-05-halt-pr-presentation-reliability.md
- .docs/decisions/adr-2026-07-05-retry-as-escalation-ladder.md
- .docs/decisions/adr-2026-07-05-standalone-bin-update.md
- .docs/decisions/adr-2026-07-06-daemon-false-ship-guard.md
- .docs/decisions/adr-2026-07-06-installed-root-resolution-for-global-writes.md
- .docs/decisions/adr-2026-07-06-manual-test-fail-routing.md
- .docs/decisions/adr-2026-07-06-migration-gate-waiver.md
- .docs/decisions/adr-2026-07-06-stale-engine-respawn-in-place.md
- .docs/decisions/adr-2026-07-07-audit-trail-event-sink.md
- .docs/decisions/adr-2026-07-07-daemon-owned-build-credential.md
- .docs/decisions/adr-2026-07-07-finish-record-primitive.md
- .docs/decisions/adr-2026-07-07-ship-ci-feedback-loop.md
- .docs/decisions/adr-2026-07-07-single-generation-stale-respawn.md
- .docs/decisions/adr-2026-07-07-task-trailer-id-alias.md
- .docs/decisions/adr-2026-07-08-halt-issue-closure-sweep.md
- .docs/decisions/adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md
- .docs/decisions/adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md
- .docs/decisions/adr-2026-07-09-deterministic-evidence-attribution-enforcement.md
- .docs/decisions/adr-2026-07-09-setup-failure-triage.md
- .docs/decisions/adr-2026-07-10-daemon-stall-remediation.md
- .docs/decisions/adr-2026-07-10-evidence-range-anchor-resolution.md
- .docs/decisions/adr-2026-07-10-inline-work-attribution-enforcement.md
- .docs/decisions/adr-2026-07-10-intake-claim-priority-banding.md
- .docs/decisions/adr-2026-07-10-intra-step-build-progress-events.md
- .docs/decisions/adr-2026-07-10-observed-close-watch-registry.md
- .docs/decisions/adr-2026-07-10-park-marker-main-root-resolution.md
- .docs/decisions/adr-2026-07-10-retire-migration-grandfather.md
- .docs/decisions/adr-2026-07-10-session-hook-task-stamping.md
- .docs/decisions/adr-2026-07-11-attribution-abstain-or-loud.md
- .docs/decisions/adr-2026-07-11-attribution-spot-audit-measurement.md
- .docs/decisions/adr-2026-07-11-attribution-verdict-interface.md
- .docs/decisions/adr-2026-07-11-evidence-judge-cli-and-cutover.md
- .docs/decisions/adr-2026-07-11-finish-step-engine-completion-machinery.md
- .docs/decisions/adr-2026-07-11-pipeline-state-durability.md
- .docs/decisions/adr-2026-07-11-semantic-attribution-verification-lane.md
- .docs/decisions/adr-2026-07-11-verdict-aware-resume-entry.md
- .docs/decisions/adr-2026-07-12-judged-attribution-verdict-persistence.md
- .docs/decisions/adr-2026-07-12-progress-aware-build-halt.md
- .docs/decisions/adr-2026-07-12-rebase-evidence-stamp-translation.md
- .docs/decisions/adr-2026-07-12-wired-into-contract.md
- .docs/decisions/adr-2026-07-12-wiring-check-gate.md
- .docs/decisions/adr-2026-07-13-kickback-build-no-op-escalation.md
- .docs/decisions/adr-2026-07-13-park-all-dispatch-paths.md
- .docs/decisions/adr-2026-07-13-retry-classify-rerun-vs-route.md
- .docs/decisions/adr-2026-07-13-session-fresh-verdict-artifacts.md
- .docs/decisions/adr-2026-07-17-verify-only-judged-closure.md
- .docs/decisions/adr-2026-07-20-bounded-dirname-path-corroboration.md
- .docs/decisions/adr-2026-07-20-ci-fix-dispatch-via-steprunner.md
- .docs/decisions/adr-2026-07-20-ci-fix-startup-preflight-and-error-classification.md
- .docs/decisions/adr-2026-07-20-post-rebase-delta-aware-invalidation.md
- .docs/decisions/adr-2026-07-21-completeness-as-build-review-rubric.md
- .docs/decisions/adr-2026-07-21-decide-time-unmerged-overlap-scan.md
- .docs/decisions/adr-2026-07-21-demote-task-stamping-to-telemetry.md
- .docs/decisions/adr-2026-07-21-engine-owned-acceptance-red-execution.md
- .docs/decisions/adr-2026-07-21-intake-only-enforcement.md
- .docs/decisions/adr-2026-07-21-no-diff-task-evidence-stamp.md
- .docs/decisions/adr-2026-07-21-owner-stamped-at-authoring.md
- .docs/decisions/adr-2026-07-21-s-tier-pipeline-knobs.md
- .docs/decisions/adr-2026-07-21-serena-removal-path.md
- .docs/decisions/adr-2026-07-22-attempts-counter-on-crash-recovery.md
- .docs/decisions/adr-2026-07-22-auth-failure-classification-observed-401-patterns.md
- .docs/decisions/adr-2026-07-22-build-dispatch-json-usage-capture.md
- .docs/decisions/adr-2026-07-22-canonical-tagged-source-ref.md
- .docs/decisions/adr-2026-07-22-canonical-tracker-client-seam.md
- .docs/decisions/adr-2026-07-22-coherence-gate-placement-and-validation-split.md
- .docs/decisions/adr-2026-07-22-coherence-waiver-and-duplicate-claim.md
- .docs/decisions/adr-2026-07-22-daemon-level-missing-credential-gate.md
- .docs/decisions/adr-2026-07-22-examples-state-isolation.md
- .docs/decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md
- .docs/decisions/adr-2026-07-22-headless-vs-guided-examples.md
- .docs/decisions/adr-2026-07-22-heartbeat-lease-deferred.md
- .docs/decisions/adr-2026-07-22-intake-closed-issue-reconciliation.md
- .docs/decisions/adr-2026-07-22-origin-refresh-before-engine-rebuild.md
- .docs/decisions/adr-2026-07-22-per-feature-cost-rollup-in-shipped-record.md
- .docs/decisions/adr-2026-07-22-per-task-work-happened-floor.md
- .docs/decisions/adr-2026-07-22-phase-scoped-docs-write-guard.md
- .docs/decisions/adr-2026-07-22-requeue-claimed-distinct-from-reopen.md
- .docs/decisions/adr-2026-07-22-stale-claim-staleness-window-default.md
- .docs/decisions/adr-2026-07-22-token-liveness-probe-via-cli-invocation.md
- .docs/decisions/adr-2026-07-23-build-review-fresh-base-disposition.md
- .docs/decisions/adr-2026-07-23-commit-movement-liveness-floor.md
- .docs/decisions/adr-2026-07-23-intake-label-authority-scoped-replace.md
- .docs/decisions/adr-2026-07-23-session-hook-repair-before-halt.md
- .docs/decisions/adr-2026-07-23-trailer-union-build-step-routing.md
- .docs/decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md
- .docs/decisions/adr-2026-07-25-content-addressed-full-suite-proof.md
- .docs/decisions/adr-2026-07-25-custom-step-completion-artifacts.md
- .docs/decisions/adr-2026-07-25-fail-closed-durable-shipment-evidence.md
- .docs/decisions/adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation.md
- .docs/decisions/adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation.md
- .docs/decisions/adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md
- .docs/decisions/adr-2026-07-26-daemon-decide-preseed-ownership.md
- .docs/decisions/adr-2026-07-26-protected-artifact-seal-rebaseline.md
- .docs/decisions/adr-2026-07-26-rebase-tail-current-branch-before-publication.md
- .docs/decisions/adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates.md
- .docs/decisions/adr-2026-07-27-ancestry-proven-park-reconciliation.md
- .docs/decisions/adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md
- .docs/decisions/adr-2026-07-27-cold-start-within-step-retries.md
- .docs/decisions/adr-2026-07-27-cost-unmetered-is-a-first-class-state.md
- .docs/decisions/adr-2026-07-27-daemon-decide-kickback-halt.md
- .docs/decisions/adr-2026-07-27-project-config-scaffolder.md
- .docs/decisions/adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md
- .docs/decisions/adr-2026-07-28-feature-aware-artifact-resolution.md
- .docs/decisions/adr-2026-07-28-total-halt-classification-legacy-boundary.md
- .docs/decisions/adr-2026-07-29-codex-readiness-probe-failure-disposition.md
- .docs/decisions/adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main.md
- .docs/decisions/adr-2026-07-29-deterministic-build-verification-fanout.md
- .docs/decisions/adr-2026-07-29-operator-park-scheduling-unit-boundary.md
- .docs/decisions/adr-2026-07-29-ship-start-draft-pr.md
- .docs/decisions/adr-2026-07-30-contract-aware-same-file-wiring.md
- .docs/decisions/adr-2026-07-30-finish-only-mergeability-gate.md
- .docs/decisions/adr-2026-07-30-pinned-remote-theme-for-pages-navigation.md
- .docs/decisions/adr-2026-07-30-provider-preparation-lifecycle-supervision.md
- .docs/decisions/adr-2026-08-01-bot-owned-release-pr.md
- .docs/decisions/adr-2026-08-01-conduct-state-mutation-port.md
- .docs/decisions/adr-2026-08-01-engine-owned-resumable-finish-publication.md
- .docs/decisions/adr-2026-08-01-engine-owned-scoped-test-invocation.md
- .docs/decisions/adr-2026-08-01-multi-proof-park-deletion-authority.md
- .docs/decisions/adr-2026-08-01-rebase-full-replay-intent-validation.md
- .docs/decisions/adr-2026-08-01-scoped-run-verb-release-surface.md
- .docs/decisions/adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate.md
- .docs/decisions/adr-2026-08-02-live-tier-asserts-outcomes-not-scripts.md
- .docs/decisions/adr-2026-08-02-plan-scope-containment-at-commit-boundary.md
- .docs/decisions/adr-2026-08-03-build-repair-member-reuse-validity.md
- .docs/decisions/adr-2026-08-03-fail-closed-decide-entry.md
- .docs/decisions/adr-2026-08-03-ledgered-per-block-migration-execution.md
- .docs/decisions/adr-2026-08-03-uncommitted-work-floor-under-build-completion.md
- .docs/decisions/adr-2026-08-04-classify-before-spend-release-smoke-gate.md
- .docs/decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md
- .docs/decisions/adr-2026-08-04-live-tier-provisions-its-own-provider-home.md
- .docs/decisions/adr-2026-08-04-unresolved-step-command-fails-by-name.md
- .docs/decisions/adr-2026-08-05-blocked-classification-after-dedup.md
- .docs/decisions/adr-2026-08-05-blocked-is-a-distinct-state-from-halted.md
- .docs/decisions/adr-2026-08-05-build-settle-outcome-stamp.md
- .docs/decisions/adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever.md
- .docs/decisions/adr-2026-08-05-provenance-based-protected-artifact-inheritance.md
- .docs/decisions/adr-2026-08-05-token-first-stories-reference-normalization.md
- .docs/decisions/adr-2026-08-05-worktree-classification-evidence-derived-reasons.md
- .docs/decisions/adr-2026-08-06-bounded-progress-allowance-for-finish-publication.md
- .docs/decisions/adr-2026-08-06-honest-park-termination-boundary.md
- .docs/decisions/adr-2026-08-06-publication-progress-is-its-own-disposition.md
- .docs/decisions/adr-2026-08-07-project-teardown-hook-contract-and-containment.md
- .docs/decisions/adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.md
- .docs/decisions/adr-2026-08-07-smoke-gate-goes-live-without-precharacterization.md
- .docs/decisions/adr-2026-08-07-worktree-removal-coverage-guard.md
- .docs/decisions/adr-2026-08-08-finish-human-required-halt-rendering.md
- .docs/decisions/adr-2026-08-08-pipeline-owned-closeout-timestamps.md
- .docs/decisions/adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition.md
- .docs/decisions/adr-2026-08-08-single-adr-approval-parser-three-rungs.md
- .docs/decisions/adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md
- .docs/decisions/adr-2026-08-09-adr-contradiction-detection-in-two-halves.md
- .docs/decisions/adr-2026-08-09-adr-layer-gated-by-committed-adr-signal.md
- .docs/decisions/adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md
- .docs/decisions/adr-2026-08-09-checkout-is-sole-version-identity-authority.md
- .docs/decisions/adr-2026-08-09-conductor-block-single-source-of-truth.md
- .docs/decisions/adr-2026-08-09-declared-pattern-replication-in-build.md
- .docs/decisions/adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md
- .docs/decisions/adr-2026-08-09-hook-owned-containment-event-ledger.md
- .docs/decisions/adr-2026-08-09-legacy-json-seed-migration-rule.md
- .docs/decisions/adr-2026-08-09-non-blocking-plan-scope-containment.md
- .docs/decisions/adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md
- .docs/decisions/adr-2026-08-09-operator-only-scoped-artifact-reseal.md
- .docs/decisions/adr-2026-08-09-recorded-red-exception-for-remediation.md
- .docs/decisions/adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag.md
- .docs/decisions/adr-2026-08-09-reseal-audit-rides-the-existing-event-spine.md
- .docs/decisions/adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator.md
- .docs/decisions/adr-2026-08-09-seal-rotation-authorship-predicate.md
- .docs/decisions/adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag.md
- .docs/decisions/adr-2026-08-09-worktree-local-provider-scratch.md
- .docs/decisions/adr-2026-08-11-deprecated-no-op-step-retirement.md
- .docs/decisions/adr-2026-08-11-halt-events-ride-the-persisted-spine.md
- .docs/decisions/adr-2026-08-12-cumulative-build-review-convergence-bound.md
- .docs/decisions/adr-2026-0…6195 tokens truncated…eview-2026-09-09-operators-cannot-attach-their-own-metadata-to-expo.md

## Verification

Claims basis: verified source/contract review for the identified interactions; the clean result is the review judgement, not a claim of implementation proof. No unconfirmed load-bearing assumption remains. Verify-claims: CLEAR.

