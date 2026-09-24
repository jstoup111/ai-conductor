# Conflict Check: As-built review receives bounded inputs and returns typed verdicts (#2188)

**Date:** 2026-09-23
**Stories checked:** `.docs/stories/as-built-review-receives-bounded-inputs-and-return.md` (Stories 1–9) against all 480 other files in `.docs/stories/`.
**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus`). All 317 ADRs were examined in the architecture-review sweep; 102 were retained as subject-overlapping and 215 were narrowed out (lists below). No ADR was excluded as fully superseded; ADRs with a partial supersession were retained.
**Result:** 7 blocking and 12 degrading conflicts. Each has been resolved as described below, so none remains open.

## Resolutions within this spec's stories

Four conflicts were found inside this spec's own stories or ADR pairs and were fixed in place, before or during the scan:

- **Oscillation, Story 5 vs Story 7 / ship-tail run-identity amendment of 2026-09-06.** A prior-identity verdict always scored `absent`, while an approved verdict is preserved across identities when its code stamp is valid. Story 5 now limits `absent` to verdicts whose code stamp cannot vouch for them.
- **A5, sub-decision citations** (`malformed-as-built-clause-forces-an-operator-decis` Story 1). Story 4 now states that the schema admits only whole-number decision ids. A `D5.2` sub-decision is cited as decision 5, which preserves #2424's outcome, and the string `"5.2"` is rejected by field name.
- **A15, reachability citations** (`wiring-gate-flags-production-reachable-seams-compo` Story 4). Stories 4 and 5 now carry production-reachability entries and drift notes, including `UNEXERCISED` signatures, in the typed verdict and the rendered report.
- **Further degrading gaps closed in this spec's stories:**
  - **A13, kill switch off:** as-built identity checking stays in force (Story 5).
  - **A14, failed rewind:** rollback restores the typed verdict and report (Story 7).
  - **A16:** the skill section keeps its ADR citation (Story 9).
  - **A19, Codex missing structured result:** the adapter failure is scored `absent` (Story 3).

## Conflicts with shipped stories (resolved by in-place replacement in a companion PR)

The land gate rejects edits to stories outside this spec's own stem, so these replacements ship on a separate main-based branch, `docs/2188-supersede-as-built-markdown-stories`. That companion PR merges with this spec PR. The operator chose this on 2026-09-23 (precedent: PRs #1927/#1928).

| # | Existing story | Type | Severity | Superseded assertion | Replacement |
|---|---|---|---|---|---|
| A1 | `every-as-built-blocked-verdict-halts-needs-human-i` Story 1 | contradiction | blocking | The reviewer writes a `## Blocking Findings` table, and the skill specifies the table contract. | Typed findings with structural references; the engine renders the table. |
| A2 | `every-as-built-blocked-verdict-halts-needs-human-i` Story 2 | contradiction | blocking | A missing or invalid table halts `needs-human`, via an engine table parser. | Typed-contract rejection is scored `absent` and reruns, with `needs-human` on exhaustion. |
| A3 | `as-built-invalid-verdict-halt-always-blames-plan-g` Stories 1–4 | contradiction | blocking | Markdown-cause classification (`no-verdict-line`, `plan-gap-missing-outcome`, `unparseable-blocked-findings`). | Field-named rejection of the typed result. The halt still names the real defect and never blames PLAN_GAP. |
| A4 | `parse-heading-decorated-as-built-verdict-lines` Stories 1–2 | contradiction | blocking | Heading-decorated verdict lines are parsed, with exactly one verdict-line reader. | One typed-verdict reader. A Markdown-only report is `absent`. |
| A5 | `malformed-as-built-clause-forces-an-operator-decis` Stories 1–2 | contradiction | blocking | Clause grammar with dotted collapse; an unresolvable clause halts `needs-human`; the skill carries clause grammar. | Whole-number decision field. An unresolvable reference is rejected and reruns. The skill states whole-decision citation as judgement guidance. |
| A6 | `build-review-re-judges-what-the-plan-architecture-` Story 13 | contradiction | blocking | BLOCKED always halts; the step never routes to BUILD. This had already been overtaken by #1874. | DESIGN halts. All-REMEDIABLE findings take the bounded route. |
| A7 | `session-fresh-verdict-artifacts` Stories 1–3; `prd-audit-halts-on-a-stale-report-when-the-audit-d` Story 6 | contradiction | blocking | Freshness of the as-built Markdown is decided by mtime, with an unstamped mtime fallback. | Scoped to the other gates. As-built requires an identity-stamped typed verdict, with no mtime fallback. |
| A8 | `every-as-built-blocked-verdict-halts-needs-human-i` Story 3 (negative); `reaped-stale-claim-jstoup111-ai-conductor-2054` Story 2 | contradiction | degrading | An unresolvable clause halts at admission; resolver tests exercise the string grammar. | Rejected at validation. Structural-reference resolution tests. |
| A9 | `remediable-as-built-blocked-verdict-halts-needs-hu` Story 2 and Story 3 negatives | contradiction | degrading | Invalid-findings and invalid-verdict messages come from Markdown. | A rejected or missing structured result is `absent`, then a no-verdict step failure. |
| A10 | `every-as-built-blocked-verdict-halts-needs-human-i` Story 7 | contradiction | degrading | The invalid-report halt carries a refusal stamp. | An exhausted invalid result goes through step failure, recorded `failed`. |
| A11 | `every-as-built-blocked-verdict-halts-needs-human-i` Story 6 Done When | overlap | degrading | Recorded findings round-trip through a parse of the Markdown artifact. | They round-trip through the typed verdict and the shipped record. |
| A12 | `prd-audit-halts-on-a-stale-report-when-the-audit-d` Story 2 | overlap | degrading | The handshake requires the provider to write the report. | For as-built, the handshake observes the persisted typed verdict stamped with `attempt.id`. |
| A13 | `gate-step-completion-validates-against-code-state-` Stories 3, 6; `prd-audit-halts-on-a-stale-report-when-the-audit-d` Story 6 | state-conflict | degrading | With the kill switch off, freshness reverts to pure mtime. | As-built keeps identity checking. |
| A14 | `roll-back-a-failed-rewind-fully-including-never-ru` Story 1 | state-conflict | degrading | A failed rewind restores what it removed, but the new typed verdict was not in scope. | The typed verdict and report join rollback. |
| A15 | `wiring-gate-flags-production-reachable-seams-compo` Story 4 | overlap | degrading | Reachability citations live in a report section written by the reviewer. | They are recorded as typed reachability entries and rendered. |
| A16 | `per-task-wired-into-contracts-cost-build-cycles-th` ST-1496-7 | overlap | degrading | §12 keeps its ADR citation. | Kept by this spec's Story 9. The existing story is verified unchanged. |
| A17 | `retry-classify-rerun-vs-route` Stories 1–2 | overlap | degrading | Classification is keyed to the Markdown file and its mtime. | Keyed to the typed verdict and absent/rejected/stale-identity outcomes. Routing outcome is unchanged. |
| A18 | `runmode-interactive-flag` | overlap | degrading | Every conversational step is a REPL in interactive mode. | Native-schema judgement steps always run one-shot. |
| A19 | `build-review-rubric-findings-arrive-as-typed-struc` Story 8 | sequencing | degrading | Codex reports a missing structured result as a failure. | Resolved in this spec's Story 3; the existing story is unchanged. |

