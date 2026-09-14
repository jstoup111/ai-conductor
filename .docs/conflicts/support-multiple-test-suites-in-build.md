# Conflict Check: Support multiple test suites in BUILD

Date: 2026-09-11
Source: jstoup111/ai-conductor#2358
Result: PASS — zero blocking conflicts, zero degrading conflicts, zero conflict resolutions.

Operator approval: James Stoup approved this report in composer chat on 2026-09-11.

## Scope and method

The subject is the nine accepted stories in
`../stories/support-multiple-test-suites-in-build.md`, implementing the approved
PRD and architecture review. `conflict_check.adr_corpus` is `repo_wide` in the
project configuration. The inventory contains 485 story files, 55 specs,
314 ADR files, and 261 previous conflict reports. A corpus-wide subject scan
identified 55 story, 3 spec, 44 ADR, and 37 conflict-report candidates mentioning
the suite, scoped invocation, or aggregate proof. Counts describe the saved
inventory at this review, excluding this newly written report.

The scan is a discovery aid, not evidence of semantic compatibility. Relevant
acceptance text and governing decision sections were compared below. Incidental
mentions of running tests to validate unrelated behavior do not introduce suite
configuration, execution, evidence, or reuse obligations. Every ADR's disposition
is recorded in the appendix. Partial and ambiguous supersessions were retained
for subject selection; no ADR was excluded merely for containing “superseded.”

The six checks were contradiction, incompatible behavioral overlap, impossible
state, resource contention, sequencing, and oscillation. For shared behavior the
comparison asked in both directions whether satisfying one obligation prevents
the other. Confidence in the clean conclusion is 95%: the relevant contracts are
explicit, but a large historical corpus and concurrent branches limit certainty.

## Interactions among the new stories

Numbers below refer to the declared story numbers; each row covers that story
against every earlier story, accounting for all 36 unordered pairs.

| Story | Earlier stories | Two-directional result |
|---|---|---|
| 2 — Execution contexts | 1 | Validation admits only declarations the resolver can execute; shared defaults and entry overrides do not introduce a second list form. Both hold. |
| 3 — Serial execution | 1–2 | The complete list is validated before execution. Stopping at the first runtime failure cannot bypass validation of a later entry. Validating all entries does not require running all entries. Both hold. |
| 4 — Runner independence | 1–3 | Commands remain opaque to the engine; schema, directory, timeout, and exit handling do not require runner-output parsing. Serial execution does not assume a test framework. Both hold. |
| 5 — Aggregate evidence | 1–4 | An attempted prefix records execution without manufacturing results for entries not run. Only a complete successful prefix can attest to the whole list; the terminal failure remains fail-closed. Both hold. |
| 6 — Failure reporting | 1–5 | Reporting uses typed attempted results and the declared total. Bounded, redacted diagnostics preserve failed-entry identity without turning omitted output or unexecuted entries into success. Failure routing remains typed rather than derived from prose. Both hold. |
| 7 — Compatibility | 1–6 | Scalar and list declarations are mutually exclusive. Scalar/scoped v4 behavior remains intact; only list aggregate execution writes v5. Nonempty scoped selection and explicit empty-selection aggregate fallback remain separate routes. Both hold. |
| 8 — Fingerprints | 1–7 | List order, shape, and effective settings enter configuration identity without changing scalar serialization. Whole-project input observation covers each directory; entry order is not sorted away. Budget preservation cannot tolerate a configuration change. Both hold. |
| 9 — Shared verification | 1–8 | All callers use one verifier and one aggregate lock. Reuse requires a valid complete proof for the declaration and current inspection. Retries execute the entire list, so no partial-entry cache can bypass serial execution or proof completeness. Both hold. |

## Existing story and architecture interactions

