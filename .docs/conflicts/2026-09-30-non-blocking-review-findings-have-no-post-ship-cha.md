# Conflict Check: Durable operator actions and implementation issue closures

**Date:** 2026-09-30
**Source:** jstoup111/ai-conductor#1810
**Stories:** [Accepted stories](../stories/non-blocking-review-findings-have-no-post-ship-cha.md)
**ADR corpus:** `repo_wide`, explicitly configured in `.ai-conductor/config.yml`
**Verdict:** CLEAN — zero blocking conflicts and zero accepted degrading compromises.
**Resolution approval:** Operator, 2026-09-30: “approve” to merge-time closure and the scoped predecessor corrections.

## Inventory and scope

Indexed the full text of 518 story files, 61 spec files, 637 decision/review files, and 307
prior conflict reports. Subject/full-text screening selected intersecting review, action,
publication, storage, seal, and event contracts. The manifest is retained locally in
`.pipeline/conflict-inventory-1810.json`; the ADR disposition appendix lists the repo-wide corpus.
Unrelated historical pairs are not asserted to be globally consistent. Partial/ambiguous
supersession did not exclude relevant ADRs; the adopted case/effect predecessor remained selected.

The approved new stories, the four earlier ADR amendments, and the three earlier story corrections
were the input. This rerun also checks the newly approved predecessor corrections in place.

## Resolved conflicts

| Conflict | Type / original severity | Resolution applied | Governing approval |
|---|---|---|---|
| Watched origins used non-closing references while new Story 15 requires merge closure | contradiction / blocking | The July 10 observed-close ADR now defers overlapping implementation linkage to new ADR D10-D11; its story text explicitly scopes independent observation operations outside this workflow. New Story 15 and the closure sequence assert watched markers cannot downgrade the approved closing targets. No observation-marker gate or watcher is introduced. | Operator-approved option 1, 2026-09-30 |
| Origin-only skips and warn-only linkage contradict extras-only, verified FINISH publication | overlap and sequencing / blocking | Legacy issue-link stories now skip only when origin and extras are absent, preserve spec non-closing references, and report implementation linkage incomplete on failure. Additive notes qualify the old PRD and July 3 / July 11 FINISH ADRs. Halt rehabilitation folds its prior supersession block into the common in-step behavior and distinguishes title facets from closure verification. | Accepted FR-13/FR-15/FR-16 plus scoped correction approval |
| An older recurrence story treats every reserved remote effect as a blocker | state-conflict / blocking | Confidence-floor Story 6 now distinguishes the required local handoff/BUILD effects from optional remote publication; the settlement predicate stays read-only and exact-ID based. | Accepted FR-8, new ADR D5, and scoped correction approval |

Original evidence was read directly: the watched ADR's “Signature declared → inject `Refs`”
clause opposed new Story 15's closing references for all targets; the old issue-link Story 4
skipped any undefined sourceRef; the old confidence-floor Story 6 kept any reserved deferral live.
The previous report presented their exact opposing text and options. This current report records
the applied outcomes; version history preserves earlier reports after commit.

## Two-direction recheck