**Resolution root.** Every blocking conflict is a behavior change that this spec deliberately makes and that the operator-approved ADR amendments authorize. None comes from contradictory requirements or an incompatible design, so none was routed upstream.

## Examined and compatible (summary)

The following were read and hold unchanged:
- `build-review-rubric-findings-arrive-as-typed-struc` Stories 1–7
- the other stories in `prd-audit-halts-on-a-stale-report-when-the-audit-d`, `session-fresh-verdict-artifacts` Story 4, and `gate-step-completion-validates-against-code-state-`
- post-rebase invalidation and preservation stories
- `ship-tail-parallel-validation-serial-publication-922`
- `parallel-validation-phase-fan-out-manual-test-prd-`
- remediation-planner stories (existing-task, plan growth, dispositions)
- `every-as-built-blocked-verdict-halts-needs-human-i` Stories 4–5
- `remediable-as-built-blocked-verdict-halts-needs-hu` happy paths
- `fresh-session-per-step`
- unresolved-command stories
- model and provider routing stories
- `reviewer-wording-drift-invalidates-an-approved-wid`
- shipped-record lifecycle stories

No accepted story asserts a review-required marker for as-built.

## ADR corpus: examined (102, subject-overlapping)

- adr-014-otel-observability-exporter
- adr-2026-06-29-architecture-before-stories-convergent-kickback
- adr-2026-06-30-halt-based-release-gates
- adr-2026-06-30-sandbox-build-isolation
- adr-2026-07-03-generated-model-table-single-source
- adr-2026-07-03-halt-pr-rehabilitation-at-finish
- adr-2026-07-03-reactive-model-fallback-ladder
- adr-2026-07-04-auth-failure-park-and-poll
- adr-2026-07-04-kickback-event-emission-and-log-prominence
- adr-2026-07-05-daemon-rate-limit-episode-coordinator
- adr-2026-07-05-engine-owned-task-status
- adr-2026-07-05-retry-as-escalation-ladder
- adr-2026-07-07-audit-trail-event-sink
- adr-2026-07-07-finish-record-primitive
- adr-2026-07-08-post-rebase-gate-first-mechanical-reverify
- adr-2026-07-10-concurrent-group-core
- adr-2026-07-10-intra-step-build-progress-events
- adr-2026-07-10-validation-group-join
- adr-2026-07-11-finish-step-engine-completion-machinery
- adr-2026-07-11-pipeline-state-durability
- adr-2026-07-11-verdict-aware-resume-entry
- adr-2026-07-12-rebase-evidence-stamp-translation
- adr-2026-07-12-wiring-check-gate
- adr-2026-07-13-kickback-build-no-op-escalation
- adr-2026-07-13-retry-classify-rerun-vs-route
- adr-2026-07-13-session-fresh-verdict-artifacts
- adr-2026-07-20-ci-fix-dispatch-via-steprunner
- adr-2026-07-20-ci-fix-startup-preflight-and-error-classification
- adr-2026-07-20-post-rebase-delta-aware-invalidation
- adr-2026-07-21-engine-owned-acceptance-red-execution
- adr-2026-07-22-auth-failure-classification-observed-401-patterns
- adr-2026-07-22-build-dispatch-json-usage-capture
- adr-2026-07-22-gate-evidence-code-validity-on-redispatch
- adr-2026-07-22-per-feature-cost-rollup-in-shipped-record
- adr-2026-07-23-build-review-fresh-base-disposition
- adr-2026-07-24-provider-aware-step-execution-fresh-session-scope
- adr-2026-07-25-custom-step-completion-artifacts
- adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation
- adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation
- adr-2026-07-26-cross-dispatch-kickback-livelock-bound
- adr-2026-07-26-event-sink-registry-exhaustiveness
- adr-2026-07-26-protected-artifact-seal-rebaseline
- adr-2026-07-26-rebase-tail-current-branch-before-publication
- adr-2026-07-27-codex-never-resumes-a-harness-minted-session
- adr-2026-07-27-cold-start-within-step-retries
- adr-2026-07-27-cost-unmetered-is-a-first-class-state
- adr-2026-07-27-daemon-decide-kickback-halt
- adr-2026-07-28-feature-aware-artifact-resolution
- adr-2026-07-28-total-halt-classification-legacy-boundary
- adr-2026-07-29-engine-observed-provider-time-partition
- adr-2026-07-29-operator-park-scheduling-unit-boundary
- adr-2026-07-30-contract-aware-same-file-wiring
- adr-2026-07-30-provider-preparation-lifecycle-supervision
- adr-2026-08-01-conduct-state-mutation-port
- adr-2026-08-03-build-repair-member-reuse-validity
- adr-2026-08-03-fail-closed-decide-entry
- adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts
- adr-2026-08-04-unresolved-step-command-fails-by-name
- adr-2026-08-05-build-settle-outcome-stamp
- adr-2026-08-06-publication-progress-is-its-own-disposition
- adr-2026-08-08-pipeline-owned-closeout-timestamps
- adr-2026-08-08-single-adr-approval-parser-three-rungs
- adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance
- adr-2026-08-09-recorded-red-exception-for-remediation
- adr-2026-08-11-halt-events-ride-the-persisted-spine
- adr-2026-08-12-execution-lifecycle-completeness-for-timing
- adr-2026-08-13-engine-managed-build-review-rubric-branches
- adr-2026-08-14-retire-build-review-wiring-rubric
- adr-2026-08-16-closed-build-review-finding-vocabularies
- adr-2026-08-16-restore-the-current-head-publication-fence
- adr-2026-08-17-framework-agnostic-tautology-scoped-run
- adr-2026-08-18-content-anchored-finding-reference-schema
- adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane
- adr-2026-08-19-engine-stamped-rubric-judged-result-envelope
- adr-2026-08-19-live-provider-stream-observation
- adr-2026-08-19-operator-step-rewind-through-the-mutation-port
- adr-2026-08-19-unretryable-step-runner-failures-route-by-kind
- adr-2026-08-21-review-bound-by-plan-done-when-criteria
- adr-2026-08-22-as-built-review-runs-always-with-plan-gap
- adr-2026-08-22-one-owner-per-review-question
- adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback
- adr-2026-08-23-criterion-layer-is-structural-at-land
- adr-2026-08-24-one-dispatch-member-on-the-provider-contract
- adr-2026-08-24-refused-step-status
- adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route
- adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot
- adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity
- adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
- adr-2026-08-26-remove-retrospectives-one-shot
- adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class
- adr-2026-08-30-shared-plan-task-reference-resolver
- adr-2026-08-31-coverage-binding-judge-step
- adr-2026-08-31-kickback-ledger-read-fails-closed
- adr-2026-09-02-adr-decision-citability-contract
- adr-2026-09-06-engine-owned-test-quality-scope
- adr-2026-09-06-reopened-task-resolution
- adr-2026-09-07-durable-prd-widening-decision-reconciliation
- adr-2026-09-10-portable-build-review-policy
- adr-2026-09-10-shared-step-lifecycle-telemetry
- adr-2026-09-11-finish-mergeability-respects-active-review-inputs
- adr-2026-09-11-selective-post-rebase-verification

