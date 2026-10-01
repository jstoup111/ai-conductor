# Conflict check: PRD typed verdict migration

Source: jstoup111/ai-conductor#2521. Date: 2026-09-30.
Verdict: PASS after operator-approved reconciliation. Zero unresolved blocking or degrading conflicts.
The architecture and nine new stories are already approved. These findings concern contradictory
assertions left in older accepted artifacts. No implementation, publishing, or merge is proposed.

## Resolution 1: PRD freshness and consumers follow typed authority

Type: contradiction / state-conflict. Severity: blocking. Confidence: 100%.

Old `.docs/stories/prd-audit-halts-on-a-stale-report-when-the-audit-d.md`, Story 6:

> Given the existing gate-code-validity kill-switch is off, when the prd_audit and manual_test gates run, then identity checking is bypassed and pure mtime behavior applies end-to-end

New `.docs/stories/prd-audit-receives-bounded-inputs-and-returns-vali.md`, Story 5:

> Given an older verdict with a recently modified timestamp or refreshed independent stamp, when a new dispatch produces no verdict, then the older judgment is not accepted for the new attempt.

These cannot both hold when an old PRD report is touched and code-validity preservation is disabled.
The older assertions also appear in `session-fresh-verdict-artifacts` Stories 1–3 and
`gate-step-completion-validates-against-code-state-` Stories 3 and 6. Markdown is still named as
routing authority in `retry-classify-rerun-vs-route` Story 7 and preservation authority in
`skip-prd-audit-as-built-re-dispatch-after-a-kickba` Story 1.

Applied reconciliation:
- PRD joins as-built in the existing typed-verdict exception. A dispatched attempt needs its own validated persisted result; timestamps and separately refreshed sidecars cannot supply it.
- PRD's old Markdown-only evidence requires a new audit. Pre-dispatch reuse remains available when the typed judgment, code-validity proof and current decision state all validate.
- The code-validity switch disables preservation, not typed identity checking. Manual-test fallback and whitewash behavior remain as specified for that gate.
- Older routing and preservation criteria cite validated PRD findings, with Markdown retained as the human view.
- The existing run-identity ADR amendment remains the governing decision. Add clarifying amendment notes beside the inherited fallback assertions in the two older ADRs below; preserve their original text.

ADR comparison A:
- ADR filename stem: `adr-2026-07-22-gate-evidence-code-validity-on-redispatch`
- Story ID: Story 5 (new feature)
- ADR opposing sentence (verbatim): "An additive config flag reverts to pure mtime-freshness (no stamp read/preserve), defaulting to the new behavior."
- Story opposing sentence (verbatim): "Given an older verdict with a recently modified timestamp or refreshed independent stamp, when a new dispatch produces no verdict, then the older judgment is not accepted for the new attempt."
- Resolution: clarify D3/D5/D6's PRD exception by reference to the already-approved #2521 run-identity amendment. Preserve all unrelated gate contracts.

ADR comparison B:
- ADR filename stem: `adr-2026-07-13-session-fresh-verdict-artifacts`
- Story ID: Story 5 (new feature)
- ADR opposing sentence (verbatim): "The mtime floor survives as the fallback for unstamped artifacts; the manual_test deferral is lifted (run identity composes with the #367 whitewash guard, which is unchanged)."
- Story opposing sentence (verbatim): "Given an older verdict with a recently modified timestamp or refreshed independent stamp, when a new dispatch produces no verdict, then the older judgment is not accepted for the new attempt."
- Resolution: beside the #1838 amendment, clarify that typed PRD/as-built artifacts have no mtime fallback, under the current run-identity ADR; other gates retain their applicable contract.

Options, ranked by impact: (1) apply these scoped corrections; (2) retain dual Markdown/typed readers with a new compatibility policy; (3) reopen the approved migration to preserve Markdown authority. Operator selected option 1: it follows the approved design without a second authority or new policy.

## Resolution 2: Completeness is criterion coverage with applicable PRD traceability