| Shared boundary | New-to-existing check | Existing-to-new check | Result |
|---|---|---|---|
| Review classification | Capture follows classified/fresh results, preserving raw blockers, security judgement and infrastructure precedence. | Legitimate deferral/accepted risk/suppression can retain evidence without another review or repair. | Compatible |
| Review settlement | Required local handoff settles only non-blocking deferral/residual outcomes; live control corruption still fails. | Genuine BUILD effects and decision/infrastructure stops remain blockers; optional publication does not become required again. | Compatible after correction |
| PRD authority | Action decisions never accept/refuse widening or rewrite PRD history. | Prior risk acceptance remains visible while follow-up can stay open. | Compatible |
| Historical identity | Exact source replay preserves later decisions; repaired/refuted findings are not reopened. | Existing judged case relationships can be reused without fuzzy matching or another model. | Compatible |
| Intake publication | Explicit filing uses the guarded canonical intake boundary and stable marker recovery. | Intake ledger remains consumption authority; local actions do not consume issues or authorize unrequested filing. | Compatible |
| Dispatcher and cleanup | Executors write worktree sources only; outer collection owns repository actions after release. | Shipped-record authority still controls cleanup; import failure leaves recoverable committed evidence rather than halting a ship. | Compatible |
| Events | State uses existing case machinery and occurrences use the existing union/sinks; standalone ledgers remain same-schema single-writer. | Existing timeline explicitly consumes new variants; no new watcher or competing occurrence authority. | Compatible |
| Closure authority | Approved committed descriptor survives automatic rebaseline; explicit reseal owns intentional changes. | Existing fingerprint rotation can continue without adopting BUILD-added targets or permitting blanket reseal. | Compatible |
| Merge versus observation | Implementation origin/extras close at merge; old marker cannot downgrade references. | Independently enrolled watches outside this operation are not removed or mutated. | Compatible after operator decision |
| Extras-only and legacy origins | Explicit extras survive absent origin; strict extras parsing does not change legacy origin grammar. | Origin-only GitHub behavior stays available; Jira origin compatibility adds no unsupported Jira closure promise. | Compatible after correction |
| PR body ownership | Complete engine-owned closing projection preserves unrelated/project-owned body regions. | Project regions cannot claim engine closing references or establish target authority. | Compatible |
| FINISH failure | Typed incomplete/refused linkage remains FINISH-owned, with declarations and existing PR intact. | Observe-before-act/verify-after-write publication remains shared by attended and daemon modes; no BUILD repair or false success. | Compatible after correction |

All six types were evaluated: the three resolved groups account for contradiction, overlap,
state, and sequencing conflicts; leases and separated storage authority avoid a new resource
contention conflict. The opposing rules that could have produced an oscillation are now scoped
or superseded, so neither implementation route re-breaks the other. No new architectural seam
or unsupported capability was invented to resolve them.

## Verify-Claims Ledger

- [Verified, 99%] The configured corpus is repo-wide and the listed relevant predecessors retain
  their applicable clauses despite partial supersession.
- [Verified, 99%] Current issue-ref source uses unconditional origin `Closes`; searches across
  source, launchers, skills, and tests found no observed-close implementation. This was treated as
  an approved contract conflict, not as proof that the older approval had vanished.
- [Verified, 99%] The approved additive notes and in-place story replacements now state the same
  closure precedence, extras-only behavior, linkage failure result, and local settlement meaning.
- [Confirmed] Operator chose the concrete merge-time resolution and predecessor corrections.

**Verify-claims verdict:** CLEAR. No unconfirmed load-bearing assumption remains for planning.
The review-required marker remains because three blocking groups were found and resolved.
No executable tests were needed for this artifact-only conflict pass.

## ADR corpus dispositions

The list records all ADR files screened. Partial or ambiguous supersession is never used alone
to discard a relevant ADR. The adopted build-review predecessor remains in the examined set.

