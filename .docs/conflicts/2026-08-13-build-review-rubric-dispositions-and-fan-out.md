# Conflict Check: Build-review rubric dispositions and independent evaluation

**Date:** 2026-08-13
**Status:** RESOLVED — CLEAN RECHECK
**ADR corpus:** `repo_wide`
**Operator resolution:** Recommended bundle approved 2026-08-13

## Corpus and Method

- Scanned all 327 files under `.docs/stories/`, all 50 files under `.docs/specs/`, prior conflict
  reports, and every ADR carrying an approved status.
- Compared the new 25 stories in both directions against every existing story sharing a gate,
  configuration block, rubric, verdict, provider execution, event, disposition, report, or
  publication surface.
- Narrowed the approved ADR corpus only after the repo-wide inventory. The examined overlapping ADRs
  and exact narrowed-out set are recorded in Appendix A.
- Checked contradiction, behavioral overlap, state conflict, resource contention, sequencing, and
  oscillation. Confidence is grounded in the quoted accepted artifacts and approved ADRs.
- Recurring patterns checked included the original build-review gate report, the convergence-bound
  report, partial-block config behavior, parallel-group semantics, event-ledger ownership, and
  resumable finish publication.

## Conflict 1: Single grader topology contradicts rubric fan-out

**Stories involved:** grader runs input-starved in a fresh one-shot session vs Bound concurrent
rubric evaluation
**Files:** `.docs/stories/add-a-judgement-gate-at-the-build-manual-test-seam.md` vs
`.docs/stories/build-review-rubric-dispositions-and-fan-out.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 100%

**Description:** The older story requires one grader session and one three-rubric write, while the
new accepted story and ADR require independently scheduled rubric sessions. Both execution
topologies cannot govern the same review lap. The Wiring ADR's no-new-dispatch rationale is also
false under fan-out.

**Resolution Options:**

1. Let the new ADR supersede only the older execution-topology assertions while retaining the
   engine-owned input trust boundary and aggregate compatibility.
2. Keep one grader call and abandon independent model/provider ladders.
3. Represent rubrics as public lifecycle steps.

**Recommendation:** Option 1 because it preserves the approved public gate and trust boundary while
delivering the operator-selected fan-out.

**Selected resolution:** Option 1. The governing ADR now records partial supersession, and accepted
stories preserve their original text with additive #1542 amendments.

## Conflict 2: Disableable Completeness contradicts unconditional completion authority

**Stories involved:** build_review gains a default-on completeness rubric item vs Disable one rubric
without calling it a pass
**Files:** `.docs/stories/demote-task-stamping-to-telemetry.md` vs
`.docs/stories/build-review-rubric-dispositions-and-fan-out.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 100%

**Description:** The former decision says Completeness runs unconditionally even when other rubric
items are tunable. The accepted new behavior lets every rubric be disabled independently. An
explicitly disabled Completeness branch cannot simultaneously be unconditional.

**Resolution Options:**

1. Keep Completeness default-enabled but allow an explicit per-rubric disable, partially superseding
   its unconditional clause.
2. Exempt Completeness from the otherwise independent enablement map.
3. Add a separate mechanical completeness gate before permitting the rubric to be disabled.

**Recommendation:** Option 1 because the operator explicitly selected independent enablement and an
explicit opt-out remains visible as reduced coverage.

**Selected resolution:** Option 1. The older ADR and story are additively amended; rubric meaning,
default-on behavior, holistic plan comparison, and kickback ownership remain approved.

## Conflict 3: Wiring not-judged state is absent from the branch outcome union