Type: contradiction. Severity: blocking. Confidence: 100%.

Old `.docs/stories/prd-audit-passes-on-a-partial-report-when-backgrou.md`, Story 3:

> Given `prd_audit` is running (on any track, per #1805) and no
> approved PRD can be resolved for this feature, when the predicate runs, then it returns
> `done: false` with a reason naming the unresolvable PRD — it never falls back to scanning every
> spec in the corpus, and never treats "cannot find the PRD" as "nothing to cover".

New Story 1:

> Given technical-track work with no applicable PRD and no prior history, when an audit is prepared, then those absences are explicit and the complete story/task evidence remains available.

The old artifact additionally demands ALIGNED/DIVERGED FR rows and a Markdown row parser,
where the accepted #1805 stories already use PASS/FIXABLE/PLAN_GAP/OVER_SCOPE criterion judgments.

Applied reconciliation: replace the older artifact's three stories in place while
preserving their three purposes: complete coverage; identical completion/preservation/sweep checks;
and feature-scoped denominator resolution. The authoritative denominator becomes the active sealed
story criteria. Applicable PRD requirements retain the existing coverage/PLAN_GAP traceability check.
No-PRD technical work is valid; an unreadable or unresolved required source remains blocking.
Omitted criteria and unresolved applicable requirement coverage cannot pass or be preserved. Remove
the obsolete ALIGNED grammar and parser-specific Done When assertions from that accepted story.

Options: (1) align these assertions to the accepted stories-authority contract; (2) add a second FR verdict layer; (3) require PRDs on all tracks. Operator selected option 1: the others introduce scope already rejected by the current contract.

## Resolution 3: No-owner and task-reference semantics survive without a skill-owned grammar

Type: contradiction / behavioral overlap. Severity: blocking. Confidence: 100%.

Old `.docs/stories/prd-audit-has-no-criterion-key-for-an-over-scope-f.md`, Story 6:

> Given the skill text after this change, when it is read, then it teaches the NC.«n» key form and no longer claims the engine cannot route no-owner findings

Old `.docs/stories/remediation-task-ids-are-non-numeric-by-design-but.md`, Story 4:

> Given the resolved rule that any Verdict Table row may cite a task present in the active plan while FIXABLE rows must, when the prd-audit skill text is read, then its Plan-task cell instructions state that rule and instruct emitting the bare id without annotation

New Story 9:

> Given a reintroduced engine-input recipe or machine-output table grammar in the migrated PRD-audit skill surface, when the existing contract audit evaluates it, then the audit fails for the contract violation rather than silently making that prose authoritative.

Applied reconciliation:
- Rewrite the affected no-owner parsing stories (1–3 and 6) around typed entry validation and engine-rendered NC ordinals. NC ordinals are presentation, not reviewer-owned semantic identity.
- Preserve per-entry rejection, valid siblings, the blocking effect of incompleteness, duplicate normalized criterion rejection, and no-owner OVER_SCOPE-only rules.
- Replace missing Markdown marker/table failures with missing/malformed or unsupported typed envelope failures; no report scraping repairs them.
- Keep the durable-decision and no-NC-BUILD rules in Stories 4–5. Update their transport descriptions only where they require parsing Markdown.
- In the shared-task-reference stories, preserve the common resolver, alphanumeric/remediation ids, existing annotation tolerance and exactly-one FIXABLE owner. Replace Verdict Table/parser obligations with typed contract/validation obligations. The skill retains judgment responsibilities; the engine owns citation shape.

Options: (1) move these existing semantics to the approved typed contract; (2) maintain skill grammar plus typed schema as two contracts; (3) drop per-entry salvage or reference compatibility. Operator selected option 1: it preserves the promised behavior while removing the duplicate transport authority.

## Resolution 4: Managed interactive PRD audits use the native-schema exception

Type: contradiction. Severity: blocking. Confidence: 100%.

Old `.docs/stories/runmode-interactive-flag.md`, acceptance criterion:

> Given the conductor is installed, when I run `conduct --interactive "Add login"`, then `RunMode` is set to `'interactive'` and every conversational step other than the native-schema judgement steps (`architecture_review_as_built` and the `build_review` rubric judges) invokes the Claude provider with `interactive: true` (no `-p` flag).

New Story 2:

> Given auto mode or interactive conduct mode, when the managed audit dispatches, then it obtains its judgment through a fresh one-shot invocation while standalone interactive skill use remains available for human review.

Applied reconciliation: add `prd_audit` to the two explicit native-schema exemption
lists in the old story. Preserve the rest of interactive-mode behavior and standalone human review.

Options: (1) extend the existing exemption; (2) add a distinct interactive machine-output protocol; (3) exclude managed interactive runs from the migration. Operator selected option 1: this is the same supported native-schema path already approved in architecture.

## Recheck and interaction findings

The operator approved all four resolution families on 2026-09-30. Superseded story assertions were replaced in place; inherited ADR and specification assertions carry additive clarification notes. The no-owner producer clarification is also attached to the older durable-refusal ADR D4. No architecture choice was reversed and no superseding ADR was needed.

Resolution 2 also corrected the surviving technical-track skip assertions in `decide-pipeline-restructure` and `parallel-validation-phase-fan-out-manual-test-prd-`, and added an amendment beside the original pipeline specification FR-14. These use the already-approved #1805 run rule rather than introducing participation policy.

All six conflict types were considered in both directions for the overlapping behavior groups:

| Interaction | New behavior preserves old effective contract | Old effective contract permits new behavior | Result |
| --- | --- | --- | --- |
| Criterion authority, no-PRD and requirement traceability | Full sealed criteria and applicable requirements survive; absent PRD is explicit | #1805 already makes stories authoritative on all tracks | Compatible after resolution 2 |
| Fresh dispatch, resume, sweep, rebase and finish | Current attempt needs its own result; pre-dispatch reuse needs valid code and decisions | Identity and replay ADR amendments distinguish dispatch from preservation | Compatible after resolution 1; no preservation/rerun oscillation |
| Partial findings, no-owner identity and shared task references | Invalid entries stay blocking; valid siblings and non-numeric ids survive | Typed entries preserve the shared resolver and semantic widening authority | Compatible after resolution 3 |
| Native-schema invocation and interactive use | Fresh sessions, capability checks, provider error precedence and cleanup remain | Managed schema judgments use the existing one-shot exception | Compatible after resolution 4 |
| Grade routing and bounded repair | FIXABLE ownership, PLAN_GAP policy, scope precedence and pending-repair accounting survive | Existing owners accept validated findings without requiring Markdown authority | Compatible; no new append or repair authority |
| Widening capture and replay | Original offers and decisions survive; stale relationships never publish | #2429 already separates original decisions from current source bindings | Compatible; no rendering/reconciliation feedback loop |
| Parallel join and events | No-verdict failures retain only objectively verified siblings; no synthetic gap | Join and event-spine rules apply to typed evidence | Compatible; no shared writer or ordering conflict |
| Rewind and failure rollback | Derived typed evidence and human view are cleared/restored together | Existing rollback story requires every removed gate artifact restored | Compatible; operator decisions are not derived gate artifacts |
| Projection completeness and existing coherence artifacts | Present mapping is supplied; absent/zero-criterion mappings do not invent obligations | Criterion-row strictness remains at land, not SHIP | Compatible; no new coherence-format gate |

Retry, cap raises, group joins, current-HEAD publication and operator decision stores keep their existing authority. Old FR-named remediation examples describe identifiers already admitted by the existing domain resolver; they do not authorize replacement of criterion judgments with an FR-only verdict. Earlier architecture-review reports are historical rationale, interpreted with their approved ADR amendments rather than a second current machine contract.

Inventory scanned across 522 story files, 60 specification files, 636 decision documents and 307 previous conflict reports. Full-text subject selection identified 50 directly PRD-related stories and five specifications; additionally examined interactive dispatch, widening replay and rewind rollback interactions. ADR scope is `repo_wide` from project configuration. The lists below record subject selection; partial supersessions remain examined. The previous as-built migration report was used as a candidate index, not as a substitute clean verdict.

Grounding: the four contradictions above are certain (100%); compatibility judgement after reconciliation is high confidence (95%). No unconfirmed load-bearing assumption or accepted degrading compromise remains. This is a specification consistency review, not evidence that the implementation has shipped.

## Examined ADRs: relevant decisions and amendments (63)

- adr-2026-06-29-brainstorm-rename-migration
- adr-2026-06-29-explore-prd-split-track-in-explore
- adr-2026-06-29-track-marker-location
- adr-2026-07-04-auth-failure-park-and-poll
- adr-2026-07-05-daemon-rate-limit-episode-coordinator
- adr-2026-07-05-engine-owned-task-status
- adr-2026-07-06-manual-test-fail-routing
- adr-2026-07-10-concurrent-group-core
- adr-2026-07-10-validation-group-join
- adr-2026-07-11-pipeline-state-durability
- adr-2026-07-11-semantic-attribution-verification-lane
- adr-2026-07-13-kickback-build-no-op-escalation
- adr-2026-07-13-retry-classify-rerun-vs-route
- adr-2026-07-13-session-fresh-verdict-artifacts
- adr-2026-07-20-post-rebase-delta-aware-invalidation
- adr-2026-07-21-demote-task-stamping-to-telemetry
- adr-2026-07-22-auth-failure-classification-observed-401-patterns
- adr-2026-07-22-build-dispatch-json-usage-capture
- adr-2026-07-22-coherence-gate-placement-and-validation-split
- adr-2026-07-22-gate-evidence-code-validity-on-redispatch
- adr-2026-07-23-commit-movement-liveness-floor
- adr-2026-07-23-trailer-union-build-step-routing
- adr-2026-07-24-provider-aware-step-execution-fresh-session-scope
- adr-2026-07-26-cross-dispatch-kickback-livelock-bound
- adr-2026-07-26-event-sink-registry-exhaustiveness
- adr-2026-07-26-rebase-tail-current-branch-before-publication
- adr-2026-07-27-cold-start-within-step-retries
- adr-2026-07-27-protected-artifact-seal-self-amendment-visibility
- adr-2026-07-30-provider-preparation-lifecycle-supervision
- adr-2026-08-01-conduct-state-mutation-port
- adr-2026-08-03-uncommitted-work-floor-under-build-completion
- adr-2026-08-09-non-blocking-plan-scope-containment
- adr-2026-08-12-cumulative-build-review-convergence-bound
- adr-2026-08-12-operator-reseal-as-second-scope-justification
- adr-2026-08-13-markdown-default-inversion
- adr-2026-08-13-stable-build-review-finding-dispositions
- adr-2026-08-16-restore-the-current-head-publication-fence
- adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence
- adr-2026-08-19-operator-step-rewind-through-the-mutation-port
- adr-2026-08-19-unretryable-step-runner-failures-route-by-kind
- adr-2026-08-22-as-built-review-runs-always-with-plan-gap
- adr-2026-08-22-one-owner-per-review-question
- adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback
- adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote
- adr-2026-08-23-criterion-layer-is-structural-at-land
- adr-2026-08-24-evidentiary-defects-are-not-waivable
- adr-2026-08-24-one-dispatch-member-on-the-provider-contract
- adr-2026-08-24-over-scope-decision-block-and-durable-refusals
- adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route
- adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity
- adr-2026-08-26-music-vocabulary-player-composer-rename
- adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class
- adr-2026-08-30-shared-plan-task-reference-resolver
- adr-2026-08-31-coverage-binding-judge-step
- adr-2026-09-06-reopened-task-resolution
- adr-2026-09-07-durable-prd-widening-decision-reconciliation
- adr-2026-09-10-portable-build-review-policy
- adr-2026-09-11-finish-mergeability-respects-active-review-inputs
- adr-2026-09-11-immutable-state-lease-recovery-succession
- adr-2026-09-11-selective-post-rebase-verification
- adr-2026-09-23-one-owner-for-accepted-story-readability
- adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability

## ADRs narrowed out: no affected behavior or authority (254)

- adr-002-engineer-store-and-retro-redirect
- adr-003-registry-write-and-integration
- adr-005-non-autonomy-and-read-only-governor
- adr-006-flywheel-lesson-selection-and-provenance
- adr-008-agent-hosted-loop-and-in-chat-authoring
- adr-009-intake-adapter-port
- adr-010-pidfile-lock-daemon-liveness
- adr-011-async-intake-queue-and-github-source
- adr-012-durable-intake-ledger-sole-dedup-authority
- adr-014-otel-observability-exporter
- adr-015-daemon-pr-labeling-sweep
- adr-2026-06-29-architecture-before-stories-convergent-kickback
- adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting
- adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration
- adr-2026-06-29-memory-resilience-write-fallback-and-reconcile
- adr-2026-06-29-per-project-memory-provider-selection
- adr-2026-06-29-per-provider-retrieval-guidance-location
- adr-2026-06-29-platform-adoption-and-removal-surface
- adr-2026-06-29-rebase-conflict-resolution-dispatch
- adr-2026-06-29-safe-reversible-memory-migration
- adr-2026-06-29-shared-memory-store-placement-and-durability
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
- adr-2026-07-04-autoresolve-state-and-config
- adr-2026-07-04-claim-time-delivery-evidence-guard
- adr-2026-07-04-durable-pause-marker
- adr-2026-07-04-event-driven-halt-clear-wake
- adr-2026-07-04-kickback-event-emission-and-log-prominence
- adr-2026-07-04-park-unpark-cli-verbs
- adr-2026-07-04-pending-restart-queue
- adr-2026-07-04-resolution-worktree-lifecycle
- adr-2026-07-04-respawn-in-place-restart
- adr-2026-07-04-versioned-engine-store-atomic-flip
- adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep
- adr-2026-07-05-halt-pr-presentation-reliability
- adr-2026-07-05-retry-as-escalation-ladder
- adr-2026-07-05-standalone-bin-update
- adr-2026-07-06-daemon-false-ship-guard
- adr-2026-07-06-installed-root-resolution-for-global-writes
- adr-2026-07-06-migration-gate-waiver
- adr-2026-07-06-stale-engine-respawn-in-place
- adr-2026-07-07-audit-trail-event-sink
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
- adr-2026-07-10-daemon-stall-remediation
- adr-2026-07-10-evidence-range-anchor-resolution
- adr-2026-07-10-inline-work-attribution-enforcement
- adr-2026-07-10-intake-claim-priority-banding
- adr-2026-07-10-intra-step-build-progress-events
- adr-2026-07-10-observed-close-watch-registry
- adr-2026-07-10-park-marker-main-root-resolution
- adr-2026-07-10-retire-migration-grandfather
- adr-2026-07-10-session-hook-task-stamping
- adr-2026-07-11-attribution-abstain-or-loud
- adr-2026-07-11-attribution-spot-audit-measurement
- adr-2026-07-11-attribution-verdict-interface
- adr-2026-07-11-evidence-judge-cli-and-cutover
- adr-2026-07-11-finish-step-engine-completion-machinery
- adr-2026-07-11-verdict-aware-resume-entry
- adr-2026-07-12-judged-attribution-verdict-persistence
- adr-2026-07-12-progress-aware-build-halt
- adr-2026-07-12-rebase-evidence-stamp-translation
- adr-2026-07-12-wired-into-contract
- adr-2026-07-12-wiring-check-gate
- adr-2026-07-13-park-all-dispatch-paths
- adr-2026-07-17-verify-only-judged-closure
- adr-2026-07-20-bounded-dirname-path-corroboration
- adr-2026-07-20-ci-fix-dispatch-via-steprunner
- adr-2026-07-20-ci-fix-startup-preflight-and-error-classification
- adr-2026-07-21-decide-time-unmerged-overlap-scan
- adr-2026-07-21-engine-owned-acceptance-red-execution
- adr-2026-07-21-intake-only-enforcement
- adr-2026-07-21-no-diff-task-evidence-stamp
- adr-2026-07-21-owner-stamped-at-authoring
- adr-2026-07-21-s-tier-pipeline-knobs
- adr-2026-07-21-serena-removal-path
- adr-2026-07-22-attempts-counter-on-crash-recovery
- adr-2026-07-22-canonical-tagged-source-ref
- adr-2026-07-22-canonical-tracker-client-seam
- adr-2026-07-22-coherence-waiver-and-duplicate-claim
- adr-2026-07-22-daemon-level-missing-credential-gate
- adr-2026-07-22-examples-state-isolation
- adr-2026-07-22-headless-vs-guided-examples
- adr-2026-07-22-heartbeat-lease-deferred
- adr-2026-07-22-intake-closed-issue-reconciliation
- adr-2026-07-22-origin-refresh-before-engine-rebuild
- adr-2026-07-22-per-feature-cost-rollup-in-shipped-record
- adr-2026-07-22-per-task-work-happened-floor
- adr-2026-07-22-phase-scoped-docs-write-guard
- adr-2026-07-22-requeue-claimed-distinct-from-reopen
- adr-2026-07-22-stale-claim-staleness-window-default
- adr-2026-07-22-token-liveness-probe-via-cli-invocation
- adr-2026-07-23-build-review-fresh-base-disposition
- adr-2026-07-23-intake-label-authority-scoped-replace
- adr-2026-07-23-session-hook-repair-before-halt
- adr-2026-07-25-content-addressed-full-suite-proof
- adr-2026-07-25-custom-step-completion-artifacts
- adr-2026-07-25-fail-closed-durable-shipment-evidence
- adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation
- adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation
- adr-2026-07-26-daemon-decide-preseed-ownership
- adr-2026-07-26-protected-artifact-seal-rebaseline
- adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates
- adr-2026-07-27-ancestry-proven-park-reconciliation
- adr-2026-07-27-codex-never-resumes-a-harness-minted-session
- adr-2026-07-27-cost-unmetered-is-a-first-class-state
- adr-2026-07-27-daemon-decide-kickback-halt
- adr-2026-07-27-project-config-scaffolder
- adr-2026-07-28-feature-aware-artifact-resolution
- adr-2026-07-28-total-halt-classification-legacy-boundary
- adr-2026-07-29-codex-readiness-probe-failure-disposition
- adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main
- adr-2026-07-29-deterministic-build-verification-fanout
- adr-2026-07-29-engine-observed-provider-time-partition
- adr-2026-07-29-operator-park-scheduling-unit-boundary
- adr-2026-07-29-ship-start-draft-pr
- adr-2026-07-30-contract-aware-same-file-wiring
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
- adr-2026-08-03-build-repair-member-reuse-validity
- adr-2026-08-03-fail-closed-decide-entry
- adr-2026-08-03-ledgered-per-block-migration-execution
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
- adr-2026-08-08-pipeline-owned-closeout-timestamps
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
- adr-2026-08-09-one-pr-per-branch-halt-is-a-state
- adr-2026-08-09-operator-only-scoped-artifact-reseal
- adr-2026-08-09-recorded-red-exception-for-remediation
- adr-2026-08-09-reseal-audit-rides-the-existing-event-spine
- adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator
- adr-2026-08-09-seal-rotation-authorship-predicate
- adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag
- adr-2026-08-09-worktree-local-provider-scratch
- adr-2026-08-11-deprecated-no-op-step-retirement
- adr-2026-08-11-halt-events-ride-the-persisted-spine
- adr-2026-08-12-execution-lifecycle-completeness-for-timing
- adr-2026-08-12-fail-closed-intake-ledger-durability
- adr-2026-08-12-live-provider-coverage-from-plugin-registry
- adr-2026-08-12-per-provider-live-smoke-legs
- adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns
- adr-2026-08-13-durable-base-advance-attribution
- adr-2026-08-13-engine-managed-build-review-rubric-branches
- adr-2026-08-14-retire-build-review-wiring-rubric
- adr-2026-08-16-closed-build-review-finding-vocabularies
- adr-2026-08-17-framework-agnostic-tautology-scoped-run
- adr-2026-08-17-structural-live-checkout-containment
- adr-2026-08-18-content-anchored-finding-reference-schema
- adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane
- adr-2026-08-19-engine-stamped-rubric-judged-result-envelope
- adr-2026-08-19-live-provider-stream-observation
- adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch
- adr-2026-08-21-engine-identity-in-build-review-cache-key
- adr-2026-08-21-review-bound-by-plan-done-when-criteria
- adr-2026-08-22-build-review-opt-in-rubric-container
- adr-2026-08-22-done-when-evidence-at-task-close
- adr-2026-08-23-committed-halt-record
- adr-2026-08-23-diff-locality-is-an-authored-disposition
- adr-2026-08-24-refused-step-status
- adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot
- adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
- adr-2026-08-26-remove-retrospectives-one-shot
- adr-2026-08-26-setup-once-per-worktree-marker
- adr-2026-08-26-shared-coherence-parser-at-discovery
- adr-2026-08-27-daemon-dispatcher-executor-seam
- adr-2026-08-28-test-suite-drift-budget-and-verification-mode
- adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication
- adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded
- adr-2026-08-31-kickback-ledger-read-fails-closed
- adr-2026-09-02-adr-decision-citability-contract
- adr-2026-09-05-gh-cli-version-floor-and-environment-gate
- adr-2026-09-06-engine-owned-test-quality-scope
- adr-2026-09-06-inbound-intake-trust-boundary
- adr-2026-09-10-separate-custom-review-coverage-identity
- adr-2026-09-10-shared-step-lifecycle-telemetry
- adr-2026-09-11-github-operation-ownership
- adr-2026-09-20-halt-resolution-queue-derived-from-markers
- adr-2026-09-20-operator-launched-sessions-retain-conductor-authority
- adr-2026-09-23-engine-git-guard-on-agent-path
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery
- adr-2026-09-24-project-owned-pr-body-regions
- adr-2026-09-28-skills-may-bundle-executable-helpers
- adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history
- adr-2026-09-29-plan-slice-manifest

## ADRs excluded: unambiguously fully superseded status (10)

- adr-2026-07-03-gated-writeback-announcements
- adr-2026-07-04-operator-park-marker
- adr-2026-07-21-completeness-as-build-review-rubric
- adr-2026-07-30-finish-only-mergeability-gate
- adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag
- adr-2026-08-12-removal-anchored-tautology-exemption
- adr-2026-08-15-verify-only-anchored-tautology-exemption
- adr-2026-08-16-preservation-anchored-completeness-exemption
- adr-2026-08-29-build-review-remediate-case-adjudication
- adr-2026-08-29-operator-authorized-kickback-budget-recovery


> **Amended 2026-09-30 by #2521:** BUILD requires #2753 (kickback-cap remediation-to-BUILD settlement) to land first. Its approved ADR is present at this spec base, but its `pendingRepair` implementation is not: `readRemediationGateAppendBudget` still charges through the older append path. Preserve the approved future accounting contract after that prerequisite lands; do not implement #2753 inside this migration. Before spec publication, register #2753 as a native blocking dependency of #2521 so daemon scheduling enforces the order. Recheck the accounting seam against the delivered prerequisite before BUILD. This corrects the earlier description of BUILD-dispatch accounting as already implemented.