| ADR | Recorded status | Disposition |
|---|---|---|
| `adr-002-engineer-store-and-retro-redirect` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-003-registry-write-and-integration` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-005-non-autonomy-and-read-only-governor` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-006-flywheel-lesson-selection-and-provenance` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-008-agent-hosted-loop-and-in-chat-authoring` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-009-intake-adapter-port` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-010-pidfile-lock-daemon-liveness` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-011-async-intake-queue-and-github-source` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-012-durable-intake-ledger-sole-dedup-authority` | APPROVED | Examined — relevant boundary above |
| `adr-014-otel-observability-exporter` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-015-daemon-pr-labeling-sweep` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-architecture-before-stories-convergent-kickback` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-brainstorm-rename-migration` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-explore-prd-split-track-in-explore` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-memory-resilience-write-fallback-and-reconcile` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-per-project-memory-provider-selection` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-per-provider-retrieval-guidance-location` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-platform-adoption-and-removal-surface` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-rebase-conflict-resolution-dispatch` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-safe-reversible-memory-migration` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-shared-memory-store-placement-and-durability` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-29-track-marker-location` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-30-background-intake-brain-loop` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-30-engineer-worktree-authoring-isolation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-30-grandfather-cutover-merge-time` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-30-halt-based-release-gates` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-30-origin-seeded-intake-routing` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-30-owner-gate-identity-resolution` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-30-owner-provenance-recording` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-30-sandbox-build-isolation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-06-30-self-host-detection-seam` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-01-machine-scoped-operator-identity` | Approved | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-daemon-auto-restart-stale-engine` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-dependency-fail-closed-and-cache` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-dependency-gate-backlog-waiting-channel` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-gated-snapshot-status-read-model` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-gated-writeback-announcements` | SUPERSEDED by adr-2026-09-11-github-operation-ownership | Excluded — explicit full supersession; outside intersecting subjects |
| `adr-2026-07-03-generated-model-table-single-source` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-halt-pr-rehabilitation-at-finish` | APPROVED | Examined — relevant boundary above |
| `adr-2026-07-03-harness-daemon-profile` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-issue-dependencies-api-surface` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-owner-gate-gated-channel` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-post-rebase-force-with-lease` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-pr-timing-config-key` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-pr-timing-self-host-precedence` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-priority-fetch-fail-soft` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-priority-from-linked-issue-labels` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-prose-to-link-migration` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-reactive-model-fallback-ladder` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-03-version-gate-semver-escalation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-auth-failure-park-and-poll` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-autoresolve-state-and-config` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-claim-time-delivery-evidence-guard` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-durable-pause-marker` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-event-driven-halt-clear-wake` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-kickback-event-emission-and-log-prominence` | APPROVED (amended 2026-07-04: front-half cap enforcement added at conflict-check; re-approved by operator) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-operator-park-marker` | No parsed approval marker | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-park-unpark-cli-verbs` | No parsed approval marker | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-pending-restart-queue` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-resolution-worktree-lifecycle` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-respawn-in-place-restart` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-versioned-engine-store-atomic-flip` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-05-daemon-rate-limit-episode-coordinator` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-05-engine-owned-task-status` | APPROVED — Fable-validated 2026-07-05. First pressure-tested under Opus (2026-07-05), | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-05-halt-pr-presentation-reliability` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-05-retry-as-escalation-ladder` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-05-standalone-bin-update` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-06-daemon-false-ship-guard` | APPROVED (operator-approved 2026-07-06, engineer session) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-06-installed-root-resolution-for-global-writes` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-06-manual-test-fail-routing` | APPROVED (operator-selected Approach B, 2026-07-06 session decision) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-06-migration-gate-waiver` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-06-stale-engine-respawn-in-place` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-07-audit-trail-event-sink` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-07-daemon-owned-build-credential` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-07-finish-record-primitive` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-07-ship-ci-feedback-loop` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-07-single-generation-stale-respawn` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-07-task-trailer-id-alias` | APPROVED (operator-approved 2026-07-07) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-08-halt-issue-closure-sweep` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-08-main-checkout-leak-triage-and-write-fence` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-09-deterministic-evidence-attribution-enforcement` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-09-setup-failure-triage` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-10-concurrent-group-core` | APPROVED (operator-approved 2026-07-10) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-10-daemon-stall-remediation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-10-evidence-range-anchor-resolution` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-10-inline-work-attribution-enforcement` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-10-intake-claim-priority-banding` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-10-intra-step-build-progress-events` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-10-observed-close-watch-registry` | APPROVED | Examined — relevant boundary above |
| `adr-2026-07-10-park-marker-main-root-resolution` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-10-retire-migration-grandfather` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-10-session-hook-task-stamping` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-10-validation-group-join` | APPROVED (operator-approved 2026-07-10) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-11-attribution-abstain-or-loud` | APPROVED (operator, 2026-07-11) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-11-attribution-spot-audit-measurement` | APPROVED (operator, 2026-07-11) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-11-attribution-verdict-interface` | APPROVED (operator, 2026-07-11) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-11-evidence-judge-cli-and-cutover` | APPROVED (operator, 2026-07-11) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-11-finish-step-engine-completion-machinery` | APPROVED | Examined — relevant boundary above |
| `adr-2026-07-11-pipeline-state-durability` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-11-semantic-attribution-verification-lane` | APPROVED (operator, 2026-07-11) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-11-verdict-aware-resume-entry` | APPROVED; finish-boundary behavior amended by | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-12-judged-attribution-verdict-persistence` | No parsed approval marker | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-12-progress-aware-build-halt` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-12-rebase-evidence-stamp-translation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-12-wired-into-contract` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-12-wiring-check-gate` | SUPERSEDED in part by `adr-2026-07-29-deterministic-build-verification-fanout` (BUILD-tail ordering only) and `adr-2026-07-30-contract-aware-same-file-wiring` (same-file composition exception only) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-13-kickback-build-no-op-escalation` | APPROVED (operator-approved 2026-08-08, retroactive — shipped work, see #662) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-13-park-all-dispatch-paths` | APPROVED (operator-approved 2026-08-08, retroactive — shipped work, see #662) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-13-retry-classify-rerun-vs-route` | Approved | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-13-session-fresh-verdict-artifacts` | APPROVED (operator-approved 2026-08-08, retroactive — shipped work, see #662) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-17-verify-only-judged-closure` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-20-bounded-dirname-path-corroboration` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-20-ci-fix-dispatch-via-steprunner` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-20-post-rebase-delta-aware-invalidation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-21-completeness-as-build-review-rubric` | SUPERSEDED by adr-2026-08-22-one-owner-per-review-question | Narrowed out by subject; supersession treated as partial/ambiguous |
| `adr-2026-07-21-decide-time-unmerged-overlap-scan` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-21-demote-task-stamping-to-telemetry` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-21-engine-owned-acceptance-red-execution` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-21-intake-only-enforcement` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-21-no-diff-task-evidence-stamp` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-21-owner-stamped-at-authoring` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-21-s-tier-pipeline-knobs` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-21-serena-removal-path` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-attempts-counter-on-crash-recovery` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-auth-failure-classification-observed-401-patterns` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-build-dispatch-json-usage-capture` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-canonical-tagged-source-ref` | APPROVED | Examined — relevant boundary above |
| `adr-2026-07-22-canonical-tracker-client-seam` | APPROVED | Examined — relevant boundary above |
| `adr-2026-07-22-coherence-gate-placement-and-validation-split` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-coherence-waiver-and-duplicate-claim` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-daemon-level-missing-credential-gate` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-examples-state-isolation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-gate-evidence-code-validity-on-redispatch` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-headless-vs-guided-examples` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-heartbeat-lease-deferred` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-intake-closed-issue-reconciliation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-origin-refresh-before-engine-rebuild` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-per-task-work-happened-floor` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-phase-scoped-docs-write-guard` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-requeue-claimed-distinct-from-reopen` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-stale-claim-staleness-window-default` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-22-token-liveness-probe-via-cli-invocation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-23-build-review-fresh-base-disposition` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-23-commit-movement-liveness-floor` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-23-intake-label-authority-scoped-replace` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-23-session-hook-repair-before-halt` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-23-trailer-union-build-step-routing` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-25-content-addressed-full-suite-proof` | SUPERSEDED in part by `adr-2026-07-29-deterministic-build-verification-fanout` (BUILD-tail ordering and skill surface); previously superseded in part by `adr-2026-07-25-direct-claude-configured-verifier-interface` | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-25-custom-step-completion-artifacts` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-25-fail-closed-durable-shipment-evidence` | APPROVED | Examined — relevant boundary above |
| `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-26-daemon-decide-preseed-ownership` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-26-event-sink-registry-exhaustiveness` | Approved | Examined — relevant boundary above |
| `adr-2026-07-26-protected-artifact-seal-rebaseline` | APPROVED | Examined — relevant boundary above |
| `adr-2026-07-26-rebase-tail-current-branch-before-publication` | APPROVED (operator-approved 2026-07-26) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-27-ancestry-proven-park-reconciliation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-27-codex-never-resumes-a-harness-minted-session` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-27-cold-start-within-step-retries` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-27-cost-unmetered-is-a-first-class-state` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-27-daemon-decide-kickback-halt` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-27-project-config-scaffolder` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-28-feature-aware-artifact-resolution` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-28-total-halt-classification-legacy-boundary` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-29-codex-readiness-probe-failure-disposition` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` | APPROVED | Examined — relevant boundary above |
| `adr-2026-07-29-deterministic-build-verification-fanout` | APPROVED (operator-approved 2026-07-29) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-29-engine-observed-provider-time-partition` | APPROVED (operator-approved 2026-07-29) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-29-operator-park-scheduling-unit-boundary` | APPROVED (operator-approved 2026-07-29) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-29-ship-start-draft-pr` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-30-contract-aware-same-file-wiring` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-30-finish-only-mergeability-gate` | SUPERSEDED | Excluded — explicit full supersession; outside intersecting subjects |
| `adr-2026-07-30-pinned-remote-theme-for-pages-navigation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-07-30-provider-preparation-lifecycle-supervision` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-01-bot-owned-release-pr` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-01-conduct-state-mutation-port` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-01-engine-owned-resumable-finish-publication` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-01-engine-owned-scoped-test-invocation` | APPROVED (operator-approved 2026-08-01) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-01-multi-proof-park-deletion-authority` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-01-rebase-full-replay-intent-validation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-01-scoped-run-verb-release-surface` | APPROVED (operator-approved 2026-08-01) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-02-plan-scope-containment-at-commit-boundary` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-03-build-repair-member-reuse-validity` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-03-fail-closed-decide-entry` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-03-ledgered-per-block-migration-execution` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-03-uncommitted-work-floor-under-build-completion` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-04-classify-before-spend-release-smoke-gate` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-04-live-tier-provisions-its-own-provider-home` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-04-unresolved-step-command-fails-by-name` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-05-blocked-classification-after-dedup` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-05-blocked-is-a-distinct-state-from-halted` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-05-build-settle-outcome-stamp` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-05-provenance-based-protected-artifact-inheritance` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-05-token-first-stories-reference-normalization` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-05-worktree-classification-evidence-derived-reasons` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-06-honest-park-termination-boundary` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-06-publication-progress-is-its-own-disposition` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-07-project-teardown-hook-contract-and-containment` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` | APPROVED (operator-approved 2026-08-07) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-07-worktree-removal-coverage-guard` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-08-finish-human-required-halt-rendering` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-08-pipeline-owned-closeout-timestamps` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition` | APPROVED (operator-approved 2026-08-08) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-08-single-adr-approval-parser-three-rungs` | APPROVED (operator-approved 2026-08-08) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-adr-contradiction-detection-in-two-halves` | Approved | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal` | Approved | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config` | APPROVED (operator, 2026-08-09) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-checkout-is-sole-version-identity-authority` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-conductor-block-single-source-of-truth` | APPROVED (operator, 2026-08-09) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-declared-pattern-replication-in-build` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` | APPROVED (operator, 2026-08-09) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-hook-owned-containment-event-ledger` | APPROVED (operator, 2026-08-09) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-legacy-json-seed-migration-rule` | APPROVED (operator, 2026-08-09) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-non-blocking-plan-scope-containment` | APPROVED (operator, 2026-08-09) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` | APPROVED (operator, 2026-08-09) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-operator-only-scoped-artifact-reseal` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-09-recorded-red-exception-for-remediation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` | Approved | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-seal-rotation-authorship-predicate` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-09-worktree-local-provider-scratch` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-11-deprecated-no-op-step-retirement` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-11-halt-events-ride-the-persisted-spine` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-12-cumulative-build-review-convergence-bound` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-12-execution-lifecycle-completeness-for-timing` | APPROVED (operator-approved 2026-08-12) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-12-fail-closed-intake-ledger-durability` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-12-live-provider-coverage-from-plugin-registry` | APPROVED (operator-approved 2026-08-12) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-12-operator-reseal-as-second-scope-justification` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-12-per-provider-live-smoke-legs` | APPROVED (operator-approved 2026-08-12) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-12-removal-anchored-tautology-exemption` | SUPERSEDED by adr-2026-08-22-one-owner-per-review-question | Narrowed out by subject; supersession treated as partial/ambiguous |
| `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns` | APPROVED (operator, 2026-08-13) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-13-durable-base-advance-attribution` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-13-engine-managed-build-review-rubric-branches` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-13-markdown-default-inversion` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-13-stable-build-review-finding-dispositions` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-14-retire-build-review-wiring-rubric` | APPROVED (operator-directed, 2026-08-14) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-15-verify-only-anchored-tautology-exemption` | SUPERSEDED by adr-2026-08-22-one-owner-per-review-question | Excluded — explicit full supersession; outside intersecting subjects |
| `adr-2026-08-16-closed-build-review-finding-vocabularies` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-16-preservation-anchored-completeness-exemption` | SUPERSEDED by adr-2026-08-22-one-owner-per-review-question | Excluded — explicit full supersession; outside intersecting subjects |
| `adr-2026-08-16-restore-the-current-head-publication-fence` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-17-framework-agnostic-tautology-scoped-run` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-17-structural-live-checkout-containment` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-18-content-anchored-finding-reference-schema` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-19-live-provider-stream-observation` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-21-engine-identity-in-build-review-cache-key` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-21-review-bound-by-plan-done-when-criteria` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-22-as-built-review-runs-always-with-plan-gap` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-22-build-review-opt-in-rubric-container` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-22-done-when-evidence-at-task-close` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-22-one-owner-per-review-question` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-23-committed-halt-record` | No parsed approval marker | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-23-criterion-layer-is-structural-at-land` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-23-diff-locality-is-an-authored-disposition` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-24-evidentiary-defects-are-not-waivable` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-24-refused-step-status` | APPROVED (operator, 2026-08-24) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-26-music-vocabulary-player-composer-rename` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-26-remove-retrospectives-one-shot` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-26-setup-once-per-worktree-marker` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-26-shared-coherence-parser-at-discovery` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-27-daemon-dispatcher-executor-seam` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-29-build-review-remediate-case-adjudication` | Superseded by `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` | Retained — successor explicitly adopts non-conflicting case/effect decisions; not fully superseded |
| `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` | APPROVED | Examined — relevant boundary above |
| `adr-2026-08-29-operator-authorized-kickback-budget-recovery` | Superseded by `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` | Narrowed out by subject; supersession treated as partial/ambiguous |
| `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-30-shared-plan-task-reference-resolver` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-31-coverage-binding-judge-step` | APPROVED (operator-approved 2026-08-31, composer session for #2088) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-08-31-kickback-ledger-read-fails-closed` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-02-adr-decision-citability-contract` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-05-gh-cli-version-floor-and-environment-gate` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-06-engine-owned-test-quality-scope` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-06-inbound-intake-trust-boundary` | APPROVED | Examined — relevant boundary above |
| `adr-2026-09-06-reopened-task-resolution` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-07-durable-prd-widening-decision-reconciliation` | APPROVED | Examined — relevant boundary above |
| `adr-2026-09-10-portable-build-review-policy` | APPROVED | Examined — relevant boundary above |
| `adr-2026-09-10-separate-custom-review-coverage-identity` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-10-shared-step-lifecycle-telemetry` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-11-github-operation-ownership` | APPROVED | Examined — relevant boundary above |
| `adr-2026-09-11-immutable-state-lease-recovery-succession` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-11-selective-post-rebase-verification` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-20-halt-resolution-queue-derived-from-markers` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-20-operator-launched-sessions-retain-conductor-authority` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-23-engine-git-guard-on-agent-path` | APPROVED (operator, 2026-09-23) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-23-one-owner-for-accepted-story-readability` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-24-project-owned-pr-body-regions` | APPROVED | Examined — relevant boundary above |
| `adr-2026-09-28-skills-may-bundle-executable-helpers` | APPROVED (operator, 2026-09-28) | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-29-plan-slice-manifest` | APPROVED | Narrowed out — subject outside the action/closure interaction under review |
| `adr-2026-09-30-durable-post-ship-action-cases` | APPROVED | Examined — relevant boundary above |
