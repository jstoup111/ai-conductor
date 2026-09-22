# Conflict Check: Custom steps without engine-reserved names or paths (#1344)

**Date:** 2026-09-20
**Result:** CLEAN after resolution — one blocking conflict resolved, one degrading overlap accepted.

## Scope Reviewed

The inventory covered 470 story files under `.docs/stories/` and the approved decision corpus.
`conflict_check.adr_corpus` is `repo_wide`. Semantic comparison focused on the six new stories plus
every story addressing custom steps, completion artifacts, gating enforcement and skip authority,
FINISH publication and release readiness, the release-disposition contract, skill dispatch, and
configuration-key consumers. All six conflict types were evaluated, and every pair sharing a
behavior, entity, or gate was tested in both directions.

## Conflict: A skipped gating custom step cannot be exempt from FINISH

**Stories involved:** Story 2 (Steps that are not prerequisites never block FINISH) vs Stories 1 and 4 of "when: bypasses gating enforcement while disable: is rejected"
**Files:** [.docs/stories/custom-steps-work-only-in-this-repo-engine-hardcod.md] vs [.docs/stories/when-bypasses-gating-enforcement-while-disable-is-.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The drafted Story 2 exempted a gating custom step recorded `skipped` from the
FINISH prerequisite. The shipped story rejects `when:` and `disable: true` on a gating custom step
at configuration load and records that such steps "can never be disabled". No legitimate path
produces a skipped gating custom step, so the exemption could only ever turn an illegitimate skip
into a silent FINISH bypass, and it would have loosened today's behavior, where any status other
than `done` blocks. Tested both ways: satisfying the shipped story leaves the exemption
unreachable; satisfying the exemption weakens the shipped gate. One direction fails, so this is a
contradiction, not an oscillation.

**Resolution Options:**
1. Remove the exemption: a gating custom step that is not `done`, including `skipped`, leaves FINISH blocked and named.
2. Restrict the exemption to advisory steps, which are already outside the prerequisite.
3. Keep the exemption as drafted.

**Resolution (operator-selected, 2026-09-20):** Option 1. Story 2 was corrected in place; decision
D6 in `adr-2026-07-25-custom-step-completion-artifacts` now states that any status other than `done`
leaves the prerequisite unsatisfied; the architecture review carries an amendment note on its
condition 3. The ordering exclusion for a step placed after `finish` stands, because that one
prevents a real deadlock.

## Conflict: Two other features' story files describe dispatch by step key

**Stories involved:** Story 4 (A custom step runs the skill its configuration names) vs "Live daemon e2e build step never runs a real agent" and the unplanned "Custom-Step Skill Identity Dispatch"
**Files:** [.docs/stories/custom-steps-work-only-in-this-repo-engine-hardcod.md] vs [.docs/stories/live-daemon-e2e-build-step-never-runs-a-real-agent.md], [.docs/stories/custom-step-skill-identity-dispatch.md]
**Type:** overlap
**Severity:** degrading

**Description:** The live-tier story records, as a known non-covered preflight case, that a custom
step "dispatches as its raw state key rather than through the registry". Story 4 makes that
description false for custom steps. The unplanned skill-identity story asks for the behavior Story 4
now delivers and is absorbed by it. Neither file asserts behavior that blocks Story 4; they become
inaccurate once it ships.

**Resolution Options:**
1. Correct both files in a separate main-based change after this specification lands.
2. Correct them on this branch.
3. Leave them.

**Resolution (operator-accepted, 2026-09-20):** Option 1. This branch may only carry story files
for its own feature, so the two corrections travel separately. Accepted as a known follow-up.

## Findings — compatible

- **`maintain-documentation` "Require fresh pass evidence":** compatible. Its session-start floor governs completion evaluated outside an attempt; D3.1 changes the floor only for the FINISH prerequisite observation and leaves the original sentence in force elsewhere.
- **"Unattended FINISH spends minutes before deterministic checks":** compatible. An unsatisfied custom gate resolves to the existing blocked release-readiness conditions, so a release-readiness gap still never dispatches BUILD.
- **"Config keys that validate but have no consumer":** compatible. `gate` and `kickback_target` are untouched, and `steps.«custom».skill` gains a consumer rather than a new key.
- **"Custom steps crash the conductor with step-artifact contracts":** compatible. A custom step still has no artifact contract and still raises no artifact-review prompt.
- **"Projects cannot add portable non-competing build rubrics" (#1986):** compatible. It governs `build_review.custom_rubrics`; no story here reads or changes that subtree.
- **"CHANGELOG Unreleased is a shared write target" and the bot-owned release PR:** compatible. The release-metadata contract and its required check are preserved byte-for-byte (Story 5, Story 6).

## Internal Consistency

- Story 1 and Story 2 partition the same observation: Story 1 defines who is a prerequisite, Story 2 who is not. After the resolution no step satisfies both.
- Story 3 adds the step key to refusals Story 1 produces without adding a condition code, so Story 1's verdicts are unchanged by it.
- Story 5's non-self-build case and Story 1 agree: a consumer's step named `release-disposition` is an ordinary gating custom step.
- Story 4's byte-identical prompts for this repository's two steps keep Story 5's flow working across the dispatch change.

## ADR Corpus

All 340 non-review records under `.docs/decisions/` were opened in the architecture review's
delegated sweep. No ADR-versus-story conflict was grounded in opposing sentences. The narrowing
below records which records address a subject these stories touch.

**Examined against the stories (33):** adr-2026-07-25-custom-step-completion-artifacts,
adr-2026-06-30-halt-based-release-gates, adr-2026-06-30-self-host-detection-seam,
adr-2026-07-03-version-gate-semver-escalation, adr-2026-07-03-pr-timing-self-host-precedence,
adr-005-non-autonomy-and-read-only-governor, 004-when-parallel-workflow-dsl,
adr-2026-07-25-fail-closed-durable-shipment-evidence,
adr-2026-07-26-event-sink-registry-exhaustiveness,
adr-2026-07-04-kickback-event-emission-and-log-prominence, adr-2026-07-06-manual-test-fail-routing,
adr-2026-07-06-migration-gate-waiver, adr-2026-07-03-halt-pr-rehabilitation-at-finish,
adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation, 002-plugin-manifest-and-discovery,
adr-2026-08-01-engine-owned-resumable-finish-publication,
adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns,
adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity,
adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal,
adr-2026-08-04-unresolved-step-command-fails-by-name, adr-2026-07-29-ship-start-draft-pr,
adr-2026-08-01-bot-owned-release-pr, adr-2026-08-01-scoped-run-verb-release-surface,
adr-2026-07-28-feature-aware-artifact-resolution,
adr-2026-07-28-total-halt-classification-legacy-boundary, adr-2026-08-23-committed-halt-record,
adr-2026-09-10-shared-step-lifecycle-telemetry,
adr-2026-09-05-gh-cli-version-floor-and-environment-gate,
adr-2026-09-11-github-operation-ownership,
adr-2026-08-24-one-dispatch-member-on-the-provider-contract,
adr-2026-07-27-project-config-scaffolder, adr-2026-09-10-portable-build-review-policy,
adr-2026-08-24-refused-step-status.

<details>
<summary>Narrowed out after reading — subject does not overlap these stories (307)</summary>

001-harness-architecture
003-ui-renderer-plugin-point
005-when-undefined-key-falsy
2026-06-29-delivery-split-pluggable-memory
adr-002-engineer-store-and-retro-redirect
adr-003-registry-write-and-integration
adr-006-flywheel-lesson-selection-and-provenance
adr-008-agent-hosted-loop-and-in-chat-authoring
adr-009-intake-adapter-port
adr-010-pidfile-lock-daemon-liveness
adr-011-async-intake-queue-and-github-source
adr-012-durable-intake-ledger-sole-dedup-authority
adr-014-otel-observability-exporter
adr-015-daemon-pr-labeling-sweep
adr-2026-06-29-architecture-before-stories-convergent-kickback
adr-2026-06-29-brainstorm-rename-migration
adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting
adr-2026-06-29-explore-prd-split-track-in-explore
adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration
adr-2026-06-29-memory-resilience-write-fallback-and-reconcile
adr-2026-06-29-per-project-memory-provider-selection
adr-2026-06-29-per-provider-retrieval-guidance-location
adr-2026-06-29-platform-adoption-and-removal-surface
adr-2026-06-29-rebase-conflict-resolution-dispatch
adr-2026-06-29-safe-reversible-memory-migration
adr-2026-06-29-shared-memory-store-placement-and-durability
adr-2026-06-29-track-marker-location
adr-2026-06-30-background-intake-brain-loop
adr-2026-06-30-engineer-worktree-authoring-isolation
adr-2026-06-30-grandfather-cutover-merge-time
adr-2026-06-30-origin-seeded-intake-routing
adr-2026-06-30-owner-gate-identity-resolution
adr-2026-06-30-owner-provenance-recording
adr-2026-06-30-sandbox-build-isolation
adr-2026-07-01-machine-scoped-operator-identity
adr-2026-07-03-daemon-auto-restart-stale-engine
adr-2026-07-03-dependency-fail-closed-and-cache
adr-2026-07-03-dependency-gate-backlog-waiting-channel
adr-2026-07-03-engineer-checkpoint-commits-idempotent-land
adr-2026-07-03-gated-snapshot-status-read-model
adr-2026-07-03-gated-writeback-announcements
adr-2026-07-03-generated-model-table-single-source
adr-2026-07-03-harness-daemon-profile
adr-2026-07-03-issue-dependencies-api-surface
adr-2026-07-03-owner-gate-gated-channel
adr-2026-07-03-post-rebase-force-with-lease
adr-2026-07-03-pr-timing-config-key
adr-2026-07-03-priority-fetch-fail-soft
adr-2026-07-03-priority-from-linked-issue-labels
adr-2026-07-03-prose-to-link-migration
adr-2026-07-03-reactive-model-fallback-ladder
adr-2026-07-04-auth-failure-park-and-poll
adr-2026-07-04-autoresolve-state-and-config
adr-2026-07-04-claim-time-delivery-evidence-guard
adr-2026-07-04-durable-pause-marker
adr-2026-07-04-event-driven-halt-clear-wake
adr-2026-07-04-operator-park-marker
adr-2026-07-04-park-unpark-cli-verbs
adr-2026-07-04-pending-restart-queue
adr-2026-07-04-resolution-worktree-lifecycle
adr-2026-07-04-respawn-in-place-restart
adr-2026-07-04-versioned-engine-store-atomic-flip
adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep
adr-2026-07-05-daemon-rate-limit-episode-coordinator
adr-2026-07-05-engine-owned-task-status
adr-2026-07-05-halt-pr-presentation-reliability
adr-2026-07-05-retry-as-escalation-ladder
adr-2026-07-05-standalone-bin-update
adr-2026-07-06-daemon-false-ship-guard
adr-2026-07-06-installed-root-resolution-for-global-writes
adr-2026-07-06-stale-engine-respawn-in-place
adr-2026-07-07-audit-trail-event-sink
adr-2026-07-07-daemon-owned-build-credential
adr-2026-07-07-finish-record-primitive
adr-2026-07-07-ship-ci-feedback-loop
adr-2026-07-07-single-generation-stale-respawn
adr-2026-07-07-task-trailer-id-alias
adr-2026-07-08-halt-issue-closure-sweep
adr-2026-07-08-main-checkout-leak-triage-and-write-fence
adr-2026-07-08-post-rebase-gate-first-mechanical-reverify
adr-2026-07-09-deterministic-evidence-attribution-enforcement
adr-2026-07-09-setup-failure-triage
adr-2026-07-10-concurrent-group-core
adr-2026-07-10-daemon-stall-remediation
adr-2026-07-10-evidence-range-anchor-resolution
adr-2026-07-10-inline-work-attribution-enforcement
adr-2026-07-10-intake-claim-priority-banding
adr-2026-07-10-intra-step-build-progress-events
adr-2026-07-10-observed-close-watch-registry
adr-2026-07-10-park-marker-main-root-resolution
adr-2026-07-10-retire-migration-grandfather
adr-2026-07-10-session-hook-task-stamping
adr-2026-07-10-validation-group-join
adr-2026-07-11-attribution-abstain-or-loud
adr-2026-07-11-attribution-spot-audit-measurement
adr-2026-07-11-attribution-verdict-interface
adr-2026-07-11-evidence-judge-cli-and-cutover
adr-2026-07-11-finish-step-engine-completion-machinery
adr-2026-07-11-pipeline-state-durability
adr-2026-07-11-semantic-attribution-verification-lane
adr-2026-07-11-verdict-aware-resume-entry
adr-2026-07-12-judged-attribution-verdict-persistence
adr-2026-07-12-progress-aware-build-halt
adr-2026-07-12-rebase-evidence-stamp-translation
adr-2026-07-12-wired-into-contract
adr-2026-07-12-wiring-check-gate
adr-2026-07-13-kickback-build-no-op-escalation
adr-2026-07-13-park-all-dispatch-paths
adr-2026-07-13-retry-classify-rerun-vs-route
adr-2026-07-13-session-fresh-verdict-artifacts
adr-2026-07-17-verify-only-judged-closure
adr-2026-07-20-bounded-dirname-path-corroboration
adr-2026-07-20-ci-fix-dispatch-via-steprunner
adr-2026-07-20-ci-fix-startup-preflight-and-error-classification
adr-2026-07-20-post-rebase-delta-aware-invalidation
adr-2026-07-21-completeness-as-build-review-rubric
adr-2026-07-21-decide-time-unmerged-overlap-scan
adr-2026-07-21-demote-task-stamping-to-telemetry
adr-2026-07-21-engine-owned-acceptance-red-execution
adr-2026-07-21-intake-only-enforcement
adr-2026-07-21-no-diff-task-evidence-stamp
adr-2026-07-21-owner-stamped-at-authoring
adr-2026-07-21-s-tier-pipeline-knobs
adr-2026-07-21-serena-removal-path
adr-2026-07-22-attempts-counter-on-crash-recovery
adr-2026-07-22-auth-failure-classification-observed-401-patterns
adr-2026-07-22-build-dispatch-json-usage-capture
adr-2026-07-22-canonical-tagged-source-ref
adr-2026-07-22-canonical-tracker-client-seam
adr-2026-07-22-coherence-gate-placement-and-validation-split
adr-2026-07-22-coherence-waiver-and-duplicate-claim
adr-2026-07-22-daemon-level-missing-credential-gate
adr-2026-07-22-examples-state-isolation
adr-2026-07-22-gate-evidence-code-validity-on-redispatch
adr-2026-07-22-headless-vs-guided-examples
adr-2026-07-22-heartbeat-lease-deferred
adr-2026-07-22-intake-closed-issue-reconciliation
adr-2026-07-22-origin-refresh-before-engine-rebuild
adr-2026-07-22-per-feature-cost-rollup-in-shipped-record
adr-2026-07-22-per-task-work-happened-floor
adr-2026-07-22-phase-scoped-docs-write-guard
adr-2026-07-22-requeue-claimed-distinct-from-reopen
adr-2026-07-22-stale-claim-staleness-window-default
adr-2026-07-22-token-liveness-probe-via-cli-invocation
adr-2026-07-23-build-review-fresh-base-disposition
adr-2026-07-23-commit-movement-liveness-floor
adr-2026-07-23-intake-label-authority-scoped-replace
adr-2026-07-23-session-hook-repair-before-halt
adr-2026-07-23-trailer-union-build-step-routing
adr-2026-07-24-provider-aware-step-execution-fresh-session-scope
adr-2026-07-25-content-addressed-full-suite-proof
adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation
adr-2026-07-26-cross-dispatch-kickback-livelock-bound
adr-2026-07-26-daemon-decide-preseed-ownership
adr-2026-07-26-protected-artifact-seal-rebaseline
adr-2026-07-26-rebase-tail-current-branch-before-publication
adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates
adr-2026-07-27-ancestry-proven-park-reconciliation
adr-2026-07-27-codex-never-resumes-a-harness-minted-session
adr-2026-07-27-cold-start-within-step-retries
adr-2026-07-27-cost-unmetered-is-a-first-class-state
adr-2026-07-27-daemon-decide-kickback-halt
adr-2026-07-27-protected-artifact-seal-self-amendment-visibility
adr-2026-07-29-codex-readiness-probe-failure-disposition
adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main
adr-2026-07-29-deterministic-build-verification-fanout
adr-2026-07-29-engine-observed-provider-time-partition
adr-2026-07-29-operator-park-scheduling-unit-boundary
adr-2026-07-30-contract-aware-same-file-wiring
adr-2026-07-30-finish-only-mergeability-gate
adr-2026-07-30-pinned-remote-theme-for-pages-navigation
adr-2026-07-30-provider-preparation-lifecycle-supervision
adr-2026-08-01-conduct-state-mutation-port
adr-2026-08-01-engine-owned-scoped-test-invocation
adr-2026-08-01-multi-proof-park-deletion-authority
adr-2026-08-01-rebase-full-replay-intent-validation
adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate
adr-2026-08-02-live-tier-asserts-outcomes-not-scripts
adr-2026-08-02-plan-scope-containment-at-commit-boundary
adr-2026-08-03-build-repair-member-reuse-validity
adr-2026-08-03-fail-closed-decide-entry
adr-2026-08-03-ledgered-per-block-migration-execution
adr-2026-08-03-uncommitted-work-floor-under-build-completion
adr-2026-08-04-classify-before-spend-release-smoke-gate
adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts
adr-2026-08-04-live-tier-provisions-its-own-provider-home
adr-2026-08-05-blocked-classification-after-dedup
adr-2026-08-05-blocked-is-a-distinct-state-from-halted
adr-2026-08-05-build-settle-outcome-stamp
adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever
adr-2026-08-05-provenance-based-protected-artifact-inheritance
adr-2026-08-05-token-first-stories-reference-normalization
adr-2026-08-05-worktree-classification-evidence-derived-reasons
adr-2026-08-06-bounded-progress-allowance-for-finish-publication
adr-2026-08-06-honest-park-termination-boundary
adr-2026-08-06-publication-progress-is-its-own-disposition
adr-2026-08-07-project-teardown-hook-contract-and-containment
adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts
adr-2026-08-07-smoke-gate-goes-live-without-precharacterization
adr-2026-08-07-worktree-removal-coverage-guard
adr-2026-08-08-finish-human-required-halt-rendering
adr-2026-08-08-pipeline-owned-closeout-timestamps
adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition
adr-2026-08-08-single-adr-approval-parser-three-rungs
adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance
adr-2026-08-09-adr-contradiction-detection-in-two-halves
adr-2026-08-09-adr-layer-gated-by-committed-adr-signal
adr-2026-08-09-bash-yaml-access-via-conduct-ts-config
adr-2026-08-09-checkout-is-sole-version-identity-authority
adr-2026-08-09-conductor-block-single-source-of-truth
adr-2026-08-09-declared-pattern-replication-in-build
adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic
adr-2026-08-09-hook-owned-containment-event-ledger
adr-2026-08-09-legacy-json-seed-migration-rule
adr-2026-08-09-non-blocking-plan-scope-containment
adr-2026-08-09-one-pr-per-branch-halt-is-a-state
adr-2026-08-09-operator-only-scoped-artifact-reseal
adr-2026-08-09-recorded-red-exception-for-remediation
adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag
adr-2026-08-09-reseal-audit-rides-the-existing-event-spine
adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator
adr-2026-08-09-seal-rotation-authorship-predicate
adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag
adr-2026-08-09-worktree-local-provider-scratch
adr-2026-08-11-deprecated-no-op-step-retirement
adr-2026-08-11-halt-events-ride-the-persisted-spine
adr-2026-08-12-cumulative-build-review-convergence-bound
adr-2026-08-12-execution-lifecycle-completeness-for-timing
adr-2026-08-12-fail-closed-intake-ledger-durability
adr-2026-08-12-live-provider-coverage-from-plugin-registry
adr-2026-08-12-operator-reseal-as-second-scope-justification
adr-2026-08-12-per-provider-live-smoke-legs
adr-2026-08-12-removal-anchored-tautology-exemption
adr-2026-08-13-durable-base-advance-attribution
adr-2026-08-13-engine-managed-build-review-rubric-branches
adr-2026-08-13-markdown-default-inversion
adr-2026-08-13-stable-build-review-finding-dispositions
adr-2026-08-14-retire-build-review-wiring-rubric
adr-2026-08-15-verify-only-anchored-tautology-exemption
adr-2026-08-16-closed-build-review-finding-vocabularies
adr-2026-08-16-preservation-anchored-completeness-exemption
adr-2026-08-16-restore-the-current-head-publication-fence
adr-2026-08-17-framework-agnostic-tautology-scoped-run
adr-2026-08-17-structural-live-checkout-containment
adr-2026-08-18-content-anchored-finding-reference-schema
adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane
adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence
adr-2026-08-19-engine-stamped-rubric-judged-result-envelope
adr-2026-08-19-live-provider-stream-observation
adr-2026-08-19-operator-step-rewind-through-the-mutation-port
adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch
adr-2026-08-19-unretryable-step-runner-failures-route-by-kind
adr-2026-08-21-engine-identity-in-build-review-cache-key
adr-2026-08-21-review-bound-by-plan-done-when-criteria
adr-2026-08-22-as-built-review-runs-always-with-plan-gap
adr-2026-08-22-build-review-opt-in-rubric-container
adr-2026-08-22-done-when-evidence-at-task-close
adr-2026-08-22-one-owner-per-review-question
adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback
adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote
adr-2026-08-23-criterion-layer-is-structural-at-land
adr-2026-08-23-diff-locality-is-an-authored-disposition
adr-2026-08-24-evidentiary-defects-are-not-waivable
adr-2026-08-24-over-scope-decision-block-and-durable-refusals
adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope
adr-2026-08-25-as-built-remediable-findings-bounded-build-route
adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot
adr-2026-08-26-music-vocabulary-player-composer-rename
adr-2026-08-26-remove-retrospectives-one-shot
adr-2026-08-26-setup-once-per-worktree-marker
adr-2026-08-26-shared-coherence-parser-at-discovery
adr-2026-08-27-daemon-dispatcher-executor-seam
adr-2026-08-28-test-suite-drift-budget-and-verification-mode
adr-2026-08-29-build-review-remediate-case-adjudication
adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class
adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication
adr-2026-08-29-operator-authorized-kickback-budget-recovery
adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded
adr-2026-08-30-shared-plan-task-reference-resolver
adr-2026-08-31-coverage-binding-judge-step
adr-2026-08-31-kickback-ledger-read-fails-closed
adr-2026-09-02-adr-decision-citability-contract
adr-2026-09-06-engine-owned-test-quality-scope
adr-2026-09-06-inbound-intake-trust-boundary
adr-2026-09-06-reopened-task-resolution
adr-2026-09-07-durable-prd-widening-decision-reconciliation
adr-2026-09-10-separate-custom-review-coverage-identity
adr-2026-09-11-finish-mergeability-respects-active-review-inputs
adr-2026-09-11-immutable-state-lease-recovery-succession
adr-2026-09-11-selective-post-rebase-verification
build-review-re-judges-what-the-plan-architecture-
ci-fix-resolver-autofix-review
conductor-suite-fork-determinism
draft-memory-mcp-service
gate-audit-2026-06-23
per-feature-token-accounting-review
review-2026-07-26-daemon-decide-phase-coherence-ownership-971
review-2026-07-27-project-config-scaffolding-683
review-2026-08-05-annotated-stories-line-blocked-specs-1330
review-2026-08-09-halt-pr-occupies-retained-slot-1415
review-2026-08-09-update-check-config-split-brain-1400
review-2026-08-11-halt-events-reach-the-persisted-spine
review-2026-08-11-remove-wiring-check-gate-1496
review-per-task-work-happened-floor
review-staleness-decisions-invisible-in-daemon-log
supervisor-engineer-followup
technical-assessment-2026-08-14

</details>
