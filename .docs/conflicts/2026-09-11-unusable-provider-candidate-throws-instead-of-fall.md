# Conflict Check: Provider setup failures preserve configured fallback

**Date:** 2026-09-11
**Result:** PASS
**Blocking conflicts:** 0
**Degrading conflicts:** 0
**Resolutions:** None
**ADR corpus:** repo_wide, explicitly configured in `.ai-conductor/config.yml`

## Inventory and method

Inventoried 444 story files, 54 spec files, and 261 prior conflict reports. Searched the complete text corpus for provider preparation, setup, unavailability, fallback, candidate exhaustion, and unconditional retry claims; read the interacting scenario/decision passages. The narrowed story/spec/report candidate set contains 64 files, including this feature's accepted stories. Search matches from memory-provider selection, project installation, and test-quality fixture setup were distinguished from LLM execution rather than treated as shared behavior merely because they use the same words.

The repository-wide ADR inventory below records examined and narrowed-out decisions, with fully superseded entries separated. Partial supersession is retained: the provider execution/session, self-host, telemetry, and portable-policy decisions are interpreted with their in-place amendments. The governing provider-execution and preparation-lifecycle ADRs were already read in architecture review and remain authoritative.

Compatibility confidence: 95%, based on the cited interacting passages and both-direction reasoning below. This is a scoped semantic review of the inventoried corpus, not a claim that keyword absence mathematically proves noninteraction.

## New-story pair review

For each pair, the two columns answer whether satisfying the first preserves the second and vice versa.

| Pair | First preserves second | Second preserves first |
|------|------------------------|------------------------|
| 1 / 2 | Yes: successful fallback occurs only after release and required safety checks | Yes: cleanup permits an eligible next candidate without weakening its context |
| 1 / 3 | Yes: skipping before successful invocation remains within one attempt | Yes: only all-setup exhaustion stops; a usable fallback still runs |
| 1 / 4 | Yes: actual completion supplies actual-provider attribution | Yes: diagnostics record execution and do not manufacture or authorize it |
| 2 / 3 | Yes: unresolved cleanup blocks rather than becoming setup-only exhaustion | Yes: exhaustion follows completed setup unwinding and cannot reset lifecycle authority |
| 2 / 4 | Yes: failed-setup cleanup does not require fabricated provider activity | Yes: observational sink failure does not change cleanup or safety authority |
| 3 / 4 | Yes: a one-pass all-skipped result retains every candidate reason | Yes: recording skips does not count them as invocations or policy retries |

## Existing-contract interactions

Every row was evaluated in both directions: implementing #1285 must preserve the named contract, and implementing that contract must leave the accepted #1285 outcomes achievable.