**Stories involved:** ADR branch outcome union vs ST-1496-1 build_review judges wiring reachability
**Files:** `.docs/decisions/adr-2026-08-13-engine-managed-build-review-rubric-branches.md` vs
`.docs/stories/per-task-wired-into-contracts-cost-build-cycles-th.md`
**Type:** state-conflict
**Severity:** blocking
**Confidence:** 98%
**ADR filename stem:** adr-2026-08-13-engine-managed-build-review-rubric-branches
**Story ID:** ST-1496-1
**ADR opposing sentence (verbatim):** "`skipped` — disabled before dispatch;"
**Story opposing sentence (verbatim):** "Given `config.wiring.entry_points` is absent or empty, when the wiring item is judged, then it reports \"not judged\" and does not fail the build — the item never passes or fails on an undefined premise."

**Description:** The original three-variant branch design allowed skip only for operator disablement,
leaving no honest representation for Wiring's approved missing-premise behavior. Coercing it to pass
would violate skip/pass separation; coercing it to infrastructure failure would break compatibility.

**Resolution Options:**

1. Add the closed skip reason `missing-entry-points` for Wiring alongside `disabled`.
2. Reject every project that enables build review without Wiring entry points.
3. Treat missing entry points as a Wiring pass.

**Recommendation:** Option 1 because it preserves the existing not-judged behavior, reports reduced
coverage, and keeps it out of judged-rate denominators.

**Selected resolution:** Option 1. The PRD, ADR, stories, review, and diagrams now use the two closed
skip reasons; neither is a pass, and a lap with no valid judgement cannot pass.

## Conflict 4: Strict new rubric policy contradicts tolerant whole-block parsing

**Stories involved:** unknown build_review keys warn without dropping siblings vs Bound concurrent
rubric evaluation / Refuse an enabled gate with no review coverage / Select execution policy per rubric
**Files:** `.docs/stories/build-review-ci-watch-partial-block-1002.md` vs
`.docs/stories/build-review-rubric-dispositions-and-fan-out.md`
**Type:** behavioral-overlap
**Severity:** blocking
**Confidence:** 100%

**Description:** The older story says every `build_review` block shape returns a defined block and
never hard-fails. The new accepted behavior requires invalid concurrency/policy structures and the
enabled-empty rubric combination to refuse execution. Applying both rules to the new subtree would
silently replace operator-selected model and recovery policy or make the explicit empty-set guard
unenforceable.

**Resolution Options:**

1. Preserve tolerant behavior for legacy `enabled`/`perTaskFloor` keys and make the new
   `maxParallel`/`rubrics` subtree plus enabled-empty combination fail closed.
2. Warn and fall back for every invalid new key, except the enabled-empty combination.
3. Make the entire `build_review` block strict, including legacy keys.

**Recommendation:** Option 1 because it contains the compatibility exception while refusing to
invent execution policy after an invalid new configuration.

**Selected resolution:** Option 1. The old story and new PRD/ADR now state the boundary explicitly.

## Conflict 5: Grader-run HEAD tests duplicate the authoritative green gate

**Stories involved:** build_review grades on the diff's scoped tests vs Reuse green proof and
measure Tautology's RED counterfactual
**Files:** `.docs/stories/reduce-redundant-full-test-suite-runs-in-build-shi.md` vs
`.docs/stories/build-review-rubric-dispositions-and-fan-out.md`
**Type:** behavioral-overlap
**Severity:** blocking
**Confidence:** 100%

**Description:** The older story instructs the grader to execute changed tests on current HEAD,
while the joined deterministic `test_suite` immediately before review already owns the code-valid
green proof. The new requirement needs the other side of Tautology's mutation question: changed
tests against merge-base production code. Running both HEAD checks spends time without adding
evidence; omitting the RED side leaves the counterfactual inferred.

**Resolution Options:**

1. Reuse current `test_suite` PASS and replace grader-run HEAD tests with one engine-owned isolated
   reverted-production Tautology preflight.
2. Keep the grader-run HEAD scoped test and add the RED preflight, accepting duplicate green proof.
3. Keep static Tautology inference and add no preflight.

**Recommendation:** Option 1 because each test execution then owns one distinct claim and the RED
experiment remains deterministic, isolated, and attributable.