## ADR corpus: narrowed out (215, no subject overlap with these stories)

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
- adr-2026-06-30-origin-seeded-intake-routing
- adr-2026-06-30-owner-gate-identity-resolution
- adr-2026-06-30-owner-provenance-recording
- adr-2026-06-30-self-host-detection-seam
- adr-2026-07-01-machine-scoped-operator-identity
- adr-2026-07-03-daemon-auto-restart-stale-engine
- adr-2026-07-03-dependency-fail-closed-and-cache
- adr-2026-07-03-dependency-gate-backlog-waiting-channel
- adr-2026-07-03-engineer-checkpoint-commits-idempotent-land
- adr-2026-07-03-gated-snapshot-status-read-model
- adr-2026-07-03-gated-writeback-announcements
- adr-2026-07-03-harness-daemon-profile
- adr-2026-07-03-issue-dependencies-api-surface
- adr-2026-07-03-owner-gate-gated-channel
- adr-2026-07-03-post-rebase-force-with-lease
- adr-2026-07-03-pr-timing-config-key
- adr-2026-07-03-pr-timing-self-host-precedence
- adr-2026-07-03-priority-fetch-fail-soft
- adr-2026-07-03-priority-from-linked-issue-labels
- adr-2026-07-03-prose-to-link-migration
- adr-2026-07-03-version-gate-semver-escalation
- adr-2026-07-04-autoresolve-state-and-config
- adr-2026-07-04-claim-time-delivery-evidence-guard
- adr-2026-07-04-durable-pause-marker
- adr-2026-07-04-event-driven-halt-clear-wake
- adr-2026-07-04-operator-park-marker
- adr-2026-07-04-park-unpark-cli-verbs
- adr-2026-07-04-pending-restart-queue
- adr-2026-07-04-resolution-worktree-lifecycle
- adr-2026-07-04-respawn-in-place-restart
- adr-2026-07-04-versioned-engine-store-atomic-flip
- adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep
- adr-2026-07-05-halt-pr-presentation-reliability
- adr-2026-07-05-standalone-bin-update
- adr-2026-07-06-daemon-false-ship-guard
- adr-2026-07-06-installed-root-resolution-for-global-writes
- adr-2026-07-06-manual-test-fail-routing
- adr-2026-07-06-migration-gate-waiver
- adr-2026-07-06-stale-engine-respawn-in-place
- adr-2026-07-07-daemon-owned-build-credential
- adr-2026-07-07-ship-ci-feedback-loop
- adr-2026-07-07-single-generation-stale-respawn
- adr-2026-07-07-task-trailer-id-alias
- adr-2026-07-08-halt-issue-closure-sweep
- adr-2026-07-08-main-checkout-leak-triage-and-write-fence
- adr-2026-07-09-deterministic-evidence-attribution-enforcement
- adr-2026-07-09-setup-failure-triage
- adr-2026-07-10-daemon-stall-remediation
- adr-2026-07-10-evidence-range-anchor-resolution
- adr-2026-07-10-inline-work-attribution-enforcement
- adr-2026-07-10-intake-claim-priority-banding
- adr-2026-07-10-observed-close-watch-registry
- adr-2026-07-10-park-marker-main-root-resolution
- adr-2026-07-10-retire-migration-grandfather
- adr-2026-07-10-session-hook-task-stamping
- adr-2026-07-11-attribution-abstain-or-loud
- adr-2026-07-11-attribution-spot-audit-measurement
- adr-2026-07-11-attribution-verdict-interface
- adr-2026-07-11-evidence-judge-cli-and-cutover
- adr-2026-07-11-semantic-attribution-verification-lane
- adr-2026-07-12-judged-attribution-verdict-persistence
- adr-2026-07-12-progress-aware-build-halt
- adr-2026-07-12-wired-into-contract
- adr-2026-07-13-park-all-dispatch-paths
- adr-2026-07-17-verify-only-judged-closure
- adr-2026-07-20-bounded-dirname-path-corroboration
- adr-2026-07-21-completeness-as-build-review-rubric
- adr-2026-07-21-decide-time-unmerged-overlap-scan
- adr-2026-07-21-demote-task-stamping-to-telemetry
- adr-2026-07-21-intake-only-enforcement
- adr-2026-07-21-no-diff-task-evidence-stamp
- adr-2026-07-21-owner-stamped-at-authoring
- adr-2026-07-21-s-tier-pipeline-knobs
- adr-2026-07-21-serena-removal-path
- adr-2026-07-22-attempts-counter-on-crash-recovery
- adr-2026-07-22-canonical-tagged-source-ref
- adr-2026-07-22-canonical-tracker-client-seam
- adr-2026-07-22-coherence-gate-placement-and-validation-split
- adr-2026-07-22-coherence-waiver-and-duplicate-claim
- adr-2026-07-22-daemon-level-missing-credential-gate
- adr-2026-07-22-examples-state-isolation
- adr-2026-07-22-headless-vs-guided-examples
- adr-2026-07-22-heartbeat-lease-deferred
- adr-2026-07-22-intake-closed-issue-reconciliation
- adr-2026-07-22-origin-refresh-before-engine-rebuild
- adr-2026-07-22-per-task-work-happened-floor
- adr-2026-07-22-phase-scoped-docs-write-guard
- adr-2026-07-22-requeue-claimed-distinct-from-reopen
- adr-2026-07-22-stale-claim-staleness-window-default
- adr-2026-07-22-token-liveness-probe-via-cli-invocation
- adr-2026-07-23-commit-movement-liveness-floor
- adr-2026-07-23-intake-label-authority-scoped-replace
- adr-2026-07-23-session-hook-repair-before-halt
- adr-2026-07-23-trailer-union-build-step-routing
- adr-2026-07-25-content-addressed-full-suite-proof
- adr-2026-07-25-fail-closed-durable-shipment-evidence
- adr-2026-07-26-daemon-decide-preseed-ownership
- adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates
- adr-2026-07-27-ancestry-proven-park-reconciliation
- adr-2026-07-27-project-config-scaffolder
- adr-2026-07-27-protected-artifact-seal-self-amendment-visibility
- adr-2026-07-29-codex-readiness-probe-failure-disposition
- adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main
- adr-2026-07-29-deterministic-build-verification-fanout
- adr-2026-07-29-ship-start-draft-pr
- adr-2026-07-30-finish-only-mergeability-gate
- adr-2026-07-30-pinned-remote-theme-for-pages-navigation
- adr-2026-08-01-bot-owned-release-pr
- adr-2026-08-01-engine-owned-resumable-finish-publication
- adr-2026-08-01-engine-owned-scoped-test-invocation
- adr-2026-08-01-multi-proof-park-deletion-authority
- adr-2026-08-01-rebase-full-replay-intent-validation
- adr-2026-08-01-scoped-run-verb-release-surface
- adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate
- adr-2026-08-02-live-tier-asserts-outcomes-not-scripts
- adr-2026-08-02-plan-scope-containment-at-commit-boundary
- adr-2026-08-03-ledgered-per-block-migration-execution
- adr-2026-08-03-uncommitted-work-floor-under-build-completion
- adr-2026-08-04-classify-before-spend-release-smoke-gate
- adr-2026-08-04-live-tier-provisions-its-own-provider-home
- adr-2026-08-05-blocked-classification-after-dedup
- adr-2026-08-05-blocked-is-a-distinct-state-from-halted
- adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever
- adr-2026-08-05-provenance-based-protected-artifact-inheritance
- adr-2026-08-05-token-first-stories-reference-normalization
- adr-2026-08-05-worktree-classification-evidence-derived-reasons
- adr-2026-08-06-bounded-progress-allowance-for-finish-publication
- adr-2026-08-06-honest-park-termination-boundary
- adr-2026-08-07-project-teardown-hook-contract-and-containment
- adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts
- adr-2026-08-07-smoke-gate-goes-live-without-precharacterization
- adr-2026-08-07-worktree-removal-coverage-guard
- adr-2026-08-08-finish-human-required-halt-rendering
- adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition
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
- adr-2026-08-13-markdown-default-inversion
- adr-2026-08-13-stable-build-review-finding-dispositions
- adr-2026-08-15-verify-only-anchored-tautology-exemption
- adr-2026-08-16-preservation-anchored-completeness-exemption
- adr-2026-08-17-structural-live-checkout-containment
- adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence
- adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch
- adr-2026-08-21-engine-identity-in-build-review-cache-key
- adr-2026-08-22-build-review-opt-in-rubric-container
- adr-2026-08-22-done-when-evidence-at-task-close
- adr-2026-08-23-committed-halt-record
- adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote
- adr-2026-08-23-diff-locality-is-an-authored-disposition
- adr-2026-08-24-evidentiary-defects-are-not-waivable
- adr-2026-08-24-over-scope-decision-block-and-durable-refusals
- adr-2026-08-26-music-vocabulary-player-composer-rename
- adr-2026-08-26-setup-once-per-worktree-marker
- adr-2026-08-26-shared-coherence-parser-at-discovery
- adr-2026-08-27-daemon-dispatcher-executor-seam
- adr-2026-08-28-test-suite-drift-budget-and-verification-mode
- adr-2026-08-29-build-review-remediate-case-adjudication
- adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication
- adr-2026-08-29-operator-authorized-kickback-budget-recovery
- adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded
- adr-2026-09-05-gh-cli-version-floor-and-environment-gate
- adr-2026-09-06-inbound-intake-trust-boundary
- adr-2026-09-10-separate-custom-review-coverage-identity
- adr-2026-09-11-github-operation-ownership
- adr-2026-09-11-immutable-state-lease-recovery-succession
