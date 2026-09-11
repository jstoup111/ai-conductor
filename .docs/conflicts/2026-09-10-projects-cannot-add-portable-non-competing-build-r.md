# Conflict Check: Portable, non-competing build review policy

**Date:** 2026-09-10
**Status:** PASS — zero remaining conflicts after operator-approved architecture amendment
**Scope:** Accepted #1986 Stories 1–18 and approved product requirements, including #1804 effective-policy caching and excluding general #1344 custom-step redesign
**ADR corpus:** `repo_wide`, explicitly configured in `.ai-conductor/config.yml`
**Result:** 1 blocking state conflict resolved; 0 remaining blocking conflicts; 0 degrading conflicts
**Resolution approval:** James Stoup, 2026-09-10, after plain-English review of the two approval subjects and package-update persistence.
**Next gate:** Implementation planning; the amended Story 17 remains Accepted under that approval.

## Corpus and method

Recursively inventoried and full-text indexed 472 story files, 53 specification files, 257 prior conflict reports, and 570 decision-directory files, including nested epic/feature stories. Subject and content screening identified the review, provider, policy-loading, disposition, evidence, containment, and recovery comparisons. The appendix records the ADR scope decisions. Full supersession is distinguished from partial amendment: partially superseded decisions remain comparison inputs for their surviving obligations.

Compared the new stories' shared behaviors in both directions, then compared them with relevant existing story clauses and selected ADR decisions. All six conflict types were considered: contradiction, behavioral overlap, state conflict, resource contention, sequencing, and oscillation. Search hits identify candidate text, not semantic incompatibility. No unrelated legacy-versus-legacy inconsistency is treated as a new feature blocker. Re-check includes the approved coverage-identity ADR and the corrected Story 17 against loading failures, provenance, cache identity, operator authority, and recovery.

## Resolved conflict: Missing policy content cannot identify an operator coverage waiver

**Type / severity:** state-conflict / blocking, resolved
**Confidence:** 95%, inferred from directly verified opposing contracts; no runtime implementation failure is claimed
**Root / target:** Architecture — the original common custom-disposition identity required effective content even for a loading failure that has none.

**Resolution applied:** The operator selected separate subjects of approval. APPROVED `adr-2026-09-10-separate-custom-review-coverage-identity` D1–D4 now binds risk acceptance to a judged finding and effective content, while reduced coverage binds to the feature, validated custom declaration, and closed failure reason. The primary ADR, older cache-identity ADR, and infrastructure-fault ADR carry additive corrections beside their original clauses. Story 17 was corrected in place without an amendment note and now has seven criteria.

The accepted cost is explicit: a coverage waiver survives a package update while the same declared obligation has the same failure reason. It does not attest to package safety, authorize a reviewer without containment, suppress a later finding, or make an entirely unjudged lap pass. Changed declaration or failure reason requires new approval. The rejected alternatives were making first-use loading failures unwaivable, or requiring last-known content that still cannot exist on first use.

### Re-check of the resolution

| Pair | First direction | Reverse direction | Result |
|---|---|---|---|
| S3/S6 missing or incomplete policy vs S17.2 digestless coverage | Loading reports no judged content; coverage needs no content digest | Applying coverage still records the failed branch as unjudged | compatible |
| S7/S8 judged provenance/cache vs S17.2/S17.3 coverage | Valid judged cache entries still require complete effective identity | Digestless coverage cannot supply a judged result or cache hit | compatible |
| S17.1 risk acceptance vs S17.3 package-change persistence | Changed content invalidates risk matching only | Persistent coverage acts on the observed failure, not on findings | compatible |
| S17.3 persistence vs S17.5 declaration/reason mismatch | Package changes do not change the declared coverage obligation | Changed declaration or reason is a new obligation/failure and cannot match | compatible |
| S17.7 healed or entirely unjudged lap vs S11 mixed-lap routing | A healed branch's findings remain subject to ordinary adjudication | A covered failed sibling does not erase unresolved content or the minimum judged-coverage condition | compatible |
| S16 restart and S17.6 late operator decision vs distinct matching | Durable records retain their own subject and attribution | Re-reading exact current authority does not duplicate effects or rewrite risk as coverage | compatible |
| Infrastructure-fault ADR D7/D8 vs approved coverage amendment | Built-in keys and authority stay unchanged | Custom declarations add a validated subject without free-text diagnostic identity | compatible |