**Selected resolution:** Option 1. The old stories and governing ADR are additively amended; the
full-suite gate remains authoritative and no rubric session invokes a test command.

## Compatibility check: cached semantics do not reuse a stale verdict

`adr-2026-07-13-session-fresh-verdict-artifacts` requires current-attempt build-review evidence.
The semantic rubric cache does not reuse `.pipeline/build-review.json` or an old branch artifact.
On every hit, the active coordinator validates the cache entry, stamps a current-lap branch result,
performs the current join, and writes a fresh aggregate. The freshness contract and the no-repeat
provider-call requirement therefore compose without contradiction.

The operator also identified future Tautology/Scope claim-or-bypass work. No matching landed spec
was found in the current corpus. #1542 reserves typed stable finding identities and a
post-judgement resolution seam only; it does not pre-authorize or define that future mechanism, so
there is no present behavioral conflict to resolve.

## Clean Recheck

The full comparison was repeated after amendment. All five conflicts are resolved, zero blocking or
degrading conflicts remain, and no pair forms an oscillation:

- Fan-out reuses the existing group core without creating lifecycle `StepName`s.
- Completeness is default-on but explicitly disableable; the choice is observable as a skip.
- Wiring without entry points is a deterministic prerequisite skip, not a pass or provider failure.
- Legacy config keys retain tolerant parsing; the new policy boundary and semantic empty-set error
  fail before dispatch.
- Disposition application occurs after raw judgement, so it does not change grader input or raw
  rubric rates.
- Current `test_suite` PASS supplies green proof once; only the isolated reverted-production
  Tautology preflight executes tests during review.
- Cached semantic results are re-materialized as current-lap evidence and never reuse an aggregate
  verdict; skips and cache hits make no provider call.
- Tautology preflight evidence has a separate exact-input cache because it precedes projection
  hashing; neither preflight nor rubric infrastructure failures are reusable.
- Active-loop acceptance composes with the cumulative cap: a later effective pass resets convergence
  state normally, while the command does not become a general HALT clearer.
- The external CLI writer reuses the same-schema external event ledger and merged reader; no parallel
  telemetry channel exists.
- Accepted-risk publication uses the existing resumable finish coordinator and remains idempotent.

## Appendix A: Repo-wide ADR Corpus

### Examined overlapping ADRs

- `adr-2026-07-03-reactive-model-fallback-ladder`
- `adr-2026-07-05-daemon-rate-limit-episode-coordinator`
- `adr-2026-07-07-audit-trail-event-sink`
- `adr-2026-07-10-concurrent-group-core`
- `adr-2026-07-11-pipeline-state-durability`
- `adr-2026-07-13-session-fresh-verdict-artifacts`
- `adr-2026-07-21-completeness-as-build-review-rubric`
- `adr-2026-07-23-build-review-fresh-base-disposition`
- `adr-2026-07-23-built-in-provider-model-policies`
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`
- `adr-2026-07-25-fail-closed-durable-shipment-evidence`
- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation`
- `adr-2026-07-27-cold-start-within-step-retries`
- `adr-2026-07-29-engine-observed-provider-time-partition`
- `adr-2026-07-29-operator-park-scheduling-unit-boundary`
- `adr-2026-07-29-ship-start-draft-pr`
- `adr-2026-08-01-bot-owned-release-pr`
- `adr-2026-08-01-conduct-state-mutation-port`
- `adr-2026-08-01-engine-owned-resumable-finish-publication`
- `adr-2026-08-01-engine-owned-scoped-test-invocation`
- `adr-2026-08-08-pipeline-owned-closeout-timestamps`
- `adr-2026-08-09-operator-only-scoped-artifact-reseal`
- `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`
- `adr-2026-08-11-halt-events-ride-the-persisted-spine`
- `adr-2026-08-11-wiring-judged-in-build-review`
- `adr-2026-08-12-cumulative-build-review-convergence-bound`
- `adr-2026-08-12-removal-anchored-tautology-exemption`
- `adr-2026-08-13-engine-managed-build-review-rubric-branches`
- `adr-2026-08-13-stable-build-review-finding-dispositions`

