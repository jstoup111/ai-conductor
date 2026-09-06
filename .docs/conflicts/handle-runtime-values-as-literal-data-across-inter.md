# Conflict Check: Runtime values remain literal data

Date: 2026-09-06
Verdict: CLEAN
Blocking conflicts: 0
Degrading conflicts: 0
Resolutions required: 0

## Corpus and method

Configuration explicitly selects conflict_check.adr_corpus: repo_wide. Inventoried and content-scanned 408 story files, 52 spec files, and 247 prior conflict reports recursively. Candidate comparisons were selected by shared task-validation, installer configuration, session-start, interpreter transport, and repository validation concerns; a keyword hit alone was not treated as a conflict. Checked applicable clauses in both directions for contradiction, incompatible overlap, impossible state, exclusive resource ownership, ordering cycles, and oscillation. There is no product PRD for this technical change.

All repository ADR files were inventoried. Approved ADRs narrowed in and out are recorded below. Partial/ambiguous supersession did not remove a decision from review; only explicit full SUPERSEDED-by status was eligible for complete exclusion. Historical clauses were interpreted alongside later governing decisions, not treated as fresh requirements to revive retired code.

## New-story pair analysis

| Pair | Shared concern | Two-directional result |
|---|---|---|
| 1 / 2 | Literal transport and process errors | Compatible: same source/data invariant; distinct JSON files and caller exit policies, no shared writer |
| 1 / 3 | Hook failure handling | Compatible: failed required membership lookup rejects; advisory summary warns and continues; neither requires the other's exit policy |
| 1 / 4 | Generated hook validation | Compatible: fixed-source lookup passes the static rule; checker does not redefine valid IDs or execute specimens |
| 2 / 3 | Python dependency and safe source | Compatible: both retain Python; helper failures propagate to advisory callers, while absent summary state stays quiet |
| 2 / 4 | Installer scripts in scan | Compatible: quoted arguments/heredocs satisfy the scanner; custom settings content is data, not scanned production source |
| 3 / 4 | Fixed-path preventive cleanup | Compatible: the scanner rejects the old source-expansion form; constant relative path travels as data, with no new path override |

All six conflict types were considered for each row. No dependency cycle, new shared resource, or mutually exclusive success condition was found.

## Existing-story comparisons

- engine-invoked-task-attribution-494-freezes-curren, Story 4, requires real seeded IDs and numeric/string compatibility. Story 1 preserves both; quote-safe transport does not turn membership into array-index validation.
- deterministic-evidence-attribution and inline-build-work-commits-unattributed-session-hoo include historical evidence rejection. demote-task-stamping-to-telemetry and its approved 2026-07-21 ADR explicitly retire that branch. Story 1 follows the surviving contract; it does not modify those historical artifacts or reintroduce the branch.
- verify-only-prove-closed-task-evidence's historical empty-commit evidence requirement is likewise retired for this hook by the 2026-07-21 decision. Completion semantics are not changed by this spec.
- pipeline-commits-files-outside-the-active-plan-bef includes earlier blocking proposals and later report-only behavior. out-of-plan-production-edits-reach-build-review-in and the approved 2026-08-09 decision require advisory scope behavior. Story 1 preserves the current advisory call and does not confuse its errors with task-membership processing errors.
- prepare-commit-msg-reconciles-self-stamped-trailer and concurrent-task telemetry decisions govern stamping, not this lookup repair. The prepare-commit-msg script is unchanged; generated-asset scanning only checks source construction.
- install-and-first-run-paths-give-misleading-or-mis, Story 3, requires permission-write status to survive cleanup and failure to reach the caller warning. Story 2 preserves this and applies equivalent truthful failure propagation to hook configuration. Its YAML-related stories do not prohibit the retained JSON-only Python helpers.
- 2026-07-12-rtk-hook-preservation requires preservation/idempotency of custom hooks. Story 2 explicitly retains both and does not move RTK initialization.
- first-class-codex-harness-parity-904 and codex-lacks-preventive-hook-parity-protected-artif retain host parity and protected-commit authority. The generated Git hook repair applies to either host; Story 3 is explicitly the existing Claude session hook, not a new asymmetric capability.
- drop-check-harness-config-consumer-claude-md-harne retains session-start missing-reference guidance. Story 3 continues the remaining context output and does not restore the deleted auto-commit launcher behavior.
- v1-0-cutover-remove-bin-conduct-make-the-ts-cli-ai and current removed-launcher history remain honored: no Story asks to restore bin/conduct. Repository validation gains a separate check without changing ShellCheck's existing threshold.