| Existing contract | New stories | Both-direction result |
|-------------------|-------------|-----------------------|
| `per-step-provider-routing-927`, ST-927-4/5/6/7; PRD FR-9 through FR-20 | 1–4 | Compatible. Explicit setup unavailability advances in configured order; auth and ordinary failures do not. Native settings and fresh sessions remain candidate-local. Setup-only exhaustion is a failed step, not fabricated success or an unconfigured provider. |
| `model-availability-fallback-ladder`, `support-astra-in-the-daemon` | 1, 3 | Compatible. The within-provider model ladder still precedes existing runtime/model fallback. A real invocation before exhaustion cannot be reclassified as all-setup. Context-specific setup gaps do not disable an otherwise eligible provider on another step. |
| `model-and-effort-resolution-provider-aware-902`, `model-attribution-and-provider-defaults-931` | 1, 4 | Compatible. Actual fallback settings and attribution remain native to the actual provider. #1285 does not change configuration precedence or introduce model translation. |
| `first-class-codex-harness-parity-904`, ST-904-12; skill-adaptation ADR | 1 | Compatible. Actual-candidate prompt resolution remains inside candidate execution; the next provider does not inherit the first provider's native skill syntax. |
| `codex-auth-sandbox-permission-readiness-905`, `codex-readiness-park-970`, `auth-park-coordinator-decomposition` | 1–3 | Compatible. Credential failure retains its selected provider/source and bounded recovery. Missing capability is not synonymous with missing credentials. |
| `codex-readiness-distinguishes-unavailable-doctor-p`; readiness-probe-disposition ADR | 1–3 | Compatible. Inconclusive doctor results retain their degraded-readiness/real-trial behavior. They are not explicit candidate capability failures and cannot buy a provider switch. |
| `daemon-build-review-can-wedge-before-provider-laun`, TI-1 and lifecycle-fencing scenarios; preparation-lifecycle ADR | 1–3 | Compatible. Fallback remains inside the same active attempt and deadline; setup skips do not buy a fresh permit or consume the bounded replacement allowance. Revoked work cannot spawn late. |
| Symmetric self-host isolation and structural containment ADRs | 1, 2 | Compatible. Every actual candidate retains required isolation. Cleanup releases only owned state. A failed required protection or terminal verification is not authorization for unprotected fallback. |
| `build-review-rubric-dispositions-and-fan-out`; engine-managed-rubric ADR | 3, 4 | Compatible. Setup-only exhaustion is still an attributable infrastructure failure that blocks judging; no finding or successful review is invented. Runtime failures continue to use the rubric's actual retry policy. |
| `projects-cannot-add-portable-non-competing-build-r`, Stories 5 and 9; portable-policy ADR D6 | 1–4 | Compatible with the approved classification boundary. Missing, ambiguous, or unloadable review policy is a configuration/coverage failure, not provider unavailability. Valid fallback resolves its own policy and cache identity; #1285 does not allow borrowing the prior candidate's policy or treating discovery errors as eligibility to switch. |
| `finish-s-stop-gate-does-not-stop-a-correct-refusal`; `unattended-finish-spends-minutes-before-determinis` | 3 | Compatible. Existing decoded `provider_unavailable` and `timed_out` judgment results keep their publication-retry mapping. Setup-only exhaustion must survive the execution wrapper before being collapsed into a legacy judgment category; #1285 does not redefine that decoder's existing variants. |
| `export-the-telemetry-dimensions-the-engine-already`, Stories 3/4; `restore-per-member-telemetry-for-validation-groups`; ADR-014 and shared-step-lifecycle ADR | 4 | Compatible. `invoked: false` skips add no dispatch or usage. Existing attempt-chain reasons, actual-provider dimensions, and execution correlation remain on the event spine. Timing and sink observations do not control execution. |
| Engine-observed-provider-time-partition ADR | 4 | Compatible. No process means no provider-active time; actual fallback intervals retain their own attribution. |
| `codex-fresh-session-per-step-contract`, `claude-within-step-retries-resume-the-prior-attemp`; cold-start ADRs | 1, 3 | Compatible. Read current criteria and amendment text, not historical titles/context as a requirement to resume. Fallback and retries use fresh identities. |
| `automatic-park-outcome-writes-no-park-marker-so-an`, project setup-repair and teardown contracts | 2, 3 | No overlapping lifecycle authority. Their project dependency installation/fix-session or teardown operations are not provider candidate selection. #1285 does not change their retry/park contracts. |
| Committed-halt-record and park/unpark ADRs | 3 | Compatible. Existing terminal halt publication and operator recovery remain owned by the conductor; the new setup-only disposition must not bypass branch-visible operator-actionable halt handling. |

The earlier `2026-07-30-provider-preparation-lifecycle-supervision` conflict report independently records compatibility between unsupported-candidate fallback and the same active lifecycle attempt. Other retrieved reports concerning provider routing, readiness, native attribution, and portable policies retain the same cause-specific failure boundaries rather than authorizing catch-all fallback.

## Six conflict types

- **Contradiction:** none found. Setup capability absence, auth/permission failure, policy-loading failure, and post-invocation runtime failure have distinct accepted dispositions.
- **Behavioral overlap:** compatible. Shared candidate execution is the intentional integration point, not a second retry or selection controller.
- **State conflict:** none found. Invoked versus skipped and setup-only versus mixed exhaustion remain distinguishable; failure does not imply successful review or execution.
- **Resource contention:** none found. Candidate cleanup owns only that candidate's resources and must settle before advancement; concurrent attempts retain separate authority.
- **Sequencing conflict:** none found. Resolve/prepare, unwind if needed, record, and advance form a finite ordered progression; successful or non-fallback results terminate it.
- **Oscillating conflict:** none found. Terminal setup-only exhaustion cannot be sent back through the same ordinary retry list, and runtime failures do not lose their retries to satisfy that rule.

## Outcome

