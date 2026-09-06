# Conflict Check: Accurate test-quality scope

**Date:** 2026-09-06
**Status:** PASS
**Verdict:** CLEAN — zero remaining blocking conflicts
**Stories:** .docs/stories/testquality-admits-724-test-titles-for-eight-chang.md (operator accepted)
**ADR corpus:** repo_wide, from .ai-conductor/config.yml

## Inventory and scope

Screened all 1219 Markdown files across stories, specs, decisions and conflict reports by heading/status and subject references. The complete story corpus was searched for changed-test scope, Covers bindings, review gates, counterfactuals, cache identity, source authority, and recovery. Semantic review was concentrated on the overlapping contracts listed below; unrelated product behavior is not claimed as a new feature interaction. The ADR inventory appendix records examined versus narrowed-out subjects. Only clearly fully superseded ADRs are excluded on status; partial supersessions remain applicable with their amendments.

Examined overlapping story families: build-review-re-judges-what-the-plan-architecture-; build-review-rubric-dispositions-and-fan-out; clean-rubric-judgements-rejected-as-invalid-provid; equivalent-re-worded-findings-escape-their-accepte; review-infrastructure-failures-are-operator-unreco; one-rubric-s-rejected-contract-discards-the-whole-; infrastructure-exits-can-masquerade-as-test-sensit; rubric-cache-identity-is-sha-anchored-so-a-rebase-; repeated-build-review-semantic-failures-can-churn-; one-build-review-pass-clears-the-convergence-cap-s; rebase-invalidated-test-suite-proof-halts-build-re; test-suite-re-runs-and-re-passes-the-full-suite-10. Prior retired completeness/wiring/tautology requirements were interpreted through their explicit governing supersessions, not reintroduced.

## Resolved scope refinement

**Type:** behavioral overlap. **Severity before clarification:** blocking.
Old test-quality Story 3 confined tests to the feature diff. New Story 3 admits concrete changed shared setup/helper effects while test bodies can remain unchanged. The operator approved comprehensive engine-led scope with explicit protection for no-test refactors. The new accepted Story 3 supersedes that prior scope restriction for this change; the opt-in ADR decision 3 carries the additive clarification. The historical story remains unchanged because the composer landing gate requires every changed story filename to match this feature stem. This is not a new blanket dependency or coverage mandate.

**Resolution authority:** operator approved engine approach, corrected refactor handling, instructed continuation, then accepted these nine stories. No further scope choice is inferred.

## Pairwise findings after correction

| Compared behaviors | Bidirectional result | Basis |
|---|---|---|
| New Stories 1/2 versus 3 | Compatible | Direct body changes and shared affected candidates are separate sets; grouping does not claim unchanged bodies changed. |
| Stories 2/3 versus 4 | Compatible | Only concrete opted-in evidence creates a candidate; absent tests/markers/plan paths preserve empty scope. |
| Stories 4/5 versus 6 | Compatible | Out-of-scope judgment can pass; genuinely indeterminate concrete candidates cannot pass without authorized reduced coverage. Unsupported syntax alone is not a fault. |
| Stories 5/6 versus counterfactual-sensitivity Story 3 | Compatible | scopeResolutions indeterminate concerns finding authority; counterfactualSensitivity indeterminate concerns execution evidence and retains empty-findings PASS. Neither implies the other. |
| Story 7 versus content-only cache/disposition stories | Compatible | Projection version and relevant content invalidate scope caches; result v3 and exact finding identity persist. Source commit coordinates remain provenance, not semantic identity. |
| Stories 5/6 versus mechanical-fault and mixed-lap stories | Compatible | Typed scope-incomplete joins the bounded fault mechanism; missing evidence never becomes test-insensitive, and valid independently judged findings must be retained. No new plan tasks or retry counter. |
| Stories 4/8 versus configured suite and no-rerun stories | Compatible | Scope analysis does not execute source or narrow aggregate regression selection; disabled and empty review do not start a counterfactual. |
| Stories 3/9 versus accuracy priority | Compatible | Shared/ambiguous context can grow; unrelated sibling titles cannot inflate directly changed targets. Bytes/timing are observations, not assertions of semantic completeness or token savings. |

