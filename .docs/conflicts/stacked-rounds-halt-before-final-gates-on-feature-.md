# Conflict Check: Stacked rounds reach whole-feature validation

**Stories:** `.docs/stories/stacked-rounds-halt-before-final-gates-on-feature-.md`, Stories 1–4, operator accepted.
**Result:** PASS — zero blocking conflicts, zero degrading conflicts, zero resolutions.
**Scope:** Compare this feature's acceptance behavior with the repository story/specification corpus and governing APPROVED ADRs. Historical unrelated pairs are not re-adjudicated.

## Interaction analysis

Each row checks both directions: fully satisfying the new stories must preserve the cited contract, and satisfying the existing contract must still permit the new outcome. Confidence is 95%, grounded in the cited text and the approved scope, rather than an assumption of compatibility from filenames.

| Existing contract | New stories | Both-direction result |
|---|---|---|
| `build-loop-cannot-complete-a-feature-child-by-chil`, Story 4; `adr-2026-10-07-per-child-build-region` D4 | 1–4 | Compatible. The existing contract requires the child overlay for reads and child-owned region writes. The new behavior repairs that read context and expressly forbids synthetic root completion. Neither requires a second authority or altered storage. |
| `clamp-resume-entry-to-a-runnable-step-and-halt-whe`, Stories 1–2; `adr-2026-07-11-verdict-aware-resume-entry` D1–D5 and its child-overlay amendment | 2–3 | Compatible. Entry is still reconciled backward using the existing authority; the input is the correct overlay. An unresolved gate retains its existing refusal. The new no-false-HALT outcome applies to satisfied or runnable authoritative prerequisites, not a blanket suppression of gate refusals. |
| `routed-repair-opens-a-new-round-while-an-earlier-r`, Story 1; `adr-2026-10-12-routed-whole-feature-repair` D7 and D13 amendments | 1–2 | Compatible. Host/queue continuation happens before leaf entry. The new stories require settled routing and do not skip a remaining host or duplicate reconciliation. Live and resumed paths retain the same next-work meaning. |
| `refused-over-scope-rework-can-t-start-while-a-rout`, Story 2; routed-repair ADR D7 as amended by #3597 | 1–3 | Compatible. Outstanding hosts, unreadable/nonempty queues, and open rounds still hold back every whole-feature step. Removing a false missing-root-suite halt does not remove a genuine routing fence or its bounded stall. |
| `routed-remediation-skips-re-run-steps-on-stale-chi`, Stories 2 and 5; routed-repair ADR D8 round-evidence amendment | 2–3 | Compatible. Completed means satisfied under existing round and invalidation rules. A previous round's passing host verdict cannot skip required current work, while valid completed work remains reusable. No new rule expires every unaffected child each round. |
| `a-routed-fix-is-never-carried-up-the-stack-or-foll`, Story 6 | 1–3 | Compatible. Leaf return still records the return and re-pends applicable gates after routed repair. The new stories govern entry into those pending gates, not route-record writes, budget refunds, or whether a gate should be re-pended. |
| `late-gate-fixes-restack-the-whole-stack-every-repa`, Stories 5–6; `adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish` | 1–3 | Compatible. A fold with unchanged leaf tree keeps existing whole-feature results and proceeds to rebase; a changed tree re-pends them. The new stories dispatch the first *pending* whole-feature gate and never require a fresh suite or a new audit after every fold. Required child revalidation still precedes publication. |
| `manual-reviewer-edits-cannot-be-landed-safely-in-t`; `adr-2026-10-24-operator-route-round-for-closed-stacked-children` | 1–4 | Compatible. Operator landing, abandonment, and budgets retain their existing semantics. An abandoned round's preserved results need not be re-pended by this feature; an incomplete validation still cannot be treated as complete. |
| `successful-stacked-restack-halts-on-a-stale-reopen`, Story 3; `adr-2026-08-01-conduct-state-mutation-port` | 4 | Compatible. Refreshing feature state and aligning cursor ownership remains necessary; the new stories prohibit false conflicts from crossing stores, not genuine same-field mutation conflicts. Writes still go through the existing mutation port. |
| `multi-child-feature-cannot-resume-after-an-operato`, Stories 3–4; `adr-2026-10-23-slice-topology-from-sealed-plan` D2–D5 | 2, 4 | Compatible. Existing topology/cursor failures are actionable refusals, never evidence of a flat feature or completed child. No new inference from checkout alone or new topology cache is required. |
| `stack-preflight-refusals-end-the-run-with-no-halt-`, Stories 1–2; `adr-2026-07-28-total-halt-classification-legacy-boundary` | 2–3 | Compatible. Actual unavailable/refused preflight and validation failures retain their reason and classification. This feature removes only a false prerequisite detour; it does not auto-clear needs-human halts or invent unclassified stops. |
| `rebase-base-refresh-revalidation-halts-needs-human`, Stories 2 and 6; `adr-2026-10-10-stacked-restack-journaled-replay` | 1–3 | Compatible. Queued revalidation admission and restack recovery keep their authority. Once they settle, child evidence is read correctly. The new feature does not change queue consumption, restack rollback, or base-refresh sequencing. |

The remaining screened matches govern builder placement claims, provider-session invocation, RED provenance, budget accounting, commit attribution, telemetry, or publication. The new stories neither alter those mechanisms nor redefine their evidence; their requirements remain satisfiable alongside the corrected handoff. In particular, `adr-2026-09-06-reopened-task-resolution` requires routed obligations to finish their host region and exit before returning to review, which the settled-routing precondition preserves. The acceptance RED and budget ADR amendments retain their respective evidence and accounting owners.

## Six conflict types

- **Contradiction:** no criterion requires a gate both to run and not run under the same authoritative completion state.
- **Behavioral overlap:** new stories refine the absent-root-status boundary; the existing routing, fold, and failure paths keep their contracts.
- **State conflict:** child region evidence and feature-wide state retain distinct ownership; no synthetic aggregate is introduced.
- **Resource contention:** no new writer, store, lease, or shared resource is required.
- **Sequencing:** routed/queued work precedes leaf validation; missing suite/review precedes whole-feature gates; completed BUILD is not repeated solely due to missing root fields.
- **Oscillation:** reuse of valid evidence and mandatory rerun of stale/negative evidence are disjoint. Fixing one does not invalidate the other; no alternate root-success authority can repeatedly override the child.

## Prior conflict reports

The #3455 stale-verdict report distinguishes completed current-round work from merely old passing evidence and distinguishes refused exits from routing stalls. The #3597 report distinguishes a genuine routing deferral from refusal-rework failure. Both distinctions are retained. The #3445 continuation report and the base-refresh revalidation report retain their continuation ownership. No earlier resolution needs reopening.

## Verify-Claims and review outcome

Verified grounding: the named story clauses, ADR clauses and amendments, the approved architecture review, and the source-level separation of child overlays from root state recorded there. No opposing sentence pair was found that requires both incompatible outcomes under the same preconditions. No load-bearing assumption remains for this comparison. Verdict: CLEAR.

No story or historical ADR was changed by this check. No review-required marker is needed under the conflict-check skill because there are no conflicts or resolutions; composer still owns its operator output confirmation.

## Corpus inventory

Screened complete Markdown text from 695 story files, 65 specification files, 793 decision/review files, and 259 prior conflict files. Screening used subject and behavior terms, followed by direct review of the interacting passages and named governing decisions. Screening is not a claim that unrelated historical pairs were re-adjudicated.

### Story candidates from corpus screening

- `a-change-to-one-stacked-child-cannot-be-carried-in.md`
- `a-routed-fix-cannot-be-built-charged-and-reviewed-.md`
- `a-routed-fix-is-never-carried-up-the-stack-or-foll.md`
- `acceptance-specs-hide-missing-red-evidence-and-com.md`
- `admitted-whole-feature-fixes-in-a-stacked-feature-.md`
- `build-loop-cannot-complete-a-feature-child-by-chil.md`
- `codex-fresh-session-per-step-contract.md`
- `done-step-with-an-unsatisfied-gate-verdict-loops-s.md`
- `late-gate-fixes-restack-the-whole-stack-every-repa.md`
- `manual-reviewer-edits-cannot-be-landed-safely-in-t.md`
- `operator-command-to-inspect-and-recover-wedged-rou.md`
- `over-scope-refusal-should-route-to-build-rework-in.md`
- `rebase-base-refresh-revalidation-halts-needs-human.md`
- `refused-over-scope-rework-can-t-start-while-a-rout.md`
- `restack-resolver-asks-for-an-operator-decision-no-.md`
- `routed-build-claim-with-null-fields-is-rejected-as.md`
- `routed-remediation-skips-re-run-steps-on-stale-chi.md`
- `routed-repair-hosts-a-finding-on-a-stack-child-tha.md`
- `routed-repair-opens-a-new-round-while-an-earlier-r.md`
- `stack-preflight-refusals-end-the-run-with-no-halt-.md`
- `stacked-repair-restack-conflict-above-the-repaired.md`
- `stacked-rounds-halt-before-final-gates-on-feature-.md`
- `successful-stacked-restack-halts-on-a-stale-reopen.md`
- `whole-feature-audit-fixes-cannot-land-in-the-stack.md`

Additional direct checks: `clamp-resume-entry-to-a-runnable-step-and-halt-whe.md` and `multi-child-feature-cannot-resume-after-an-operato.md`. Provider-session resume and builder prerequisite-claim matches were narrowed out: they govern provider launch syntax and repair placement, respectively, not gate prerequisites.

