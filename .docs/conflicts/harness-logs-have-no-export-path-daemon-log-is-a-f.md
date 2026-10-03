# Conflict Check: Configurable harness log export

**Date:** 2026-09-30
**Source:** jstoup111/ai-conductor#1935
**Stories:** [Accepted Stories 1–12](../stories/harness-logs-have-no-export-path-daemon-log-is-a-f.md)
**ADR corpus:** repo_wide, explicitly configured in `.ai-conductor/config.yml`.
**Result:** PASS — zero unresolved blocking conflicts, zero degrading compromises, zero new resolutions.
**Implementation prerequisite:** #2870 remains open. A delivery dependency is not a contradiction in the accepted specification.

## Inventory and method

The content scan loaded all 518 story files, 61 specs, 307 prior conflict reports and 327 ADR files in this checkout. It screened subjects and passages for OTel/OTLP, event routing, log output, shared runtime state, configuration and attribution. One hundred story files, seven specs and 64 ADR files matched the initial telemetry/log/event vocabulary; filename and source-boundary review additionally included daemon feature tags, configuration-key consumers, the main-root resolver and lock ownership.

This is a repository-wide subject scan followed by detailed comparison of overlapping contracts, not a claim that every unrelated story pair was independently re-reviewed. Existing-versus-existing unrelated conflicts are outside this change. Every new story was compared against its overlapping story/ADR subjects below; the 66 pairs within the new set were checked for shared scenarios, with both directions evaluated when they shared behavior. The ADR disposition appendix records all examined and narrowed-out files. Partial/ambiguous supersessions were retained; no selected decision was discarded merely because an amendment exists.

The approved PRD and D27–D30 already settle the independent log control, replay policy, resource bounds, and ownership. The earlier durable-export conflict report was read: its gRPC default compatibility, health visibility, lease succession, disabled backlog and respawn resolutions remain intact.

## Contract comparisons

Each row records the two-directional check: implementing the new contract leaves the existing contract true, and preserving the existing contract leaves the new one achievable. Confidence is 98% for compatibility judgments based on the cited text; this is a design review, not runtime proof.