**Re-check verdict:** PASS. No remaining contradiction, incompatible overlap, impossible state, exclusive-resource demand, circular sequencing, or repair oscillation was found for the amended identity behavior.

## Other interactions examined

For each row, satisfying the first side preserves the second and vice versa under the stated boundary. The previously blocking coverage-identity pair is now resolved as recorded above.

| Shared behavior / new stories | Existing party and compatibility reasoning |
|---|---|
| Installed adoption, S1–S6 | Project skill overrides and ordinary lifecycle native invocation retain their own precedence. The approved new custom-review declaration has explicit ambiguity rules and review-role adaptation; it does not change `tdd` overrides, install links, or general custom steps. |
| Provider execution, S3/S5/S9 | Provider-aware step execution, first-class Codex adaptation, and one-dispatch-member ADRs: prepare each actual candidate, use one `invoke` seam, keep native policy and fresh sessions. Metadata discovery is not another model-dispatch member. |
| Fallback versus policy failure, S3/S5/S9 | Availability-ladder and per-step provider stories: provider/model unavailability retains existing fallback; authentication, rate limits, cancellation, and policy-loading failure do not become invented unavailability. |
| Lifecycle and scratch, S3/S5/S9/S10 | Preparation-supervision and worktree-local scratch ADRs: resolve under the existing attempt owner, enforce spawn permits, and clean up candidate-owned work. Existing scratch placement/leases remain authoritative; runtime policy evidence is not a second scratch reaper. |
| Isolation, S6/S10 | Live-checkout containment protects the live root while allowing BUILD writes; the separately scoped custom-review profile protects reviewer inputs. Its extra denial is not a global replacement of the writable BUILD environment or the self-host guard. |
| Caching and provenance, S7–S9/S18 | Engine identity and semantic-content cache stories: current prepared policy is a newly approved semantic input. Temporary paths, timestamps, and commit addresses alone remain excluded; original producing provenance is distinct from current reuse. |
| Built-in contract, S7/S13/S18 | Closed vocabulary, content-anchor, engine-envelope, and current testQuality scope ADRs retain their specialized built-in semantics. The new versioned custom contract does not change built-in vocabulary or return provider-owned envelope authority. A supplied envelope claim can be ignored and engine-stamped; its presence alone is not a new built-in rejection. |
| Join and mixed laps, S11–S13 | Post-join adjudication and mixed-lap ADR/story set: settle branches before one content decision, preserve infrastructure independently, and deliver no partial action set on an invalid or inconsistent decision. Infrastructure is never a semantic case. |
| Source completeness and settled recurrence, S12/S13/S15 | Post-join cases and confidence-floor stories: current eligible sources have complete outcomes; exact settled sources can skip judging; drifted sources still reach semantic comparison with retained history. Custom identity changes cannot erase prior cases. |
| Operator race, S13/S17 | Stable-disposition and late-acceptance contracts: re-read exact current operator state at application; a stored aggregate result is not permission to overwrite a later operator decision. Suppression stays non-blocking history, not accepted risk. |
| Decision ownership, S12/S14 | One-owner, plan-bound review, and implementation-only remediation contracts: custom reviewers cannot declare their own non-blocking scope escape or append plan work. The aggregate either admits a repair under existing tasks or stops at the owning decision. Legacy non-case remediation contracts remain supported. |
| Repair verification, S15/S18 | BUILD member-reuse and stale-test-proof contracts: progression requires current code-valid evidence, while a member's own valid content proof may permit reuse. No blanket repeat of an unaffected aggregate test suite is introduced. |
| Budget preservation, S15/S16 | Cumulative bounds, rebase refunds, and operator budget-recovery ADRs: policy changes/incidental code movement are not reset authority. Existing genuine gate-invalidation refunds, per-tree no-op counter semantics, fresh-session clearing, and explicit operator recovery are not removed. |
| Durable recovery, S7/S16 | Existing cases, charge ownership, conduct-state mutation, and ledger fail-closed ADRs: use the existing lease/atomic mutation owners; current stricter corruption handling governs rather than older fail-open ledger prose. No new ledger is added. |
| Observability, S7/S11/S16/S17 | Event-sink and persisted-halt ADRs: occurrences extend existing events; verdict/case/bundle data are state. Publication and operator views consume original attribution, not timestamps from a new side channel. |
| Legacy membership, S2/S18 | The opt-in container ADR and its approved #1986 amendment distinguish shipped built-ins from custom declarations. Historical four-rubric/default-on or only-one-shipped-member assertions do not re-enable retired policies or prohibit this explicitly approved extension. Unknown legacy keys still reject. |

