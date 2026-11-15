# Conflict check: Reduce mechanical restack resolver cost

Status: CLEAN — zero unresolved blocking conflicts

## Corpus inventory

The repository-wide inventory is recorded in `.pipeline/conflict-corpus.json`: 695 story documents, 65 specs, 794 decisions, and 259 prior conflict reports. Subject screening selected 46 stories and 78 decisions mentioning restack/replay concerns. The subject screen supplies candidates, not verdicts. The semantic comparison below checks both directions for the shared behaviors; unrelated workflow subjects are narrowed out, not asserted to implement this feature.

## Shared reporting ownership

**Type:** resource-contention / behavioral-overlap
**Severity:** blocking for task decomposition
**Confidence:** verified source and approved artifact overlap; 95% that independent implementation would create duplicate ownership unless explicitly sequenced.

New Story 5 requires resolution-tier reporting with provider attempts and costs by operation and round. Approved `adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish` D11 already assigns resolver attribution, event correlation, OTel dimensions, and a shipped-record Restack block to #3653.

Exact governing evidence:

> `provider_attempt` gains an optional `restack: {opId, cause, roundId?}`.

> A stacked feature's record gains an additive `## Restack` block, derived from the same events.

> It has one row per round and per fold or base-refresh operation, giving resolver runs and cost, plus an `unattributed` row.

The current `src/conductor/src/types/events.ts` contains restack events but lacks that provider-attempt restack correlation. The issue is OPEN, verified with `gh issue view 3653 --repo jstoup111/ai-conductor --json state,title,closedAt` on 2026-11-15. Closed #3628 is superseded by this still-open delivery; its closure did not establish implementation availability.

These requirements are behaviorally compatible in both directions if #3632 extends #3653's foundation. They become competing implementation ownership if both independently add that foundation. No contradictory behavior is claimed, and no replacement of the approved architecture is proposed.

### Resolution options

1. Recommended: declare #3653 a prerequisite. Plan #3632's resolution-tier reporting as an extension of its attribution and reporting surfaces; preserve its fold scheduling unchanged. The full #3632 implementation waits for that foundation.
2. Keep #3632 independent, but explicitly transfer the shared reporting ownership between specs during DECIDE. This requires reviewing and amending #3653's artifacts and scope; it is not authorized by the present request.

Operator decision: APPROVED on 2026-11-15. Declare `jstoup111/ai-conductor#3653` as a prerequisite at composer land. Its spec PR #3675 is already merged; implementation PR #3684 remains open. No second specification is needed. Remote dependency publication remains owned by composer land.

## Compatible interactions already examined

- Existing operator-tip reuse permits parent-tree matching and scoped halt-record normalization; new automatic reuse deliberately has separate stricter identity evidence. Neither changes the other's acceptance rules.
- Journal cleanup removes aborted-operation staging refs; new accepted-result retention has separate feature-owned authority, so it can survive that cleanup without retaining an aborted journal as active.
- Existing full-replay intent validation applies to the strong resolver. A deterministic bookkeeping rule is not a general exemption for semantic source conflicts.
- Existing mixed halt-record/source conflict behavior preserves deterministic handling of the halt record while source work reaches the resolver; no partially resolved child becomes accepted.
- Existing remediation union eligibility stays routing-scoped; the new multi-path composition must not enable it for flat or routing-disabled features.
- Ref compare-and-swap, exact rewrites, bounded resolver attempts, post-restack invalidation, and flat-feature behavior remain intact.

## Final semantic disposition

The prerequisite resolves competing reporting ownership. Satisfying the new stories preserves the existing operator-tip, source-intent, journal lifecycle, routing, cleanup, and event-spine contracts; those contracts also allow the new automatic-result record and tier reporting. Distinct automatic records do not relax operator-tip staleness or journal exclusivity. New retained refs join the finite feature cleanup list, never prefix-discovered deletion. Missing event cost differs from a known operation with zero provider attempts, so unknown-cost reporting does not contradict the existing zero-attempt $0.00 case.

