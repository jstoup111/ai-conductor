# Conflict Check: Portable feature history across bounded traces

Date: 2026-09-30
Source: jstoup111/ai-conductor#2011, including consolidated #2009
Verdict: CLEAN after applying approved resolutions
Blocking conflicts remaining: 0
Degrading conflicts accepted: 0
ADR corpus: repo_wide (explicit `.ai-conductor/config.yml` configuration)
Operator review: approved in chat on 2026-09-30; no new architecture decision requested.

## Inventory and comparison boundary

Inventoried all 518 story files, 60 specs, 327 ADRs, and 307 prior conflict reports.
Full-corpus content searches narrowed interactions by telemetry, span, event persistence,
resource identity, provider identity, lifecycle timing, and shutdown behavior. The initial
OTel/event/identity search selected 43 story files, four specs and 27 ADR candidates;
subject inspection excluded incidental mentions and added the main-root and lifecycle
contracts listed below. This is a repository-wide inventory with focused substantive
comparison, not a claim that every unrelated artifact was read line by line.

Compared the ten accepted stories against their governing ADRs, the original OTel PRD,
and the overlapping stories for exporter wiring, identity, metrics, event sinks, lifecycle
parity, progress events, export spooling, resource metadata, authentication, config,
and shutdown. Prior conflict reports for shared lifecycle parity and the durable spool
supply historical resolutions; their old warnings are not new requirements.

All 45 new-story pairs were considered for contradiction, incompatible overlap, state
conflict, resource contention, sequencing, and oscillation. For shared behavior, the
review asked both whether satisfying A preserves B and whether satisfying B preserves A.
Nonoverlapping story subjects were excluded by behavior, not by assuming an older story
is automatically superseded.

No selected ADR was excluded as fully superseded. Partial amendments in ADR-014 and the
shared lifecycle ADR remain governing. Historical pre-amendment statements are read with
their adjacent accepted corrections. Existing unrelated historical drift, such as #2235's
metric-version exclusion already superseded by ADR-014's 2026-09-28 amendment, does not
become new implementation work: this feature preserves the current metric resource.

## Resolved conflict 1: A single run trace versus bounded linked segments

**Stories involved:** New Stories 2–4, 6, 9 versus otel-observability Stories 2–3,
trace-root-span-records-no-run-outcome-a-halted-ru Story 4, and shared member telemetry Stories 1/3.
**Files:** `.docs/stories/a-feature-s-telemetry-fragments-into-disconnected-.md`,
`.docs/stories/otel-observability.md`,
`.docs/stories/trace-root-span-records-no-run-outcome-a-halted-ru.md`,
`.docs/stories/restore-per-member-telemetry-for-validation-groups.md`;
original PRD `.docs/specs/2026-06-28-otel-observability.md`.
**Type:** contradiction
**Severity:** blocking before resolution; resolved
**Basis/confidence:** verified conflicting text, 100%; resolution matches operator-approved D21/D24/D25.

The historical OTel story required: "Decoded trace from a fixture run shows exactly one root span with no parent."
The historical terminal story required: "Test (regression pin) asserts step spans export at `step_completed` before any terminal event, the root span exports only after the terminal event, and `conductor.run.outcome` appears on no span until then".
A dispatch exceeding an hour cannot both export intermediate roots and forbid their export
until its terminal. Likewise one total span per execution cannot represent linked slices
and a separate delayed outcome.

Resolution options were (1) replace historical story assertions with bounded-segment
semantics, (2) retain the single trace and abandon the approved approach, or (3) add a
second vendor-specific mode. Option 1 follows the operator's explicit portable linked-trace
choice and approved story-reconciliation package; options 2/3 contradict that choice.

Applied: in-place story replacements, valid IDs for the legacy OTel headings, and adjacent
additive corrections to the original PRD and governing ADRs. Roots/groups are envelopes;
logical execution timing and exactly-once terminal facts survive segmentation. No new
scope, rejected alternative, or compromise is introduced.

## Resolved conflict 2: Read-only daemon startup versus early stable identity