No story edits, compromises, or superseding ADRs are required. The plan must preserve the explicit policy-loading/readiness exclusions and the setup-only disposition through one-shot/auxiliary wrappers. Those are applications of the accepted architecture, not new scope.

Verify-claims verdict: CLEAR. No unconfirmed load-bearing assumptions remain for planning. No conflict-review-required marker is needed because no conflict was found or resolved. The composer still presents this DECIDE output to the operator before advancing.

## ADR inventory

The following lists are the repository-wide selection record. Examined means reviewed for subject overlap; unrelated memory, installation, smoke, and teardown decisions in that list were narrowed out after examining their subject. The interaction table identifies the decisions with actual behavior overlap. Narrowed-out entries describe other subsystems and impose no provider candidate-setup behavior; fully superseded entries have unambiguous full status declarations.

### Examined for subject overlap (27)

- `adr-014-otel-observability-exporter.md`
- `adr-2026-06-29-memory-resilience-write-fallback-and-reconcile.md`
- `adr-2026-06-29-per-project-memory-provider-selection.md`
- `adr-2026-06-29-per-provider-retrieval-guidance-location.md`
- `adr-2026-06-29-platform-adoption-and-removal-surface.md`
- `adr-2026-06-29-shared-memory-store-placement-and-durability.md`
- `adr-2026-07-04-park-unpark-cli-verbs.md`
- `adr-2026-07-09-setup-failure-triage.md`
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md`
- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation.md`
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation.md`
- `adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md`
- `adr-2026-07-27-cold-start-within-step-retries.md`
- `adr-2026-07-29-codex-readiness-probe-failure-disposition.md`
- `adr-2026-07-29-engine-observed-provider-time-partition.md`
- `adr-2026-07-30-provider-preparation-lifecycle-supervision.md`
- `adr-2026-08-04-live-tier-provisions-its-own-provider-home.md`
- `adr-2026-08-04-unresolved-step-command-fails-by-name.md`
- `adr-2026-08-07-project-teardown-hook-contract-and-containment.md`
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.md`
- `adr-2026-08-12-per-provider-live-smoke-legs.md`
- `adr-2026-08-13-engine-managed-build-review-rubric-branches.md`
- `adr-2026-08-17-structural-live-checkout-containment.md`
- `adr-2026-08-23-committed-halt-record.md`
- `adr-2026-08-31-coverage-binding-judge-step.md`
- `adr-2026-09-10-portable-build-review-policy.md`
- `adr-2026-09-10-shared-step-lifecycle-telemetry.md`

### Narrowed out: unrelated subject (278)