All six classes were considered: contradiction (none remaining), behavioral overlap (reporting sequenced by prerequisite), state conflict (automatic records separate from active journals and operator tips), resource contention (finite feature refs and expected-value writes), sequencing (foundation before tier reporting, acceptance before apply), and oscillation (no gate requires both bypassing and retaining validation). No degrading compromise is accepted. Confidence: 95%, grounded in the cited contracts and source; runtime implementation is not claimed.

The full intake outcomes are stronger than the approved conservative scope: unsupported non-semantic conflicts may still reach the strong resolver, and operational failures can halt. This is an operator-approved scope decision, not an unnoticed story conflict. Coherence must expose that difference rather than falsely claim universal mechanical classification.

## ADR corpus disposition

Subject candidates were screened for direct effects on replay, evidence, decisions, retention, application, costs and reporting. Existing approved decisions on unrelated lifecycle or provider behavior remain constraints only where shared adapters are touched; no change to their behavior is authorized. Partially amended decisions remain in the corpus. The following manifest records every ADR path and the subject screening result; the detailed interaction reasoning above governs the overlapping groups.

- `.docs/decisions/adr-002-engineer-store-and-retro-redirect.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-003-registry-write-and-integration.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-005-non-autonomy-and-read-only-governor.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-006-flywheel-lesson-selection-and-provenance.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-008-agent-hosted-loop-and-in-chat-authoring.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-009-intake-adapter-port.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-010-pidfile-lock-daemon-liveness.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-011-async-intake-queue-and-github-source.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-012-durable-intake-ledger-sole-dedup-authority.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-014-otel-observability-exporter.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-015-daemon-pr-labeling-sweep.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-architecture-before-stories-convergent-kickback.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-brainstorm-rename-migration.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-explore-prd-split-track-in-explore.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-memory-resilience-write-fallback-and-reconcile.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-per-project-memory-provider-selection.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-per-provider-retrieval-guidance-location.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-platform-adoption-and-removal-surface.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-rebase-conflict-resolution-dispatch.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-06-29-safe-reversible-memory-migration.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-shared-memory-store-placement-and-durability.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-29-track-marker-location.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-30-background-intake-brain-loop.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-30-engineer-worktree-authoring-isolation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-30-grandfather-cutover-merge-time.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-30-halt-based-release-gates.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-30-origin-seeded-intake-routing.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-30-owner-gate-identity-resolution.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-30-owner-provenance-recording.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-30-sandbox-build-isolation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-06-30-self-host-detection-seam.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-01-machine-scoped-operator-identity.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-daemon-auto-restart-stale-engine.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-dependency-fail-closed-and-cache.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-dependency-gate-backlog-waiting-channel.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-gated-snapshot-status-read-model.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-gated-writeback-announcements.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-generated-model-table-single-source.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-halt-pr-rehabilitation-at-finish.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-harness-daemon-profile.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-issue-dependencies-api-surface.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-owner-gate-gated-channel.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-post-rebase-force-with-lease.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-07-03-pr-timing-config-key.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-pr-timing-self-host-precedence.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-priority-fetch-fail-soft.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-priority-from-linked-issue-labels.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-prose-to-link-migration.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-reactive-model-fallback-ladder.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-03-version-gate-semver-escalation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-auth-failure-park-and-poll.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-autoresolve-state-and-config.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-claim-time-delivery-evidence-guard.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-durable-pause-marker.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-event-driven-halt-clear-wake.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-kickback-event-emission-and-log-prominence.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-operator-park-marker.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-park-unpark-cli-verbs.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-pending-restart-queue.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-resolution-worktree-lifecycle.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-respawn-in-place-restart.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-versioned-engine-store-atomic-flip.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-07-05-daemon-rate-limit-episode-coordinator.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-05-engine-owned-task-status.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-05-halt-pr-presentation-reliability.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-05-retry-as-escalation-ladder.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-05-standalone-bin-update.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-06-daemon-false-ship-guard.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-06-installed-root-resolution-for-global-writes.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-06-manual-test-fail-routing.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-07-06-migration-gate-waiver.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-06-stale-engine-respawn-in-place.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-07-audit-trail-event-sink.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-07-daemon-owned-build-credential.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-07-finish-record-primitive.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-07-ship-ci-feedback-loop.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-07-single-generation-stale-respawn.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-07-task-trailer-id-alias.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-08-halt-issue-closure-sweep.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-09-deterministic-evidence-attribution-enforcement.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-09-setup-failure-triage.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-concurrent-group-core.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-daemon-stall-remediation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-evidence-range-anchor-resolution.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-inline-work-attribution-enforcement.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-intake-claim-priority-banding.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-intra-step-build-progress-events.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-observed-close-watch-registry.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-park-marker-main-root-resolution.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-retire-migration-grandfather.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-session-hook-task-stamping.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-10-validation-group-join.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-11-attribution-abstain-or-loud.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-11-attribution-spot-audit-measurement.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-11-attribution-verdict-interface.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-11-evidence-judge-cli-and-cutover.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-11-finish-step-engine-completion-machinery.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-11-pipeline-state-durability.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-11-semantic-attribution-verification-lane.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-11-verdict-aware-resume-entry.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-12-judged-attribution-verdict-persistence.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-12-progress-aware-build-halt.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-12-rebase-evidence-stamp-translation.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-07-12-wired-into-contract.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-12-wiring-check-gate.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-13-kickback-build-no-op-escalation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-13-park-all-dispatch-paths.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-13-retry-classify-rerun-vs-route.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-13-session-fresh-verdict-artifacts.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-17-verify-only-judged-closure.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-20-bounded-dirname-path-corroboration.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-20-ci-fix-dispatch-via-steprunner.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-20-ci-fix-startup-preflight-and-error-classification.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-20-post-rebase-delta-aware-invalidation.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-07-21-completeness-as-build-review-rubric.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-21-decide-time-unmerged-overlap-scan.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-21-demote-task-stamping-to-telemetry.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-21-engine-owned-acceptance-red-execution.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-21-intake-only-enforcement.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-21-no-diff-task-evidence-stamp.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-21-owner-stamped-at-authoring.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-21-s-tier-pipeline-knobs.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-21-serena-removal-path.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-attempts-counter-on-crash-recovery.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-auth-failure-classification-observed-401-patterns.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-build-dispatch-json-usage-capture.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-canonical-tagged-source-ref.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-canonical-tracker-client-seam.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-coherence-gate-placement-and-validation-split.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-coherence-waiver-and-duplicate-claim.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-daemon-level-missing-credential-gate.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-examples-state-isolation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-headless-vs-guided-examples.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-heartbeat-lease-deferred.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-intake-closed-issue-reconciliation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-origin-refresh-before-engine-rebuild.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-per-feature-cost-rollup-in-shipped-record.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-per-task-work-happened-floor.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-phase-scoped-docs-write-guard.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-requeue-claimed-distinct-from-reopen.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-stale-claim-staleness-window-default.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-22-token-liveness-probe-via-cli-invocation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-23-build-review-fresh-base-disposition.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-07-23-commit-movement-liveness-floor.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-23-intake-label-authority-scoped-replace.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-23-session-hook-repair-before-halt.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-23-trailer-union-build-step-routing.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-25-content-addressed-full-suite-proof.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-25-custom-step-completion-artifacts.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-25-fail-closed-durable-shipment-evidence.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-26-daemon-decide-preseed-ownership.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-26-event-sink-registry-exhaustiveness.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-26-protected-artifact-seal-rebaseline.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-07-26-rebase-tail-current-branch-before-publication.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-27-ancestry-proven-park-reconciliation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-27-cold-start-within-step-retries.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-27-cost-unmetered-is-a-first-class-state.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-27-daemon-decide-kickback-halt.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-27-project-config-scaffolder.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-28-feature-aware-artifact-resolution.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-28-total-halt-classification-legacy-boundary.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-29-codex-readiness-probe-failure-disposition.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-07-29-deterministic-build-verification-fanout.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-29-engine-observed-provider-time-partition.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-29-operator-park-scheduling-unit-boundary.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-29-ship-start-draft-pr.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-07-30-contract-aware-same-file-wiring.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-30-finish-only-mergeability-gate.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-30-pinned-remote-theme-for-pages-navigation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-07-30-provider-preparation-lifecycle-supervision.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-01-bot-owned-release-pr.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-01-conduct-state-mutation-port.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-01-engine-owned-resumable-finish-publication.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-01-engine-owned-scoped-test-invocation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-01-multi-proof-park-deletion-authority.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-01-rebase-full-replay-intent-validation.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-08-01-scoped-run-verb-release-surface.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-02-live-tier-asserts-outcomes-not-scripts.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-02-plan-scope-containment-at-commit-boundary.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-03-build-repair-member-reuse-validity.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-03-fail-closed-decide-entry.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-03-ledgered-per-block-migration-execution.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-03-uncommitted-work-floor-under-build-completion.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-04-classify-before-spend-release-smoke-gate.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-04-live-tier-provisions-its-own-provider-home.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-04-unresolved-step-command-fails-by-name.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-05-blocked-classification-after-dedup.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-05-blocked-is-a-distinct-state-from-halted.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-05-build-settle-outcome-stamp.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-05-provenance-based-protected-artifact-inheritance.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-05-token-first-stories-reference-normalization.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-05-worktree-classification-evidence-derived-reasons.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-06-bounded-progress-allowance-for-finish-publication.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-06-honest-park-termination-boundary.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-06-publication-progress-is-its-own-disposition.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-07-project-teardown-hook-contract-and-containment.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-07-smoke-gate-goes-live-without-precharacterization.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-07-worktree-removal-coverage-guard.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-08-finish-human-required-halt-rendering.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-08-pipeline-owned-closeout-timestamps.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-08-single-adr-approval-parser-three-rungs.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-adr-contradiction-detection-in-two-halves.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-adr-layer-gated-by-committed-adr-signal.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-checkout-is-sole-version-identity-authority.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-conductor-block-single-source-of-truth.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-declared-pattern-replication-in-build.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-hook-owned-containment-event-ledger.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-legacy-json-seed-migration-rule.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-non-blocking-plan-scope-containment.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-operator-only-scoped-artifact-reseal.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-recorded-red-exception-for-remediation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-reseal-audit-rides-the-existing-event-spine.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-seal-rotation-authorship-predicate.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-09-worktree-local-provider-scratch.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-11-deprecated-no-op-step-retirement.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-11-halt-events-ride-the-persisted-spine.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-12-cumulative-build-review-convergence-bound.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-12-execution-lifecycle-completeness-for-timing.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-12-fail-closed-intake-ledger-durability.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-12-live-provider-coverage-from-plugin-registry.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-12-operator-reseal-as-second-scope-justification.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-12-per-provider-live-smoke-legs.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-12-removal-anchored-tautology-exemption.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-13-durable-base-advance-attribution.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-08-13-engine-managed-build-review-rubric-branches.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-13-markdown-default-inversion.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-13-stable-build-review-finding-dispositions.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-14-retire-build-review-wiring-rubric.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-15-verify-only-anchored-tautology-exemption.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-16-closed-build-review-finding-vocabularies.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-16-preservation-anchored-completeness-exemption.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-16-restore-the-current-head-publication-fence.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-17-framework-agnostic-tautology-scoped-run.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-17-structural-live-checkout-containment.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-18-content-anchored-finding-reference-schema.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-08-19-engine-stamped-rubric-judged-result-envelope.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-19-live-provider-stream-observation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-19-operator-step-rewind-through-the-mutation-port.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-19-unretryable-step-runner-failures-route-by-kind.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-21-engine-identity-in-build-review-cache-key.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-21-review-bound-by-plan-done-when-criteria.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-22-as-built-review-runs-always-with-plan-gap.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-22-build-review-opt-in-rubric-container.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-22-done-when-evidence-at-task-close.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-22-one-owner-per-review-question.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-23-committed-halt-record.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-23-criterion-layer-is-structural-at-land.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-23-diff-locality-is-an-authored-disposition.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-24-evidentiary-defects-are-not-waivable.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-24-one-dispatch-member-on-the-provider-contract.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-24-over-scope-decision-block-and-durable-refusals.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-24-refused-step-status.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-25-as-built-remediable-findings-bounded-build-route.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-26-music-vocabulary-player-composer-rename.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-26-remove-retrospectives-one-shot.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-26-setup-once-per-worktree-marker.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-26-shared-coherence-parser-at-discovery.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-27-daemon-dispatcher-executor-seam.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-29-build-review-remediate-case-adjudication.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-29-operator-authorized-kickback-budget-recovery.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-30-shared-plan-task-reference-resolver.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-31-coverage-binding-judge-step.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-08-31-kickback-ledger-read-fails-closed.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-02-adr-decision-citability-contract.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-05-gh-cli-version-floor-and-environment-gate.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-06-engine-owned-test-quality-scope.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-06-inbound-intake-trust-boundary.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-06-reopened-task-resolution.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-09-07-durable-prd-widening-decision-reconciliation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-10-portable-build-review-policy.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-09-10-separate-custom-review-coverage-identity.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-10-shared-step-lifecycle-telemetry.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-11-finish-mergeability-respects-active-review-inputs.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-09-11-github-operation-ownership.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-11-immutable-state-lease-recovery-succession.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-11-selective-post-rebase-verification.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-09-20-halt-resolution-queue-derived-from-markers.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-20-operator-launched-sessions-retain-conductor-authority.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-23-engine-git-guard-on-agent-path.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-09-23-one-owner-for-accepted-story-readability.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-24-built-in-provider-catalog-and-boot-discovery.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-24-project-owned-pr-body-regions.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-28-skills-may-bundle-executable-helpers.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-09-29-plan-slice-manifest.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-01-daemon-session-command-contracts.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-03-fail-closed-git-option-normalization.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-03-per-feature-step-applicability.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-03-stacked-child-plans-identity-and-state.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-04-resume-completes-interrupted-rebase-operation.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-06-catalog-owned-interactive-model-and-effort.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-07-conductor-decomposition-target-architecture.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-07-per-child-build-region.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-07-provider-cost-includes-failed-attempts.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-07-prune-base-inherited-deletions-from-the-seal.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-09-dependency-drift-sweep-on-intake-tick.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-09-dependency-reconciler-and-edge-write-ownership.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-09-shipped-pr-readiness-verdict.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-10-adr-assumption-ledger-contract.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-10-backend-neutral-ordering-source.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-10-retain-self-host-provider-transcripts.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-10-source-grounded-adversarial-plan-review-step.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-10-stacked-restack-journaled-replay.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-10-watch-registry-grace-state-is-durable-state.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-12-enforced-source-layer-directions.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-12-routed-whole-feature-repair.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-14-ac-prefixed-skill-names.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-14-commander-program-is-the-cli-catalog.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-14-dispatch-first-daemon-maintenance.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-15-per-dispatch-engine-pinned-executor.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-17-stacked-feature-publication-as-native-stack.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-19-build-review-finding-severity-advisory-threshold.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-20-operator-acceptance-is-durable-case-state.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-21-remediation-closure-judgement.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-23-slice-topology-from-sealed-plan.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-24-finish-surfaces-guarded-publish-failures.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-24-lap-monotonic-build-review-scope.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-24-operator-route-round-for-closed-stacked-children.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-24-per-feature-artifact-manifest.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-25-operator-recorded-restack-conflict-resolution.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-28-as-built-finding-reconciliation.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-28-shared-credential-reference-resolver.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-31-engine-performs-finish-pr-prose-write.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-10-31-operator-decision-for-stacked-restack-conflicts.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-11-07-child-projected-dispatch-otel.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-11-07-composer-run-checkpoint-resume-handoff.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-11-07-daemon-step-boundary-preemption.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-11-07-decision-corpus-query-and-known-record-shapes.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-11-07-external-boundary-ports-registry-and-ratchet.md` — narrowed out: no restack/replay subject overlap in corpus screening.
- `.docs/decisions/adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish.md` — examined for restack/replay interaction; preserve unaffected clauses.
- `.docs/decisions/adr-2026-11-15-accepted-restack-resolution-reuse.md` — examined for restack/replay interaction; preserve unaffected clauses.