## Previous-conflict lessons applied

- The one-owner report distinguishes historical retired rubric assertions from current authority; it does not justify ignoring surviving operator or evidence contracts.
- The post-join report resolved infrastructure hiding actionable siblings; that ordering remains, with the new consistency/decision stop preceding action authorization.
- The confidence-floor report keeps suppression and exact settled recurrence separate from current source completeness and operator acceptance.
- The rebase-refund report rejects a lifetime-only budget reinterpretation; this feature preserves its precise refund trigger.
- The provider-preparation and worktree-scratch reports preserve attempt ownership, cleanup, and containment boundaries rather than adding independent process control.

## Verify-Claims Ledger

- **Verified:** Corpus counts and the `repo_wide` setting were read in this isolated spec worktree. Approval/supersession decisions use recorded status and amendment text, not issue titles or assumptions about implementation dates.
- **Verified:** Existing reduced-coverage identity is `{rubric, reason}` in its own record kind and matcher. The approved amendment preserves that built-in behavior and adds a distinct validated custom subject.
- **Operator-approved:** The identity distinction and persistence cost were approved on 2026-09-10 and applied in DECIDE. Re-check explicitly reasons through both directions of loading, cache, matching, healing, and recovery interactions.
- **Not assumed:** Private-policy compatibility, live provider behavior beyond previously inspected interfaces, or model semantic correctness.

**Verdict:** PASS. Zero blocking or degrading conflicts remain. The review marker remains because a blocking conflict was found and resolved; operator approval of that resolution is recorded above.

## ADR inventory appendix

The pre-proposal inventory contains 311 ADR-named files: 42 retained for overlapping decision comparison, 259 approved/partially amended subjects narrowed out, 6 unambiguously superseded standalone authorities, and 4 other-status entries. The additional coverage-identity ADR is now APPROVED and was included in the re-check.

### Examined overlapping ADRs

- `adr-2026-09-10-separate-custom-review-coverage-identity` — approved resolution, examined in re-check

These are retained with their applicable amendments; partial supersession does not remove their surviving decisions. The interaction table above records the comparison basis by shared concern.