| Comparison | New stories | Why both contracts hold |
| --- | --- | --- |
| ADR-014 D1–D7 and `otel-observability.md` | 1, 2, 7, 8, 12 | Existing traces/metrics remain optional event-fed observers. D27–D30 explicitly add separately enabled logs. The original Phase-1 “unchanged emit sites” condition governed its trace/metric delivery scope; it does not prohibit later approved diagnostic event types. Logs-off introduces no log sender. |
| ADR-014 D8–D14, identity/static-attribute/dimension stories | 4, 7 | Log records may carry full feature identity while their Resource stays worker-stable. Existing trace resources, metric label sets, temporality and custom-attribute precedence do not change. |
| Durable-export Stories 1–6 and ADR-014 D15–D17 | 1, 7, 9, 12 | Reuse the completed runtime rather than implement it again. The 512 MiB existing trace/metric policy and new independent 64 MiB log cap apply to different retained data. Spool-disabled processes leave old data untouched; log consent further restricts log sends. |
| Durable default-on HTTP spool versus gRPC compatibility | 7, 11 | Logs' always-HTTP transport has its own endpoint when the parent is gRPC/file. No new restriction is imposed on parent `otel.protocol`, headers or spool defaults. |
| `authenticate-otlp-export-with-env-referenced-heade.md` | 3, 9, 11 | Same credential-reference syntax, no literal secret values, no secret diagnostics. Existing parent-header validation remains; the new log block has independent validation and sending-time resolution. |
| `operators-cannot-attach-their-own-metadata-to-expo.md` | 4, 7 | Logs inherit validated metadata without broadening allowed parent attributes. Conductor identity wins collisions. Existing byte/attribute-set promises concern trace/metric outputs and remain unchanged. |
| `daemon-dispatched-builds-emit-no-otel-telemetry-th.md` | 2, 7, 12 | Shared log wiring complements shared existing signal wiring. Per-feature span provider shutdown cannot stop the root log owner or shared delivery. |
| `daemon-log-feature-tags-254.md` | 4, 5, 6 | Local tags retain their 24-character display convention. Export captures immutable full ownership before formatting, so full remote identity does not alter local output. |
| Local kickback/progress/retry/staleness/noise stories | 2, 6, 10 | Existing local rendering, rotation, follow and suppression remain intact. Event-derived text is not recaptured as another occurrence. Delivery health is additive and rate-limited. |
| ADR event-sink registry and OTel handler-coverage stories | 2, 4, 10 | Add an explicit logs declaration and typed log projection; do not redefine existing render/persist/audit/otel/otelTrace decisions. Every new diagnostic/health event declares all sinks. |
| Wave-C persister and JSON-stdout stories | 2, 6 | Existing persistence/UI consumers retain their contracts; logs is another subscriber, not a replacement renderer. Capture only scoped harness diagnostics, not arbitrary stdout or subscriber JSON. |
| Shared lifecycle telemetry ADR | 2, 4, 5 | Use actual emitted lifecycle identity/timestamps; do not reconstruct timing from text or fabricate starts/outcomes. Preserve execution context while forwarding; logs do not record another metric/dispatch. |
| Dispatcher/executor seam D1/D8 | 1, 5, 9, 12 | Canonical policy and spool access remain owned by process/root adapters. Executors forward occurrences and cannot directly own shared-root configuration or delivery locks. Async-scoped attribution is preserved. |
| Main-root resolver and pidfile/lease ADRs | 1, 9, 11, 12 | Logs use the strict resolver without changing park-marker fallback semantics. Reuse the prerequisite delivery lease; do not create a new daemon/process lock or reclaim protocol. |
| Config-key consumer registry D4 | 1, 11 | Every new accepted log setting must name the independent resolver/wiring consumer. Existing known-key and unrelated project/user precedence checks retain their meaning. |
| Halt/pipeline-closeout/audit event-spine ADRs | 2, 4, 10 | New observations use the same union and persistence routes. Log projection changes neither existing audit mapping nor durable timing/cost authority. |
| Live-provider-stream ADR and scope exclusions | 2, 8 | Operational diagnostics can export while provider transcript chunks/dashboard snapshots remain excluded. Existing stream observation throttling/render decisions are unchanged. |

## New-story interaction review

| Shared scenario | Stories | Two-directional result |
| --- | --- | --- |
| Current consent versus durable replay | 1, 9, 11 | Retention alone is not permission. Matching current enabled policy is required before every send, including direct fallback and ownership changes. |
| Configuration inheritance versus independent signals | 1, 7, 11 | Only the log policy is canonical-root scoped; existing trace/metric resolution stays in its current scope. A log-only error cannot enter the fatal parent-validation path. |
| Complete local output versus remote size bounds | 4, 6, 8 | Remote normalization affects only the remote copy; required identity is never shortened. Local sinks receive the original content. |
| Coverage versus duplicate suppression | 2, 5, 6 | One event is one logical occurrence; two events with equal text remain two occurrences. Rendering suppression is scoped to rendering, not a global busy flag. |
| Remote progress versus write-first durability | 8, 9 | Admission returns without waiting for I/O; durable acknowledgment follows the asynchronous committed write. No crash-safety claim applies to unretained records. |
| Drop visibility versus recursive capture | 2, 8, 9, 10 | Delivery health is persisted/rendered but explicitly excluded from logs and diagnostic recapture; summaries aggregate losses without feeding another send. |
| Feature completion versus shared owner lifetime | 5, 9, 12 | A feature flush/stop cannot detach root listeners or release another owner's transport reference. Deferred diagnostics keep immutable source identity. |
| Time limits versus final output and retention | 2, 8, 9, 12 | Final diagnostics participate in a single bounded best-effort flush. No criterion promises unlimited wait or lossless retention of unflushed memory. |
| Vendor recipes versus credential safety | 3, 9, 11 | Header-based authentication permits rejecting secret-bearing endpoint URL components. Configuration does not introduce vendor adapters or file collection. |

## Six conflict classes