**Stories involved:** New Story 1 versus daemon-dispatched-builds Story 2 and cold-start ST-1071-5.
**Files:** `.docs/stories/daemon-dispatched-builds-emit-no-otel-telemetry-th.md`,
`.docs/stories/claude-within-step-retries-resume-the-prior-attemp.md`,
`.docs/decisions/adr-014-otel-observability-exporter.md`.
**Type:** sequencing
**Severity:** blocking before resolution; resolved
**Basis/confidence:** verified opposing text, 100%.
**ADR filename stem:** adr-014-otel-observability-exporter
**Story ID:** 2 (daemon-dispatched-builds-emit-no-otel-telemetry-th)
**ADR opposing sentence (verbatim):** "Make one shared create-if-absent identity helper own .pipeline/conduct-session-id."
**Story opposing sentence (verbatim, before correction):** "Given a fresh worktree where .pipeline/conduct-session-id does not exist yet at wiring time, when the daemon path resolves the run id, then it uses the caller-injected dispatch session id and does not write .pipeline/conduct-session-id (the step runner remains that file's only writer)"

Early recovery cannot depend on identity first being written by a later step. Options:
(1) apply the approved shared atomic helper to these remaining legacy assertions,
(2) postpone tracing until a step writes identity, or (3) create a separate identity file.
Option 1 is the already-approved D22 decision. Options 2/3 lose early telemetry or introduce
an unnecessary second identity authority.

Applied: enabled daemon startup and StepRunner share create-if-absent persistence;
existing identity remains immutable; provider session generation remains independent.
Added the correction beside ADR-014's old #1934 read-only clause and replaced story wording
in place. These are consequences of the architecture approval, not a new design decision.
StepRunner's existing error/degraded-state contract remains authoritative.

## Resolved conflict 3: Grouping could merge retries and re-runs

**Stories involved:** New Stories 3–5 versus shared lifecycle Stories 2/3 and ADR D2.
**Files:** `.docs/stories/restore-per-member-telemetry-for-validation-groups.md`,
`.docs/architecture/a-feature-s-telemetry-fragments-into-disconnected-.md`.
**Type:** state-conflict
**Severity:** blocking before resolution; resolved during approved architecture/story review
**Basis/confidence:** verified, 100%.

The earlier diagram prose described a retry as a distinct execution. Shared lifecycle D2
keeps policy retries inside the execution and gives only a later re-run a new identity.
Options were (1) preserve D2 and distinguish retry/execution/slice, (2) redefine engine
execution identity, or (3) collapse all executions into a step aggregate. The operator
approved option 1 in D24 and the acceptance package. The diagram now has its additive
correction; story text preserves one execution across retries and rotations while
keeping re-runs and overlapping subjects distinct. Grouping changes no scheduling policy.

## Two-directional interaction review

| New stories | Existing party / shared behavior | Why both directions hold after resolution |
|---|---|---|
| 1, 2, 10 | Cold-start identity; daemon wiring; branch/engine/released-version resource stories | Bootstrap adds stable feature identity before tracing while preserving provider-session freshness and existing resolved/unresolved resource values. Those resource requirements do not prevent safe isolated continuity when scope is unavailable. |
| 2, 8 | Wave C event persistence; registry exhaustiveness; audit sink | Typed correlation events reuse the existing writer/decoder. Explicit sink declarations isolate rotation from metrics and audit. Ordinary step events and report semantics remain unchanged; persister rejection is caught only at the telemetry publication boundary. |
| 2, 7, 9 | Durable export spool Stories 1–6 / ADR-014 D15–D17 | Recovery links use feature ledger context; export durability uses the independent existing exporter seam. Neither claims backend acceptance. Rotation flushes ended spans without stopping the process-owned spool drainer or applying a client age filter. A failed/unpublished context cannot be advertised as durable. |
| 3, 4, 6 | Shared lifecycle D1–D5; per-member telemetry | Segment boundaries do not emit engine completions or reopen settled work. Repeated executions share grouping but keep distinct IDs; retry identity is unchanged. Late classification preserves the observed work interval without holding an old span open. |
| 3, 7 | Progress/stall events and watcher lifecycle | The trace deadline never resets from progress; progress's own heartbeat/quiet timers remain unchanged. Trace rotation emits no progress, stall, or engine policy event, so neither timer system controls the other. |
| 5 | Metrics dimensions, custom attributes, cost/shipment tier, two-layer identity | Existing MetricsListener and event-derived rollups retain ownership. New dispatch/segment/execution IDs are trace/event-only, not metric keys; provider attempts/terminal usage retain existing deduplication. Custom attributes cannot override conductor-owned identifiers. |
| 6, 7, 9 | Engine-observed timing and lifecycle completeness | A slice cutoff is never an authoritative engine terminal or recovered active interval. Missing history stays unknown/partial. Work timing survives later classification and clock gaps without rewriting ended spans. |
| 8, 10 | Authenticated OTLP and config-validation stories | Existing headers/protocols/failure isolation remain at the exporter boundary. Correlation records contain no credential fields; disabled telemetry does not cause identity/recovery/export side effects. No config key or plugin API is added. |
| 9, 10 | Daemon teardown and terminal outcome stories | First terminal wins; children close before parents; stop is idempotent and bounded. Intermediate segments have no dispatch outcome. Root creation remains lazy, so a never-started dispatch creates no outcome span. A previously active idle dispatch can end with a final bounded outcome segment. |
| 1, 8 | Pipeline-state durability and canonical main-root resolution | Bootstrap reuses identity creation and existing canonical resolution; it does not delete the pipeline, repair invalid identity by overwriting it, or silently make uncertain scope recoverable. Mid-run state loss still follows existing engine diagnostics. |