All six conflict classes were checked on overlapping pairs: contradiction, behavioral overlap, state conflict, resource contention, sequencing and oscillation. Both directions hold for the pairs above. New source analysis is read-only and per-worktree; existing cache and disposition leases remain single owners, so no additional writer contention is introduced. The same-call candidate judgment avoids a prerequisite cycle between final scope and a second reviewer invocation.

## Verification ledger

Verified: operator scope, current accepted stories, governing ADR clauses and their amendments, current engine assembly/domain/cache/recovery shapes. Confidence in semantic compatibility: 90%, inferred by comparing the identified overlapping obligations in both directions; not an implementation proof. Advisory Git branch overlap exists; GitHub dependency lookup was unavailable. Neither result establishes a semantic conflict. No unconfirmed load-bearing assumption remains for the plan.

## ADR inventory

- `adr-002-engineer-store-and-retro-redirect` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-003-registry-write-and-integration` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-005-non-autonomy-and-read-only-governor` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-006-flywheel-lesson-selection-and-provenance` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-008-agent-hosted-loop-and-in-chat-authoring` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-009-intake-adapter-port` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-010-pidfile-lock-daemon-liveness` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-011-async-intake-queue-and-github-source` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-012-durable-intake-ledger-sole-dedup-authority` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-014-otel-observability-exporter` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-015-daemon-pr-labeling-sweep` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-architecture-before-stories-convergent-kickback` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-brainstorm-rename-migration` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-explore-prd-split-track-in-explore` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-memory-resilience-write-fallback-and-reconcile` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-per-project-memory-provider-selection` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-per-provider-retrieval-guidance-location` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-platform-adoption-and-removal-surface` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-rebase-conflict-resolution-dispatch` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-safe-reversible-memory-migration` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-shared-memory-store-placement-and-durability` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-29-track-marker-location` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-30-background-intake-brain-loop` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-30-engineer-worktree-authoring-isolation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-30-grandfather-cutover-merge-time` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-30-halt-based-release-gates` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-30-origin-seeded-intake-routing` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-30-owner-gate-identity-resolution` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-30-owner-provenance-recording` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-30-sandbox-build-isolation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-06-30-self-host-detection-seam` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-01-machine-scoped-operator-identity` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-daemon-auto-restart-stale-engine` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-dependency-fail-closed-and-cache` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-dependency-gate-backlog-waiting-channel` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-gated-snapshot-status-read-model` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-gated-writeback-announcements` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-generated-model-table-single-source` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-halt-pr-rehabilitation-at-finish` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-harness-daemon-profile` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-issue-dependencies-api-surface` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-owner-gate-gated-channel` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-post-rebase-force-with-lease` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-pr-timing-config-key` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-pr-timing-self-host-precedence` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-priority-fetch-fail-soft` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-priority-from-linked-issue-labels` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-prose-to-link-migration` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-reactive-model-fallback-ladder` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-03-version-gate-semver-escalation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-auth-failure-park-and-poll` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-autoresolve-state-and-config` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-claim-time-delivery-evidence-guard` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-durable-pause-marker` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-event-driven-halt-clear-wake` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-kickback-event-emission-and-log-prominence` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-operator-park-marker` — Narrowed out: explicitly fully superseded; successor governs.
- `adr-2026-07-04-park-unpark-cli-verbs` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-pending-restart-queue` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-resolution-worktree-lifecycle` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-respawn-in-place-restart` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-versioned-engine-store-atomic-flip` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-05-daemon-rate-limit-episode-coordinator` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-05-engine-owned-task-status` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-05-halt-pr-presentation-reliability` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-05-retry-as-escalation-ladder` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-05-standalone-bin-update` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-06-daemon-false-ship-guard` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-06-installed-root-resolution-for-global-writes` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-06-manual-test-fail-routing` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-06-migration-gate-waiver` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-06-stale-engine-respawn-in-place` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-07-audit-trail-event-sink` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-07-daemon-owned-build-credential` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-07-finish-record-primitive` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-07-ship-ci-feedback-loop` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-07-single-generation-stale-respawn` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-07-task-trailer-id-alias` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-08-halt-issue-closure-sweep` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-08-main-checkout-leak-triage-and-write-fence` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-09-deterministic-evidence-attribution-enforcement` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-09-setup-failure-triage` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-concurrent-group-core` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-daemon-stall-remediation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-evidence-range-anchor-resolution` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-inline-work-attribution-enforcement` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-intake-claim-priority-banding` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-intra-step-build-progress-events` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-observed-close-watch-registry` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-park-marker-main-root-resolution` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-retire-migration-grandfather` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-session-hook-task-stamping` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-10-validation-group-join` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-11-attribution-abstain-or-loud` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-11-attribution-spot-audit-measurement` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-11-attribution-verdict-interface` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-11-evidence-judge-cli-and-cutover` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-11-finish-step-engine-completion-machinery` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-11-pipeline-state-durability` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-11-semantic-attribution-verification-lane` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-11-verdict-aware-resume-entry` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-12-judged-attribution-verdict-persistence` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-12-progress-aware-build-halt` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-12-rebase-evidence-stamp-translation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-12-wired-into-contract` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-12-wiring-check-gate` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-13-kickback-build-no-op-escalation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-13-park-all-dispatch-paths` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-13-retry-classify-rerun-vs-route` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-13-session-fresh-verdict-artifacts` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-17-verify-only-judged-closure` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-20-bounded-dirname-path-corroboration` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-20-ci-fix-dispatch-via-steprunner` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-20-post-rebase-delta-aware-invalidation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-21-completeness-as-build-review-rubric` — Narrowed out: explicitly fully superseded; successor governs.
- `adr-2026-07-21-decide-time-unmerged-overlap-scan` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-21-demote-task-stamping-to-telemetry` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-21-engine-owned-acceptance-red-execution` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-21-intake-only-enforcement` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-21-no-diff-task-evidence-stamp` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-21-owner-stamped-at-authoring` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-21-s-tier-pipeline-knobs` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-21-serena-removal-path` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-attempts-counter-on-crash-recovery` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-auth-failure-classification-observed-401-patterns` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-build-dispatch-json-usage-capture` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-canonical-tagged-source-ref` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-canonical-tracker-client-seam` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-coherence-gate-placement-and-validation-split` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-daemon-level-missing-credential-gate` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-examples-state-isolation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-gate-evidence-code-validity-on-redispatch` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-headless-vs-guided-examples` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-heartbeat-lease-deferred` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-intake-closed-issue-reconciliation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-origin-refresh-before-engine-rebuild` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-per-task-work-happened-floor` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-phase-scoped-docs-write-guard` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-requeue-claimed-distinct-from-reopen` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-stale-claim-staleness-window-default` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-22-token-liveness-probe-via-cli-invocation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-23-build-review-fresh-base-disposition` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-23-commit-movement-liveness-floor` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-23-intake-label-authority-scoped-replace` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-23-session-hook-repair-before-halt` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-23-trailer-union-build-step-routing` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-25-content-addressed-full-suite-proof` — Narrowed out: explicitly fully superseded; successor governs.
- `adr-2026-07-25-custom-step-completion-artifacts` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-25-fail-closed-durable-shipment-evidence` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-26-daemon-decide-preseed-ownership` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-26-event-sink-registry-exhaustiveness` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-26-protected-artifact-seal-rebaseline` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-26-rebase-tail-current-branch-before-publication` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-27-ancestry-proven-park-reconciliation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-27-codex-never-resumes-a-harness-minted-session` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-27-cold-start-within-step-retries` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-27-daemon-decide-kickback-halt` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-27-project-config-scaffolder` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-28-feature-aware-artifact-resolution` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-28-total-halt-classification-legacy-boundary` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-29-codex-readiness-probe-failure-disposition` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-29-deterministic-build-verification-fanout` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-29-engine-observed-provider-time-partition` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-29-operator-park-scheduling-unit-boundary` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-29-ship-start-draft-pr` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-30-contract-aware-same-file-wiring` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-30-finish-only-mergeability-gate` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-30-pinned-remote-theme-for-pages-navigation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-07-30-provider-preparation-lifecycle-supervision` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-01-bot-owned-release-pr` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-01-conduct-state-mutation-port` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-01-engine-owned-resumable-finish-publication` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-01-engine-owned-scoped-test-invocation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-01-multi-proof-park-deletion-authority` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-01-rebase-full-replay-intent-validation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-01-scoped-run-verb-release-surface` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-02-plan-scope-containment-at-commit-boundary` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-03-build-repair-member-reuse-validity` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-03-fail-closed-decide-entry` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-03-ledgered-per-block-migration-execution` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-03-uncommitted-work-floor-under-build-completion` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-04-classify-before-spend-release-smoke-gate` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-04-live-tier-provisions-its-own-provider-home` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-04-unresolved-step-command-fails-by-name` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-05-blocked-classification-after-dedup` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-05-blocked-is-a-distinct-state-from-halted` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-05-build-settle-outcome-stamp` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-05-provenance-based-protected-artifact-inheritance` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-05-token-first-stories-reference-normalization` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-05-worktree-classification-evidence-derived-reasons` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-06-honest-park-termination-boundary` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-06-publication-progress-is-its-own-disposition` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-07-project-teardown-hook-contract-and-containment` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-07-worktree-removal-coverage-guard` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-08-finish-human-required-halt-rendering` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-08-pipeline-owned-closeout-timestamps` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-08-single-adr-approval-parser-three-rungs` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-adr-contradiction-detection-in-two-halves` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-checkout-is-sole-version-identity-authority` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-conductor-block-single-source-of-truth` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-declared-pattern-replication-in-build` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-hook-owned-containment-event-ledger` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-legacy-json-seed-migration-rule` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-non-blocking-plan-scope-containment` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-operator-only-scoped-artifact-reseal` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-recorded-red-exception-for-remediation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` — Narrowed out: explicitly fully superseded; successor governs.
- `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-seal-rotation-authorship-predicate` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-09-worktree-local-provider-scratch` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-11-deprecated-no-op-step-retirement` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-11-halt-events-ride-the-persisted-spine` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-12-cumulative-build-review-convergence-bound` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-12-execution-lifecycle-completeness-for-timing` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-12-fail-closed-intake-ledger-durability` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-12-live-provider-coverage-from-plugin-registry` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-12-operator-reseal-as-second-scope-justification` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-12-per-provider-live-smoke-legs` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-12-removal-anchored-tautology-exemption` — Narrowed out: explicitly fully superseded; successor governs.
- `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-13-durable-base-advance-attribution` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-13-engine-managed-build-review-rubric-branches` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-13-markdown-default-inversion` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-13-stable-build-review-finding-dispositions` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-14-retire-build-review-wiring-rubric` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-15-verify-only-anchored-tautology-exemption` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-16-closed-build-review-finding-vocabularies` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-16-preservation-anchored-completeness-exemption` — Narrowed out: explicitly fully superseded; successor governs.
- `adr-2026-08-16-restore-the-current-head-publication-fence` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-17-framework-agnostic-tautology-scoped-run` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-17-structural-live-checkout-containment` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-18-content-anchored-finding-reference-schema` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-19-live-provider-stream-observation` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-21-engine-identity-in-build-review-cache-key` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-21-review-bound-by-plan-done-when-criteria` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-22-as-built-review-runs-always-with-plan-gap` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-22-build-review-opt-in-rubric-container` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-22-done-when-evidence-at-task-close` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-22-one-owner-per-review-question` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-23-committed-halt-record` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-23-criterion-layer-is-structural-at-land` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-23-diff-locality-is-an-authored-disposition` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-24-evidentiary-defects-are-not-waivable` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-24-refused-step-status` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-26-music-vocabulary-player-composer-rename` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-26-remove-retrospectives-one-shot` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-26-setup-once-per-worktree-marker` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-26-shared-coherence-parser-at-discovery` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-27-daemon-dispatcher-executor-seam` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-29-build-review-remediate-case-adjudication` — Narrowed out: explicitly fully superseded; successor governs.
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-29-operator-authorized-kickback-budget-recovery` — Narrowed out: explicitly fully superseded; successor governs.
- `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
- `adr-2026-08-30-shared-plan-task-reference-resolver` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-31-coverage-binding-judge-step` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-08-31-kickback-ledger-read-fails-closed` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-09-02-adr-decision-citability-contract` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-09-05-gh-cli-version-floor-and-environment-gate` — Narrowed out: subject outside this feature’s test-quality selection/result boundary; no change to its behavior.
- `adr-2026-09-06-engine-owned-test-quality-scope` — Examined: review scope, identity, evidence, or bounded recovery obligations; retain partial amendments.