Other inventory hits concerned unrelated session freshness, model pins, memory, documentation lifecycle, or distinct setup flows. They impose no requirement on these lookup/configuration/summary/checker outputs. Prior reports document the same historical attribution and containment transitions; this pass creates no new reconciliation.

## Examined approved ADRs

- `adr-2026-07-09-deterministic-evidence-attribution-enforcement.md`: Retained despite partial amendment; Story 1 preserves actual-id validation. Its old evidence requirement is retired by the 2026-07-21 decision, not revived here.
- `adr-2026-07-10-inline-work-attribution-enforcement.md`: Retained, not excluded wholesale. The old missing-trailer evidence block is explicitly retired by the 2026-07-21 decision; Story 1 preserves remaining exemptions.
- `adr-2026-07-10-session-hook-task-stamping.md`: Retained; PRE/POST dispatch stamping is distinct from the session-start summary and remains unchanged.
- `adr-2026-07-11-attribution-abstain-or-loud.md`: Actual seeded IDs remain the lookup authority; Story 1 does not substitute array indices or guess attribution.
- `adr-2026-07-11-semantic-attribution-verification-lane.md`: Retained; Story 1 does not change the semantic lane or task-N alias policy.
- `adr-2026-07-17-verify-only-judged-closure.md`: Retained, not excluded wholesale; its former empty-commit evidence rejection is retired by 2026-07-21. No change to verify-only completion is requested.
- `adr-2026-07-21-demote-task-stamping-to-telemetry.md`: Story 1 explicitly retains missing-evidence/trailer pass-through and does not reinstate an evidence gate.
- `adr-2026-07-22-phase-scoped-docs-write-guard.md`: Story 2 preserves existing installed hook entries; Story 4 inspects generated strings without changing their protection behavior.
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation.md`: Story 1 changes lookup transport, not concurrent stamping or provider isolation. Explicit trailer handling is retained.
- `adr-2026-08-02-plan-scope-containment-at-commit-boundary.md`: Retained with all amendments. Its earlier blocking containment proposal is superseded for this concern by the explicit 2026-08-09 non-blocking decision.
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.md`: The pre-commit protected-artifact gate and engine exemption remain untouched; literal task lookup neither bypasses nor expands it.
- `adr-2026-08-09-hook-owned-containment-event-ledger.md`: Existing scope-check invocation and ledger ownership remain unchanged. New error diagnostics are ordinary stderr, not a parallel event channel.
- `adr-2026-08-09-non-blocking-plan-scope-containment.md`: Story 1 preserves advisory scope-check handling, including processing-error abstention; task-membership errors are a separate existing lookup boundary.

## Narrowed-out approved ADRs

Each listed ADR was excluded by subject: it does not govern literal interpreter transport, the changed lookup/configuration/summary boundary, or repository validation. These are scope exclusions, not supersession claims.