The new-story interactions are also closed: 1 supplies scope to 2/8; 3 and 9 serialize
rotation versus terminal ownership; 4 and 5 distinguish groups from additive facts; 6 and
7 distinguish measured work from observation/classification time; 8 drains while persistence
remains attached; 10 composes these at both entry points. There is no circular startup
prerequisite, extra lifecycle owner, second ledger writer, or required infinite retry loop.

## Re-check and limits

Re-read the affected assertions after replacement and compared the ten stories with
D21–D26 and retained lifecycle/metric constraints. The three conflict classes above are
resolved under already-recorded operator choices; there is no accepted degrading conflict
and no new/superseding ADR. Historical artifact corrections stay in DECIDE and must not
become BUILD tasks.

Judgement: CLEAN, inferred 95% from the documented bidirectional review and source-grounded
contracts. This is not proof of implementation, live backend ingestion, or future merge
compatibility. No test suite was run for this specification-only pass. Diagram syntax
was checked earlier; current changes are prose only. `git diff --check` is the scoped
formatting check. The review-required marker is present because resolutions occurred.

Before publication, retain native amendment handling: current landSpec excludes existing
foreign-stem artifacts from current-feature discovery while still staging their approved
changes (`resolveFeatureFiles`, existing-path ownership). The 2026-09-29 spool
report's older foreign-stem rejection is historical, not a reason to split this approved
DECIDE correction into another PR.

## Examined ADRs

- adr-014-otel-observability-exporter
- adr-2026-07-07-audit-trail-event-sink
- adr-2026-07-10-intra-step-build-progress-events
- adr-2026-07-10-park-marker-main-root-resolution
- adr-2026-07-11-pipeline-state-durability
- adr-2026-07-22-per-feature-cost-rollup-in-shipped-record
- adr-2026-07-26-event-sink-registry-exhaustiveness
- adr-2026-07-27-cold-start-within-step-retries
- adr-2026-07-29-engine-observed-provider-time-partition
- adr-2026-08-08-pipeline-owned-closeout-timestamps
- adr-2026-08-11-halt-events-ride-the-persisted-spine
- adr-2026-08-12-execution-lifecycle-completeness-for-timing
- adr-2026-09-10-shared-step-lifecycle-telemetry

## Narrowed-out ADR inventory

The following subjects do not change this feature's trace, identity, timing, persistence,
export, or terminal behavior. They remain authoritative within their own scope; none is
excluded here merely because it is partially superseded.