| Existing contract | New stories | Comparison in both directions and result |
|---|---|---|
| `full-suite-verification-gate-940` and content-addressed-proof ADR | 1–9 | The approved #2358 amendments to D3 and D6 already permit the list and v5 evidence. The gate, single verifier, conservative inputs, atomic persistence, and fail-closed reuse remain. Legacy scalar examples remain valid. No further amendment is needed. |
| `deterministic-test-suite-step` and deterministic BUILD verification ADR | 3, 6, 9 | List entries are serial inside the existing single step, not new gate-loop members. The ADR's later removal of wiring_check and the BUILD group is retained. A list failure blocks build_review and retains the existing budget classification. No topology is resurrected. |
| `test-suite-re-runs-and-re-passes-the-full-suite-10` and drift-budget ADR | 7–9 | A configured nonempty scoped selection still uses scoped_command; an empty gate-derived selection explicitly routes to aggregate execution, now the declared list if present. The drift ledger remains caller-recorded after inspection. List edits enter unbudgetable project_config, while source drift follows existing declared budgets. Neither obligation defeats the other. |
| `build-review-repeats-aggregate-verification-despit` and scoped invocation ADR | 4, 7, 9 | Direct scoped invocation still refuses empty selectors and never silently widens. This is distinct from the verifier's explicit empty-selection fallback. Aggregate list support does not modify selector assembly, quoting, the placeholder, or direct scoped evidence behavior. |
| `build-review-rubric-dispositions-and-fan-out` and rubric-branch ADR | 5, 7, 9 | build_review consumes validated current green proof; it does not independently repeat the list. Counterfactual preflight continues to use its scoped interface, separate evidence, and existing scope rules. List support does not widen counterfactual selection or change the test-quality judgment. |
| `reclaim-orphaned-full-suite-lock-recovery-claims` | 3, 9 | The existing lock encloses the complete serial list. Claim recovery and live-owner exclusion are unchanged; competing callers re-inspect after obtaining that same lock. There is no per-entry lock or new contention channel. |
| `a-halted-feature-only-re-runs-when-a-human-clears-` and typed-failure routing | 3, 6 | A normal nonzero exit remains a semantic suite failure; timeout, signal, launch, and internal failures retain their existing infrastructure categories. More informative messages do not become routing inputs. Existing retry limits and kickback budgets remain authoritative. |
| `rebase-invalidated-test-suite-proof-halts-build-re` and tree-attesting gates ADR | 8–9 | Dispatch and rebase inspection still compute current proof validity. Reading remains side-effect-free, and a persisted step status cannot stand in for evidence. A valid list proof can be reused by the same predicate; malformed or stale proof cannot. |
| BUILD-repair reuse ADR and post-rebase invalidation ADR | 8–9 | Repair re-dispatch still asks the member's own verifier. The observed input surface is not narrowed to one directory or the feature diff. New configuration identity changes force execution; permitted drift is judged only after observation under the already-approved policy. |
| `run-the-harness-integrity-suite-in-build-s-test-su` (#658) | 1–4, 7 | That feature configures this repository's Vitest and integrity commands after generic engine support exists. #2358 supplies the prerequisite without editing this repository's active suite configuration. No reverse dependency or framework-specific engine behavior is introduced. |
| `auto-resolve-open-pr-conflicts` | 7, 9 | The separate mergeable_autoresolve.suite_command and post-mutation checks remain independent. This feature does not replace them with aggregate-cache reuse. The CI-repair caller that already uses the shared verifier continues through that adapter. |
| Event-sink registry ADR | 6 | Optional terminal list results extend test_suite_verification on the existing emitter/persister spine. Sink decisions are explicit; rendering lists does not require raw output in events or a parallel event file. Legacy freshness-only events remain quiet. |
| Config consumer registry ADR | 1–2 | The new accepted key must declare the actual resolver/executor consumer in the existing registry. Schema acceptance and runtime consumption ship together; no runtime grep or independent config loader is introduced. |
| Scoped-run release surface ADR | 7 | This feature needs no bin/conduct, settings.json, hook, or skill-link change. The scoped CLI interface remains intact, and release automation retains CHANGELOG/VERSION ownership. Its historical release disposition applies to that feature, not a new waiver here. |
| Engine-owned test-quality scope ADR | 4, 7 | Runner-agnostic aggregate execution does not change the rubric's parser, marker scope, counterfactual selection, or judgment. Aggregate tests remain the broader regression authority; their success is not promoted to proof of individual assertion sensitivity. |

Previous report `test-suite-re-runs-and-re-passes-the-full-suite-10.md` already
resolved the mode-specific tension between earlier aggregate-only gate language
and scoped verification. Those dated amendments are part of the baseline, not
new conflicts to reopen. The current design preserves their route distinction.
Other prior reports with incidental verification mentions do not supply an
opposing requirement for the new list.

## Boundaries carried into planning

Keep one shared verifier, aggregate lock, input observer, and event spine. Do not
add runner adapters, per-entry caches, gate-loop members, or a parallel telemetry
channel. Preserve scalar fingerprint bytes and v4 proof compatibility. Reject
partial or contradictory v5 evidence. Keep diagnostics redacted and bounded.
Preserve typed failure routing and the difference between a direct empty scoped
request and the verifier's explicit aggregate fallback.

The approved architecture review also identified concurrent file overlap with
`spec/daemon-self-host-guardrails` and `spec/self-host-phase6-wiring`. This is
integration coordination, not a demonstrated requirement conflict; refresh the
overlap check against the plan's exact file union before landing.

The PRD keeps documentation upkeep outside its functional-requirements section.
The approved upkeep obligation accompanies implementation without inventing a
documentation-only story/task.

No conflict-resolution ADR or conditional conflict-review marker is required.
Composer's separate operator approval gate still applies to this output.

## ADR inventory

“Examined” means the relevant decision text was compared above. “Narrowed out”
means its subject does not govern this change; incidental mentions of tests or
suite execution are not a shared behavioral contract. The inventory deliberately
lists every ADR file, including uncertain statuses, rather than silently treating
unclear or partial supersession as full retirement.

| ADR | Disposition |
|---|---|
| [adr-002-engineer-store-and-retro-redirect](../decisions/adr-002-engineer-store-and-retro-redirect.md) | Narrowed out — different decision subject |
| [adr-003-registry-write-and-integration](../decisions/adr-003-registry-write-and-integration.md) | Narrowed out — different decision subject |
| [adr-005-non-autonomy-and-read-only-governor](../decisions/adr-005-non-autonomy-and-read-only-governor.md) | Narrowed out — different decision subject |
| [adr-006-flywheel-lesson-selection-and-provenance](../decisions/adr-006-flywheel-lesson-selection-and-provenance.md) | Narrowed out — different decision subject |
| [adr-008-agent-hosted-loop-and-in-chat-authoring](../decisions/adr-008-agent-hosted-loop-and-in-chat-authoring.md) | Narrowed out — different decision subject |
| [adr-009-intake-adapter-port](../decisions/adr-009-intake-adapter-port.md) | Narrowed out — different decision subject |
| [adr-010-pidfile-lock-daemon-liveness](../decisions/adr-010-pidfile-lock-daemon-liveness.md) | Narrowed out — different decision subject |
| [adr-011-async-intake-queue-and-github-source](../decisions/adr-011-async-intake-queue-and-github-source.md) | Narrowed out — different decision subject |
| [adr-012-durable-intake-ledger-sole-dedup-authority](../decisions/adr-012-durable-intake-ledger-sole-dedup-authority.md) | Narrowed out — different decision subject |
| [adr-014-otel-observability-exporter](../decisions/adr-014-otel-observability-exporter.md) | Narrowed out — different decision subject |
| [adr-015-daemon-pr-labeling-sweep](../decisions/adr-015-daemon-pr-labeling-sweep.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-architecture-before-stories-convergent-kickback](../decisions/adr-2026-06-29-architecture-before-stories-convergent-kickback.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-brainstorm-rename-migration](../decisions/adr-2026-06-29-brainstorm-rename-migration.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting](../decisions/adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-explore-prd-split-track-in-explore](../decisions/adr-2026-06-29-explore-prd-split-track-in-explore.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration](../decisions/adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-memory-resilience-write-fallback-and-reconcile](../decisions/adr-2026-06-29-memory-resilience-write-fallback-and-reconcile.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-per-project-memory-provider-selection](../decisions/adr-2026-06-29-per-project-memory-provider-selection.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-per-provider-retrieval-guidance-location](../decisions/adr-2026-06-29-per-provider-retrieval-guidance-location.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-platform-adoption-and-removal-surface](../decisions/adr-2026-06-29-platform-adoption-and-removal-surface.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-rebase-conflict-resolution-dispatch](../decisions/adr-2026-06-29-rebase-conflict-resolution-dispatch.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-safe-reversible-memory-migration](../decisions/adr-2026-06-29-safe-reversible-memory-migration.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-shared-memory-store-placement-and-durability](../decisions/adr-2026-06-29-shared-memory-store-placement-and-durability.md) | Narrowed out — different decision subject |
| [adr-2026-06-29-track-marker-location](../decisions/adr-2026-06-29-track-marker-location.md) | Narrowed out — different decision subject |
| [adr-2026-06-30-background-intake-brain-loop](../decisions/adr-2026-06-30-background-intake-brain-loop.md) | Narrowed out — different decision subject |
| [adr-2026-06-30-engineer-worktree-authoring-isolation](../decisions/adr-2026-06-30-engineer-worktree-authoring-isolation.md) | Narrowed out — different decision subject |
| [adr-2026-06-30-grandfather-cutover-merge-time](../decisions/adr-2026-06-30-grandfather-cutover-merge-time.md) | Narrowed out — different decision subject |
| [adr-2026-06-30-halt-based-release-gates](../decisions/adr-2026-06-30-halt-based-release-gates.md) | Narrowed out — different decision subject |
| [adr-2026-06-30-origin-seeded-intake-routing](../decisions/adr-2026-06-30-origin-seeded-intake-routing.md) | Narrowed out — different decision subject |
| [adr-2026-06-30-owner-gate-identity-resolution](../decisions/adr-2026-06-30-owner-gate-identity-resolution.md) | Narrowed out — different decision subject |
| [adr-2026-06-30-owner-provenance-recording](../decisions/adr-2026-06-30-owner-provenance-recording.md) | Narrowed out — different decision subject |
| [adr-2026-06-30-sandbox-build-isolation](../decisions/adr-2026-06-30-sandbox-build-isolation.md) | Narrowed out — different decision subject |
| [adr-2026-06-30-self-host-detection-seam](../decisions/adr-2026-06-30-self-host-detection-seam.md) | Narrowed out — different decision subject |
| [adr-2026-07-01-machine-scoped-operator-identity](../decisions/adr-2026-07-01-machine-scoped-operator-identity.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-daemon-auto-restart-stale-engine](../decisions/adr-2026-07-03-daemon-auto-restart-stale-engine.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-dependency-fail-closed-and-cache](../decisions/adr-2026-07-03-dependency-fail-closed-and-cache.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-dependency-gate-backlog-waiting-channel](../decisions/adr-2026-07-03-dependency-gate-backlog-waiting-channel.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-engineer-checkpoint-commits-idempotent-land](../decisions/adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-gated-snapshot-status-read-model](../decisions/adr-2026-07-03-gated-snapshot-status-read-model.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-gated-writeback-announcements](../decisions/adr-2026-07-03-gated-writeback-announcements.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-generated-model-table-single-source](../decisions/adr-2026-07-03-generated-model-table-single-source.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-halt-pr-rehabilitation-at-finish](../decisions/adr-2026-07-03-halt-pr-rehabilitation-at-finish.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-harness-daemon-profile](../decisions/adr-2026-07-03-harness-daemon-profile.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-issue-dependencies-api-surface](../decisions/adr-2026-07-03-issue-dependencies-api-surface.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-owner-gate-gated-channel](../decisions/adr-2026-07-03-owner-gate-gated-channel.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-post-rebase-force-with-lease](../decisions/adr-2026-07-03-post-rebase-force-with-lease.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-pr-timing-config-key](../decisions/adr-2026-07-03-pr-timing-config-key.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-pr-timing-self-host-precedence](../decisions/adr-2026-07-03-pr-timing-self-host-precedence.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-priority-fetch-fail-soft](../decisions/adr-2026-07-03-priority-fetch-fail-soft.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-priority-from-linked-issue-labels](../decisions/adr-2026-07-03-priority-from-linked-issue-labels.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-prose-to-link-migration](../decisions/adr-2026-07-03-prose-to-link-migration.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-reactive-model-fallback-ladder](../decisions/adr-2026-07-03-reactive-model-fallback-ladder.md) | Narrowed out — different decision subject |
| [adr-2026-07-03-version-gate-semver-escalation](../decisions/adr-2026-07-03-version-gate-semver-escalation.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-auth-failure-park-and-poll](../decisions/adr-2026-07-04-auth-failure-park-and-poll.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-autoresolve-state-and-config](../decisions/adr-2026-07-04-autoresolve-state-and-config.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-claim-time-delivery-evidence-guard](../decisions/adr-2026-07-04-claim-time-delivery-evidence-guard.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-durable-pause-marker](../decisions/adr-2026-07-04-durable-pause-marker.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-event-driven-halt-clear-wake](../decisions/adr-2026-07-04-event-driven-halt-clear-wake.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-kickback-event-emission-and-log-prominence](../decisions/adr-2026-07-04-kickback-event-emission-and-log-prominence.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-operator-park-marker](../decisions/adr-2026-07-04-operator-park-marker.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-park-unpark-cli-verbs](../decisions/adr-2026-07-04-park-unpark-cli-verbs.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-pending-restart-queue](../decisions/adr-2026-07-04-pending-restart-queue.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-resolution-worktree-lifecycle](../decisions/adr-2026-07-04-resolution-worktree-lifecycle.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-respawn-in-place-restart](../decisions/adr-2026-07-04-respawn-in-place-restart.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-versioned-engine-store-atomic-flip](../decisions/adr-2026-07-04-versioned-engine-store-atomic-flip.md) | Narrowed out — different decision subject |
| [adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep](../decisions/adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep.md) | Narrowed out — different decision subject |
| [adr-2026-07-05-daemon-rate-limit-episode-coordinator](../decisions/adr-2026-07-05-daemon-rate-limit-episode-coordinator.md) | Narrowed out — different decision subject |
| [adr-2026-07-05-engine-owned-task-status](../decisions/adr-2026-07-05-engine-owned-task-status.md) | Narrowed out — different decision subject |
| [adr-2026-07-05-halt-pr-presentation-reliability](../decisions/adr-2026-07-05-halt-pr-presentation-reliability.md) | Narrowed out — different decision subject |
| [adr-2026-07-05-retry-as-escalation-ladder](../decisions/adr-2026-07-05-retry-as-escalation-ladder.md) | Narrowed out — different decision subject |
| [adr-2026-07-05-standalone-bin-update](../decisions/adr-2026-07-05-standalone-bin-update.md) | Narrowed out — different decision subject |
| [adr-2026-07-06-daemon-false-ship-guard](../decisions/adr-2026-07-06-daemon-false-ship-guard.md) | Narrowed out — different decision subject |
| [adr-2026-07-06-installed-root-resolution-for-global-writes](../decisions/adr-2026-07-06-installed-root-resolution-for-global-writes.md) | Narrowed out — different decision subject |
| [adr-2026-07-06-manual-test-fail-routing](../decisions/adr-2026-07-06-manual-test-fail-routing.md) | Narrowed out — different decision subject |
| [adr-2026-07-06-migration-gate-waiver](../decisions/adr-2026-07-06-migration-gate-waiver.md) | Narrowed out — different decision subject |
| [adr-2026-07-06-stale-engine-respawn-in-place](../decisions/adr-2026-07-06-stale-engine-respawn-in-place.md) | Narrowed out — different decision subject |
| [adr-2026-07-07-audit-trail-event-sink](../decisions/adr-2026-07-07-audit-trail-event-sink.md) | Narrowed out — different decision subject |
| [adr-2026-07-07-daemon-owned-build-credential](../decisions/adr-2026-07-07-daemon-owned-build-credential.md) | Narrowed out — different decision subject |
| [adr-2026-07-07-finish-record-primitive](../decisions/adr-2026-07-07-finish-record-primitive.md) | Narrowed out — different decision subject |
| [adr-2026-07-07-ship-ci-feedback-loop](../decisions/adr-2026-07-07-ship-ci-feedback-loop.md) | Narrowed out — different decision subject |
| [adr-2026-07-07-single-generation-stale-respawn](../decisions/adr-2026-07-07-single-generation-stale-respawn.md) | Narrowed out — different decision subject |
| [adr-2026-07-07-task-trailer-id-alias](../decisions/adr-2026-07-07-task-trailer-id-alias.md) | Narrowed out — different decision subject |
| [adr-2026-07-08-halt-issue-closure-sweep](../decisions/adr-2026-07-08-halt-issue-closure-sweep.md) | Narrowed out — different decision subject |
| [adr-2026-07-08-main-checkout-leak-triage-and-write-fence](../decisions/adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md) | Narrowed out — different decision subject |
| [adr-2026-07-08-post-rebase-gate-first-mechanical-reverify](../decisions/adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md) | Narrowed out — different decision subject |
| [adr-2026-07-09-deterministic-evidence-attribution-enforcement](../decisions/adr-2026-07-09-deterministic-evidence-attribution-enforcement.md) | Narrowed out — different decision subject |
| [adr-2026-07-09-setup-failure-triage](../decisions/adr-2026-07-09-setup-failure-triage.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-concurrent-group-core](../decisions/adr-2026-07-10-concurrent-group-core.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-daemon-stall-remediation](../decisions/adr-2026-07-10-daemon-stall-remediation.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-evidence-range-anchor-resolution](../decisions/adr-2026-07-10-evidence-range-anchor-resolution.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-inline-work-attribution-enforcement](../decisions/adr-2026-07-10-inline-work-attribution-enforcement.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-intake-claim-priority-banding](../decisions/adr-2026-07-10-intake-claim-priority-banding.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-intra-step-build-progress-events](../decisions/adr-2026-07-10-intra-step-build-progress-events.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-observed-close-watch-registry](../decisions/adr-2026-07-10-observed-close-watch-registry.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-park-marker-main-root-resolution](../decisions/adr-2026-07-10-park-marker-main-root-resolution.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-retire-migration-grandfather](../decisions/adr-2026-07-10-retire-migration-grandfather.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-session-hook-task-stamping](../decisions/adr-2026-07-10-session-hook-task-stamping.md) | Narrowed out — different decision subject |
| [adr-2026-07-10-validation-group-join](../decisions/adr-2026-07-10-validation-group-join.md) | Narrowed out — different decision subject |
| [adr-2026-07-11-attribution-abstain-or-loud](../decisions/adr-2026-07-11-attribution-abstain-or-loud.md) | Narrowed out — different decision subject |
| [adr-2026-07-11-attribution-spot-audit-measurement](../decisions/adr-2026-07-11-attribution-spot-audit-measurement.md) | Narrowed out — different decision subject |
| [adr-2026-07-11-attribution-verdict-interface](../decisions/adr-2026-07-11-attribution-verdict-interface.md) | Narrowed out — different decision subject |
| [adr-2026-07-11-evidence-judge-cli-and-cutover](../decisions/adr-2026-07-11-evidence-judge-cli-and-cutover.md) | Narrowed out — different decision subject |
| [adr-2026-07-11-finish-step-engine-completion-machinery](../decisions/adr-2026-07-11-finish-step-engine-completion-machinery.md) | Narrowed out — different decision subject |
| [adr-2026-07-11-pipeline-state-durability](../decisions/adr-2026-07-11-pipeline-state-durability.md) | Narrowed out — different decision subject |
| [adr-2026-07-11-semantic-attribution-verification-lane](../decisions/adr-2026-07-11-semantic-attribution-verification-lane.md) | Narrowed out — different decision subject |
| [adr-2026-07-11-verdict-aware-resume-entry](../decisions/adr-2026-07-11-verdict-aware-resume-entry.md) | Narrowed out — different decision subject |
| [adr-2026-07-12-judged-attribution-verdict-persistence](../decisions/adr-2026-07-12-judged-attribution-verdict-persistence.md) | Narrowed out — different decision subject |
| [adr-2026-07-12-progress-aware-build-halt](../decisions/adr-2026-07-12-progress-aware-build-halt.md) | Narrowed out — different decision subject |
| [adr-2026-07-12-rebase-evidence-stamp-translation](../decisions/adr-2026-07-12-rebase-evidence-stamp-translation.md) | Narrowed out — different decision subject |
| [adr-2026-07-12-wired-into-contract](../decisions/adr-2026-07-12-wired-into-contract.md) | Narrowed out — different decision subject |
| [adr-2026-07-12-wiring-check-gate](../decisions/adr-2026-07-12-wiring-check-gate.md) | Narrowed out — different decision subject |
| [adr-2026-07-13-kickback-build-no-op-escalation](../decisions/adr-2026-07-13-kickback-build-no-op-escalation.md) | Narrowed out — different decision subject |
| [adr-2026-07-13-park-all-dispatch-paths](../decisions/adr-2026-07-13-park-all-dispatch-paths.md) | Narrowed out — different decision subject |
| [adr-2026-07-13-retry-classify-rerun-vs-route](../decisions/adr-2026-07-13-retry-classify-rerun-vs-route.md) | Narrowed out — different decision subject |
| [adr-2026-07-13-session-fresh-verdict-artifacts](../decisions/adr-2026-07-13-session-fresh-verdict-artifacts.md) | Narrowed out — different decision subject |
| [adr-2026-07-17-verify-only-judged-closure](../decisions/adr-2026-07-17-verify-only-judged-closure.md) | Narrowed out — different decision subject |
| [adr-2026-07-20-bounded-dirname-path-corroboration](../decisions/adr-2026-07-20-bounded-dirname-path-corroboration.md) | Narrowed out — different decision subject |
| [adr-2026-07-20-ci-fix-dispatch-via-steprunner](../decisions/adr-2026-07-20-ci-fix-dispatch-via-steprunner.md) | Narrowed out — different decision subject |
| [adr-2026-07-20-ci-fix-startup-preflight-and-error-classification](../decisions/adr-2026-07-20-ci-fix-startup-preflight-and-error-classification.md) | Narrowed out — different decision subject |
| [adr-2026-07-20-post-rebase-delta-aware-invalidation](../decisions/adr-2026-07-20-post-rebase-delta-aware-invalidation.md) | Examined — relevant retained decisions compared above |
| [adr-2026-07-21-completeness-as-build-review-rubric](../decisions/adr-2026-07-21-completeness-as-build-review-rubric.md) | Narrowed out — different decision subject |
| [adr-2026-07-21-decide-time-unmerged-overlap-scan](../decisions/adr-2026-07-21-decide-time-unmerged-overlap-scan.md) | Narrowed out — different decision subject |
| [adr-2026-07-21-demote-task-stamping-to-telemetry](../decisions/adr-2026-07-21-demote-task-stamping-to-telemetry.md) | Narrowed out — different decision subject |
| [adr-2026-07-21-engine-owned-acceptance-red-execution](../decisions/adr-2026-07-21-engine-owned-acceptance-red-execution.md) | Narrowed out — different decision subject |
| [adr-2026-07-21-intake-only-enforcement](../decisions/adr-2026-07-21-intake-only-enforcement.md) | Narrowed out — different decision subject |
| [adr-2026-07-21-no-diff-task-evidence-stamp](../decisions/adr-2026-07-21-no-diff-task-evidence-stamp.md) | Narrowed out — different decision subject |
| [adr-2026-07-21-owner-stamped-at-authoring](../decisions/adr-2026-07-21-owner-stamped-at-authoring.md) | Narrowed out — different decision subject |
| [adr-2026-07-21-s-tier-pipeline-knobs](../decisions/adr-2026-07-21-s-tier-pipeline-knobs.md) | Narrowed out — different decision subject |
| [adr-2026-07-21-serena-removal-path](../decisions/adr-2026-07-21-serena-removal-path.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-attempts-counter-on-crash-recovery](../decisions/adr-2026-07-22-attempts-counter-on-crash-recovery.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-auth-failure-classification-observed-401-patterns](../decisions/adr-2026-07-22-auth-failure-classification-observed-401-patterns.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-build-dispatch-json-usage-capture](../decisions/adr-2026-07-22-build-dispatch-json-usage-capture.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-canonical-tagged-source-ref](../decisions/adr-2026-07-22-canonical-tagged-source-ref.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-canonical-tracker-client-seam](../decisions/adr-2026-07-22-canonical-tracker-client-seam.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-coherence-gate-placement-and-validation-split](../decisions/adr-2026-07-22-coherence-gate-placement-and-validation-split.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-coherence-waiver-and-duplicate-claim](../decisions/adr-2026-07-22-coherence-waiver-and-duplicate-claim.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-daemon-level-missing-credential-gate](../decisions/adr-2026-07-22-daemon-level-missing-credential-gate.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-examples-state-isolation](../decisions/adr-2026-07-22-examples-state-isolation.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-gate-evidence-code-validity-on-redispatch](../decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-headless-vs-guided-examples](../decisions/adr-2026-07-22-headless-vs-guided-examples.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-heartbeat-lease-deferred](../decisions/adr-2026-07-22-heartbeat-lease-deferred.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-intake-closed-issue-reconciliation](../decisions/adr-2026-07-22-intake-closed-issue-reconciliation.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-origin-refresh-before-engine-rebuild](../decisions/adr-2026-07-22-origin-refresh-before-engine-rebuild.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-per-feature-cost-rollup-in-shipped-record](../decisions/adr-2026-07-22-per-feature-cost-rollup-in-shipped-record.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-per-task-work-happened-floor](../decisions/adr-2026-07-22-per-task-work-happened-floor.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-phase-scoped-docs-write-guard](../decisions/adr-2026-07-22-phase-scoped-docs-write-guard.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-requeue-claimed-distinct-from-reopen](../decisions/adr-2026-07-22-requeue-claimed-distinct-from-reopen.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-stale-claim-staleness-window-default](../decisions/adr-2026-07-22-stale-claim-staleness-window-default.md) | Narrowed out — different decision subject |
| [adr-2026-07-22-token-liveness-probe-via-cli-invocation](../decisions/adr-2026-07-22-token-liveness-probe-via-cli-invocation.md) | Narrowed out — different decision subject |
| [adr-2026-07-23-build-review-fresh-base-disposition](../decisions/adr-2026-07-23-build-review-fresh-base-disposition.md) | Narrowed out — different decision subject |
| [adr-2026-07-23-commit-movement-liveness-floor](../decisions/adr-2026-07-23-commit-movement-liveness-floor.md) | Narrowed out — different decision subject |
| [adr-2026-07-23-intake-label-authority-scoped-replace](../decisions/adr-2026-07-23-intake-label-authority-scoped-replace.md) | Narrowed out — different decision subject |
| [adr-2026-07-23-session-hook-repair-before-halt](../decisions/adr-2026-07-23-session-hook-repair-before-halt.md) | Narrowed out — different decision subject |
| [adr-2026-07-23-trailer-union-build-step-routing](../decisions/adr-2026-07-23-trailer-union-build-step-routing.md) | Narrowed out — different decision subject |
| [adr-2026-07-24-provider-aware-step-execution-fresh-session-scope](../decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md) | Narrowed out — different decision subject |
| [adr-2026-07-25-content-addressed-full-suite-proof](../decisions/adr-2026-07-25-content-addressed-full-suite-proof.md) | Examined — relevant retained decisions compared above |
| [adr-2026-07-25-custom-step-completion-artifacts](../decisions/adr-2026-07-25-custom-step-completion-artifacts.md) | Narrowed out — different decision subject |
| [adr-2026-07-25-fail-closed-durable-shipment-evidence](../decisions/adr-2026-07-25-fail-closed-durable-shipment-evidence.md) | Narrowed out — different decision subject |
| [adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation](../decisions/adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation.md) | Narrowed out — different decision subject |
| [adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation](../decisions/adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation.md) | Narrowed out — different decision subject |
| [adr-2026-07-26-cross-dispatch-kickback-livelock-bound](../decisions/adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md) | Narrowed out — different decision subject |
| [adr-2026-07-26-daemon-decide-preseed-ownership](../decisions/adr-2026-07-26-daemon-decide-preseed-ownership.md) | Narrowed out — different decision subject |
| [adr-2026-07-26-event-sink-registry-exhaustiveness](../decisions/adr-2026-07-26-event-sink-registry-exhaustiveness.md) | Examined — relevant retained decisions compared above |
| [adr-2026-07-26-protected-artifact-seal-rebaseline](../decisions/adr-2026-07-26-protected-artifact-seal-rebaseline.md) | Narrowed out — different decision subject |
| [adr-2026-07-26-rebase-tail-current-branch-before-publication](../decisions/adr-2026-07-26-rebase-tail-current-branch-before-publication.md) | Narrowed out — different decision subject |
| [adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates](../decisions/adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates.md) | Narrowed out — different decision subject |
| [adr-2026-07-27-ancestry-proven-park-reconciliation](../decisions/adr-2026-07-27-ancestry-proven-park-reconciliation.md) | Narrowed out — different decision subject |
| [adr-2026-07-27-codex-never-resumes-a-harness-minted-session](../decisions/adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md) | Narrowed out — different decision subject |
| [adr-2026-07-27-cold-start-within-step-retries](../decisions/adr-2026-07-27-cold-start-within-step-retries.md) | Narrowed out — different decision subject |
| [adr-2026-07-27-cost-unmetered-is-a-first-class-state](../decisions/adr-2026-07-27-cost-unmetered-is-a-first-class-state.md) | Narrowed out — different decision subject |
| [adr-2026-07-27-daemon-decide-kickback-halt](../decisions/adr-2026-07-27-daemon-decide-kickback-halt.md) | Narrowed out — different decision subject |
| [adr-2026-07-27-project-config-scaffolder](../decisions/adr-2026-07-27-project-config-scaffolder.md) | Narrowed out — different decision subject |
| [adr-2026-07-27-protected-artifact-seal-self-amendment-visibility](../decisions/adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md) | Narrowed out — different decision subject |
| [adr-2026-07-28-feature-aware-artifact-resolution](../decisions/adr-2026-07-28-feature-aware-artifact-resolution.md) | Narrowed out — different decision subject |
| [adr-2026-07-28-total-halt-classification-legacy-boundary](../decisions/adr-2026-07-28-total-halt-classification-legacy-boundary.md) | Narrowed out — different decision subject |
| [adr-2026-07-29-codex-readiness-probe-failure-disposition](../decisions/adr-2026-07-29-codex-readiness-probe-failure-disposition.md) | Narrowed out — different decision subject |
| [adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main](../decisions/adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main.md) | Narrowed out — different decision subject |
| [adr-2026-07-29-deterministic-build-verification-fanout](../decisions/adr-2026-07-29-deterministic-build-verification-fanout.md) | Examined — relevant retained decisions compared above |
| [adr-2026-07-29-engine-observed-provider-time-partition](../decisions/adr-2026-07-29-engine-observed-provider-time-partition.md) | Narrowed out — different decision subject |
| [adr-2026-07-29-operator-park-scheduling-unit-boundary](../decisions/adr-2026-07-29-operator-park-scheduling-unit-boundary.md) | Narrowed out — different decision subject |
| [adr-2026-07-29-ship-start-draft-pr](../decisions/adr-2026-07-29-ship-start-draft-pr.md) | Narrowed out — different decision subject |
| [adr-2026-07-30-contract-aware-same-file-wiring](../decisions/adr-2026-07-30-contract-aware-same-file-wiring.md) | Narrowed out — different decision subject |
| [adr-2026-07-30-finish-only-mergeability-gate](../decisions/adr-2026-07-30-finish-only-mergeability-gate.md) | Narrowed out — different decision subject |
| [adr-2026-07-30-pinned-remote-theme-for-pages-navigation](../decisions/adr-2026-07-30-pinned-remote-theme-for-pages-navigation.md) | Narrowed out — different decision subject |
| [adr-2026-07-30-provider-preparation-lifecycle-supervision](../decisions/adr-2026-07-30-provider-preparation-lifecycle-supervision.md) | Narrowed out — different decision subject |
| [adr-2026-08-01-bot-owned-release-pr](../decisions/adr-2026-08-01-bot-owned-release-pr.md) | Narrowed out — different decision subject |
| [adr-2026-08-01-conduct-state-mutation-port](../decisions/adr-2026-08-01-conduct-state-mutation-port.md) | Narrowed out — different decision subject |
| [adr-2026-08-01-engine-owned-resumable-finish-publication](../decisions/adr-2026-08-01-engine-owned-resumable-finish-publication.md) | Narrowed out — different decision subject |
| [adr-2026-08-01-engine-owned-scoped-test-invocation](../decisions/adr-2026-08-01-engine-owned-scoped-test-invocation.md) | Examined — relevant retained decisions compared above |
| [adr-2026-08-01-multi-proof-park-deletion-authority](../decisions/adr-2026-08-01-multi-proof-park-deletion-authority.md) | Narrowed out — different decision subject |
| [adr-2026-08-01-rebase-full-replay-intent-validation](../decisions/adr-2026-08-01-rebase-full-replay-intent-validation.md) | Narrowed out — different decision subject |
| [adr-2026-08-01-scoped-run-verb-release-surface](../decisions/adr-2026-08-01-scoped-run-verb-release-surface.md) | Examined — relevant retained decisions compared above |
| [adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate](../decisions/adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate.md) | Narrowed out — different decision subject |
| [adr-2026-08-02-live-tier-asserts-outcomes-not-scripts](../decisions/adr-2026-08-02-live-tier-asserts-outcomes-not-scripts.md) | Narrowed out — different decision subject |
| [adr-2026-08-02-plan-scope-containment-at-commit-boundary](../decisions/adr-2026-08-02-plan-scope-containment-at-commit-boundary.md) | Narrowed out — different decision subject |
| [adr-2026-08-03-build-repair-member-reuse-validity](../decisions/adr-2026-08-03-build-repair-member-reuse-validity.md) | Examined — relevant retained decisions compared above |
| [adr-2026-08-03-fail-closed-decide-entry](../decisions/adr-2026-08-03-fail-closed-decide-entry.md) | Narrowed out — different decision subject |
| [adr-2026-08-03-ledgered-per-block-migration-execution](../decisions/adr-2026-08-03-ledgered-per-block-migration-execution.md) | Narrowed out — different decision subject |
| [adr-2026-08-03-uncommitted-work-floor-under-build-completion](../decisions/adr-2026-08-03-uncommitted-work-floor-under-build-completion.md) | Narrowed out — different decision subject |
| [adr-2026-08-04-classify-before-spend-release-smoke-gate](../decisions/adr-2026-08-04-classify-before-spend-release-smoke-gate.md) | Narrowed out — different decision subject |
| [adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts](../decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md) | Narrowed out — different decision subject |
| [adr-2026-08-04-live-tier-provisions-its-own-provider-home](../decisions/adr-2026-08-04-live-tier-provisions-its-own-provider-home.md) | Narrowed out — different decision subject |
| [adr-2026-08-04-unresolved-step-command-fails-by-name](../decisions/adr-2026-08-04-unresolved-step-command-fails-by-name.md) | Narrowed out — different decision subject |
| [adr-2026-08-05-blocked-classification-after-dedup](../decisions/adr-2026-08-05-blocked-classification-after-dedup.md) | Narrowed out — different decision subject |
| [adr-2026-08-05-blocked-is-a-distinct-state-from-halted](../decisions/adr-2026-08-05-blocked-is-a-distinct-state-from-halted.md) | Narrowed out — different decision subject |
| [adr-2026-08-05-build-settle-outcome-stamp](../decisions/adr-2026-08-05-build-settle-outcome-stamp.md) | Narrowed out — different decision subject |
| [adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever](../decisions/adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever.md) | Narrowed out — different decision subject |
| [adr-2026-08-05-provenance-based-protected-artifact-inheritance](../decisions/adr-2026-08-05-provenance-based-protected-artifact-inheritance.md) | Narrowed out — different decision subject |
| [adr-2026-08-05-token-first-stories-reference-normalization](../decisions/adr-2026-08-05-token-first-stories-reference-normalization.md) | Narrowed out — different decision subject |
| [adr-2026-08-05-worktree-classification-evidence-derived-reasons](../decisions/adr-2026-08-05-worktree-classification-evidence-derived-reasons.md) | Narrowed out — different decision subject |
| [adr-2026-08-06-bounded-progress-allowance-for-finish-publication](../decisions/adr-2026-08-06-bounded-progress-allowance-for-finish-publication.md) | Narrowed out — different decision subject |
| [adr-2026-08-06-honest-park-termination-boundary](../decisions/adr-2026-08-06-honest-park-termination-boundary.md) | Narrowed out — different decision subject |
| [adr-2026-08-06-publication-progress-is-its-own-disposition](../decisions/adr-2026-08-06-publication-progress-is-its-own-disposition.md) | Narrowed out — different decision subject |
| [adr-2026-08-07-project-teardown-hook-contract-and-containment](../decisions/adr-2026-08-07-project-teardown-hook-contract-and-containment.md) | Narrowed out — different decision subject |
| [adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts](../decisions/adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.md) | Narrowed out — different decision subject |
| [adr-2026-08-07-smoke-gate-goes-live-without-precharacterization](../decisions/adr-2026-08-07-smoke-gate-goes-live-without-precharacterization.md) | Narrowed out — different decision subject |
| [adr-2026-08-07-worktree-removal-coverage-guard](../decisions/adr-2026-08-07-worktree-removal-coverage-guard.md) | Narrowed out — different decision subject |
| [adr-2026-08-08-finish-human-required-halt-rendering](../decisions/adr-2026-08-08-finish-human-required-halt-rendering.md) | Narrowed out — different decision subject |
| [adr-2026-08-08-pipeline-owned-closeout-timestamps](../decisions/adr-2026-08-08-pipeline-owned-closeout-timestamps.md) | Narrowed out — different decision subject |
| [adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition](../decisions/adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition.md) | Narrowed out — different decision subject |
| [adr-2026-08-08-single-adr-approval-parser-three-rungs](../decisions/adr-2026-08-08-single-adr-approval-parser-three-rungs.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance](../decisions/adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-adr-contradiction-detection-in-two-halves](../decisions/adr-2026-08-09-adr-contradiction-detection-in-two-halves.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-adr-layer-gated-by-committed-adr-signal](../decisions/adr-2026-08-09-adr-layer-gated-by-committed-adr-signal.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-bash-yaml-access-via-conduct-ts-config](../decisions/adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-checkout-is-sole-version-identity-authority](../decisions/adr-2026-08-09-checkout-is-sole-version-identity-authority.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-conductor-block-single-source-of-truth](../decisions/adr-2026-08-09-conductor-block-single-source-of-truth.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-declared-pattern-replication-in-build](../decisions/adr-2026-08-09-declared-pattern-replication-in-build.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic](../decisions/adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-hook-owned-containment-event-ledger](../decisions/adr-2026-08-09-hook-owned-containment-event-ledger.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-legacy-json-seed-migration-rule](../decisions/adr-2026-08-09-legacy-json-seed-migration-rule.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-non-blocking-plan-scope-containment](../decisions/adr-2026-08-09-non-blocking-plan-scope-containment.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-one-pr-per-branch-halt-is-a-state](../decisions/adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-operator-only-scoped-artifact-reseal](../decisions/adr-2026-08-09-operator-only-scoped-artifact-reseal.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-recorded-red-exception-for-remediation](../decisions/adr-2026-08-09-recorded-red-exception-for-remediation.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag](../decisions/adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-reseal-audit-rides-the-existing-event-spine](../decisions/adr-2026-08-09-reseal-audit-rides-the-existing-event-spine.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator](../decisions/adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-seal-rotation-authorship-predicate](../decisions/adr-2026-08-09-seal-rotation-authorship-predicate.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag](../decisions/adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag.md) | Narrowed out — different decision subject |
| [adr-2026-08-09-worktree-local-provider-scratch](../decisions/adr-2026-08-09-worktree-local-provider-scratch.md) | Narrowed out — different decision subject |
| [adr-2026-08-11-deprecated-no-op-step-retirement](../decisions/adr-2026-08-11-deprecated-no-op-step-retirement.md) | Narrowed out — different decision subject |
| [adr-2026-08-11-halt-events-ride-the-persisted-spine](../decisions/adr-2026-08-11-halt-events-ride-the-persisted-spine.md) | Narrowed out — different decision subject |
| [adr-2026-08-12-cumulative-build-review-convergence-bound](../decisions/adr-2026-08-12-cumulative-build-review-convergence-bound.md) | Narrowed out — different decision subject |
| [adr-2026-08-12-execution-lifecycle-completeness-for-timing](../decisions/adr-2026-08-12-execution-lifecycle-completeness-for-timing.md) | Narrowed out — different decision subject |
| [adr-2026-08-12-fail-closed-intake-ledger-durability](../decisions/adr-2026-08-12-fail-closed-intake-ledger-durability.md) | Narrowed out — different decision subject |
| [adr-2026-08-12-live-provider-coverage-from-plugin-registry](../decisions/adr-2026-08-12-live-provider-coverage-from-plugin-registry.md) | Narrowed out — different decision subject |
| [adr-2026-08-12-operator-reseal-as-second-scope-justification](../decisions/adr-2026-08-12-operator-reseal-as-second-scope-justification.md) | Narrowed out — different decision subject |
| [adr-2026-08-12-per-provider-live-smoke-legs](../decisions/adr-2026-08-12-per-provider-live-smoke-legs.md) | Narrowed out — different decision subject |
| [adr-2026-08-12-removal-anchored-tautology-exemption](../decisions/adr-2026-08-12-removal-anchored-tautology-exemption.md) | Narrowed out — different decision subject |
| [adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns](../decisions/adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md) | Narrowed out — different decision subject |
| [adr-2026-08-13-durable-base-advance-attribution](../decisions/adr-2026-08-13-durable-base-advance-attribution.md) | Narrowed out — different decision subject |
| [adr-2026-08-13-engine-managed-build-review-rubric-branches](../decisions/adr-2026-08-13-engine-managed-build-review-rubric-branches.md) | Examined — relevant retained decisions compared above |
| [adr-2026-08-13-markdown-default-inversion](../decisions/adr-2026-08-13-markdown-default-inversion.md) | Narrowed out — different decision subject |
| [adr-2026-08-13-stable-build-review-finding-dispositions](../decisions/adr-2026-08-13-stable-build-review-finding-dispositions.md) | Narrowed out — different decision subject |
| [adr-2026-08-14-retire-build-review-wiring-rubric](../decisions/adr-2026-08-14-retire-build-review-wiring-rubric.md) | Narrowed out — different decision subject |
| [adr-2026-08-15-verify-only-anchored-tautology-exemption](../decisions/adr-2026-08-15-verify-only-anchored-tautology-exemption.md) | Narrowed out — different decision subject |
| [adr-2026-08-16-closed-build-review-finding-vocabularies](../decisions/adr-2026-08-16-closed-build-review-finding-vocabularies.md) | Narrowed out — different decision subject |
| [adr-2026-08-16-preservation-anchored-completeness-exemption](../decisions/adr-2026-08-16-preservation-anchored-completeness-exemption.md) | Narrowed out — different decision subject |
| [adr-2026-08-16-restore-the-current-head-publication-fence](../decisions/adr-2026-08-16-restore-the-current-head-publication-fence.md) | Narrowed out — different decision subject |
| [adr-2026-08-17-framework-agnostic-tautology-scoped-run](../decisions/adr-2026-08-17-framework-agnostic-tautology-scoped-run.md) | Narrowed out — different decision subject |
| [adr-2026-08-17-structural-live-checkout-containment](../decisions/adr-2026-08-17-structural-live-checkout-containment.md) | Narrowed out — different decision subject |
| [adr-2026-08-18-content-anchored-finding-reference-schema](../decisions/adr-2026-08-18-content-anchored-finding-reference-schema.md) | Narrowed out — different decision subject |
| [adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane](../decisions/adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md) | Narrowed out — different decision subject |
| [adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence](../decisions/adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence.md) | Narrowed out — different decision subject |
| [adr-2026-08-19-engine-stamped-rubric-judged-result-envelope](../decisions/adr-2026-08-19-engine-stamped-rubric-judged-result-envelope.md) | Narrowed out — different decision subject |
| [adr-2026-08-19-live-provider-stream-observation](../decisions/adr-2026-08-19-live-provider-stream-observation.md) | Narrowed out — different decision subject |
| [adr-2026-08-19-operator-step-rewind-through-the-mutation-port](../decisions/adr-2026-08-19-operator-step-rewind-through-the-mutation-port.md) | Narrowed out — different decision subject |
| [adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch](../decisions/adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md) | Examined — relevant retained decisions compared above |
| [adr-2026-08-19-unretryable-step-runner-failures-route-by-kind](../decisions/adr-2026-08-19-unretryable-step-runner-failures-route-by-kind.md) | Examined — relevant retained decisions compared above |
| [adr-2026-08-21-engine-identity-in-build-review-cache-key](../decisions/adr-2026-08-21-engine-identity-in-build-review-cache-key.md) | Narrowed out — different decision subject |
| [adr-2026-08-21-review-bound-by-plan-done-when-criteria](../decisions/adr-2026-08-21-review-bound-by-plan-done-when-criteria.md) | Narrowed out — different decision subject |
| [adr-2026-08-22-as-built-review-runs-always-with-plan-gap](../decisions/adr-2026-08-22-as-built-review-runs-always-with-plan-gap.md) | Narrowed out — different decision subject |
| [adr-2026-08-22-build-review-opt-in-rubric-container](../decisions/adr-2026-08-22-build-review-opt-in-rubric-container.md) | Narrowed out — different decision subject |
| [adr-2026-08-22-done-when-evidence-at-task-close](../decisions/adr-2026-08-22-done-when-evidence-at-task-close.md) | Narrowed out — different decision subject |
| [adr-2026-08-22-one-owner-per-review-question](../decisions/adr-2026-08-22-one-owner-per-review-question.md) | Narrowed out — different decision subject |
| [adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback](../decisions/adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback.md) | Narrowed out — different decision subject |
| [adr-2026-08-23-committed-halt-record](../decisions/adr-2026-08-23-committed-halt-record.md) | Narrowed out — different decision subject |
| [adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote](../decisions/adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote.md) | Narrowed out — different decision subject |
| [adr-2026-08-23-criterion-layer-is-structural-at-land](../decisions/adr-2026-08-23-criterion-layer-is-structural-at-land.md) | Narrowed out — different decision subject |
| [adr-2026-08-23-diff-locality-is-an-authored-disposition](../decisions/adr-2026-08-23-diff-locality-is-an-authored-disposition.md) | Narrowed out — different decision subject |
| [adr-2026-08-24-evidentiary-defects-are-not-waivable](../decisions/adr-2026-08-24-evidentiary-defects-are-not-waivable.md) | Narrowed out — different decision subject |
| [adr-2026-08-24-one-dispatch-member-on-the-provider-contract](../decisions/adr-2026-08-24-one-dispatch-member-on-the-provider-contract.md) | Narrowed out — different decision subject |
| [adr-2026-08-24-over-scope-decision-block-and-durable-refusals](../decisions/adr-2026-08-24-over-scope-decision-block-and-durable-refusals.md) | Narrowed out — different decision subject |
| [adr-2026-08-24-refused-step-status](../decisions/adr-2026-08-24-refused-step-status.md) | Narrowed out — different decision subject |
| [adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope](../decisions/adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope.md) | Narrowed out — different decision subject |
| [adr-2026-08-25-as-built-remediable-findings-bounded-build-route](../decisions/adr-2026-08-25-as-built-remediable-findings-bounded-build-route.md) | Narrowed out — different decision subject |
| [adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot](../decisions/adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot.md) | Narrowed out — different decision subject |
| [adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity](../decisions/adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity.md) | Narrowed out — different decision subject |
| [adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal](../decisions/adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal.md) | Examined — relevant retained decisions compared above |
| [adr-2026-08-26-music-vocabulary-player-composer-rename](../decisions/adr-2026-08-26-music-vocabulary-player-composer-rename.md) | Narrowed out — different decision subject |
| [adr-2026-08-26-remove-retrospectives-one-shot](../decisions/adr-2026-08-26-remove-retrospectives-one-shot.md) | Narrowed out — different decision subject |
| [adr-2026-08-26-setup-once-per-worktree-marker](../decisions/adr-2026-08-26-setup-once-per-worktree-marker.md) | Narrowed out — different decision subject |
| [adr-2026-08-26-shared-coherence-parser-at-discovery](../decisions/adr-2026-08-26-shared-coherence-parser-at-discovery.md) | Narrowed out — different decision subject |
| [adr-2026-08-27-daemon-dispatcher-executor-seam](../decisions/adr-2026-08-27-daemon-dispatcher-executor-seam.md) | Narrowed out — different decision subject |
| [adr-2026-08-28-test-suite-drift-budget-and-verification-mode](../decisions/adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md) | Examined — relevant retained decisions compared above |
| [adr-2026-08-29-build-review-remediate-case-adjudication](../decisions/adr-2026-08-29-build-review-remediate-case-adjudication.md) | Narrowed out — different decision subject |
| [adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class](../decisions/adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class.md) | Narrowed out — different decision subject |
| [adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication](../decisions/adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md) | Narrowed out — different decision subject |
| [adr-2026-08-29-operator-authorized-kickback-budget-recovery](../decisions/adr-2026-08-29-operator-authorized-kickback-budget-recovery.md) | Narrowed out — different decision subject |
| [adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded](../decisions/adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded.md) | Narrowed out — different decision subject |
| [adr-2026-08-30-shared-plan-task-reference-resolver](../decisions/adr-2026-08-30-shared-plan-task-reference-resolver.md) | Narrowed out — different decision subject |
| [adr-2026-08-31-coverage-binding-judge-step](../decisions/adr-2026-08-31-coverage-binding-judge-step.md) | Narrowed out — different decision subject |
| [adr-2026-08-31-kickback-ledger-read-fails-closed](../decisions/adr-2026-08-31-kickback-ledger-read-fails-closed.md) | Narrowed out — different decision subject |
| [adr-2026-09-02-adr-decision-citability-contract](../decisions/adr-2026-09-02-adr-decision-citability-contract.md) | Narrowed out — different decision subject |
| [adr-2026-09-05-gh-cli-version-floor-and-environment-gate](../decisions/adr-2026-09-05-gh-cli-version-floor-and-environment-gate.md) | Narrowed out — different decision subject |
| [adr-2026-09-06-engine-owned-test-quality-scope](../decisions/adr-2026-09-06-engine-owned-test-quality-scope.md) | Examined — relevant retained decisions compared above |
| [adr-2026-09-06-inbound-intake-trust-boundary](../decisions/adr-2026-09-06-inbound-intake-trust-boundary.md) | Narrowed out — different decision subject |
| [adr-2026-09-06-reopened-task-resolution](../decisions/adr-2026-09-06-reopened-task-resolution.md) | Narrowed out — different decision subject |
| [adr-2026-09-07-durable-prd-widening-decision-reconciliation](../decisions/adr-2026-09-07-durable-prd-widening-decision-reconciliation.md) | Narrowed out — different decision subject |
| [adr-2026-09-10-portable-build-review-policy](../decisions/adr-2026-09-10-portable-build-review-policy.md) | Narrowed out — different decision subject |
| [adr-2026-09-10-separate-custom-review-coverage-identity](../decisions/adr-2026-09-10-separate-custom-review-coverage-identity.md) | Narrowed out — different decision subject |
| [adr-2026-09-10-shared-step-lifecycle-telemetry](../decisions/adr-2026-09-10-shared-step-lifecycle-telemetry.md) | Narrowed out — different decision subject |
| [adr-2026-09-11-finish-mergeability-respects-active-review-inputs](../decisions/adr-2026-09-11-finish-mergeability-respects-active-review-inputs.md) | Narrowed out — different decision subject |