### Narrowed-out approved ADRs

The exact repo-wide approved corpus members that did not share this feature's behavior, entity,
field, resource, or gate follow. Fully superseded ADRs were excluded before narrowing.

Narrowed out: 220 of 248 approved ADRs.

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
- `adr-2026-07-04-park-unpark-cli-verbs`
- `adr-2026-07-04-pending-restart-queue`
- `adr-2026-07-04-resolution-worktree-lifecycle`
- `adr-2026-07-04-respawn-in-place-restart`
- `adr-2026-07-04-versioned-engine-store-atomic-flip`
- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`
- `adr-2026-07-05-engine-owned-task-status`
- `adr-2026-07-05-halt-pr-presentation-reliability`
- `adr-2026-07-05-retry-as-escalation-ladder`
- `adr-2026-07-05-standalone-bin-update`
- `adr-2026-07-06-daemon-false-ship-guard`
- `adr-2026-07-06-installed-root-resolution-for-global-writes`
- `adr-2026-07-06-manual-test-fail-routing`
- `adr-2026-07-06-migration-gate-waiver`
- `adr-2026-07-06-stale-engine-respawn-in-place`
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
- `adr-2026-07-11-semantic-attribution-verification-lane`
- `adr-2026-07-11-verdict-aware-resume-entry`
- `adr-2026-07-12-judged-attribution-verdict-persistence`
- `adr-2026-07-12-progress-aware-build-halt`
- `adr-2026-07-12-rebase-evidence-stamp-translation`
- `adr-2026-07-12-wired-into-contract`
- `adr-2026-07-13-kickback-build-no-op-escalation`
- `adr-2026-07-13-park-all-dispatch-paths`
- `adr-2026-07-13-retry-classify-rerun-vs-route`
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
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation`
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound`
- `adr-2026-07-26-daemon-decide-preseed-ownership`
- `adr-2026-07-26-event-sink-registry-exhaustiveness`
- `adr-2026-07-26-protected-artifact-seal-rebaseline`
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
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main`
- `adr-2026-07-29-deterministic-build-verification-fanout`
- `adr-2026-07-30-contract-aware-same-file-wiring`
- `adr-2026-07-30-finish-only-mergeability-gate`
- `adr-2026-07-30-pinned-remote-theme-for-pages-navigation`
- `adr-2026-07-30-provider-preparation-lifecycle-supervision`
- `adr-2026-08-01-multi-proof-park-deletion-authority`
- `adr-2026-08-01-rebase-full-replay-intent-validation`
- `adr-2026-08-01-scoped-run-verb-release-surface`
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`
- `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`
- `adr-2026-08-02-plan-scope-containment-at-commit-boundary`
- `adr-2026-08-03-build-repair-member-reuse-validity`
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
- `adr-2026-08-06-publication-progress-is-its-own-disposition`
- `adr-2026-08-07-project-teardown-hook-contract-and-containment`
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts`
- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization`
- `adr-2026-08-07-worktree-removal-coverage-guard`
- `adr-2026-08-08-finish-human-required-halt-rendering`
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
- `adr-2026-08-09-non-blocking-plan-scope-containment`
- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`
- `adr-2026-08-09-recorded-red-exception-for-remediation`
- `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`
- `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator`
- `adr-2026-08-09-seal-rotation-authorship-predicate`
- `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag`
- `adr-2026-08-09-worktree-local-provider-scratch`
- `adr-2026-08-11-deprecated-no-op-step-retirement`
- `adr-2026-08-12-fail-closed-intake-ledger-durability`
- `adr-2026-08-13-durable-base-advance-attribution`
- `adr-2026-08-13-markdown-default-inversion`