- adr-002-engineer-store-and-retro-redirect
- adr-003-registry-write-and-integration
- adr-005-non-autonomy-and-read-only-governor
- adr-006-flywheel-lesson-selection-and-provenance
- adr-008-agent-hosted-loop-and-in-chat-authoring
- adr-009-intake-adapter-port
- adr-010-pidfile-lock-daemon-liveness
- adr-011-async-intake-queue-and-github-source
- adr-012-durable-intake-ledger-sole-dedup-authority
- adr-015-daemon-pr-labeling-sweep
- adr-2026-06-29-architecture-before-stories-convergent-kickback
- adr-2026-06-29-brainstorm-rename-migration
- adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting
- adr-2026-06-29-explore-prd-split-track-in-explore
- adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration
- adr-2026-06-29-memory-resilience-write-fallback-and-reconcile
- adr-2026-06-29-per-project-memory-provider-selection
- adr-2026-06-29-per-provider-retrieval-guidance-location
- adr-2026-06-29-platform-adoption-and-removal-surface
- adr-2026-06-29-rebase-conflict-resolution-dispatch
- adr-2026-06-29-safe-reversible-memory-migration
- adr-2026-06-29-shared-memory-store-placement-and-durability
- adr-2026-06-29-track-marker-location
- adr-2026-06-30-background-intake-brain-loop
- adr-2026-06-30-engineer-worktree-authoring-isolation
- adr-2026-06-30-grandfather-cutover-merge-time
- adr-2026-06-30-halt-based-release-gates
- adr-2026-06-30-origin-seeded-intake-routing
- adr-2026-06-30-owner-gate-identity-resolution
- adr-2026-06-30-owner-provenance-recording
- adr-2026-06-30-sandbox-build-isolation
- adr-2026-06-30-self-host-detection-seam
- adr-2026-07-01-machine-scoped-operator-identity
- adr-2026-07-03-daemon-auto-restart-stale-engine
- adr-2026-07-03-dependency-fail-closed-and-cache
- adr-2026-07-03-dependency-gate-backlog-waiting-channel
- adr-2026-07-03-engineer-checkpoint-commits-idempotent-land
- adr-2026-07-03-gated-snapshot-status-read-model
- adr-2026-07-03-gated-writeback-announcements
- adr-2026-07-03-generated-model-table-single-source
- adr-2026-07-03-halt-pr-rehabilitation-at-finish
- adr-2026-07-03-harness-daemon-profile
- adr-2026-07-03-issue-dependencies-api-surface
- adr-2026-07-03-owner-gate-gated-channel
- adr-2026-07-03-post-rebase-force-with-lease
- adr-2026-07-03-pr-timing-config-key
- adr-2026-07-03-pr-timing-self-host-precedence
- adr-2026-07-03-priority-fetch-fail-soft
- adr-2026-07-03-priority-from-linked-issue-labels
- adr-2026-07-03-prose-to-link-migration
- adr-2026-07-03-reactive-model-fallback-ladder
- adr-2026-07-03-version-gate-semver-escalation
- adr-2026-07-04-auth-failure-park-and-poll
- adr-2026-07-04-autoresolve-state-and-config
- adr-2026-07-04-claim-time-delivery-evidence-guard
- adr-2026-07-04-durable-pause-marker
- adr-2026-07-04-event-driven-halt-clear-wake
- adr-2026-07-04-kickback-event-emission-and-log-prominence
- adr-2026-07-04-operator-park-marker
- adr-2026-07-04-park-unpark-cli-verbs
- adr-2026-07-04-pending-restart-queue
- adr-2026-07-04-resolution-worktree-lifecycle
- adr-2026-07-04-respawn-in-place-restart
- adr-2026-07-04-versioned-engine-store-atomic-flip
- adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep
- adr-2026-07-05-daemon-rate-limit-episode-coordinator
- adr-2026-07-05-engine-owned-task-status
- adr-2026-07-05-halt-pr-presentation-reliability
- adr-2026-07-05-retry-as-escalation-ladder
- adr-2026-07-05-standalone-bin-update
- adr-2026-07-06-daemon-false-ship-guard
- adr-2026-07-06-installed-root-resolution-for-global-writes
- adr-2026-07-06-manual-test-fail-routing
- adr-2026-07-06-migration-gate-waiver
- adr-2026-07-06-stale-engine-respawn-in-place
- adr-2026-07-07-daemon-owned-build-credential
- adr-2026-07-07-finish-record-primitive
- adr-2026-07-07-ship-ci-feedback-loop
- adr-2026-07-07-single-generation-stale-respawn
- adr-2026-07-07-task-trailer-id-alias
- adr-2026-07-08-halt-issue-closure-sweep
- adr-2026-07-08-main-checkout-leak-triage-and-write-fence
- adr-2026-07-08-post-rebase-gate-first-mechanical-reverify
- adr-2026-07-09-deterministic-evidence-attribution-enforcement
- adr-2026-07-09-setup-failure-triage
- adr-2026-07-10-concurrent-group-core
- adr-2026-07-10-daemon-stall-remediation
- adr-2026-07-10-evidence-range-anchor-resolution
- adr-2026-07-10-inline-work-attribution-enforcement
- adr-2026-07-10-intake-claim-priority-banding
- adr-2026-07-10-observed-close-watch-registry
- adr-2026-07-10-retire-migration-grandfather
- adr-2026-07-10-session-hook-task-stamping
- adr-2026-07-10-validation-group-join
- adr-2026-07-11-attribution-abstain-or-loud
- adr-2026-07-11-attribution-spot-audit-measurement
- adr-2026-07-11-attribution-verdict-interface
- adr-2026-07-11-evidence-judge-cli-and-cutover
- adr-2026-07-11-finish-step-engine-completion-machinery
- adr-2026-07-11-semantic-attribution-verification-lane
- adr-2026-07-11-verdict-aware-resume-entry
- adr-2026-07-12-judged-attribution-verdict-persistence
- adr-2026-07-12-progress-aware-build-halt
- adr-2026-07-12-rebase-evidence-stamp-translation
- adr-2026-07-12-wired-into-contract
- adr-2026-07-12-wiring-check-gate
- adr-2026-07-13-kickback-build-no-op-escalation
- adr-2026-07-13-park-all-dispatch-paths
- adr-2026-07-13-retry-classify-rerun-vs-route
- adr-2026-07-13-session-fresh-verdict-artifacts
- adr-2026-07-17-verify-only-judged-closure
- adr-2026-07-20-bounded-dirname-path-corroboration
- adr-2026-07-20-ci-fix-dispatch-via-steprunner
- adr-2026-07-20-ci-fix-startup-preflight-and-error-classification
- adr-2026-07-20-post-rebase-delta-aware-invalidation
- adr-2026-07-21-completeness-as-build-review-rubric
- adr-2026-07-21-decide-time-unmerged-overlap-scan
- adr-2026-07-21-demote-task-stamping-to-telemetry
- adr-2026-07-21-engine-owned-acceptance-red-execution
- adr-2026-07-21-intake-only-enforcement
- adr-2026-07-21-no-diff-task-evidence-stamp
- adr-2026-07-21-owner-stamped-at-authoring
- adr-2026-07-21-s-tier-pipeline-knobs
- adr-2026-07-21-serena-removal-path
- adr-2026-07-22-attempts-counter-on-crash-recovery
- adr-2026-07-22-auth-failure-classification-observed-401-patterns
- adr-2026-07-22-build-dispatch-json-usage-capture
- adr-2026-07-22-canonical-tagged-source-ref
- adr-2026-07-22-canonical-tracker-client-seam
- adr-2026-07-22-coherence-gate-placement-and-validation-split
- adr-2026-07-22-coherence-waiver-and-duplicate-claim
- adr-2026-07-22-daemon-level-missing-credential-gate
- adr-2026-07-22-examples-state-isolation
- adr-2026-07-22-gate-evidence-code-validity-on-redispatch
- adr-2026-07-22-headless-vs-guided-examples
- adr-2026-07-22-heartbeat-lease-deferred
- adr-2026-07-22-intake-closed-issue-reconciliation
- adr-2026-07-22-origin-refresh-before-engine-rebuild
- adr-2026-07-22-per-task-work-happened-floor
- adr-2026-07-22-phase-scoped-docs-write-guard
- adr-2026-07-22-requeue-claimed-distinct-from-reopen
- adr-2026-07-22-stale-claim-staleness-window-default
- adr-2026-07-22-token-liveness-probe-via-cli-invocation
- adr-2026-07-23-build-review-fresh-base-disposition
- adr-2026-07-23-commit-movement-liveness-floor
- adr-2026-07-23-intake-label-authority-scoped-replace
- adr-2026-07-23-session-hook-repair-before-halt
- adr-2026-07-23-trailer-union-build-step-routing
- adr-2026-07-24-provider-aware-step-execution-fresh-session-scope
- adr-2026-07-25-content-addressed-full-suite-proof
- adr-2026-07-25-custom-step-completion-artifacts
- adr-2026-07-25-fail-closed-durable-shipment-evidence
- adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation
- adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation
- adr-2026-07-26-cross-dispatch-kickback-livelock-bound
- adr-2026-07-26-daemon-decide-preseed-ownership
- adr-2026-07-26-protected-artifact-seal-rebaseline
- adr-2026-07-26-rebase-tail-current-branch-before-publication
- adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates
- adr-2026-07-27-ancestry-proven-park-reconciliation
- adr-2026-07-27-codex-never-resumes-a-harness-minted-session
- adr-2026-07-27-cost-unmetered-is-a-first-class-state
- adr-2026-07-27-daemon-decide-kickback-halt
- adr-2026-07-27-project-config-scaffolder
- adr-2026-07-27-protected-artifact-seal-self-amendment-visibility
- adr-2026-07-28-feature-aware-artifact-resolution
- adr-2026-07-28-total-halt-classification-legacy-boundary
- adr-2026-07-29-codex-readiness-probe-failure-disposition
- adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main
- adr-2026-07-29-deterministic-build-verification-fanout
- adr-2026-07-29-operator-park-scheduling-unit-boundary
- adr-2026-07-29-ship-start-draft-pr
- adr-2026-07-30-contract-aware-same-file-wiring
- adr-2026-07-30-finish-only-mergeability-gate
- adr-2026-07-30-pinned-remote-theme-for-pages-navigation
- adr-2026-07-30-provider-preparation-lifecycle-supervision
- adr-2026-08-01-bot-owned-release-pr
- adr-2026-08-01-conduct-state-mutation-port
- adr-2026-08-01-engine-owned-resumable-finish-publication
- adr-2026-08-01-engine-owned-scoped-test-invocation
- adr-2026-08-01-multi-proof-park-deletion-authority
- adr-2026-08-01-rebase-full-replay-intent-validation
- adr-2026-08-01-scoped-run-verb-release-surface
- adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate
- adr-2026-08-02-live-tier-asserts-outcomes-not-scripts
- adr-2026-08-02-plan-scope-containment-at-commit-boundary
- adr-2026-08-03-build-repair-member-reuse-validity
- adr-2026-08-03-fail-closed-decide-entry
- adr-2026-08-03-ledgered-per-block-migration-execution
- adr-2026-08-03-uncommitted-work-floor-under-build-completion
- adr-2026-08-04-classify-before-spend-release-smoke-gate
- adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts
- adr-2026-08-04-live-tier-provisions-its-own-provider-home
- adr-2026-08-04-unresolved-step-command-fails-by-name
- adr-2026-08-05-blocked-classification-after-dedup
- adr-2026-08-05-blocked-is-a-distinct-state-from-halted
- adr-2026-08-05-build-settle-outcome-stamp
- adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever
- adr-2026-08-05-provenance-based-protected-artifact-inheritance
- adr-2026-08-05-token-first-stories-reference-normalization
- adr-2026-08-05-worktree-classification-evidence-derived-reasons
- adr-2026-08-06-bounded-progress-allowance-for-finish-publication
- adr-2026-08-06-honest-park-termination-boundary
- adr-2026-08-06-publication-progress-is-its-own-disposition
- adr-2026-08-07-project-teardown-hook-contract-and-containment
- adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts
- adr-2026-08-07-smoke-gate-goes-live-without-precharacterization
- adr-2026-08-07-worktree-removal-coverage-guard
- adr-2026-08-08-finish-human-required-halt-rendering
- adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition
- adr-2026-08-08-single-adr-approval-parser-three-rungs
- adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance
- adr-2026-08-09-adr-contradiction-detection-in-two-halves
- adr-2026-08-09-adr-layer-gated-by-committed-adr-signal
- adr-2026-08-09-bash-yaml-access-via-conduct-ts-config
- adr-2026-08-09-checkout-is-sole-version-identity-authority
- adr-2026-08-09-conductor-block-single-source-of-truth
- adr-2026-08-09-declared-pattern-replication-in-build
- adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic
- adr-2026-08-09-hook-owned-containment-event-ledger
- adr-2026-08-09-legacy-json-seed-migration-rule
- adr-2026-08-09-non-blocking-plan-scope-containment
- adr-2026-08-09-one-pr-per-branch-halt-is-a-state
- adr-2026-08-09-operator-only-scoped-artifact-reseal
- adr-2026-08-09-recorded-red-exception-for-remediation
- adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag
- adr-2026-08-09-reseal-audit-rides-the-existing-event-spine
- adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator
- adr-2026-08-09-seal-rotation-authorship-predicate
- adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag
- adr-2026-08-09-worktree-local-provider-scratch
- adr-2026-08-11-deprecated-no-op-step-retirement
- adr-2026-08-12-cumulative-build-review-convergence-bound
- adr-2026-08-12-fail-closed-intake-ledger-durability
- adr-2026-08-12-live-provider-coverage-from-plugin-registry
- adr-2026-08-12-operator-reseal-as-second-scope-justification
- adr-2026-08-12-per-provider-live-smoke-legs
- adr-2026-08-12-removal-anchored-tautology-exemption
- adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns
- adr-2026-08-13-durable-base-advance-attribution
- adr-2026-08-13-engine-managed-build-review-rubric-branches
- adr-2026-08-13-markdown-default-inversion
- adr-2026-08-13-stable-build-review-finding-dispositions
- adr-2026-08-14-retire-build-review-wiring-rubric
- adr-2026-08-15-verify-only-anchored-tautology-exemption
- adr-2026-08-16-closed-build-review-finding-vocabularies
- adr-2026-08-16-preservation-anchored-completeness-exemption
- adr-2026-08-16-restore-the-current-head-publication-fence
- adr-2026-08-17-framework-agnostic-tautology-scoped-run
- adr-2026-08-17-structural-live-checkout-containment
- adr-2026-08-18-content-anchored-finding-reference-schema
- adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane
- adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence
- adr-2026-08-19-engine-stamped-rubric-judged-result-envelope
- adr-2026-08-19-live-provider-stream-observation
- adr-2026-08-19-operator-step-rewind-through-the-mutation-port
- adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch
- adr-2026-08-19-unretryable-step-runner-failures-route-by-kind
- adr-2026-08-21-engine-identity-in-build-review-cache-key
- adr-2026-08-21-review-bound-by-plan-done-when-criteria
- adr-2026-08-22-as-built-review-runs-always-with-plan-gap
- adr-2026-08-22-build-review-opt-in-rubric-container
- adr-2026-08-22-done-when-evidence-at-task-close
- adr-2026-08-22-one-owner-per-review-question
- adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback
- adr-2026-08-23-committed-halt-record
- adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote
- adr-2026-08-23-criterion-layer-is-structural-at-land
- adr-2026-08-23-diff-locality-is-an-authored-disposition
- adr-2026-08-24-evidentiary-defects-are-not-waivable
- adr-2026-08-24-one-dispatch-member-on-the-provider-contract
- adr-2026-08-24-over-scope-decision-block-and-durable-refusals
- adr-2026-08-24-refused-step-status
- adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route
- adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot
- adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity
- adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
- adr-2026-08-26-music-vocabulary-player-composer-rename
- adr-2026-08-26-remove-retrospectives-one-shot
- adr-2026-08-26-setup-once-per-worktree-marker
- adr-2026-08-26-shared-coherence-parser-at-discovery
- adr-2026-08-27-daemon-dispatcher-executor-seam
- adr-2026-08-28-test-suite-drift-budget-and-verification-mode
- adr-2026-08-29-build-review-remediate-case-adjudication
- adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class
- adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication
- adr-2026-08-29-operator-authorized-kickback-budget-recovery
- adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded
- adr-2026-08-30-shared-plan-task-reference-resolver
- adr-2026-08-31-coverage-binding-judge-step
- adr-2026-08-31-kickback-ledger-read-fails-closed
- adr-2026-09-02-adr-decision-citability-contract
- adr-2026-09-05-gh-cli-version-floor-and-environment-gate
- adr-2026-09-06-engine-owned-test-quality-scope
- adr-2026-09-06-inbound-intake-trust-boundary
- adr-2026-09-06-reopened-task-resolution
- adr-2026-09-07-durable-prd-widening-decision-reconciliation
- adr-2026-09-10-portable-build-review-policy
- adr-2026-09-10-separate-custom-review-coverage-identity
- adr-2026-09-11-finish-mergeability-respects-active-review-inputs
- adr-2026-09-11-github-operation-ownership
- adr-2026-09-11-immutable-state-lease-recovery-succession
- adr-2026-09-11-selective-post-rebase-verification
- adr-2026-09-20-halt-resolution-queue-derived-from-markers
- adr-2026-09-20-operator-launched-sessions-retain-conductor-authority
- adr-2026-09-23-engine-git-guard-on-agent-path
- adr-2026-09-23-one-owner-for-accepted-story-readability
- adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery
- adr-2026-09-24-project-owned-pr-body-regions
- adr-2026-09-28-skills-may-bundle-executable-helpers
- adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history
- adr-2026-09-29-plan-slice-manifest