- **Contradiction:** none after applying the already-approved scope distinctions above.
- **Behavioral overlap:** same source events feed separate signals; local rendering and existing signal semantics remain unchanged.
- **State conflict:** disabled/invalid/enabled log policy represents all specified cases; retained-but-unauthorized is an unsent state.
- **Resource contention:** one prerequisite lease/runtime, separate log byte allowance, immutable source context.
- **Sequencing:** durable transport must land first (#2870); no dependency from that implementation back to log export.
- **Oscillation:** disabling logs never requires disabling other signals; failure reporting never requires exporting its own failure; bounded shutdown never requires an unlimited durability promise.

## Plan constraints carried forward

1. Keep root config reads and log transport in the owner/adapters, never per-feature executor code.
2. Register log config consumers and sink declarations mechanically.
3. Own each cross-boundary proof in one implementation task. Trace/metric and local-output preservation checks must run through the changed wiring, not just isolated log helpers.
4. Preserve the prerequisite runtime's lease/classifier implementation. Do not absorb unfinished #2870 tasks into this plan.
5. Use source-correct file hints: the union is in `src/conductor/src/types/events.ts`; emission metadata is in `ui/events.ts`; the registry is `engine/event-sinks.ts`; terminal subscription is `ui/subscriber.ts`.

## Verify-Claims Verdict

CLEAR. Scope and behavior choices are operator-approved. Compatibility findings above are grounded in the actual overlapping contracts, including the prior durable-export resolutions. The prerequisite's future availability is not asserted: the plan must retain it as a blocker. No new product/architecture decision or compromise needs approval.

No review-required conflict marker is written: the check found no new conflict or resolution.


## ADR corpus dispositions

“Examined” means selected at subject/passage level; the directly interacting obligations are compared above. “Narrowed out” means no affected log-export behavior or resource was found. Supersession alone was not used to narrow this inventory.

<details>
<summary>Examined: 67 ADR files</summary>

- `adr-010-pidfile-lock-daemon-liveness`
- `adr-014-otel-observability-exporter`
- `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting`
- `adr-2026-07-03-reactive-model-fallback-ladder`
- `adr-2026-07-04-event-driven-halt-clear-wake`
- `adr-2026-07-04-kickback-event-emission-and-log-prominence`
- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`
- `adr-2026-07-05-daemon-rate-limit-episode-coordinator`
- `adr-2026-07-06-installed-root-resolution-for-global-writes`
- `adr-2026-07-07-audit-trail-event-sink`
- `adr-2026-07-07-finish-record-primitive`
- `adr-2026-07-10-intra-step-build-progress-events`
- `adr-2026-07-10-observed-close-watch-registry`
- `adr-2026-07-10-park-marker-main-root-resolution`
- `adr-2026-07-10-session-hook-task-stamping`
- `adr-2026-07-12-rebase-evidence-stamp-translation`
- `adr-2026-07-21-engine-owned-acceptance-red-execution`
- `adr-2026-07-22-canonical-tracker-client-seam`
- `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record`
- `adr-2026-07-23-session-hook-repair-before-halt`
- `adr-2026-07-25-content-addressed-full-suite-proof`
- `adr-2026-07-26-daemon-decide-preseed-ownership`
- `adr-2026-07-26-event-sink-registry-exhaustiveness`
- `adr-2026-07-26-protected-artifact-seal-rebaseline`
- `adr-2026-07-27-cold-start-within-step-retries`
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main`
- `adr-2026-07-29-engine-observed-provider-time-partition`
- `adr-2026-08-03-build-repair-member-reuse-validity`
- `adr-2026-08-06-publication-progress-is-its-own-disposition`
- `adr-2026-08-08-finish-human-required-halt-rendering`
- `adr-2026-08-08-pipeline-owned-closeout-timestamps`
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance`
- `adr-2026-08-09-hook-owned-containment-event-ledger`
- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`
- `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`
- `adr-2026-08-09-worktree-local-provider-scratch`
- `adr-2026-08-11-deprecated-no-op-step-retirement`
- `adr-2026-08-11-halt-events-ride-the-persisted-spine`
- `adr-2026-08-13-durable-base-advance-attribution`
- `adr-2026-08-13-stable-build-review-finding-dispositions`
- `adr-2026-08-15-verify-only-anchored-tautology-exemption`
- `adr-2026-08-16-closed-build-review-finding-vocabularies`
- `adr-2026-08-16-preservation-anchored-completeness-exemption`
- `adr-2026-08-17-framework-agnostic-tautology-scoped-run`
- `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`
- `adr-2026-08-19-live-provider-stream-observation`
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port`
- `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind`
- `adr-2026-08-21-engine-identity-in-build-review-cache-key`
- `adr-2026-08-23-committed-halt-record`
- `adr-2026-08-24-over-scope-decision-block-and-durable-refusals`
- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal`
- `adr-2026-08-26-music-vocabulary-player-composer-rename`
- `adr-2026-08-26-setup-once-per-worktree-marker`
- `adr-2026-08-27-daemon-dispatcher-executor-seam`
- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode`
- `adr-2026-08-29-build-review-remediate-case-adjudication`
- `adr-2026-08-29-operator-authorized-kickback-budget-recovery`
- `adr-2026-08-31-coverage-binding-judge-step`
- `adr-2026-09-06-inbound-intake-trust-boundary`
- `adr-2026-09-10-separate-custom-review-coverage-identity`
- `adr-2026-09-10-shared-step-lifecycle-telemetry`
- `adr-2026-09-11-github-operation-ownership`
- `adr-2026-09-11-selective-post-rebase-verification`
- `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery`
- `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history`
- `adr-2026-09-29-plan-slice-manifest`

</details>

<details>
<summary>Narrowed out: 260 ADR files</summary>

- `adr-002-engineer-store-and-retro-redirect`
- `adr-003-registry-write-and-integration`
- `adr-005-non-autonomy-and-read-only-governor`
- `adr-006-flywheel-lesson-selection-and-provenance`
- `adr-008-agent-hosted-loop-and-in-chat-authoring`
- `adr-009-intake-adapter-port`
- `adr-011-async-intake-queue-and-github-source`
- `adr-012-durable-intake-ledger-sole-dedup-authority`
- `adr-015-daemon-pr-labeling-sweep`
- `adr-2026-06-29-architecture-before-stories-convergent-kickback`
- `adr-2026-06-29-brainstorm-rename-migration`
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
- `adr-2026-07-01-machine-scoped-operator-identity`
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
- `adr-2026-07-03-version-gate-semver-escalation`
- `adr-2026-07-04-auth-failure-park-and-poll`
- `adr-2026-07-04-autoresolve-state-and-config`
- `adr-2026-07-04-claim-time-delivery-evidence-guard`
- `adr-2026-07-04-durable-pause-marker`
- `adr-2026-07-04-operator-park-marker`
- `adr-2026-07-04-park-unpark-cli-verbs`
- `adr-2026-07-04-pending-restart-queue`
- `adr-2026-07-04-resolution-worktree-lifecycle`
- `adr-2026-07-04-respawn-in-place-restart`
- `adr-2026-07-04-versioned-engine-store-atomic-flip`
- `adr-2026-07-05-engine-owned-task-status`
- `adr-2026-07-05-halt-pr-presentation-reliability`
- `adr-2026-07-05-retry-as-escalation-ladder`
- `adr-2026-07-05-standalone-bin-update`
- `adr-2026-07-06-daemon-false-ship-guard`
- `adr-2026-07-06-manual-test-fail-routing`
- `adr-2026-07-06-migration-gate-waiver`
- `adr-2026-07-06-stale-engine-respawn-in-place`
- `adr-2026-07-07-daemon-owned-build-credential`
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
- `adr-2026-07-10-retire-migration-grandfather`
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
- `adr-2026-07-12-wired-into-contract`
- `adr-2026-07-12-wiring-check-gate`
- `adr-2026-07-13-kickback-build-no-op-escalation`
- `adr-2026-07-13-park-all-dispatch-paths`
- `adr-2026-07-13-retry-classify-rerun-vs-route`
- `adr-2026-07-13-session-fresh-verdict-artifacts`
- `adr-2026-07-17-verify-only-judged-closure`
- `adr-2026-07-20-bounded-dirname-path-corroboration`
- `adr-2026-07-20-ci-fix-dispatch-via-steprunner`
- `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification`
- `adr-2026-07-20-post-rebase-delta-aware-invalidation`
- `adr-2026-07-21-completeness-as-build-review-rubric`
- `adr-2026-07-21-decide-time-unmerged-overlap-scan`
- `adr-2026-07-21-demote-task-stamping-to-telemetry`
- `adr-2026-07-21-intake-only-enforcement`
- `adr-2026-07-21-no-diff-task-evidence-stamp`
- `adr-2026-07-21-owner-stamped-at-authoring`
- `adr-2026-07-21-s-tier-pipeline-knobs`
- `adr-2026-07-21-serena-removal-path`
- `adr-2026-07-22-attempts-counter-on-crash-recovery`
- `adr-2026-07-22-auth-failure-classification-observed-401-patterns`
- `adr-2026-07-22-build-dispatch-json-usage-capture`
- `adr-2026-07-22-canonical-tagged-source-ref`
- `adr-2026-07-22-coherence-gate-placement-and-validation-split`
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim`
- `adr-2026-07-22-daemon-level-missing-credential-gate`
- `adr-2026-07-22-examples-state-isolation`
- `adr-2026-07-22-gate-evidence-code-validity-on-redispatch`
- `adr-2026-07-22-headless-vs-guided-examples`
- `adr-2026-07-22-heartbeat-lease-deferred`
- `adr-2026-07-22-intake-closed-issue-reconciliation`
- `adr-2026-07-22-origin-refresh-before-engine-rebuild`
- `adr-2026-07-22-per-task-work-happened-floor`
- `adr-2026-07-22-phase-scoped-docs-write-guard`
- `adr-2026-07-22-requeue-claimed-distinct-from-reopen`
- `adr-2026-07-22-stale-claim-staleness-window-default`
- `adr-2026-07-22-token-liveness-probe-via-cli-invocation`
- `adr-2026-07-23-build-review-fresh-base-disposition`
- `adr-2026-07-23-commit-movement-liveness-floor`
- `adr-2026-07-23-intake-label-authority-scoped-replace`
- `adr-2026-07-23-trailer-union-build-step-routing`
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
- `adr-2026-07-25-custom-step-completion-artifacts`
- `adr-2026-07-25-fail-closed-durable-shipment-evidence`
- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation`
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation`
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound`
- `adr-2026-07-26-rebase-tail-current-branch-before-publication`
- `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates`
- `adr-2026-07-27-ancestry-proven-park-reconciliation`
- `adr-2026-07-27-codex-never-resumes-a-harness-minted-session`
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state`
- `adr-2026-07-27-daemon-decide-kickback-halt`
- `adr-2026-07-27-project-config-scaffolder`
- `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`
- `adr-2026-07-28-feature-aware-artifact-resolution`
- `adr-2026-07-28-total-halt-classification-legacy-boundary`
- `adr-2026-07-29-codex-readiness-probe-failure-disposition`
- `adr-2026-07-29-deterministic-build-verification-fanout`
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
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts`
- `adr-2026-08-04-live-tier-provisions-its-own-provider-home`
- `adr-2026-08-04-unresolved-step-command-fails-by-name`
- `adr-2026-08-05-blocked-classification-after-dedup`
- `adr-2026-08-05-blocked-is-a-distinct-state-from-halted`
- `adr-2026-08-05-build-settle-outcome-stamp`
- `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`
- `adr-2026-08-05-provenance-based-protected-artifact-inheritance`
- `adr-2026-08-05-token-first-stories-reference-normalization`
- `adr-2026-08-05-worktree-classification-evidence-derived-reasons`
- `adr-2026-08-06-bounded-progress-allowance-for-finish-publication`
- `adr-2026-08-06-honest-park-termination-boundary`
- `adr-2026-08-07-project-teardown-hook-contract-and-containment`
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts`
- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization`
- `adr-2026-08-07-worktree-removal-coverage-guard`
- `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition`
- `adr-2026-08-08-single-adr-approval-parser-three-rungs`
- `adr-2026-08-09-adr-contradiction-detection-in-two-halves`
- `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`
- `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config`
- `adr-2026-08-09-checkout-is-sole-version-identity-authority`
- `adr-2026-08-09-conductor-block-single-source-of-truth`
- `adr-2026-08-09-declared-pattern-replication-in-build`
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`
- `adr-2026-08-09-legacy-json-seed-migration-rule`
- `adr-2026-08-09-non-blocking-plan-scope-containment`
- `adr-2026-08-09-operator-only-scoped-artifact-reseal`
- `adr-2026-08-09-recorded-red-exception-for-remediation`
- `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`
- `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator`
- `adr-2026-08-09-seal-rotation-authorship-predicate`
- `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag`
- `adr-2026-08-12-cumulative-build-review-convergence-bound`
- `adr-2026-08-12-execution-lifecycle-completeness-for-timing`
- `adr-2026-08-12-fail-closed-intake-ledger-durability`
- `adr-2026-08-12-live-provider-coverage-from-plugin-registry`
- `adr-2026-08-12-operator-reseal-as-second-scope-justification`
- `adr-2026-08-12-per-provider-live-smoke-legs`
- `adr-2026-08-12-removal-anchored-tautology-exemption`
- `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns`
- `adr-2026-08-13-engine-managed-build-review-rubric-branches`
- `adr-2026-08-13-markdown-default-inversion`
- `adr-2026-08-14-retire-build-review-wiring-rubric`
- `adr-2026-08-16-restore-the-current-head-publication-fence`
- `adr-2026-08-17-structural-live-checkout-containment`
- `adr-2026-08-18-content-anchored-finding-reference-schema`
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`
- `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope`
- `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch`
- `adr-2026-08-21-review-bound-by-plan-done-when-criteria`
- `adr-2026-08-22-as-built-review-runs-always-with-plan-gap`
- `adr-2026-08-22-build-review-opt-in-rubric-container`
- `adr-2026-08-22-done-when-evidence-at-task-close`
- `adr-2026-08-22-one-owner-per-review-question`
- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`
- `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote`
- `adr-2026-08-23-criterion-layer-is-structural-at-land`
- `adr-2026-08-23-diff-locality-is-an-authored-disposition`
- `adr-2026-08-24-evidentiary-defects-are-not-waivable`
- `adr-2026-08-24-one-dispatch-member-on-the-provider-contract`
- `adr-2026-08-24-refused-step-status`
- `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope`
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`
- `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot`
- `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity`
- `adr-2026-08-26-remove-retrospectives-one-shot`
- `adr-2026-08-26-shared-coherence-parser-at-discovery`
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`
- `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded`
- `adr-2026-08-30-shared-plan-task-reference-resolver`
- `adr-2026-08-31-kickback-ledger-read-fails-closed`
- `adr-2026-09-02-adr-decision-citability-contract`
- `adr-2026-09-05-gh-cli-version-floor-and-environment-gate`
- `adr-2026-09-06-engine-owned-test-quality-scope`
- `adr-2026-09-06-reopened-task-resolution`
- `adr-2026-09-07-durable-prd-widening-decision-reconciliation`
- `adr-2026-09-10-portable-build-review-policy`
- `adr-2026-09-11-finish-mergeability-respects-active-review-inputs`
- `adr-2026-09-11-immutable-state-lease-recovery-succession`
- `adr-2026-09-20-halt-resolution-queue-derived-from-markers`
- `adr-2026-09-20-operator-launched-sessions-retain-conductor-authority`
- `adr-2026-09-23-engine-git-guard-on-agent-path`
- `adr-2026-09-23-one-owner-for-accepted-story-readability`
- `adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability`
- `adr-2026-09-24-project-owned-pr-body-regions`
- `adr-2026-09-28-skills-may-bundle-executable-helpers`

</details>