- `adr-002-engineer-store-and-retro-redirect.md`
- `adr-003-registry-write-and-integration.md`
- `adr-005-non-autonomy-and-read-only-governor.md`
- `adr-006-flywheel-lesson-selection-and-provenance.md`
- `adr-008-agent-hosted-loop-and-in-chat-authoring.md`
- `adr-009-intake-adapter-port.md`
- `adr-010-pidfile-lock-daemon-liveness.md`
- `adr-014-otel-observability-exporter.md`
- `adr-015-daemon-pr-labeling-sweep.md`
- `adr-2026-06-29-architecture-before-stories-convergent-kickback.md`
- `adr-2026-06-29-brainstorm-rename-migration.md`
- `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md`
- `adr-2026-06-29-explore-prd-split-track-in-explore.md`
- `adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration.md`
- `adr-2026-06-29-memory-resilience-write-fallback-and-reconcile.md`
- `adr-2026-06-29-per-project-memory-provider-selection.md`
- `adr-2026-06-29-per-provider-retrieval-guidance-location.md`
- `adr-2026-06-29-platform-adoption-and-removal-surface.md`
- `adr-2026-06-29-rebase-conflict-resolution-dispatch.md`
- `adr-2026-06-29-safe-reversible-memory-migration.md`
- `adr-2026-06-29-shared-memory-store-placement-and-durability.md`
- `adr-2026-06-29-track-marker-location.md`
- `adr-2026-06-30-background-intake-brain-loop.md`
- `adr-2026-06-30-engineer-worktree-authoring-isolation.md`
- `adr-2026-06-30-grandfather-cutover-merge-time.md`
- `adr-2026-06-30-halt-based-release-gates.md`
- `adr-2026-06-30-origin-seeded-intake-routing.md`
- `adr-2026-06-30-owner-gate-identity-resolution.md`
- `adr-2026-06-30-owner-provenance-recording.md`
- `adr-2026-06-30-sandbox-build-isolation.md`
- `adr-2026-06-30-self-host-detection-seam.md`
- `adr-2026-07-03-daemon-auto-restart-stale-engine.md`
- `adr-2026-07-03-dependency-fail-closed-and-cache.md`
- `adr-2026-07-03-dependency-gate-backlog-waiting-channel.md`
- `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.md`
- `adr-2026-07-03-gated-snapshot-status-read-model.md`
- `adr-2026-07-03-gated-writeback-announcements.md`
- `adr-2026-07-03-generated-model-table-single-source.md`
- `adr-2026-07-03-harness-daemon-profile.md`
- `adr-2026-07-03-issue-dependencies-api-surface.md`
- `adr-2026-07-03-owner-gate-gated-channel.md`
- `adr-2026-07-03-post-rebase-force-with-lease.md`
- `adr-2026-07-03-pr-timing-config-key.md`
- `adr-2026-07-03-pr-timing-self-host-precedence.md`
- `adr-2026-07-03-priority-fetch-fail-soft.md`
- `adr-2026-07-03-priority-from-linked-issue-labels.md`
- `adr-2026-07-03-prose-to-link-migration.md`
- `adr-2026-07-03-reactive-model-fallback-ladder.md`
- `adr-2026-07-03-version-gate-semver-escalation.md`
- `adr-2026-07-04-auth-failure-park-and-poll.md`
- `adr-2026-07-04-autoresolve-state-and-config.md`
- `adr-2026-07-04-durable-pause-marker.md`
- `adr-2026-07-04-event-driven-halt-clear-wake.md`
- `adr-2026-07-04-kickback-event-emission-and-log-prominence.md`
- `adr-2026-07-04-pending-restart-queue.md`
- `adr-2026-07-04-resolution-worktree-lifecycle.md`
- `adr-2026-07-04-respawn-in-place-restart.md`
- `adr-2026-07-04-versioned-engine-store-atomic-flip.md`
- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep.md`
- `adr-2026-07-05-daemon-rate-limit-episode-coordinator.md`
- `adr-2026-07-05-engine-owned-task-status.md`
- `adr-2026-07-05-halt-pr-presentation-reliability.md`
- `adr-2026-07-05-retry-as-escalation-ladder.md`
- `adr-2026-07-05-standalone-bin-update.md`
- `adr-2026-07-06-daemon-false-ship-guard.md`
- `adr-2026-07-06-installed-root-resolution-for-global-writes.md`
- `adr-2026-07-06-manual-test-fail-routing.md`
- `adr-2026-07-06-migration-gate-waiver.md`
- `adr-2026-07-06-stale-engine-respawn-in-place.md`
- `adr-2026-07-07-audit-trail-event-sink.md`
- `adr-2026-07-07-daemon-owned-build-credential.md`
- `adr-2026-07-07-finish-record-primitive.md`
- `adr-2026-07-07-ship-ci-feedback-loop.md`
- `adr-2026-07-07-single-generation-stale-respawn.md`
- `adr-2026-07-07-task-trailer-id-alias.md`
- `adr-2026-07-08-halt-issue-closure-sweep.md`
- `adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md`
- `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md`
- `adr-2026-07-09-setup-failure-triage.md`
- `adr-2026-07-10-concurrent-group-core.md`
- `adr-2026-07-10-daemon-stall-remediation.md`
- `adr-2026-07-10-evidence-range-anchor-resolution.md`
- `adr-2026-07-10-intake-claim-priority-banding.md`
- `adr-2026-07-10-intra-step-build-progress-events.md`
- `adr-2026-07-10-observed-close-watch-registry.md`
- `adr-2026-07-10-park-marker-main-root-resolution.md`
- `adr-2026-07-10-retire-migration-grandfather.md`
- `adr-2026-07-10-validation-group-join.md`
- `adr-2026-07-11-attribution-spot-audit-measurement.md`
- `adr-2026-07-11-attribution-verdict-interface.md`
- `adr-2026-07-11-evidence-judge-cli-and-cutover.md`
- `adr-2026-07-11-verdict-aware-resume-entry.md`
- `adr-2026-07-12-progress-aware-build-halt.md`
- `adr-2026-07-12-rebase-evidence-stamp-translation.md`
- `adr-2026-07-12-wired-into-contract.md`
- `adr-2026-07-13-kickback-build-no-op-escalation.md`
- `adr-2026-07-13-park-all-dispatch-paths.md`
- `adr-2026-07-13-session-fresh-verdict-artifacts.md`
- `adr-2026-07-20-bounded-dirname-path-corroboration.md`
- `adr-2026-07-20-ci-fix-dispatch-via-steprunner.md`
- `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification.md`
- `adr-2026-07-20-post-rebase-delta-aware-invalidation.md`
- `adr-2026-07-21-decide-time-unmerged-overlap-scan.md`
- `adr-2026-07-21-engine-owned-acceptance-red-execution.md`
- `adr-2026-07-21-intake-only-enforcement.md`
- `adr-2026-07-21-no-diff-task-evidence-stamp.md`
- `adr-2026-07-21-owner-stamped-at-authoring.md`
- `adr-2026-07-21-s-tier-pipeline-knobs.md`
- `adr-2026-07-21-serena-removal-path.md`
- `adr-2026-07-22-attempts-counter-on-crash-recovery.md`
- `adr-2026-07-22-auth-failure-classification-observed-401-patterns.md`
- `adr-2026-07-22-build-dispatch-json-usage-capture.md`
- `adr-2026-07-22-canonical-tagged-source-ref.md`
- `adr-2026-07-22-canonical-tracker-client-seam.md`
- `adr-2026-07-22-coherence-gate-placement-and-validation-split.md`
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim.md`
- `adr-2026-07-22-daemon-level-missing-credential-gate.md`
- `adr-2026-07-22-examples-state-isolation.md`
- `adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md`
- `adr-2026-07-22-headless-vs-guided-examples.md`
- `adr-2026-07-22-heartbeat-lease-deferred.md`
- `adr-2026-07-22-intake-closed-issue-reconciliation.md`
- `adr-2026-07-22-origin-refresh-before-engine-rebuild.md`
- `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record.md`
- `adr-2026-07-22-per-task-work-happened-floor.md`
- `adr-2026-07-22-requeue-claimed-distinct-from-reopen.md`
- `adr-2026-07-22-stale-claim-staleness-window-default.md`
- `adr-2026-07-22-token-liveness-probe-via-cli-invocation.md`
- `adr-2026-07-23-build-review-fresh-base-disposition.md`
- `adr-2026-07-23-commit-movement-liveness-floor.md`
- `adr-2026-07-23-intake-label-authority-scoped-replace.md`
- `adr-2026-07-23-session-hook-repair-before-halt.md`
- `adr-2026-07-23-trailer-union-build-step-routing.md`
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md`
- `adr-2026-07-25-custom-step-completion-artifacts.md`
- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation.md`
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md`
- `adr-2026-07-26-daemon-decide-preseed-ownership.md`
- `adr-2026-07-26-protected-artifact-seal-rebaseline.md`
- `adr-2026-07-26-rebase-tail-current-branch-before-publication.md`
- `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates.md`
- `adr-2026-07-27-ancestry-proven-park-reconciliation.md`
- `adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md`
- `adr-2026-07-27-cold-start-within-step-retries.md`
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state.md`
- `adr-2026-07-27-daemon-decide-kickback-halt.md`
- `adr-2026-07-27-project-config-scaffolder.md`
- `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md`
- `adr-2026-07-28-feature-aware-artifact-resolution.md`
- `adr-2026-07-28-total-halt-classification-legacy-boundary.md`
- `adr-2026-07-29-codex-readiness-probe-failure-disposition.md`
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main.md`
- `adr-2026-07-29-deterministic-build-verification-fanout.md`
- `adr-2026-07-29-engine-observed-provider-time-partition.md`
- `adr-2026-07-29-operator-park-scheduling-unit-boundary.md`
- `adr-2026-07-29-ship-start-draft-pr.md`
- `adr-2026-07-30-contract-aware-same-file-wiring.md`
- `adr-2026-07-30-finish-only-mergeability-gate.md`
- `adr-2026-07-30-pinned-remote-theme-for-pages-navigation.md`
- `adr-2026-07-30-provider-preparation-lifecycle-supervision.md`
- `adr-2026-08-01-bot-owned-release-pr.md`
- `adr-2026-08-01-conduct-state-mutation-port.md`
- `adr-2026-08-01-engine-owned-scoped-test-invocation.md`
- `adr-2026-08-01-multi-proof-park-deletion-authority.md`
- `adr-2026-08-01-rebase-full-replay-intent-validation.md`
- `adr-2026-08-01-scoped-run-verb-release-surface.md`
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate.md`
- `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts.md`
- `adr-2026-08-03-build-repair-member-reuse-validity.md`
- `adr-2026-08-03-fail-closed-decide-entry.md`
- `adr-2026-08-03-ledgered-per-block-migration-execution.md`
- `adr-2026-08-03-uncommitted-work-floor-under-build-completion.md`
- `adr-2026-08-04-classify-before-spend-release-smoke-gate.md`
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md`
- `adr-2026-08-04-live-tier-provisions-its-own-provider-home.md`
- `adr-2026-08-04-unresolved-step-command-fails-by-name.md`
- `adr-2026-08-05-blocked-classification-after-dedup.md`
- `adr-2026-08-05-blocked-is-a-distinct-state-from-halted.md`
- `adr-2026-08-05-build-settle-outcome-stamp.md`
- `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever.md`
- `adr-2026-08-05-provenance-based-protected-artifact-inheritance.md`
- `adr-2026-08-05-token-first-stories-reference-normalization.md`
- `adr-2026-08-05-worktree-classification-evidence-derived-reasons.md`
- `adr-2026-08-06-bounded-progress-allowance-for-finish-publication.md`
- `adr-2026-08-06-honest-park-termination-boundary.md`
- `adr-2026-08-06-publication-progress-is-its-own-disposition.md`
- `adr-2026-08-07-project-teardown-hook-contract-and-containment.md`
- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization.md`
- `adr-2026-08-07-worktree-removal-coverage-guard.md`
- `adr-2026-08-08-finish-human-required-halt-rendering.md`
- `adr-2026-08-08-pipeline-owned-closeout-timestamps.md`
- `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition.md`
- `adr-2026-08-08-single-adr-approval-parser-three-rungs.md`
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md`
- `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md`
- `adr-2026-08-09-checkout-is-sole-version-identity-authority.md`
- `adr-2026-08-09-conductor-block-single-source-of-truth.md`
- `adr-2026-08-09-declared-pattern-replication-in-build.md`
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md`
- `adr-2026-08-09-legacy-json-seed-migration-rule.md`
- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md`
- `adr-2026-08-09-operator-only-scoped-artifact-reseal.md`
- `adr-2026-08-09-recorded-red-exception-for-remediation.md`
- `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine.md`
- `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator.md`
- `adr-2026-08-09-seal-rotation-authorship-predicate.md`
- `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag.md`
- `adr-2026-08-09-worktree-local-provider-scratch.md`
- `adr-2026-08-11-deprecated-no-op-step-retirement.md`
- `adr-2026-08-11-halt-events-ride-the-persisted-spine.md`
- `adr-2026-08-12-cumulative-build-review-convergence-bound.md`
- `adr-2026-08-12-execution-lifecycle-completeness-for-timing.md`
- `adr-2026-08-12-fail-closed-intake-ledger-durability.md`
- `adr-2026-08-12-live-provider-coverage-from-plugin-registry.md`
- `adr-2026-08-12-operator-reseal-as-second-scope-justification.md`
- `adr-2026-08-12-per-provider-live-smoke-legs.md`
- `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md`
- `adr-2026-08-13-durable-base-advance-attribution.md`
- `adr-2026-08-13-engine-managed-build-review-rubric-branches.md`
- `adr-2026-08-13-markdown-default-inversion.md`
- `adr-2026-08-13-stable-build-review-finding-dispositions.md`
- `adr-2026-08-14-retire-build-review-wiring-rubric.md`
- `adr-2026-08-17-framework-agnostic-tautology-scoped-run.md`
- `adr-2026-08-17-structural-live-checkout-containment.md`
- `adr-2026-08-18-content-anchored-finding-reference-schema.md`
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md`
- `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence.md`
- `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope.md`
- `adr-2026-08-19-live-provider-stream-observation.md`
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port.md`
- `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md`
- `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind.md`
- `adr-2026-08-21-engine-identity-in-build-review-cache-key.md`
- `adr-2026-08-21-review-bound-by-plan-done-when-criteria.md`
- `adr-2026-08-22-as-built-review-runs-always-with-plan-gap.md`
- `adr-2026-08-22-build-review-opt-in-rubric-container.md`
- `adr-2026-08-22-done-when-evidence-at-task-close.md`
- `adr-2026-08-22-one-owner-per-review-question.md`
- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback.md`
- `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote.md`
- `adr-2026-08-23-criterion-layer-is-structural-at-land.md`
- `adr-2026-08-23-diff-locality-is-an-authored-disposition.md`
- `adr-2026-08-24-evidentiary-defects-are-not-waivable.md`
- `adr-2026-08-24-one-dispatch-member-on-the-provider-contract.md`
- `adr-2026-08-24-over-scope-decision-block-and-durable-refusals.md`
- `adr-2026-08-24-refused-step-status.md`
- `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope.md`
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route.md`
- `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot.md`
- `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity.md`
- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal.md`
- `adr-2026-08-26-music-vocabulary-player-composer-rename.md`
- `adr-2026-08-26-remove-retrospectives-one-shot.md`
- `adr-2026-08-26-setup-once-per-worktree-marker.md`
- `adr-2026-08-26-shared-coherence-parser-at-discovery.md`
- `adr-2026-08-27-daemon-dispatcher-executor-seam.md`
- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md`
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class.md`
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md`
- `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded.md`
- `adr-2026-08-30-shared-plan-task-reference-resolver.md`
- `adr-2026-08-31-coverage-binding-judge-step.md`
- `adr-2026-08-31-kickback-ledger-read-fails-closed.md`
- `adr-2026-09-02-adr-decision-citability-contract.md`
- `adr-2026-09-05-gh-cli-version-floor-and-environment-gate.md`
- `adr-2026-09-06-engine-owned-test-quality-scope.md`

## Fully superseded ADRs excluded

Only explicit terminal SUPERSEDED-by declarations were excluded on this basis; no partially superseded ADR was discarded wholesale.

- `adr-2026-07-21-completeness-as-build-review-rubric.md`
- `adr-2026-08-12-removal-anchored-tautology-exemption.md`
- `adr-2026-08-15-verify-only-anchored-tautology-exemption.md`
- `adr-2026-08-16-preservation-anchored-completeness-exemption.md`
- `adr-2026-08-29-build-review-remediate-case-adjudication.md`
- `adr-2026-08-29-operator-authorized-kickback-budget-recovery.md`

## Verify-Claims Ledger

Verified: the configured ADR corpus is repo_wide; the four new story bodies are operator-accepted. The specific existing story clauses and governing decision passages above were read directly. The CLEAN finding is a semantic judgment at 95% confidence, grounded in those comparisons; it is not a claim that all historical specifications are internally consistent or that an overlap ref is active. No unconfirmed load-bearing assumption or accepted compromise remains. Verdict: CLEAR.

No conditional review marker is required by conflict-check because this pass found no new conflicts or resolutions. Composer still presents the output for its per-step operator gate.