- `adr-2026-07-03-reactive-model-fallback-ladder`
- `adr-2026-07-12-wiring-check-gate` — partial supersession retained
- `adr-2026-07-23-build-review-fresh-base-disposition`
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
- `adr-2026-07-25-content-addressed-full-suite-proof` — partial supersession retained
- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation`
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound`
- `adr-2026-07-26-event-sink-registry-exhaustiveness`
- `adr-2026-07-27-daemon-decide-kickback-halt`
- `adr-2026-07-29-deterministic-build-verification-fanout`
- `adr-2026-07-30-provider-preparation-lifecycle-supervision`
- `adr-2026-08-01-conduct-state-mutation-port`
- `adr-2026-08-03-build-repair-member-reuse-validity`
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts`
- `adr-2026-08-09-non-blocking-plan-scope-containment`
- `adr-2026-08-09-worktree-local-provider-scratch`
- `adr-2026-08-11-halt-events-ride-the-persisted-spine`
- `adr-2026-08-12-cumulative-build-review-convergence-bound`
- `adr-2026-08-13-engine-managed-build-review-rubric-branches`
- `adr-2026-08-13-stable-build-review-finding-dispositions`
- `adr-2026-08-14-retire-build-review-wiring-rubric`
- `adr-2026-08-16-closed-build-review-finding-vocabularies`
- `adr-2026-08-17-structural-live-checkout-containment`
- `adr-2026-08-18-content-anchored-finding-reference-schema`
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`
- `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`
- `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope`
- `adr-2026-08-21-engine-identity-in-build-review-cache-key`
- `adr-2026-08-21-review-bound-by-plan-done-when-criteria`
- `adr-2026-08-22-build-review-opt-in-rubric-container`
- `adr-2026-08-22-one-owner-per-review-question`
- `adr-2026-08-24-one-dispatch-member-on-the-provider-contract`
- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal`
- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode`
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`
- `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded`
- `adr-2026-08-30-shared-plan-task-reference-resolver`
- `adr-2026-08-31-kickback-ledger-read-fails-closed`
- `adr-2026-09-06-engine-owned-test-quality-scope`
- `adr-2026-09-06-reopened-task-resolution`
- `adr-2026-09-10-portable-build-review-policy`

### Fully superseded standalone authorities

Excluded as independent authority only where the recorded status explicitly fully supersedes the ADR. The case-adjudication and budget-recovery successors explicitly carry forward parts of their predecessors; those adopted clauses are considered through the successor, not discarded.

- `adr-2026-07-21-completeness-as-build-review-rubric` — Status: SUPERSEDED by adr-2026-08-22-one-owner-per-review-question
- `adr-2026-08-12-removal-anchored-tautology-exemption` — Status: SUPERSEDED by adr-2026-08-22-one-owner-per-review-question
- `adr-2026-08-15-verify-only-anchored-tautology-exemption` — Status: SUPERSEDED by adr-2026-08-22-one-owner-per-review-question
- `adr-2026-08-16-preservation-anchored-completeness-exemption` — Status: SUPERSEDED by adr-2026-08-22-one-owner-per-review-question status.
- `adr-2026-08-29-build-review-remediate-case-adjudication` — Status: Superseded by adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication
- `adr-2026-08-29-operator-authorized-kickback-budget-recovery` — Status: Superseded by adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class

### Narrowed-out ADR subjects

The following inventoried subjects do not change a shared behavior/resource in this feature. Unchanged install/release, discovery scheduling, publication transport, telemetry exporters, unrelated skill workflows, and other gate internals are outside this comparison. Their mention of providers or review as context alone does not create overlap. This list is a scope exclusion, not a verdict that those artifacts have no conflicts among themselves.

- `adr-002-engineer-store-and-retro-redirect`
- `adr-003-registry-write-and-integration`
- `adr-005-non-autonomy-and-read-only-governor`
- `adr-006-flywheel-lesson-selection-and-provenance`
- `adr-008-agent-hosted-loop-and-in-chat-authoring`
- `adr-009-intake-adapter-port`
- `adr-010-pidfile-lock-daemon-liveness`
- `adr-011-async-intake-queue-and-github-source`
- `adr-012-durable-intake-ledger-sole-dedup-authority`
- `adr-014-otel-observability-exporter`
- `adr-015-daemon-pr-labeling-sweep`
- `adr-2026-06-29-architecture-before-stories-convergent-kickback`
- `adr-2026-06-29-brainstorm-rename-migration`
- `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting`
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
- `adr-2026-07-04-event-driven-halt-clear-wake`
- `adr-2026-07-04-kickback-event-emission-and-log-prominence`
- `adr-2026-07-04-pending-restart-queue`
- `adr-2026-07-04-resolution-worktree-lifecycle`
- `adr-2026-07-04-respawn-in-place-restart`
- `adr-2026-07-04-versioned-engine-store-atomic-flip`
- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`
- `adr-2026-07-05-daemon-rate-limit-episode-coordinator`
- `adr-2026-07-05-engine-owned-task-status`
- `adr-2026-07-05-halt-pr-presentation-reliability`
- `adr-2026-07-05-retry-as-escalation-ladder`
- `adr-2026-07-05-standalone-bin-update`
- `adr-2026-07-06-daemon-false-ship-guard`
- `adr-2026-07-06-installed-root-resolution-for-global-writes`
- `adr-2026-07-06-manual-test-fail-routing`
- `adr-2026-07-06-migration-gate-waiver`
- `adr-2026-07-06-stale-engine-respawn-in-place`
- `adr-2026-07-07-audit-trail-event-sink`
- `adr-2026-07-07-daemon-owned-build-credential`
- `adr-2026-07-07-finish-record-primitive`
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
- `adr-2026-07-10-intra-step-build-progress-events`
- `adr-2026-07-10-observed-close-watch-registry`
- `adr-2026-07-10-park-marker-main-root-resolution`
- `adr-2026-07-10-retire-migration-grandfather`
- `adr-2026-07-10-session-hook-task-stamping`
- `adr-2026-07-10-validation-group-join`
- `adr-2026-07-11-attribution-abstain-or-loud`
- `adr-2026-07-11-attribution-spot-audit-measurement`
- `adr-2026-07-11-attribution-verdict-interface`
- `adr-2026-07-11-evidence-judge-cli-and-cutover`
- `adr-2026-07-11-finish-step-engine-completion-machinery`
- `adr-2026-07-11-pipeline-state-durability`
- `adr-2026-07-11-semantic-attribution-verification-lane`
- `adr-2026-07-11-verdict-aware-resume-entry`
- `adr-2026-07-12-progress-aware-build-halt`
- `adr-2026-07-12-rebase-evidence-stamp-translation`
- `adr-2026-07-12-wired-into-contract`
- `adr-2026-07-13-kickback-build-no-op-escalation`
- `adr-2026-07-13-park-all-dispatch-paths`
- `adr-2026-07-13-retry-classify-rerun-vs-route`
- `adr-2026-07-13-session-fresh-verdict-artifacts`
- `adr-2026-07-17-verify-only-judged-closure`
- `adr-2026-07-20-bounded-dirname-path-corroboration`
- `adr-2026-07-20-ci-fix-dispatch-via-steprunner`
- `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification`
- `adr-2026-07-20-post-rebase-delta-aware-invalidation`
- `adr-2026-07-21-decide-time-unmerged-overlap-scan`
- `adr-2026-07-21-demote-task-stamping-to-telemetry`
- `adr-2026-07-21-engine-owned-acceptance-red-execution`
- `adr-2026-07-21-intake-only-enforcement`
- `adr-2026-07-21-no-diff-task-evidence-stamp`
- `adr-2026-07-21-owner-stamped-at-authoring`
- `adr-2026-07-21-s-tier-pipeline-knobs`
- `adr-2026-07-21-serena-removal-path`
- `adr-2026-07-22-attempts-counter-on-crash-recovery`
- `adr-2026-07-22-auth-failure-classification-observed-401-patterns`
- `adr-2026-07-22-build-dispatch-json-usage-capture`
- `adr-2026-07-22-canonical-tagged-source-ref`
- `adr-2026-07-22-canonical-tracker-client-seam`
- `adr-2026-07-22-coherence-gate-placement-and-validation-split`
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim`
- `adr-2026-07-22-daemon-level-missing-credential-gate`
- `adr-2026-07-22-examples-state-isolation`
- `adr-2026-07-22-gate-evidence-code-validity-on-redispatch`
- `adr-2026-07-22-headless-vs-guided-examples`
- `adr-2026-07-22-heartbeat-lease-deferred`
- `adr-2026-07-22-intake-closed-issue-reconciliation`
- `adr-2026-07-22-origin-refresh-before-engine-rebuild`
- `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record`
- `adr-2026-07-22-per-task-work-happened-floor`
- `adr-2026-07-22-phase-scoped-docs-write-guard`
- `adr-2026-07-22-requeue-claimed-distinct-from-reopen`
- `adr-2026-07-22-stale-claim-staleness-window-default`
- `adr-2026-07-22-token-liveness-probe-via-cli-invocation`
- `adr-2026-07-23-commit-movement-liveness-floor`
- `adr-2026-07-23-intake-label-authority-scoped-replace`
- `adr-2026-07-23-session-hook-repair-before-halt`
- `adr-2026-07-23-trailer-union-build-step-routing`
- `adr-2026-07-25-custom-step-completion-artifacts`
- `adr-2026-07-25-fail-closed-durable-shipment-evidence`
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation`
- `adr-2026-07-26-daemon-decide-preseed-ownership`
- `adr-2026-07-26-protected-artifact-seal-rebaseline`
- `adr-2026-07-26-rebase-tail-current-branch-before-publication`
- `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates`
- `adr-2026-07-27-ancestry-proven-park-reconciliation`
- `adr-2026-07-27-codex-never-resumes-a-harness-minted-session`
- `adr-2026-07-27-cold-start-within-step-retries`
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state`
- `adr-2026-07-27-project-config-scaffolder`
- `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`
- `adr-2026-07-28-feature-aware-artifact-resolution`
- `adr-2026-07-28-total-halt-classification-legacy-boundary`
- `adr-2026-07-29-codex-readiness-probe-failure-disposition`
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main`
- `adr-2026-07-29-engine-observed-provider-time-partition`
- `adr-2026-07-29-operator-park-scheduling-unit-boundary`
- `adr-2026-07-29-ship-start-draft-pr`
- `adr-2026-07-30-contract-aware-same-file-wiring`
- `adr-2026-07-30-finish-only-mergeability-gate`
- `adr-2026-07-30-pinned-remote-theme-for-pages-navigation`
- `adr-2026-08-01-bot-owned-release-pr`
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
- `adr-2026-08-06-publication-progress-is-its-own-disposition`
- `adr-2026-08-07-project-teardown-hook-contract-and-containment`
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts`
- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization`
- `adr-2026-08-07-worktree-removal-coverage-guard`
- `adr-2026-08-08-finish-human-required-halt-rendering`
- `adr-2026-08-08-pipeline-owned-closeout-timestamps`
- `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition`
- `adr-2026-08-08-single-adr-approval-parser-three-rungs`
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance`
- `adr-2026-08-09-adr-contradiction-detection-in-two-halves`
- `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`
- `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config`
- `adr-2026-08-09-checkout-is-sole-version-identity-authority`
- `adr-2026-08-09-conductor-block-single-source-of-truth`
- `adr-2026-08-09-declared-pattern-replication-in-build`
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`
- `adr-2026-08-09-hook-owned-containment-event-ledger`
- `adr-2026-08-09-legacy-json-seed-migration-rule`
- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`
- `adr-2026-08-09-operator-only-scoped-artifact-reseal`
- `adr-2026-08-09-recorded-red-exception-for-remediation`
- `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`
- `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`
- `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator`
- `adr-2026-08-09-seal-rotation-authorship-predicate`
- `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag`
- `adr-2026-08-11-deprecated-no-op-step-retirement`
- `adr-2026-08-12-execution-lifecycle-completeness-for-timing`
- `adr-2026-08-12-fail-closed-intake-ledger-durability`
- `adr-2026-08-12-live-provider-coverage-from-plugin-registry`
- `adr-2026-08-12-operator-reseal-as-second-scope-justification`
- `adr-2026-08-12-per-provider-live-smoke-legs`
- `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns`
- `adr-2026-08-13-durable-base-advance-attribution`
- `adr-2026-08-13-markdown-default-inversion`
- `adr-2026-08-16-restore-the-current-head-publication-fence`
- `adr-2026-08-17-framework-agnostic-tautology-scoped-run`
- `adr-2026-08-19-live-provider-stream-observation`
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port`
- `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch`
- `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind`
- `adr-2026-08-22-as-built-review-runs-always-with-plan-gap`
- `adr-2026-08-22-done-when-evidence-at-task-close`
- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`
- `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote`
- `adr-2026-08-23-criterion-layer-is-structural-at-land`
- `adr-2026-08-23-diff-locality-is-an-authored-disposition`
- `adr-2026-08-24-evidentiary-defects-are-not-waivable`
- `adr-2026-08-24-over-scope-decision-block-and-durable-refusals`
- `adr-2026-08-24-refused-step-status`
- `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope`
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`
- `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot`
- `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity`
- `adr-2026-08-26-music-vocabulary-player-composer-rename`
- `adr-2026-08-26-remove-retrospectives-one-shot`
- `adr-2026-08-26-setup-once-per-worktree-marker`
- `adr-2026-08-26-shared-coherence-parser-at-discovery`
- `adr-2026-08-27-daemon-dispatcher-executor-seam`
- `adr-2026-08-31-coverage-binding-judge-step`
- `adr-2026-09-02-adr-decision-citability-contract`
- `adr-2026-09-05-gh-cli-version-floor-and-environment-gate`
- `adr-2026-09-06-inbound-intake-trust-boundary`
- `adr-2026-09-07-durable-prd-widening-decision-reconciliation`

### Other-status inventory entries

These have no recognized approval declaration and no changed subject overlap; no supersession is inferred from missing status.

- `adr-2026-07-04-operator-park-marker` — no recognized status line
- `adr-2026-07-04-park-unpark-cli-verbs` — no recognized status line
- `adr-2026-07-12-judged-attribution-verdict-persistence` — no recognized status line
- `adr-2026-08-23-committed-halt-record` — no recognized status line

> **Amended 2026-09-11 by #1986 (main integration):** Rechecked the newly merged #2409 amendment to the shared case and mixed-lap ADRs against this feature. Refuted re-raises settle through the approved predecessor-owned one-time evidence-backed lane; unrefuted attempted acts retain the repeat stop. The criterion/plan references are qualified accordingly, and the implementation is dependency-ordered after #2409 rather than duplicated here. Both sides of the textual merge conflict are retained. Result: PASS, no remaining substantive conflict.