- `adr-002-engineer-store-and-retro-redirect.md`
- `adr-003-registry-write-and-integration.md`
- `adr-005-non-autonomy-and-read-only-governor.md`
- `adr-006-flywheel-lesson-selection-and-provenance.md`
- `adr-008-agent-hosted-loop-and-in-chat-authoring.md`
- `adr-009-intake-adapter-port.md`
- `adr-010-pidfile-lock-daemon-liveness.md`
- `adr-011-async-intake-queue-and-github-source.md`
- `adr-012-durable-intake-ledger-sole-dedup-authority.md`
- `adr-015-daemon-pr-labeling-sweep.md`
- `adr-2026-06-29-architecture-before-stories-convergent-kickback.md`
- `adr-2026-06-29-brainstorm-rename-migration.md`
- `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md`
- `adr-2026-06-29-explore-prd-split-track-in-explore.md`
- `adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration.md`
- `adr-2026-06-29-rebase-conflict-resolution-dispatch.md`
- `adr-2026-06-29-safe-reversible-memory-migration.md`
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
- `adr-2026-07-01-machine-scoped-operator-identity.md`
- `adr-2026-07-03-daemon-auto-restart-stale-engine.md`
- `adr-2026-07-03-dependency-fail-closed-and-cache.md`
- `adr-2026-07-03-dependency-gate-backlog-waiting-channel.md`
- `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.md`
- `adr-2026-07-03-gated-snapshot-status-read-model.md`
- `adr-2026-07-03-gated-writeback-announcements.md`
- `adr-2026-07-03-generated-model-table-single-source.md`
- `adr-2026-07-03-halt-pr-rehabilitation-at-finish.md`
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
- `adr-2026-07-04-claim-time-delivery-evidence-guard.md`
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
- `adr-2026-07-09-deterministic-evidence-attribution-enforcement.md`
- `adr-2026-07-10-concurrent-group-core.md`
- `adr-2026-07-10-daemon-stall-remediation.md`
- `adr-2026-07-10-evidence-range-anchor-resolution.md`
- `adr-2026-07-10-inline-work-attribution-enforcement.md`
- `adr-2026-07-10-intake-claim-priority-banding.md`
- `adr-2026-07-10-intra-step-build-progress-events.md`
- `adr-2026-07-10-observed-close-watch-registry.md`
- `adr-2026-07-10-park-marker-main-root-resolution.md`
- `adr-2026-07-10-retire-migration-grandfather.md`
- `adr-2026-07-10-session-hook-task-stamping.md`
- `adr-2026-07-10-validation-group-join.md`
- `adr-2026-07-11-attribution-abstain-or-loud.md`
- `adr-2026-07-11-attribution-spot-audit-measurement.md`
- `adr-2026-07-11-attribution-verdict-interface.md`
- `adr-2026-07-11-evidence-judge-cli-and-cutover.md`
- `adr-2026-07-11-finish-step-engine-completion-machinery.md`
- `adr-2026-07-11-pipeline-state-durability.md`
- `adr-2026-07-11-semantic-attribution-verification-lane.md`
- `adr-2026-07-11-verdict-aware-resume-entry.md`
- `adr-2026-07-12-judged-attribution-verdict-persistence.md`
- `adr-2026-07-12-progress-aware-build-halt.md`
- `adr-2026-07-12-rebase-evidence-stamp-translation.md`
- `adr-2026-07-12-wired-into-contract.md`
- `adr-2026-07-12-wiring-check-gate.md`
- `adr-2026-07-13-kickback-build-no-op-escalation.md`
- `adr-2026-07-13-park-all-dispatch-paths.md`
- `adr-2026-07-13-retry-classify-rerun-vs-route.md`
- `adr-2026-07-13-session-fresh-verdict-artifacts.md`
- `adr-2026-07-17-verify-only-judged-closure.md`
- `adr-2026-07-20-bounded-dirname-path-corroboration.md`
- `adr-2026-07-20-ci-fix-dispatch-via-steprunner.md`
- `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification.md`
- `adr-2026-07-20-post-rebase-delta-aware-invalidation.md`
- `adr-2026-07-21-decide-time-unmerged-overlap-scan.md`
- `adr-2026-07-21-demote-task-stamping-to-telemetry.md`
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
- `adr-2026-07-22-phase-scoped-docs-write-guard.md`
- `adr-2026-07-22-requeue-claimed-distinct-from-reopen.md`
- `adr-2026-07-22-stale-claim-staleness-window-default.md`
- `adr-2026-07-22-token-liveness-probe-via-cli-invocation.md`
- `adr-2026-07-23-build-review-fresh-base-disposition.md`
- `adr-2026-07-23-commit-movement-liveness-floor.md`
- `adr-2026-07-23-intake-label-authority-scoped-replace.md`
- `adr-2026-07-23-session-hook-repair-before-halt.md`
- `adr-2026-07-23-trailer-union-build-step-routing.md`
- `adr-2026-07-25-custom-step-completion-artifacts.md`
- `adr-2026-07-25-fail-closed-durable-shipment-evidence.md`
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md`
- `adr-2026-07-26-daemon-decide-preseed-ownership.md`
- `adr-2026-07-26-event-sink-registry-exhaustiveness.md`
- `adr-2026-07-26-protected-artifact-seal-rebaseline.md`
- `adr-2026-07-26-rebase-tail-current-branch-before-publication.md`
- `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates.md`
- `adr-2026-07-27-ancestry-proven-park-reconciliation.md`
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state.md`
- `adr-2026-07-27-daemon-decide-kickback-halt.md`
- `adr-2026-07-27-project-config-scaffolder.md`
- `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md`
- `adr-2026-07-28-feature-aware-artifact-resolution.md`
- `adr-2026-07-28-total-halt-classification-legacy-boundary.md`
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main.md`
- `adr-2026-07-29-deterministic-build-verification-fanout.md`
- `adr-2026-07-29-operator-park-scheduling-unit-boundary.md`
- `adr-2026-07-29-ship-start-draft-pr.md`
- `adr-2026-07-30-contract-aware-same-file-wiring.md`
- `adr-2026-07-30-pinned-remote-theme-for-pages-navigation.md`
- `adr-2026-08-01-bot-owned-release-pr.md`
- `adr-2026-08-01-conduct-state-mutation-port.md`
- `adr-2026-08-01-engine-owned-resumable-finish-publication.md`
- `adr-2026-08-01-engine-owned-scoped-test-invocation.md`
- `adr-2026-08-01-multi-proof-park-deletion-authority.md`
- `adr-2026-08-01-rebase-full-replay-intent-validation.md`
- `adr-2026-08-01-scoped-run-verb-release-surface.md`
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate.md`
- `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts.md`
- `adr-2026-08-02-plan-scope-containment-at-commit-boundary.md`
- `adr-2026-08-03-build-repair-member-reuse-validity.md`
- `adr-2026-08-03-fail-closed-decide-entry.md`
- `adr-2026-08-03-ledgered-per-block-migration-execution.md`
- `adr-2026-08-03-uncommitted-work-floor-under-build-completion.md`
- `adr-2026-08-04-classify-before-spend-release-smoke-gate.md`
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md`
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
- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization.md`
- `adr-2026-08-07-worktree-removal-coverage-guard.md`
- `adr-2026-08-08-finish-human-required-halt-rendering.md`
- `adr-2026-08-08-pipeline-owned-closeout-timestamps.md`
- `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition.md`
- `adr-2026-08-08-single-adr-approval-parser-three-rungs.md`
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md`
- `adr-2026-08-09-adr-contradiction-detection-in-two-halves.md`
- `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal.md`
- `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md`
- `adr-2026-08-09-checkout-is-sole-version-identity-authority.md`
- `adr-2026-08-09-conductor-block-single-source-of-truth.md`
- `adr-2026-08-09-declared-pattern-replication-in-build.md`
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md`
- `adr-2026-08-09-hook-owned-containment-event-ledger.md`
- `adr-2026-08-09-legacy-json-seed-migration-rule.md`
- `adr-2026-08-09-non-blocking-plan-scope-containment.md`
- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md`
- `adr-2026-08-09-operator-only-scoped-artifact-reseal.md`
- `adr-2026-08-09-recorded-red-exception-for-remediation.md`
- `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag.md`
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
- `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md`
- `adr-2026-08-13-durable-base-advance-attribution.md`
- `adr-2026-08-13-markdown-default-inversion.md`
- `adr-2026-08-13-stable-build-review-finding-dispositions.md`
- `adr-2026-08-14-retire-build-review-wiring-rubric.md`
- `adr-2026-08-16-closed-build-review-finding-vocabularies.md`
- `adr-2026-08-16-restore-the-current-head-publication-fence.md`
- `adr-2026-08-17-framework-agnostic-tautology-scoped-run.md`
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
- `adr-2026-08-31-kickback-ledger-read-fails-closed.md`
- `adr-2026-09-02-adr-decision-citability-contract.md`
- `adr-2026-09-05-gh-cli-version-floor-and-environment-gate.md`
- `adr-2026-09-06-engine-owned-test-quality-scope.md`
- `adr-2026-09-06-inbound-intake-trust-boundary.md`
- `adr-2026-09-06-reopened-task-resolution.md`
- `adr-2026-09-07-durable-prd-widening-decision-reconciliation.md`
- `adr-2026-09-10-separate-custom-review-coverage-identity.md`
- `adr-2026-09-11-finish-mergeability-respects-active-review-inputs.md`

### Excluded: fully superseded (9)

- `adr-2026-07-04-operator-park-marker.md`
- `adr-2026-07-21-completeness-as-build-review-rubric.md`
- `adr-2026-07-25-content-addressed-full-suite-proof.md`
- `adr-2026-07-30-finish-only-mergeability-gate.md`
- `adr-2026-08-12-removal-anchored-tautology-exemption.md`
- `adr-2026-08-15-verify-only-anchored-tautology-exemption.md`
- `adr-2026-08-16-preservation-anchored-completeness-exemption.md`
- `adr-2026-08-29-build-review-remediate-case-adjudication.md`
- `adr-2026-08-29-operator-authorized-kickback-budget-recovery.md`