### ADR disposition inventory

Partially or ambiguously superseded ADRs remain eligible. Fully superseded status is recorded explicitly; subject-disjoint records are narrowed out rather than treated as evidence of compatibility.

| ADR | Disposition | Basis |
|---|---|---|
| `adr-002-engineer-store-and-retro-redirect.md` | Narrowed out | Subject outside this change: ADR 002: Engineer store format + retro-redirect mechanism |
| `adr-003-registry-write-and-integration.md` | Narrowed out | Subject outside this change: ADR 003: Registry write mechanism + bootstrap integration |
| `adr-005-non-autonomy-and-read-only-governor.md` | Narrowed out | Subject outside this change: ADR 005: Non-autonomy by construction + read-only governor |
| `adr-006-flywheel-lesson-selection-and-provenance.md` | Narrowed out | Subject outside this change: ADR 006: Flywheel — lesson selection + engineer-planned provenance |
| `adr-008-agent-hosted-loop-and-in-chat-authoring.md` | Narrowed out | Subject outside this change: ADR 008: Agent-hosted engineer loop + in-chat human-gated authoring (cross-repo isolation without a subprocess) |
| `adr-009-intake-adapter-port.md` | Narrowed out | Subject outside this change: ADR 009: Intake adapter port (hexagonal) + Envelope contract |
| `adr-010-pidfile-lock-daemon-liveness.md` | Narrowed out | Subject outside this change: ADR 010: Pidfile-lock daemon liveness, 1-per-repo mutex & ensure-running |
| `adr-011-async-intake-queue-and-github-source.md` | Narrowed out | Subject outside this change: ADR-011: Async Intake Queue + GitHub-Issues Source |
| `adr-012-durable-intake-ledger-sole-dedup-authority.md` | Narrowed out | Subject outside this change: ADR-012: Durable Intake Ledger as Sole Dedup Authority |
| `adr-014-otel-observability-exporter.md` | Narrowed out | Subject outside this change: ADR 014: OpenTelemetry Observability Exporter |
| `adr-015-daemon-pr-labeling-sweep.md` | Narrowed out | Subject outside this change: ADR 015: Daemon PR labeling — shared gh seam, tracked mergeable watch registry, best-effort sweep |
| `adr-2026-06-29-architecture-before-stories-convergent-kickback.md` | Narrowed out | Subject outside this change: ADR: Architecture before stories; convergent root-routed kickbacks |
| `adr-2026-06-29-brainstorm-rename-migration.md` | Narrowed out | Subject outside this change: ADR: Migration for `brainstorm → {explore, prd}` |
| `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md` | Narrowed out | Subject outside this change: ADR: Daemon supervisor port + attachable foreground hosting |
| `adr-2026-06-29-explore-prd-split-track-in-explore.md` | Narrowed out | Subject outside this change: ADR: Split `brainstorm` into `explore` + `prd`; track decided in `explore` |
| `adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration.md` | Narrowed out | Subject outside this change: ADR: Memory Provider Plugin Kind & Agent-Queried Integration |
| `adr-2026-06-29-memory-resilience-write-fallback-and-reconcile.md` | Narrowed out | Subject outside this change: ADR: Memory Resilience — Best-Effort, Write-Fallback & Reconcile-on-Reconnect |
| `adr-2026-06-29-per-project-memory-provider-selection.md` | Narrowed out | Subject outside this change: ADR: Per-Project Memory Provider Selection |
| `adr-2026-06-29-per-provider-retrieval-guidance-location.md` | Narrowed out | Subject outside this change: ADR: Per-Provider Retrieval Guidance Location |
| `adr-2026-06-29-platform-adoption-and-removal-surface.md` | Narrowed out | Subject outside this change: ADR: Platform Adoption & Removal Surface |
| `adr-2026-06-29-rebase-conflict-resolution-dispatch.md` | Narrowed out | Subject outside this change: ADR: Gated rebase-conflict resolution dispatch (amends ADR-001) |
| `adr-2026-06-29-safe-reversible-memory-migration.md` | Narrowed out | Subject outside this change: ADR: Safe, Reversible Migration of Existing Memory |
| `adr-2026-06-29-shared-memory-store-placement-and-durability.md` | Narrowed out | Subject outside this change: ADR: Shared Memory Store Placement & Cross-Worktree Durability |
| `adr-2026-06-29-track-marker-location.md` | Narrowed out | Subject outside this change: ADR: Track marker is a dedicated `.docs/track/<slug>.md` |
| `adr-2026-06-30-background-intake-brain-loop.md` | Narrowed out | Subject outside this change: ADR: Background intake runs on a single brain/supervisor loop; ledger stays single-writer |
| `adr-2026-06-30-engineer-worktree-authoring-isolation.md` | Narrowed out | Subject outside this change: ADR 2026-06-30: Engineer authors in a per-idea worktree (ADR-008 escalation, for same-repo concurrency) |
| `adr-2026-06-30-grandfather-cutover-merge-time.md` | Narrowed out | Subject outside this change: ADR: Deriving a Spec's Merge Time for the Grandfather Cutover |
| `adr-2026-06-30-halt-based-release-gates.md` | Narrowed out | Subject outside this change: ADR: All self-host release gates are HALT-based and fail-closed |
| `adr-2026-06-30-origin-seeded-intake-routing.md` | Narrowed out | Subject outside this change: ADR: Origin-seeded routing for GitHub-intake ideas (human gate preserved) |
| `adr-2026-06-30-owner-gate-identity-resolution.md` | Narrowed out | Subject outside this change: ADR: Owner-Gate Identity Resolution and Fail-Open Posture |
| `adr-2026-06-30-owner-provenance-recording.md` | Narrowed out | Subject outside this change: ADR: Owner Provenance — How a Spec Records and Proves Its Owner |
| `adr-2026-06-30-sandbox-build-isolation.md` | Narrowed out | Subject outside this change: ADR: Sandbox harness self-builds via a throwaway CLAUDE_CONFIG_DIR |
| `adr-2026-06-30-self-host-detection-seam.md` | Narrowed out | Subject outside this change: ADR: Single swappable self-host detection seam |
| `adr-2026-07-01-machine-scoped-operator-identity.md` | Narrowed out | Subject outside this change: ADR 2026-07-01: Machine-scoped operator identity + fail-closed ownership gating |
| `adr-2026-07-03-daemon-auto-restart-stale-engine.md` | Narrowed out | Subject outside this change: ADR: Daemon auto-restart on stale engine code — exit-to-respawn at the idle boundary |
| `adr-2026-07-03-dependency-fail-closed-and-cache.md` | Narrowed out | Subject outside this change: ADR: Fail-closed indeterminate semantics and per-scan blocker cache |
| `adr-2026-07-03-dependency-gate-backlog-waiting-channel.md` | Narrowed out | Subject outside this change: ADR: DependencyGate placement and the backlog waiting-items channel |
| `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.md` | Narrowed out | Subject outside this change: ADR: Engineer checkpoint commits + idempotent `land` |
| `adr-2026-07-03-gated-snapshot-status-read-model.md` | Narrowed out | Subject outside this change: ADR: Per-pass atomic gated snapshot as the status CLI's read model |
| `adr-2026-07-03-gated-writeback-announcements.md` | Excluded: fully superseded | SUPERSEDED by adr-2026-09-11-github-operation-ownership |
| `adr-2026-07-03-generated-model-table-single-source.md` | Narrowed out | Subject outside this change: ADR: Generated HARNESS.md model table — typed engine metadata as single source |
| `adr-2026-07-03-halt-pr-rehabilitation-at-finish.md` | Narrowed out | Subject outside this change: ADR: Halt-PR Rehabilitation at Finish (skill presentation, engine mechanics, gate enforcement) |
| `adr-2026-07-03-harness-daemon-profile.md` | Narrowed out | Subject outside this change: ADR: Harness daemon profile — build-to-PR on the harness repo, human merge |
| `adr-2026-07-03-issue-dependencies-api-surface.md` | Narrowed out | Subject outside this change: ADR: GitHub Issue-Dependencies REST API as the dependency source of truth |
| `adr-2026-07-03-owner-gate-gated-channel.md` | Narrowed out | Subject outside this change: ADR: Owner-gate skips ride the discovery-result gated channel |
| `adr-2026-07-03-post-rebase-force-with-lease.md` | Narrowed out | Subject outside this change: ADR: Post-rebase refresh is the only force-push, and only `--force-with-lease` |
| `adr-2026-07-03-pr-timing-config-key.md` | Narrowed out | Subject outside this change: ADR: `pr_timing` config key — one setting, two publish flows |
| `adr-2026-07-03-pr-timing-self-host-precedence.md` | Narrowed out | Subject outside this change: ADR: Self-host builds ignore `early-draft` (guardrail precedence) |
| `adr-2026-07-03-priority-fetch-fail-soft.md` | Narrowed out | Subject outside this change: ADR: Priority-fetch failure degrades to pure date order with an in-memory once-per-outage warning |
| `adr-2026-07-03-priority-from-linked-issue-labels.md` | Narrowed out | Subject outside this change: ADR: Backlog priority resolved from linked-issue labels via a post-discovery ordering seam |
| `adr-2026-07-03-prose-to-link-migration.md` | Narrowed out | Subject outside this change: ADR: One-time prose→link migration — parse patterns and idempotency |
| `adr-2026-07-03-reactive-model-fallback-ladder.md` | Narrowed out | Subject outside this change: ADR: Reactive model fallback ladder in the invocation seam |
| `adr-2026-07-03-version-gate-semver-escalation.md` | Narrowed out | Subject outside this change: ADR: Version-gate semver escalation — PATCH auto-pass, MINOR/MAJOR HALT |
| `adr-2026-07-04-auth-failure-park-and-poll.md` | Narrowed out | Subject outside this change: ADR: Auth failures park-and-poll on operator credentials — never retry, never escalate |
| `adr-2026-07-04-autoresolve-state-and-config.md` | Narrowed out | Subject outside this change: ADR: Auto-Resolve State on the Watch Entry; Fail-Closed Suite Config |
| `adr-2026-07-04-claim-time-delivery-evidence-guard.md` | Narrowed out | Subject outside this change: ADR: Claim-Time Delivery-Evidence Guard (intake re-dispatch protection) |
| `adr-2026-07-04-durable-pause-marker.md` | Narrowed out | Subject outside this change: ADR: Durable repo-scoped pause marker at the dispatch boundary |
| `adr-2026-07-04-event-driven-halt-clear-wake.md` | Narrowed out | Subject outside this change: ADR 2026-07-04: Event-Driven HALT-Clear Wake with Poll Backstop |
| `adr-2026-07-04-kickback-event-emission-and-log-prominence.md` | Narrowed out | Subject outside this change: ADR: Kickback event emission completeness + log-line prominence |
| `adr-2026-07-04-pending-restart-queue.md` | Narrowed out | Subject outside this change: ADR: Pending-restart queues durably and fires at the idle boundary |
| `adr-2026-07-04-resolution-worktree-lifecycle.md` | Narrowed out | Subject outside this change: ADR: Dedicated Transient Worktree for Open-PR Conflict Resolution |
| `adr-2026-07-04-respawn-in-place-restart.md` | Narrowed out | Subject outside this change: ADR: Restart-in-place via pane respawn inside the existing tmux session |
| `adr-2026-07-04-versioned-engine-store-atomic-flip.md` | Narrowed out | Subject outside this change: ADR: Versioned engine store with atomic current-pointer flip (closes #215) |
| `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep.md` | Narrowed out | Subject outside this change: ADR: Widen the Rebase-Resolution Dispatch Exception to the Mergeable Sweep |
| `adr-2026-07-05-daemon-rate-limit-episode-coordinator.md` | Narrowed out | Subject outside this change: ADR: Daemon rate-limit episode is a coordinated in-process pause, not a per-feature failure |
| `adr-2026-07-05-engine-owned-task-status.md` | Narrowed out | Subject outside this change: ADR 2026-07-05: Engine-owned, git-derived task-status.json |
| `adr-2026-07-05-halt-pr-presentation-reliability.md` | Narrowed out | Subject outside this change: ADR 2026-07-05: Halt-PR presentation reliability — verify-after-write + reconciliation |
| `adr-2026-07-05-retry-as-escalation-ladder.md` | Narrowed out | Subject outside this change: ADR 2026-07-05: Retry-as-escalation ladder |
| `adr-2026-07-05-standalone-bin-update.md` | Narrowed out | Subject outside this change: ADR 2026-07-05 — Extract the self-update/channel flow to a standalone `bin/update` |
| `adr-2026-07-06-daemon-false-ship-guard.md` | Narrowed out | Subject outside this change: ADR: finish push-evidence gate and daemon ship guard (no false ships) |
| `adr-2026-07-06-installed-root-resolution-for-global-writes.md` | Narrowed out | Subject outside this change: ADR: Installed-root resolution for operator-global writes (worktree-install guard) |
| `adr-2026-07-06-manual-test-fail-routing.md` | Narrowed out | Subject outside this change: ADR: manual_test FAIL routing, fix-evidence gate, and gating enforcement |
| `adr-2026-07-06-migration-gate-waiver.md` | Narrowed out | Subject outside this change: ADR: TR-10 migration gate accepts a committed no-breaking-surface waiver |
| `adr-2026-07-06-stale-engine-respawn-in-place.md` | Narrowed out | Subject outside this change: ADR: Stale-engine restart rides the respawn-in-place transport; relink precedes every handoff |
| `adr-2026-07-07-audit-trail-event-sink.md` | Narrowed out | Subject outside this change: ADR: Audit-trail event-sink writer for retro friction records |
| `adr-2026-07-07-daemon-owned-build-credential.md` | Narrowed out | Subject outside this change: ADR: Daemon-owned build credential behind a BuildAuthProvider seam |
| `adr-2026-07-07-finish-record-primitive.md` | Narrowed out | Subject outside this change: ADR: `conduct-ts finish-record` — deterministic finish-completion marker primitive |
| `adr-2026-07-07-ship-ci-feedback-loop.md` | Narrowed out | Subject outside this change: ADR: Ship→CI feedback loop — sweep-native bounded remediation of red shipped PRs |
| `adr-2026-07-07-single-generation-stale-respawn.md` | Narrowed out | Subject outside this change: ADR: Stale-engine respawn is single-generation — predecessor exits unconditionally on a fired trigger; lock-losers terminate |
| `adr-2026-07-07-task-trailer-id-alias.md` | Narrowed out | Subject outside this change: ADR: Task-Trailer Id Alias (`task-<id>` ≡ `<id>`) in Evidence Derivation |
| `adr-2026-07-08-halt-issue-closure-sweep.md` | Narrowed out | Subject outside this change: ADR: Deterministic halt-issue closure sweep (ledger + Halt-Slug stamp + close-on-ship) |
| `adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md` | Narrowed out | Subject outside this change: ADR: Main-checkout leak triage with byte-identity-gated auto-heal, plus a sandbox write-fence |
| `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md` | Narrowed out | Subject outside this change: ADR: Post-rebase gate-first mechanical re-verify (build only) |
| `adr-2026-07-09-deterministic-evidence-attribution-enforcement.md` | Narrowed out | Subject outside this change: ADR: Deterministic evidence attribution — engine-owned task transitions + worktree-local git hooks |
| `adr-2026-07-09-setup-failure-triage.md` | Narrowed out | Subject outside this change: ADR: Deterministic setup-failure triage (quarantine + bounded fix-session) |
| `adr-2026-07-10-concurrent-group-core.md` | Narrowed out | Subject outside this change: ADR: Concurrent group core — one capped, engine-integrated parallel executor |
| `adr-2026-07-10-daemon-stall-remediation.md` | Narrowed out | Subject outside this change: ADR: Route daemon build stalls (halt-user-input-required) through /remediate before halting |
| `adr-2026-07-10-evidence-range-anchor-resolution.md` | Narrowed out | Subject outside this change: ADR: Single-sourced evidence-range anchor resolution (branch base, never genesis) |
| `adr-2026-07-10-inline-work-attribution-enforcement.md` | Narrowed out | Subject outside this change: ADR: Inline build work attribution enforcement — fail-closed commit gate, dispatch-shaped execution, zero-work kickback |
| `adr-2026-07-10-intake-claim-priority-banding.md` | Narrowed out | Subject outside this change: ADR: Intake claim orders candidates by priority band above receivedAt FIFO, resolved at claim time, fail-open |
| `adr-2026-07-10-intra-step-build-progress-events.md` | Narrowed out | Subject outside this change: ADR: Intra-step build progress + stall as first-class ConductorEvents |
| `adr-2026-07-10-observed-close-watch-registry.md` | Narrowed out | Subject outside this change: ADR: Observed-close — watch registry + idle-tick sweep replaces close-on-merge for watched fixes |
| `adr-2026-07-10-park-marker-main-root-resolution.md` | Narrowed out | Subject outside this change: ADR: Park markers anchor to the MAIN repository root, resolved inside park-marker.ts |
| `adr-2026-07-10-retire-migration-grandfather.md` | Narrowed out | Subject outside this change: ADR: Retire the H8 migration-grandfather path — evidence stamps are the only completion currency |
| `adr-2026-07-10-session-hook-task-stamping.md` | Narrowed out | Subject outside this change: ADR: Session-hook task stamping at subagent dispatch |
| `adr-2026-07-10-validation-group-join.md` | Narrowed out | Subject outside this change: ADR: SHIP validation group — membership, join policy, and consolidated remediation |
| `adr-2026-07-11-attribution-abstain-or-loud.md` | Narrowed out | Subject outside this change: ADR: Attribution machinery is abstain-or-loud — a stale stamp is never left, an id is never guessed, an invalid id never passes |
| `adr-2026-07-11-attribution-spot-audit-measurement.md` | Narrowed out | Subject outside this change: ADR: Spot-audit measurement of fast-lane attribution accuracy |
| `adr-2026-07-11-attribution-verdict-interface.md` | Narrowed out | Subject outside this change: ADR: Attribution verdict interface and evidence-stamp schema evolution |
| `adr-2026-07-11-evidence-judge-cli-and-cutover.md` | Narrowed out | Subject outside this change: ADR: `conduct-ts evidence judge` CLI entry, cutover flag, and model-table entry |
| `adr-2026-07-11-finish-step-engine-completion-machinery.md` | Narrowed out | Subject outside this change: ADR: Finish-step completion becomes engine machinery (in-step presentation repair, hardened gate, surgical retry) |
| `adr-2026-07-11-pipeline-state-durability.md` | Narrowed out | Subject outside this change: ADR: `.pipeline` run-state durability — defense-in-depth, fail-loud-not-crash |
| `adr-2026-07-11-semantic-attribution-verification-lane.md` | Narrowed out | Subject outside this change: ADR: Semantic attribution verification lane at the build evidence gate |
| `adr-2026-07-11-verdict-aware-resume-entry.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-07-12-progress-aware-build-halt.md` | Narrowed out | Subject outside this change: ADR: Progress-aware build halt/park + progress-gated cross-dispatch re-kick (#280) |
| `adr-2026-07-12-rebase-evidence-stamp-translation.md` | Narrowed out | Subject outside this change: ADR: Engine translates sha-anchored evidence citations through its own rebases |
| `adr-2026-07-12-wired-into-contract.md` | Narrowed out | Subject outside this change: ADR: Wired-into contract — architecture decides, plan carries, Small tier falls back |
| `adr-2026-07-12-wiring-check-gate.md` | Excluded: fully superseded | SUPERSEDED in part by `adr-2026-07-29-deterministic-build-verification-fanout` (BUILD-tail ordering only) and `adr-2026-07-30-contract-aware-same-file-wiring` (same-file composition exception only) |
| `adr-2026-07-13-kickback-build-no-op-escalation.md` | Narrowed out | Subject outside this change: ADR 2026-07-13: Kickback→build no-op guard + zero-progress/unchanged-verdict escalation |
| `adr-2026-07-13-park-all-dispatch-paths.md` | Narrowed out | Subject outside this change: ADR 2026-07-13: Operator park blocks every dispatch entry point (immediate-before-dispatch predicate) |
| `adr-2026-07-13-retry-classify-rerun-vs-route.md` | Narrowed out | Subject outside this change: ADR 2026-07-13: Classify step-failures rerun-vs-route before burning a retry (#646) |
| `adr-2026-07-13-session-fresh-verdict-artifacts.md` | Narrowed out | Subject outside this change: ADR 2026-07-13: Step completion checks require a session-fresh verdict artifact (per-attempt floor) |
| `adr-2026-07-17-verify-only-judged-closure.md` | Narrowed out | Subject outside this change: ADR: Class-scoped judged closure for verify-only (prove-closed) plan tasks |
| `adr-2026-07-20-bounded-dirname-path-corroboration.md` | Narrowed out | Subject outside this change: ADR: Bounded dirname/subsystem pass in autoheal path-corroboration |
| `adr-2026-07-20-ci-fix-dispatch-via-steprunner.md` | Narrowed out | Subject outside this change: ADR: Dispatch ci-fix via DefaultStepRunner, not a bespoke claude spawn |
| `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification.md` | Narrowed out | Subject outside this change: ADR: Fail-loud-once startup preflight + resolver error classification |
| `adr-2026-07-20-post-rebase-delta-aware-invalidation.md` | Narrowed out | Subject outside this change: ADR: Delta-aware post-rebase gate invalidation |
| `adr-2026-07-21-completeness-as-build-review-rubric.md` | Excluded: fully superseded | SUPERSEDED by adr-2026-08-22-one-owner-per-review-question |
| `adr-2026-07-21-decide-time-unmerged-overlap-scan.md` | Narrowed out | Subject outside this change: ADR: DECIDE-time unmerged-overlap scan is a deterministic primitive, dual-hooked and advisory |
| `adr-2026-07-21-demote-task-stamping-to-telemetry.md` | Narrowed out | Subject outside this change: ADR: Demote per-task evidence stamping from a completion gate to telemetry |
| `adr-2026-07-21-engine-owned-acceptance-red-execution.md` | Narrowed out | Subject outside this change: ADR: Engine-owned RED execution for acceptance_specs, driven by a skill-recorded run contract |
| `adr-2026-07-21-intake-only-enforcement.md` | Narrowed out | Subject outside this change: ADR: Enforce intake criteria at capture/file time only — never downstream |
| `adr-2026-07-21-no-diff-task-evidence-stamp.md` | Narrowed out | Subject outside this change: ADR: A no-diff task earns completion currency deterministically — stamp Evidence: skipped, recognize Type: verification |
| `adr-2026-07-21-owner-stamped-at-authoring.md` | Narrowed out | Subject outside this change: ADR: Stamp Owner at authoring time; default-and-loudly-log an un-owned arrival — never silently skip |
| `adr-2026-07-21-s-tier-pipeline-knobs.md` | Narrowed out | Subject outside this change: ADR: Small features are cheap through the existing pipeline's own knobs — no separate SDLC flow (#668) |
| `adr-2026-07-21-serena-removal-path.md` | Narrowed out | Subject outside this change: ADR: Serena removal path — stop shipping it, migrate existing deployments via an approval-gated unregister, keep the repo-local ignore line |
| `adr-2026-07-22-attempts-counter-on-crash-recovery.md` | Narrowed out | Subject outside this change: ADR: `attempts` counter increments on stale-claim recovery |
| `adr-2026-07-22-auth-failure-classification-observed-401-patterns.md` | Narrowed out | Subject outside this change: ADR: Auth-failure classification — observed 401 patterns in text mode, structured status in the probe |
| `adr-2026-07-22-build-dispatch-json-usage-capture.md` | Narrowed out | Subject outside this change: ADR 2026-07-22-a — Capture build-session usage via `--output-format json` |
| `adr-2026-07-22-canonical-tagged-source-ref.md` | Narrowed out | Subject outside this change: ADR: Canonical tagged source-ref module (GitHub refs + Jira keys) |
| `adr-2026-07-22-canonical-tracker-client-seam.md` | Narrowed out | Subject outside this change: ADR: Canonical tracker-client seam with per-backend transport contract |
| `adr-2026-07-22-coherence-gate-placement-and-validation-split.md` | Narrowed out | Subject outside this change: ADR: Coherence gate — authoring step after /plan, deterministic validation at land |
| `adr-2026-07-22-coherence-waiver-and-duplicate-claim.md` | Narrowed out | Subject outside this change: ADR: Coherence waiver format and duplicate-intake-claim lookback scope |
| `adr-2026-07-22-daemon-level-missing-credential-gate.md` | Narrowed out | Subject outside this change: ADR: Daemon-level missing-credential gate — one waiting condition, per-feature preflight retained as backstop |
| `adr-2026-07-22-examples-state-isolation.md` | Narrowed out | Subject outside this change: ADR: Examples isolate all shared state via env overrides + a throwaway root |
| `adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md` | Narrowed out | Subject outside this change: ADR: Judged-gate evidence is preserved on re-dispatch by code-state validity, not timestamp freshness |
| `adr-2026-07-22-headless-vs-guided-examples.md` | Narrowed out | Subject outside this change: ADR: Two example modes — headless self-asserting vs guided launcher |
| `adr-2026-07-22-heartbeat-lease-deferred.md` | Narrowed out | Subject outside this change: ADR: Defer a claim heartbeat/lease; accept a bounded duplicate-processing window now |
| `adr-2026-07-22-intake-closed-issue-reconciliation.md` | Narrowed out | Subject outside this change: ADR: Reconcile closed GitHub issues out of the intake ledger at two control points |
| `adr-2026-07-22-origin-refresh-before-engine-rebuild.md` | Narrowed out | Subject outside this change: ADR: Fast-forward origin refresh before the quiescent engine rebuild, loud staleness fallback |
| `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record.md` | Narrowed out | Subject outside this change: ADR 2026-07-22-b — Per-feature cost rollup lives in the committed shipped-record |
| `adr-2026-07-22-per-task-work-happened-floor.md` | Narrowed out | Subject outside this change: ADR 2026-07-22 — Per-task "work happened at all" floor under build_review |
| `adr-2026-07-22-phase-scoped-docs-write-guard.md` | Narrowed out | Subject outside this change: ADR: Phase-scoped .docs write-guard — separate marker, engine-resolved allowlist, dumb hook |
| `adr-2026-07-22-requeue-claimed-distinct-from-reopen.md` | Narrowed out | Subject outside this change: ADR: A dedicated `claimed → pending` recovery transition, distinct from `reopen` |
| `adr-2026-07-22-stale-claim-staleness-window-default.md` | Narrowed out | Subject outside this change: ADR: Staleness window default for automatic stale-claim recovery |
| `adr-2026-07-22-token-liveness-probe-via-cli-invocation.md` | Narrowed out | Subject outside this change: ADR: Token liveness verification via minimal CLI invocation (not raw API probe) |
| `adr-2026-07-23-build-review-fresh-base-disposition.md` | Narrowed out | Subject outside this change: ADR: build_review grades against a verified-fresh base; scope FAILs get a bounded deterministic disposition |
| `adr-2026-07-23-commit-movement-liveness-floor.md` | Narrowed out | Subject outside this change: ADR: Commit-movement liveness floor under the build stall breaker; attributed-task count demoted to advisory |
| `adr-2026-07-23-intake-label-authority-scoped-replace.md` | Narrowed out | Subject outside this change: ADR: Intake label authority — explicit > existing > default, applied by namespace-scoped replace |
| `adr-2026-07-23-session-hook-repair-before-halt.md` | Narrowed out | Subject outside this change: ADR: Repair missing session hooks at the build preflight instead of removing the gate |
| `adr-2026-07-23-trailer-union-build-step-routing.md` | Narrowed out | Subject outside this change: ADR: Build-step exit routes on the trailer-union task resolution |
| `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md` | Narrowed out | Subject outside this change: ADR: Provider-aware step execution with fresh step-scoped sessions |
| `adr-2026-07-25-content-addressed-full-suite-proof.md` | Excluded: fully superseded | SUPERSEDED in part by `adr-2026-07-29-deterministic-build-verification-fanout` (BUILD-tail ordering and skill surface); previously superseded in part by `adr-2026-07-25-direct-claude-configured-verifier-interface` |
| `adr-2026-07-25-custom-step-completion-artifacts.md` | Narrowed out | Subject outside this change: ADR: Custom steps may declare fresh completion artifacts |
| `adr-2026-07-25-fail-closed-durable-shipment-evidence.md` | Narrowed out | Subject outside this change: ADR: Fail-Closed Durable Shipment Evidence |
| `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation.md` | Narrowed out | Subject outside this change: ADR: First-class Codex skill and guidance adaptation |
| `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation.md` | Narrowed out | Subject outside this change: ADR: Concurrent task telemetry and symmetric self-host isolation |
| `adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md` | Narrowed out | Subject outside this change: ADR: The kickback bound is durable across dispatches and keyed on the tree, not the commit |
| `adr-2026-07-26-daemon-decide-preseed-ownership.md` | Narrowed out | Subject outside this change: ADR: DECIDE-phase steps are preseeded by derivation, and vetted at discovery |
| `adr-2026-07-26-event-sink-registry-exhaustiveness.md` | Narrowed out | Subject outside this change: ADR 2026-07-26: Compile-time exhaustive event-sink registry |
| `adr-2026-07-26-protected-artifact-seal-rebaseline.md` | Narrowed out | Subject outside this change: ADR: rebaseline the protected-artifact seal on proven base inheritance |
| `adr-2026-07-26-rebase-tail-current-branch-before-publication.md` | Narrowed out | Subject outside this change: ADR: Rebase the current validated branch before publication |
| `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates.md` | Narrowed out | Subject outside this change: ADR 2026-07-27-b — The `## Cost` block evolves by addition, and cost aggregates split from token aggregates |
| `adr-2026-07-27-ancestry-proven-park-reconciliation.md` | Narrowed out | Subject outside this change: ADR: Ancestry-proven parked-feature auto-reconciliation with config kill-switch |
| `adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md` | Narrowed out | Subject outside this change: ADR: Codex never resumes — session resume becomes a declared provider capability |
| `adr-2026-07-27-cold-start-within-step-retries.md` | Narrowed out | Subject outside this change: ADR: Claude declares no resume — the harness never resumes any session |
| `adr-2026-07-27-cost-unmetered-is-a-first-class-state.md` | Narrowed out | Subject outside this change: ADR 2026-07-27-a — Absent provider cost is a first-class `cost-unmetered` state, never zero |
| `adr-2026-07-27-daemon-decide-kickback-halt.md` | Narrowed out | Subject outside this change: ADR: One kickback-phase policy, consulted at both backward-navigation seams |
| `adr-2026-07-27-project-config-scaffolder.md` | Narrowed out | Subject outside this change: ADR: Deterministic project-config scaffolder (#683) |
| `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md` | Narrowed out | Subject outside this change: ADR: Protected-artifact seal hands self-amendment to build_review instead of halting |
| `adr-2026-07-28-feature-aware-artifact-resolution.md` | Narrowed out | Subject outside this change: ADR: Feature-aware artifact contracts resolve step outputs for every generic consumer |
| `adr-2026-07-28-total-halt-classification-legacy-boundary.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-07-29-codex-readiness-probe-failure-disposition.md` | Narrowed out | Subject outside this change: ADR: Codex readiness separates probe failure from credential failure |
| `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main.md` | Narrowed out | Subject outside this change: ADR: Defer the feature-worktree reap until the shipped record is present on main |
| `adr-2026-07-29-deterministic-build-verification-fanout.md` | Narrowed out | Subject outside this change: ADR: Deterministic BUILD verification fan-out before model review |
| `adr-2026-07-29-engine-observed-provider-time-partition.md` | Narrowed out | Subject outside this change: ADR: Engine-observed provider intervals form an overlap-safe elapsed-time partition |
| `adr-2026-07-29-operator-park-scheduling-unit-boundary.md` | Narrowed out | Subject outside this change: ADR: Operator park drains one scheduling unit, then stops with a typed outcome |
| `adr-2026-07-29-ship-start-draft-pr.md` | Narrowed out | Subject outside this change: ADR: The implementation PR opens as a draft at SHIP-phase start |
| `adr-2026-07-30-contract-aware-same-file-wiring.md` | Narrowed out | Subject outside this change: ADR: Contract-aware same-file wiring requires symbol and root proof |
| `adr-2026-07-30-finish-only-mergeability-gate.md` | Excluded: fully superseded | SUPERSEDED |
| `adr-2026-07-30-pinned-remote-theme-for-pages-navigation.md` | Narrowed out | Subject outside this change: ADR: Use a pinned remote theme for Pages navigation |
| `adr-2026-07-30-provider-preparation-lifecycle-supervision.md` | Narrowed out | Subject outside this change: ADR: Supervise provider preparation with fenced attempt identities |
| `adr-2026-08-01-bot-owned-release-pr.md` | Narrowed out | Subject outside this change: ADR: Use a bot-owned release PR as the sole pending-release writer |
| `adr-2026-08-01-conduct-state-mutation-port.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-08-01-engine-owned-resumable-finish-publication.md` | Narrowed out | Subject outside this change: ADR: Engine-owned resumable FINISH publication from observed state |
| `adr-2026-08-01-engine-owned-scoped-test-invocation.md` | Narrowed out | Subject outside this change: ADR: Engine-owned scoped test invocation |
| `adr-2026-08-01-multi-proof-park-deletion-authority.md` | Narrowed out | Subject outside this change: ADR: Parked-feature deletion rests on a set of equal-strength proofs, and every refusal names its cause |
| `adr-2026-08-01-rebase-full-replay-intent-validation.md` | Narrowed out | Subject outside this change: ADR: Require full-replay intent validation for judgment-based rebase resolution |
| `adr-2026-08-01-scoped-run-verb-release-surface.md` | Narrowed out | Subject outside this change: ADR: The scoped-run verb ships without a migration block or waiver |
| `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate.md` | Narrowed out | Subject outside this change: ADR: Manual dispatch now, reusable fail-closed gate mode reserved for release |
| `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts.md` | Narrowed out | Subject outside this change: ADR: The live tier asserts pipeline outcomes, not scripted agent output |
| `adr-2026-08-02-plan-scope-containment-at-commit-boundary.md` | Narrowed out | Subject outside this change: ADR: Plan-scope containment enforced at the commit boundary |
| `adr-2026-08-03-build-repair-member-reuse-validity.md` | Narrowed out | Subject outside this change: ADR: A BUILD repair re-dispatches every verification member; reuse lives in the member's own evidence |
| `adr-2026-08-03-fail-closed-decide-entry.md` | Narrowed out | Subject outside this change: ADR: One fail-closed DECIDE-entry policy, consulted at every navigation seam |
| `adr-2026-08-03-ledgered-per-block-migration-execution.md` | Narrowed out | Subject outside this change: ADR: Ledgered, per-block migration execution |
| `adr-2026-08-03-uncommitted-work-floor-under-build-completion.md` | Narrowed out | Subject outside this change: ADR: Uncommitted work is a build-completion floor, enforced at both doors to `status:done` |
| `adr-2026-08-04-classify-before-spend-release-smoke-gate.md` | Narrowed out | Subject outside this change: ADR: Classify before spend — the release smoke gate runs once per release, not once per merge |
| `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md` | Narrowed out | Subject outside this change: ADR: DECIDE mutates accepted `.docs/` artifacts directly, and never emits a task that mutates one |
| `adr-2026-08-04-live-tier-provisions-its-own-provider-home.md` | Narrowed out | Subject outside this change: ADR: The live tier provisions its own provider home from the checkout under test |
| `adr-2026-08-04-unresolved-step-command-fails-by-name.md` | Narrowed out | Subject outside this change: ADR: An unresolved step command fails by name — before spend, and at the provider boundary |
| `adr-2026-08-05-blocked-classification-after-dedup.md` | Narrowed out | Subject outside this change: ADR: Blocked classification runs after dedup, and the gauntlet is reordered to allow it |
| `adr-2026-08-05-blocked-is-a-distinct-state-from-halted.md` | Narrowed out | Subject outside this change: ADR: `BLOCKED` is a distinct daemon state, not an extension of `HALTED` |
| `adr-2026-08-05-build-settle-outcome-stamp.md` | Narrowed out | Subject outside this change: ADR: Build settle outcome stamp and pre-dispatch no-op refusal |
| `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever.md` | Narrowed out | Subject outside this change: ADR: Every non-done dispatch outcome leaves an operator-clearable lever |
| `adr-2026-08-05-provenance-based-protected-artifact-inheritance.md` | Narrowed out | Subject outside this change: ADR: A protected artifact this branch never touched is inherited, whatever revision it is |
| `adr-2026-08-05-token-first-stories-reference-normalization.md` | Narrowed out | Subject outside this change: ADR: Token-first normalization of the plan `**Stories:**` reference |
| `adr-2026-08-05-worktree-classification-evidence-derived-reasons.md` | Narrowed out | Subject outside this change: ADR: Worktree dashboard classification and reasons are evidence-derived, never asserted |
| `adr-2026-08-06-bounded-progress-allowance-for-finish-publication.md` | Narrowed out | Subject outside this change: ADR: A non-charging publication re-entry is bounded by its own allowance and a stuck-transition cap |
| `adr-2026-08-06-honest-park-termination-boundary.md` | Narrowed out | Subject outside this change: ADR: Honest park termination boundary |
| `adr-2026-08-06-publication-progress-is-its-own-disposition.md` | Narrowed out | Subject outside this change: ADR: Publication progress is its own disposition, not an exempted retry reason |
| `adr-2026-08-07-project-teardown-hook-contract-and-containment.md` | Narrowed out | Subject outside this change: ADR: Project teardown hook — contract, time bound, and failure containment |
| `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.md` | Narrowed out | Subject outside this change: ADR: Provider-neutral commit gate for protected DECIDE artifacts |
| `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization.md` | Narrowed out | Subject outside this change: ADR: The release smoke gate goes live without pre-characterizing every previously-ungated file |
| `adr-2026-08-07-worktree-removal-coverage-guard.md` | Narrowed out | Subject outside this change: ADR: Worktree-removal coverage is enforced by an AST structural guard with an exemption registry |
| `adr-2026-08-08-finish-human-required-halt-rendering.md` | Narrowed out | Subject outside this change: ADR: FINISH human-required halts render reason, next action, and provider detail |
| `adr-2026-08-08-pipeline-owned-closeout-timestamps.md` | Narrowed out | Subject outside this change: ADR: Pipeline emits closeout events onto the bus from its own process |
| `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition.md` | Narrowed out | Subject outside this change: ADR: Repo-wide ADR conformance is a once-per-pass discovery precondition, reported per slug |
| `adr-2026-08-08-single-adr-approval-parser-three-rungs.md` | Narrowed out | Subject outside this change: ADR: One ADR-approval parser, read at three enforcement rungs |
| `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-08-09-adr-contradiction-detection-in-two-halves.md` | Narrowed out | Subject outside this change: ADR: ADR-versus-story contradiction detection is split across two DECIDE gates |
| `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal.md` | Narrowed out | Subject outside this change: ADR: The coherence `adr` layer is gated by a committed ADR signal, not always required |
| `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md` | Narrowed out | Subject outside this change: ADR: Bash reaches the `conductor:` block through `conduct-ts config`, never through PyYAML |
| `adr-2026-08-09-checkout-is-sole-version-identity-authority.md` | Narrowed out | Subject outside this change: ADR: The checkout is the sole version-identity authority |
| `adr-2026-08-09-conductor-block-single-source-of-truth.md` | Narrowed out | Subject outside this change: ADR: The schema-owned `conductor:` block is the single source of truth for update-check state |
| `adr-2026-08-09-declared-pattern-replication-in-build.md` | Narrowed out | Subject outside this change: ADR: Declared pattern replication — the copy is a plan task, and TDD pays only for the deltas |
| `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md` | Narrowed out | Subject outside this change: ADR: Clearing the halt state removes the marker and the label together, and preserves draft |
| `adr-2026-08-09-hook-owned-containment-event-ledger.md` | Narrowed out | Subject outside this change: ADR: An unresolvable containment check is a ConductorEvent on a hook-owned sibling ledger |
| `adr-2026-08-09-legacy-json-seed-migration-rule.md` | Narrowed out | Subject outside this change: ADR: The legacy JSON seeds the YAML once and wins that seed; the rename is the idempotence marker |
| `adr-2026-08-09-non-blocking-plan-scope-containment.md` | Narrowed out | Subject outside this change: ADR: Plan-scope containment widens its floor and records rationale instead of refusing commits |
| `adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md` | Narrowed out | Subject outside this change: ADR: A feature branch has exactly one PR; a HALT is a state on it, never a second PR |
| `adr-2026-08-09-operator-only-scoped-artifact-reseal.md` | Narrowed out | Subject outside this change: ADR: Operator-only scoped reseal of protected DECIDE artifacts |
| `adr-2026-08-09-recorded-red-exception-for-remediation.md` | Narrowed out | Subject outside this change: ADR: A remediation waiver of the RED requirement must be recorded, attributable and observable |
| `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag.md` | Narrowed out | Subject outside this change: ADR: The repo-wide ADR sweep is staged behind a default-off config key |
| `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine.md` | Narrowed out | Subject outside this change: ADR: The reseal audit entry rides the existing event spine and audit-trail sink |
| `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator.md` | Narrowed out | Subject outside this change: ADR: rotation provenance is resolved outside the pure evaluator |
| `adr-2026-08-09-seal-rotation-authorship-predicate.md` | Narrowed out | Subject outside this change: ADR: seal rotation permission is authorship, not base-identity |
| `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag.md` | Narrowed out | Subject outside this change: ADR: "Unverifiable" is triggered by no reachable tag, not by a missing record |
| `adr-2026-08-09-worktree-local-provider-scratch.md` | Narrowed out | Subject outside this change: ADR: Throwaway provider homes live in the worktree, reclaimed by lease-owner liveness |
| `adr-2026-08-11-deprecated-no-op-step-retirement.md` | Narrowed out | Subject outside this change: ADR: A step whose machinery is removed is retained as a deprecated no-op |
| `adr-2026-08-11-halt-events-ride-the-persisted-spine.md` | Narrowed out | Subject outside this change: ADR: Halt events ride the persisted spine, with a centrally stamped step |
| `adr-2026-08-12-cumulative-build-review-convergence-bound.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-08-12-execution-lifecycle-completeness-for-timing.md` | Narrowed out | Subject outside this change: ADR: Every started execution closes on the ledger, or the rollup names why it could not |
| `adr-2026-08-12-fail-closed-intake-ledger-durability.md` | Narrowed out | Subject outside this change: ADR: Fail closed on an unparseable intake ledger, and serialize its writers with a lease |
| `adr-2026-08-12-live-provider-coverage-from-plugin-registry.md` | Narrowed out | Subject outside this change: ADR: Live-tier provider coverage is derived from the plugin registry, not a maintained list |
| `adr-2026-08-12-operator-reseal-as-second-scope-justification.md` | Narrowed out | Subject outside this change: ADR: An operator reseal is a second admissible Scope justification |
| `adr-2026-08-12-per-provider-live-smoke-legs.md` | Narrowed out | Subject outside this change: ADR: Live provider coverage is one smoke file per provider, and gate enforcement follows the credential |
| `adr-2026-08-12-removal-anchored-tautology-exemption.md` | Excluded: fully superseded | SUPERSEDED by adr-2026-08-22-one-owner-per-review-question |
| `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md` | Narrowed out | Subject outside this change: ADR: A publication transition advances only when it moves the dimension it owns |
| `adr-2026-08-13-durable-base-advance-attribution.md` | Narrowed out | Subject outside this change: ADR: base-advance attribution is a durable spine record, not a gate-verdict field |
| `adr-2026-08-13-engine-managed-build-review-rubric-branches.md` | Narrowed out | Subject outside this change: ADR: Engine-managed build_review rubric branches with skill-owned judgement policy |
| `adr-2026-08-13-markdown-default-inversion.md` | Narrowed out | Subject outside this change: ADR: markdown is runtime source by default; only documentation paths are excluded |
| `adr-2026-08-13-stable-build-review-finding-dispositions.md` | Narrowed out | Subject outside this change: ADR: Stable per-finding build_review dispositions are typed, transactional operator state |
| `adr-2026-08-14-retire-build-review-wiring-rubric.md` | Narrowed out | Subject outside this change: ADR: The build_review wiring rubric is retired |
| `adr-2026-08-15-verify-only-anchored-tautology-exemption.md` | Excluded: fully superseded | SUPERSEDED by adr-2026-08-22-one-owner-per-review-question |
| `adr-2026-08-16-closed-build-review-finding-vocabularies.md` | Narrowed out | Subject outside this change: ADR: Close the build_review finding-identity vocabularies |
| `adr-2026-08-16-preservation-anchored-completeness-exemption.md` | Excluded: fully superseded | SUPERSEDED by adr-2026-08-22-one-owner-per-review-question |
| `adr-2026-08-16-restore-the-current-head-publication-fence.md` | Narrowed out | Subject outside this change: ADR: Restore the current-HEAD publication fence on the coordinator path |
| `adr-2026-08-17-framework-agnostic-tautology-scoped-run.md` | Narrowed out | Subject outside this change: ADR: the Tautology counterfactual is classified by exit code, never by runner output |
| `adr-2026-08-17-structural-live-checkout-containment.md` | Narrowed out | Subject outside this change: ADR: Contain the self-host dispatch instead of attributing live-checkout drift |
| `adr-2026-08-18-content-anchored-finding-reference-schema.md` | Narrowed out | Subject outside this change: ADR: Finding-identity references are content-anchored; a closed class-level reference schema for all four rubrics |
| `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md` | Narrowed out | Subject outside this change: ADR: A mechanical rubric fault is its own lane — non-charging retry, then an operator reduced-coverage decision |
| `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence.md` | Narrowed out | Subject outside this change: ADR: a rebase that invalidates build_review refunds its convergence laps; a PASS never clears them |
| `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope.md` | Narrowed out | Subject outside this change: ADR: The engine stamps the rubric judged-result envelope; the provider returns only findings |
| `adr-2026-08-19-live-provider-stream-observation.md` | Narrowed out | Subject outside this change: ADR: The autonomous provider dispatch is observed as a live stream, not only at its result |
| `adr-2026-08-19-operator-step-rewind-through-the-mutation-port.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md` | Narrowed out | Subject outside this change: ADR: A tree-attesting gate re-checks its predicate before the loop honors a persisted `done` |
| `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind.md` | Narrowed out | Subject outside this change: ADR: A step-runner failure whose inputs cannot change routes instead of retrying |
| `adr-2026-08-21-engine-identity-in-build-review-cache-key.md` | Narrowed out | Subject outside this change: ADR: The judging engine is part of the build_review cache identity |
| `adr-2026-08-21-review-bound-by-plan-done-when-criteria.md` | Narrowed out | Subject outside this change: ADR: build_review is bound by each plan task's Done when: criteria |
| `adr-2026-08-22-as-built-review-runs-always-with-plan-gap.md` | Narrowed out | Subject outside this change: ADR: The as-built architecture review runs always, with per-check policy and a PLAN_GAP verdict |
| `adr-2026-08-22-build-review-opt-in-rubric-container.md` | Narrowed out | Subject outside this change: ADR: build_review is an opt-in rubric container |
| `adr-2026-08-22-done-when-evidence-at-task-close.md` | Narrowed out | Subject outside this change: ADR: Done when: checks are evidenced at BUILD task close when the block exists |
| `adr-2026-08-22-one-owner-per-review-question.md` | Narrowed out | Subject outside this change: ADR: One owner per review question |
| `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback.md` | Narrowed out | Subject outside this change: ADR: prd_audit judges stories as authority, runs always, and owns the only bounded kickback |
| `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote.md` | Narrowed out | Subject outside this change: ADR: A coverage claim is grounded by a verbatim quote, not re-judged at land |
| `adr-2026-08-23-criterion-layer-is-structural-at-land.md` | Narrowed out | Subject outside this change: ADR: The coherence `criterion` layer is structural, and all its strictness stays at land |
| `adr-2026-08-23-diff-locality-is-an-authored-disposition.md` | Narrowed out | Subject outside this change: ADR: Diff-locality is an authored disposition, not a detected property |
| `adr-2026-08-24-evidentiary-defects-are-not-waivable.md` | Narrowed out | Subject outside this change: ADR: The coherence waiver covers coverage gaps, not evidentiary defects |
| `adr-2026-08-24-one-dispatch-member-on-the-provider-contract.md` | Narrowed out | Subject outside this change: ADR: The provider contract has one dispatch member; live observation is a seam on it |
| `adr-2026-08-24-over-scope-decision-block-and-durable-refusals.md` | Narrowed out | Subject outside this change: ADR: OVER_SCOPE decision block and durable refusals |
| `adr-2026-08-24-refused-step-status.md` | Narrowed out | Subject outside this change: ADR: A typed `refused` step status distinct from `failed` |
| `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope.md` | Narrowed out | Subject outside this change: ADR: Every non-REPL dispatch requests the machine envelope; live visibility comes from the stream observer |
| `adr-2026-08-25-as-built-remediable-findings-bounded-build-route.md` | Narrowed out | Subject outside this change: ADR: As-built BLOCKED findings are classified per finding, and remediable ones take a bounded route to BUILD |
| `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot.md` | Narrowed out | Subject outside this change: ADR: A committed rate card prices codex dispatches, and the codex REPL is a bounded one-shot |
| `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity.md` | Narrowed out | Subject outside this change: ADR: Engine-stamped run identity for SHIP-tail verdict artifacts |
| `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal.md` | Narrowed out | Subject outside this change: ADR: Config-key consumer registry and one-shot dead-surface removal |
| `adr-2026-08-26-music-vocabulary-player-composer-rename.md` | Narrowed out | Subject outside this change: ADR: v1.0 naming — engineer→Composer, ai-conductor as the canonical CLI; daemon stays |
| `adr-2026-08-26-remove-retrospectives-one-shot.md` | Narrowed out | Subject outside this change: ADR: Remove retrospectives (full and micro) in one shot |
| `adr-2026-08-26-setup-once-per-worktree-marker.md` | Narrowed out | Subject outside this change: ADR: Project setup runs once per worktree, gated by a content-addressed success marker |
| `adr-2026-08-26-shared-coherence-parser-at-discovery.md` | Narrowed out | Subject outside this change: ADR: Discovery consumes the shared coherence parser; the bespoke triple-scan is deleted |
| `adr-2026-08-27-daemon-dispatcher-executor-seam.md` | Narrowed out | Subject outside this change: ADR: Daemon dispatcher/executor seam with pinned-base work orders and policy-gated maintenance |
| `adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md` | Narrowed out | Subject outside this change: ADR: test_suite drift budget and verification mode |
| `adr-2026-08-29-build-review-remediate-case-adjudication.md` | Excluded: fully superseded | Superseded by `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` |
| `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md` | Narrowed out | Subject outside this change: ADR: mixed build_review laps preserve content adjudication |
| `adr-2026-08-29-operator-authorized-kickback-budget-recovery.md` | Excluded: fully superseded | Superseded by `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` |
| `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded.md` | Narrowed out | Subject outside this change: ADR: Counterfactual sensitivity is judged from the excerpt, not decreed by exit code |
| `adr-2026-08-30-shared-plan-task-reference-resolver.md` | Narrowed out | Subject outside this change: ADR: Cited plan-task references resolve through one shared resolver, not per-consumer parses |
| `adr-2026-08-31-coverage-binding-judge-step.md` | Narrowed out | Subject outside this change: ADR: Coverage claims bind to `Done when`; a default-off pre-BUILD judge confirms the binding |
| `adr-2026-08-31-kickback-ledger-read-fails-closed.md` | Narrowed out | Subject outside this change: ADR: An unreadable kickback ledger fails closed, and audit history is separable from enforcement state |
| `adr-2026-09-02-adr-decision-citability-contract.md` | Narrowed out | Subject outside this change: ADR: ADR Decision Citability Contract |
| `adr-2026-09-05-gh-cli-version-floor-and-environment-gate.md` | Narrowed out | Subject outside this change: ADR: A declared `gh` version floor, enforced as a machine-level environment gate |
| `adr-2026-09-06-engine-owned-test-quality-scope.md` | Narrowed out | Subject outside this change: ADR: Engine-owned test-quality scope with explicit candidate judgment |
| `adr-2026-09-06-inbound-intake-trust-boundary.md` | Narrowed out | Subject outside this change: ADR: Inbound intake trust boundary — tracker text is evidence, never instruction |
| `adr-2026-09-06-reopened-task-resolution.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-09-07-durable-prd-widening-decision-reconciliation.md` | Narrowed out | Subject outside this change: ADR: Durable PRD widening decision reconciliation |
| `adr-2026-09-10-portable-build-review-policy.md` | Narrowed out | Subject outside this change: ADR: Portable build review policy with candidate-bound evidence and one repair authority |
| `adr-2026-09-10-separate-custom-review-coverage-identity.md` | Narrowed out | Subject outside this change: ADR: Separate custom review risk identity from reduced-coverage identity |
| `adr-2026-09-10-shared-step-lifecycle-telemetry.md` | Narrowed out | Subject outside this change: ADR: Shared lifecycle instrumentation for sequential and parallel telemetry |
| `adr-2026-09-11-finish-mergeability-respects-active-review-inputs.md` | Narrowed out | Subject outside this change: ADR: Finish mergeability must respect active review inputs |
| `adr-2026-09-11-github-operation-ownership.md` | Narrowed out | Subject outside this change: ADR: Shared ownership authorization for GitHub and remote Git operations |
| `adr-2026-09-11-immutable-state-lease-recovery-succession.md` | Narrowed out | Subject outside this change: ADR: Immutable, owner-bound state-lease recovery succession |
| `adr-2026-09-11-selective-post-rebase-verification.md` | Narrowed out | Subject outside this change: ADR: Selective verification after a completed rebase |
| `adr-2026-09-20-halt-resolution-queue-derived-from-markers.md` | Narrowed out | Subject outside this change: ADR: The halt resolution queue is derived from halt markers; only operator deferrals persist |
| `adr-2026-09-20-operator-launched-sessions-retain-conductor-authority.md` | Narrowed out | Subject outside this change: ADR: Operator-launched provider sessions retain conductor authority |
| `adr-2026-09-23-engine-git-guard-on-agent-path.md` | Narrowed out | Subject outside this change: ADR: Engine-owned git argv guard on every agent PATH |
| `adr-2026-09-23-one-owner-for-accepted-story-readability.md` | Narrowed out | Subject outside this change: ADR: One owner for accepted-story readability, and one bullet primitive beneath it |
| `adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability.md` | Narrowed out | Subject outside this change: ADR: Provider admission is one gate over a daemon-scoped availability store |
| `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery.md` | Narrowed out | Subject outside this change: ADR: One built-in provider catalog, boot-time provider discovery, and Pi as a third built-in |
| `adr-2026-09-24-project-owned-pr-body-regions.md` | Narrowed out | Subject outside this change: ADR: Project-owned pull request body regions are declared in the pull request template |
| `adr-2026-09-28-skills-may-bundle-executable-helpers.md` | Narrowed out | Subject outside this change: ADR: Shipped skills may bundle executable helpers |
| `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history.md` | Narrowed out | Subject outside this change: ADR: Automatic rebase flattens merge-bearing feature history along the first parent |
| `adr-2026-09-29-plan-slice-manifest.md` | Narrowed out | Subject outside this change: ADR: Plans declare ordered slices in one engine-validated manifest |
| `adr-2026-10-01-daemon-session-command-contracts.md` | Narrowed out | Subject outside this change: ADR: Daemon session command contracts and bounded mutation observation |
| `adr-2026-10-03-fail-closed-git-option-normalization.md` | Narrowed out | Subject outside this change: ADR: One git option spec, normalized fail-closed by both destructive-git guards |
| `adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework.md` | Narrowed out | Subject outside this change: ADR: Over-scope refusal routes to bounded BUILD rework |
| `adr-2026-10-03-per-feature-step-applicability.md` | Narrowed out | Subject outside this change: ADR: Per-feature step applicability is a merged base-tree marker honored at daemon dispatch |
| `adr-2026-10-03-stacked-child-plans-identity-and-state.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-10-04-resume-completes-interrupted-rebase-operation.md` | Narrowed out | Subject outside this change: ADR: Resume completes an interrupted rebase operation and narrows the resume-time fence |
| `adr-2026-10-06-catalog-owned-interactive-model-and-effort.md` | Narrowed out | Subject outside this change: ADR: The provider catalog owns interactive model and effort selection |
| `adr-2026-10-07-conductor-decomposition-target-architecture.md` | Narrowed out | Subject outside this change: ADR: Conductor decomposition — target architecture and ordered roadmap |
| `adr-2026-10-07-per-child-build-region.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-10-07-provider-cost-includes-failed-attempts.md` | Narrowed out | Subject outside this change: ADR: Failed provider attempts feed the existing cost telemetry |
| `adr-2026-10-07-prune-base-inherited-deletions-from-the-seal.md` | Narrowed out | Subject outside this change: ADR: prune base-inherited deletions from the protected-artifact seal |
| `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility.md` | Narrowed out | Subject outside this change: ADR: Sliced plans bind each story to one child and are re-checked for stack eligibility at build entry |
| `adr-2026-10-09-dependency-drift-sweep-on-intake-tick.md` | Narrowed out | Subject outside this change: ADR: Dependency drift is a read-only sweep on the intake tick's reconcile hook, time-bounded, published as one spine event |
| `adr-2026-10-09-dependency-reconciler-and-edge-write-ownership.md` | Narrowed out | Subject outside this change: ADR: One dependency reconciler; prose edges written by the intake Action; land owns an operator-decided proposal gate |
| `adr-2026-10-09-shipped-pr-readiness-verdict.md` | Narrowed out | Subject outside this change: ADR: Shipped-PR readiness verdict — one closed verdict per watched PR, one route per verdict |
| `adr-2026-10-10-adr-assumption-ledger-contract.md` | Narrowed out | Subject outside this change: ADR: ADR Assumption Ledger Contract |
| `adr-2026-10-10-backend-neutral-ordering-source.md` | Narrowed out | Subject outside this change: ADR: Backend-neutral ordering source for backlog priority, size, and dependency reads |
| `adr-2026-10-10-retain-self-host-provider-transcripts.md` | Narrowed out | Subject outside this change: ADR: Self-host provider transcripts are harvested at home retirement and retained by step verdict |
| `adr-2026-10-10-source-grounded-adversarial-plan-review-step.md` | Narrowed out | Subject outside this change: ADR: Source-grounded adversarial plan review as a bounded DECIDE step |
| `adr-2026-10-10-stacked-restack-journaled-replay.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-10-10-watch-registry-grace-state-is-durable-state.md` | Narrowed out | Subject outside this change: ADR: Shipped-readiness grace bookkeeping is durable watch-registry state (event-spine exception C) |
| `adr-2026-10-12-enforced-source-layer-directions.md` | Narrowed out | Subject outside this change: ADR: Roadmap slice 3 empties the layer ratchet's upward edges and extends it to type-only edges |
| `adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry.md` | Narrowed out | Subject outside this change: ADR: Retire pipeline closeout-obligation telemetry with the batch evaluator |
| `adr-2026-10-12-routed-whole-feature-repair.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-10-14-ac-prefixed-skill-names.md` | Narrowed out | Subject outside this change: ADR: Harness skills install and dispatch under `ac-` prefixed names |
| `adr-2026-10-14-commander-program-is-the-cli-catalog.md` | Narrowed out | Subject outside this change: ADR: The commander program is the CLI catalog for pre-dispatched commands |
| `adr-2026-10-14-dispatch-first-daemon-maintenance.md` | Narrowed out | Subject outside this change: ADR: Dispatch-first daemon maintenance with pooled repairs |
| `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts.md` | Narrowed out | Subject outside this change: ADR: Operator CLI Prunes Shipped Features' DECIDE Artifacts |
| `adr-2026-10-15-per-dispatch-engine-pinned-executor.md` | Narrowed out | Subject outside this change: ADR: Per-dispatch engine-pinned child executor |
| `adr-2026-10-17-stacked-feature-publication-as-native-stack.md` | Narrowed out | Subject outside this change: ADR: A stacked feature publishes as a GitHub native stack whose leaf alone ships the feature |
| `adr-2026-10-19-build-review-finding-severity-advisory-threshold.md` | Narrowed out | Subject outside this change: ADR: build_review findings carry a severity and a per-rubric threshold makes minor findings advisory |
| `adr-2026-10-20-operator-acceptance-is-durable-case-state.md` | Narrowed out | Subject outside this change: ADR: Operator acceptance is durable remediation case state, carried by one reconciler lane |
| `adr-2026-10-21-remediation-closure-judgement.md` | Narrowed out | Subject outside this change: ADR: Completed remediation tasks are judged against their named change before BUILD hands off |
| `adr-2026-10-23-slice-topology-from-sealed-plan.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-10-24-finish-surfaces-guarded-publish-failures.md` | Narrowed out | Subject outside this change: ADR: FINISH surfaces a failed guarded PR publish instead of reading it as unchanged prose |
| `adr-2026-10-24-lap-monotonic-build-review-scope.md` | Narrowed out | Subject outside this change: ADR: Later build_review laps judge only the unsettled delta, enforced by the engine |
| `adr-2026-10-24-operator-route-round-for-closed-stacked-children.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-10-24-per-feature-artifact-manifest.md` | Narrowed out | Subject outside this change: ADR: A committed per-feature artifact manifest is the authority on where a feature's artifacts live |
| `adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability.md` | Narrowed out | Subject outside this change: ADR: System-prompt delivery is a declared provider capability |
| `adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog.md` | Narrowed out | Subject outside this change: ADR: Codex model policy ids are per-tier floors upgraded from the CLI catalog |
| `adr-2026-10-25-operator-recorded-restack-conflict-resolution.md` | Narrowed out | Subject outside this change: ADR: An operator-recorded resolution settles a stacked repair restack conflict above the repaired child |
| `adr-2026-10-28-as-built-finding-reconciliation.md` | Narrowed out | Subject outside this change: ADR: As-built findings are reconciled against prior as-built cases in the gap plan |
| `adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest.md` | Narrowed out | Subject outside this change: ADR: Path policy reads feature ownership from the artifact manifest |
| `adr-2026-10-28-pi-auth-and-rate-limit-signatures-are-anchored-to-captured-output.md` | Narrowed out | Subject outside this change: ADR: Pi auth and rate-limit signatures are anchored to captured output, and a Pi auth failure parks on Pi's own credentials |
| `adr-2026-10-28-shared-credential-reference-resolver.md` | Narrowed out | Subject outside this change: ADR: Shared credential-reference resolver with pluggable dynamic sources |
| `adr-2026-10-31-engine-performs-finish-pr-prose-write.md` | Narrowed out | Subject outside this change: ADR: The engine performs FINISH's PR-prose write; the provider only returns prose |
| `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts.md` | Narrowed out | Subject outside this change: ADR: An operator decision answers a stacked restack conflict, for feature-repair and base-refresh |
| `adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref.md` | Narrowed out | Subject outside this change: ADR: Stacked restack recovery keeps every commit, and a stacked feature's halt record lives on a ref |
| `adr-2026-11-07-child-projected-dispatch-otel.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
| `adr-2026-11-07-composer-run-checkpoint-resume-handoff.md` | Narrowed out | Subject outside this change: ADR: Composer runs checkpoint to the spec branch and resume anywhere |
| `adr-2026-11-07-daemon-step-boundary-preemption.md` | Narrowed out | Subject outside this change: ADR: Daemon preempts lower-priority work at step boundaries |
| `adr-2026-11-07-decision-corpus-query-and-known-record-shapes.md` | Narrowed out | Subject outside this change: ADR: Decision-corpus query and known record shapes |
| `adr-2026-11-07-external-boundary-ports-registry-and-ratchet.md` | Narrowed out | Subject outside this change: ADR: External boundaries are ports wired at composition roots, enumerated in one registry and held by a shrink-only ratchet |
| `adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary.md` | Narrowed out | Subject outside this change: ADR: A retryable HALT is cleared, and the progress baseline is stamped, at the daemon dispatch boundary |
| `adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish.md` | Examined | Relevant passage assessed in interaction analysis; telemetry or budget-only clauses retain their separate ownership. |
