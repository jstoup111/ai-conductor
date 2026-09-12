# Conflict Check: Recover stale conduct-state lease recovery claims

**Date:** 2026-09-11
**ADR corpus:** repo_wide, explicitly configured in `.ai-conductor/config.yml`.
**Verdict:** PASS — zero blocking conflicts, zero degrading conflicts, zero resolutions.
**Stories:** `.docs/stories/recover-stale-conduct-state-lease-recovery-claims.md` (operator accepted).

## Inventory and comparison method

Scanned the text of all 485 story files, 54 specs, 261 previous conflict reports, and 578 decision/review files. Filtered candidates by shared state/ledger mutation, lease ownership, crash recovery, diagnostics, and concurrency; Git force-with-lease, daemon scheduling locks, intake-session claims, and provider-home ownership are different resources. This is a full-corpus candidate scan followed by semantic comparison of overlapping contracts, not a claim that every unrelated historical story pair was manually compared.

Reviewed all ten pairs among new Stories 1–5 in both directions, and compared each applicable selected ADR clause against the relevant new stories. For each relevant pair, considered contradiction, behavioral overlap, state conflict, resource contention, sequencing, and oscillation. No story changes or ADR supersessions were needed.

## New-story pair analysis

| Pair | Two-directional compatibility basis |
| --- | --- |
| 1 / 2 | Recovery requires valid metadata and provable death; refusal applies when either proof is absent. Neither promises recovery from malformed records. |
| 1 / 3 | Successful recovery is serialized, not simultaneous; the second caller may acquire only after the first releases within its budget. |
| 1 / 4 | Success is conditional on remaining time; repeated interrupted attempts cannot restart the deadline. |
| 1 / 5 | The store enters its mutation only after acquiring ownership and releases afterward; recovery does not bypass store evaluation. |
| 2 / 3 | Ambiguous legacy claims retain conservative protection; explicitly foreign-generation valid claims are a separate, proven-identity case. |
| 2 / 4 | Invalid authority and probe errors refuse; live contention waits until timeout. Error classification does not turn uncertainty into ownership. |
| 2 / 5 | Refused recovery prevents persistence; proof of dead ownership enables normal store semantics, not an unguarded write. |
| 3 / 4 | Both wait and race retries share a budget. A winner may hold its claim while a loser times out; no story requires stealing from the live winner. |
| 3 / 5 | Single ownership prevents overlapping protected writes, while separate field mutations retain their normal expected-value semantics. |
| 4 / 5 | Failure returns before persistence; bounded recovery does not imply a timeout may abort an already-committed store mutation. |

## Existing-story comparisons

- `conduct-state-json-lost-update-conductor-s-whole-o` TS-1–TS-5: disjoint fields survive, writes are serialized, corrupt/ambiguous ownership refuses, independent paths stay isolated, and every writer uses the mutation port. New Story 5 is the changed recovery case of that same contract; it neither reopens whole-state replacement nor changes field precedence.
- `harden-intake-ledger-durability` Stories 6–9: retain bounded cross-process locking for reads and writes, caller-specific diagnostic identity, and the configured ledger path. Story 8's diagnostic preservation is scoped to retaining store identity during generalization; ordinary live-owner and label behavior remains unchanged. The new stories correct the distinct dead-owner/recovery-claim misdiagnosis rather than rename the store or weaken failure propagation.
- `retry-a-lease-whose-owner-vanished-before-its-meta` Stories 1–2 (#2172): missing initial owner metadata still waits and retries within budget; non-absence errors and corrupt owner metadata still refuse. New vanished-claim/generation scenarios do not convert initializing owner metadata into a busy loop.
- `reclaim-orphaned-full-suite-lock-recovery-claims` Stories 1–2 (#2171): no contradiction because that story explicitly excludes the conduct-state lease and this feature excludes the full-suite lock. Its aged-malformed-claim policy does not transfer to this resource.
- Intake-session claim/requeue stories describe long-lived workflow ownership and time-window requeue policy, not the short-lived mutex used to protect the ledger file. The new protocol grants no authority to requeue an issue or change assignments.
- Git force-with-lease, daemon drain-before-release, provider scratch ownership, and multi-operator session ownership were screened as distinct resources; this plan changes no corresponding ownership or lifecycle behavior.

## Selected ADR comparisons

- `adr-2026-09-11-immutable-state-lease-recovery-succession` — D1–D6 govern all five new stories: exclusive succession, generation binding, legacy compatibility, winner authority, refusal/budget, release/diagnostics.
- `adr-2026-08-01-conduct-state-mutation-port` — The single-host adapter serializes writers, preserves fields, and refuses uncertain ownership; Stories 1–5 preserve these properties.
- `adr-2026-08-12-fail-closed-intake-ledger-durability` — D5/D6 require the same lease for reads and writes beside the configured ledger. The implementation remains path-generic; no lease bypass or ledger relocation is introduced.
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` — D2 uses authorized mutations through the same port. Repairing dead claims enables that existing authority without granting permission to rewind or clear halts.
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` — D2/D4 retain typed budget authority and the shared bounded lease. Recovery of the mutex does not grant a budget adjustment or daemon resume authorization.
- `adr-2026-08-29-operator-authorized-kickback-budget-recovery` — Retained despite its superseded header: successor D4 explicitly carries forward D1–D8 except halt-class wording. The bounded shared lease and live/ambiguous-owner refusal remain binding and compatible.
- `adr-2026-09-07-durable-prd-widening-decision-reconciliation` — D2/D8 use the existing remediation store lease and atomic mutation. New recovery leaves decision attribution, store schema, snapshot freshness, and provider-call boundaries unchanged.

## Supersession handling

Do not discard `adr-2026-08-29-operator-authorized-kickback-budget-recovery` based on its header: its successor explicitly retains most decisions. No overlapping ADR was excluded as fully superseded. Other ADRs below are narrowed out for non-overlapping subject, not because a partial/ambiguous supersession was treated as complete.

## Prior report context

The earlier conduct-state mutation-port report establishes compatible field semantics and lease failure behavior. The intake-ledger durability report records accepted bounded read/write contention and once-per-corruption-episode ledger warnings. New recovery does not change ledger-corruption quarantine, warning frequency, or read locking, so those resolutions remain intact. Full-suite aggregate verification policies concern a different lock and remain outside this change.

## Grounding and verdict

Compatibility conclusions: 95% confidence, inferred from direct comparison of the cited accepted stories and approved ADR clauses. Source wiring was verified during architecture review; runtime race correctness is not claimed by this prose check. No unconfirmed load-bearing requirement is used.

Verify-claims: CLEAR. There are no resolutions to approve and no review-required conflict marker is emitted; the conflict-check skill's clean-pass route permits planning.

## ADR corpus inventory: narrowed-out subjects

The following ADR paths were included in the repository-wide inventory and narrowed out because they govern other behavior/resources. The compared set is listed above; architecture-review reports are not ADRs and are not silently counted as selected decisions.

- `adr-002-engineer-store-and-retro-redirect` — ADR 002: Engineer store format + retro-redirect mechanism
- `adr-003-registry-write-and-integration` — ADR 003: Registry write mechanism + bootstrap integration
- `adr-005-non-autonomy-and-read-only-governor` — ADR 005: Non-autonomy by construction + read-only governor
- `adr-006-flywheel-lesson-selection-and-provenance` — ADR 006: Flywheel — lesson selection + engineer-planned provenance
- `adr-008-agent-hosted-loop-and-in-chat-authoring` — ADR 008: Agent-hosted engineer loop + in-chat human-gated authoring (cross-repo isolation without a subprocess)
- `adr-009-intake-adapter-port` — ADR 009: Intake adapter port (hexagonal) + Envelope contract
- `adr-010-pidfile-lock-daemon-liveness` — ADR 010: Pidfile-lock daemon liveness, 1-per-repo mutex & ensure-running
- `adr-011-async-intake-queue-and-github-source` — ADR-011: Async Intake Queue + GitHub-Issues Source
- `adr-012-durable-intake-ledger-sole-dedup-authority` — ADR-012: Durable Intake Ledger as Sole Dedup Authority
- `adr-014-otel-observability-exporter` — ADR 014: OpenTelemetry Observability Exporter
- `adr-015-daemon-pr-labeling-sweep` — ADR 015: Daemon PR labeling — shared gh seam, tracked mergeable watch registry, best-effort sweep
- `adr-2026-06-29-architecture-before-stories-convergent-kickback` — ADR: Architecture before stories; convergent root-routed kickbacks
- `adr-2026-06-29-brainstorm-rename-migration` — ADR: Migration for `brainstorm → {explore, prd}`
- `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` — ADR: Daemon supervisor port + attachable foreground hosting
- `adr-2026-06-29-explore-prd-split-track-in-explore` — ADR: Split `brainstorm` into `explore` + `prd`; track decided in `explore`
- `adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration` — ADR: Memory Provider Plugin Kind & Agent-Queried Integration
- `adr-2026-06-29-memory-resilience-write-fallback-and-reconcile` — ADR: Memory Resilience — Best-Effort, Write-Fallback & Reconcile-on-Reconnect
- `adr-2026-06-29-per-project-memory-provider-selection` — ADR: Per-Project Memory Provider Selection
- `adr-2026-06-29-per-provider-retrieval-guidance-location` — ADR: Per-Provider Retrieval Guidance Location
- `adr-2026-06-29-platform-adoption-and-removal-surface` — ADR: Platform Adoption & Removal Surface
- `adr-2026-06-29-rebase-conflict-resolution-dispatch` — ADR: Gated rebase-conflict resolution dispatch (amends ADR-001)
- `adr-2026-06-29-safe-reversible-memory-migration` — ADR: Safe, Reversible Migration of Existing Memory
- `adr-2026-06-29-shared-memory-store-placement-and-durability` — ADR: Shared Memory Store Placement & Cross-Worktree Durability
- `adr-2026-06-29-track-marker-location` — ADR: Track marker is a dedicated `.docs/track/<slug>.md`
- `adr-2026-06-30-background-intake-brain-loop` — ADR: Background intake runs on a single brain/supervisor loop; ledger stays single-writer
- `adr-2026-06-30-engineer-worktree-authoring-isolation` — ADR 2026-06-30: Engineer authors in a per-idea worktree (ADR-008 escalation, for same-repo concurrency)
- `adr-2026-06-30-grandfather-cutover-merge-time` — ADR: Deriving a Spec's Merge Time for the Grandfather Cutover
- `adr-2026-06-30-halt-based-release-gates` — ADR: All self-host release gates are HALT-based and fail-closed
- `adr-2026-06-30-origin-seeded-intake-routing` — ADR: Origin-seeded routing for GitHub-intake ideas (human gate preserved)
- `adr-2026-06-30-owner-gate-identity-resolution` — ADR: Owner-Gate Identity Resolution and Fail-Open Posture
- `adr-2026-06-30-owner-provenance-recording` — ADR: Owner Provenance — How a Spec Records and Proves Its Owner
- `adr-2026-06-30-sandbox-build-isolation` — ADR: Sandbox harness self-builds via a throwaway CLAUDE_CONFIG_DIR
- `adr-2026-06-30-self-host-detection-seam` — ADR: Single swappable self-host detection seam
- `adr-2026-07-01-machine-scoped-operator-identity` — ADR 2026-07-01: Machine-scoped operator identity + fail-closed ownership gating
- `adr-2026-07-03-daemon-auto-restart-stale-engine` — ADR: Daemon auto-restart on stale engine code — exit-to-respawn at the idle boundary
- `adr-2026-07-03-dependency-fail-closed-and-cache` — ADR: Fail-closed indeterminate semantics and per-scan blocker cache
- `adr-2026-07-03-dependency-gate-backlog-waiting-channel` — ADR: DependencyGate placement and the backlog waiting-items channel
- `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land` — ADR: Engineer checkpoint commits + idempotent `land`
- `adr-2026-07-03-gated-snapshot-status-read-model` — ADR: Per-pass atomic gated snapshot as the status CLI's read model
- `adr-2026-07-03-gated-writeback-announcements` — ADR: Gated-spec announcements via the pr-labels seam, warn-once per state change
- `adr-2026-07-03-generated-model-table-single-source` — ADR: Generated HARNESS.md model table — typed engine metadata as single source
- `adr-2026-07-03-halt-pr-rehabilitation-at-finish` — ADR: Halt-PR Rehabilitation at Finish (skill presentation, engine mechanics, gate enforcement)
- `adr-2026-07-03-harness-daemon-profile` — ADR: Harness daemon profile — build-to-PR on the harness repo, human merge
- `adr-2026-07-03-issue-dependencies-api-surface` — ADR: GitHub Issue-Dependencies REST API as the dependency source of truth
- `adr-2026-07-03-owner-gate-gated-channel` — ADR: Owner-gate skips ride the discovery-result gated channel
- `adr-2026-07-03-post-rebase-force-with-lease` — ADR: Post-rebase refresh is the only force-push, and only `--force-with-lease`
- `adr-2026-07-03-pr-timing-config-key` — ADR: `pr_timing` config key — one setting, two publish flows
- `adr-2026-07-03-pr-timing-self-host-precedence` — ADR: Self-host builds ignore `early-draft` (guardrail precedence)
- `adr-2026-07-03-priority-fetch-fail-soft` — ADR: Priority-fetch failure degrades to pure date order with an in-memory once-per-outage warning
- `adr-2026-07-03-priority-from-linked-issue-labels` — ADR: Backlog priority resolved from linked-issue labels via a post-discovery ordering seam
- `adr-2026-07-03-prose-to-link-migration` — ADR: One-time prose→link migration — parse patterns and idempotency
- `adr-2026-07-03-reactive-model-fallback-ladder` — ADR: Reactive model fallback ladder in the invocation seam
- `adr-2026-07-03-version-gate-semver-escalation` — ADR: Version-gate semver escalation — PATCH auto-pass, MINOR/MAJOR HALT
- `adr-2026-07-04-auth-failure-park-and-poll` — ADR: Auth failures park-and-poll on operator credentials — never retry, never escalate
- `adr-2026-07-04-autoresolve-state-and-config` — ADR: Auto-Resolve State on the Watch Entry; Fail-Closed Suite Config
- `adr-2026-07-04-claim-time-delivery-evidence-guard` — ADR: Claim-Time Delivery-Evidence Guard (intake re-dispatch protection)
- `adr-2026-07-04-durable-pause-marker` — ADR: Durable repo-scoped pause marker at the dispatch boundary
- `adr-2026-07-04-event-driven-halt-clear-wake` — ADR 2026-07-04: Event-Driven HALT-Clear Wake with Poll Backstop
- `adr-2026-07-04-kickback-event-emission-and-log-prominence` — ADR: Kickback event emission completeness + log-line prominence
- `adr-2026-07-04-operator-park-marker` — ADR: Operator park state — repo-root `.daemon/parked/<slug>` marker, checked before every autonomous decision
- `adr-2026-07-04-park-unpark-cli-verbs` — ADR: `daemon park <slug>` / `daemon unpark <slug>` — filesystem-direct CLI verbs, no live daemon required
- `adr-2026-07-04-pending-restart-queue` — ADR: Pending-restart queues durably and fires at the idle boundary
- `adr-2026-07-04-resolution-worktree-lifecycle` — ADR: Dedicated Transient Worktree for Open-PR Conflict Resolution
- `adr-2026-07-04-respawn-in-place-restart` — ADR: Restart-in-place via pane respawn inside the existing tmux session
- `adr-2026-07-04-versioned-engine-store-atomic-flip` — ADR: Versioned engine store with atomic current-pointer flip (closes #215)
- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep` — ADR: Widen the Rebase-Resolution Dispatch Exception to the Mergeable Sweep
- `adr-2026-07-05-daemon-rate-limit-episode-coordinator` — ADR: Daemon rate-limit episode is a coordinated in-process pause, not a per-feature failure
- `adr-2026-07-05-engine-owned-task-status` — ADR 2026-07-05: Engine-owned, git-derived task-status.json
- `adr-2026-07-05-halt-pr-presentation-reliability` — ADR 2026-07-05: Halt-PR presentation reliability — verify-after-write + reconciliation
- `adr-2026-07-05-retry-as-escalation-ladder` — ADR 2026-07-05: Retry-as-escalation ladder
- `adr-2026-07-05-standalone-bin-update` — ADR 2026-07-05 — Extract the self-update/channel flow to a standalone `bin/update`
- `adr-2026-07-06-daemon-false-ship-guard` — ADR: finish push-evidence gate and daemon ship guard (no false ships)
- `adr-2026-07-06-installed-root-resolution-for-global-writes` — ADR: Installed-root resolution for operator-global writes (worktree-install guard)
- `adr-2026-07-06-manual-test-fail-routing` — ADR: manual_test FAIL routing, fix-evidence gate, and gating enforcement
- `adr-2026-07-06-migration-gate-waiver` — ADR: TR-10 migration gate accepts a committed no-breaking-surface waiver
- `adr-2026-07-06-stale-engine-respawn-in-place` — ADR: Stale-engine restart rides the respawn-in-place transport; relink precedes every handoff
- `adr-2026-07-07-audit-trail-event-sink` — ADR: Audit-trail event-sink writer for retro friction records
- `adr-2026-07-07-daemon-owned-build-credential` — ADR: Daemon-owned build credential behind a BuildAuthProvider seam
- `adr-2026-07-07-finish-record-primitive` — ADR: `conduct-ts finish-record` — deterministic finish-completion marker primitive
- `adr-2026-07-07-ship-ci-feedback-loop` — ADR: Ship→CI feedback loop — sweep-native bounded remediation of red shipped PRs
- `adr-2026-07-07-single-generation-stale-respawn` — ADR: Stale-engine respawn is single-generation — predecessor exits unconditionally on a fired trigger; lock-losers terminate
- `adr-2026-07-07-task-trailer-id-alias` — ADR: Task-Trailer Id Alias (`task-<id>` ≡ `<id>`) in Evidence Derivation
- `adr-2026-07-08-halt-issue-closure-sweep` — ADR: Deterministic halt-issue closure sweep (ledger + Halt-Slug stamp + close-on-ship)
- `adr-2026-07-08-main-checkout-leak-triage-and-write-fence` — ADR: Main-checkout leak triage with byte-identity-gated auto-heal, plus a sandbox write-fence
- `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify` — ADR: Post-rebase gate-first mechanical re-verify (build only)
- `adr-2026-07-09-deterministic-evidence-attribution-enforcement` — ADR: Deterministic evidence attribution — engine-owned task transitions + worktree-local git hooks
- `adr-2026-07-09-setup-failure-triage` — ADR: Deterministic setup-failure triage (quarantine + bounded fix-session)
- `adr-2026-07-10-concurrent-group-core` — ADR: Concurrent group core — one capped, engine-integrated parallel executor
- `adr-2026-07-10-daemon-stall-remediation` — ADR: Route daemon build stalls (halt-user-input-required) through /remediate before halting
- `adr-2026-07-10-evidence-range-anchor-resolution` — ADR: Single-sourced evidence-range anchor resolution (branch base, never genesis)
- `adr-2026-07-10-inline-work-attribution-enforcement` — ADR: Inline build work attribution enforcement — fail-closed commit gate, dispatch-shaped execution, zero-work kickback
- `adr-2026-07-10-intake-claim-priority-banding` — ADR: Intake claim orders candidates by priority band above receivedAt FIFO, resolved at claim time, fail-open
- `adr-2026-07-10-intra-step-build-progress-events` — ADR: Intra-step build progress + stall as first-class ConductorEvents
- `adr-2026-07-10-observed-close-watch-registry` — ADR: Observed-close — watch registry + idle-tick sweep replaces close-on-merge for watched fixes
- `adr-2026-07-10-park-marker-main-root-resolution` — ADR: Park markers anchor to the MAIN repository root, resolved inside park-marker.ts
- `adr-2026-07-10-retire-migration-grandfather` — ADR: Retire the H8 migration-grandfather path — evidence stamps are the only completion currency
- `adr-2026-07-10-session-hook-task-stamping` — ADR: Session-hook task stamping at subagent dispatch
- `adr-2026-07-10-validation-group-join` — ADR: SHIP validation group — membership, join policy, and consolidated remediation
- `adr-2026-07-11-attribution-abstain-or-loud` — ADR: Attribution machinery is abstain-or-loud — a stale stamp is never left, an id is never guessed, an invalid id never passes
- `adr-2026-07-11-attribution-spot-audit-measurement` — ADR: Spot-audit measurement of fast-lane attribution accuracy
- `adr-2026-07-11-attribution-verdict-interface` — ADR: Attribution verdict interface and evidence-stamp schema evolution
- `adr-2026-07-11-evidence-judge-cli-and-cutover` — ADR: `conduct-ts evidence judge` CLI entry, cutover flag, and model-table entry
- `adr-2026-07-11-finish-step-engine-completion-machinery` — ADR: Finish-step completion becomes engine machinery (in-step presentation repair, hardened gate, surgical retry)
- `adr-2026-07-11-pipeline-state-durability` — ADR: `.pipeline` run-state durability — defense-in-depth, fail-loud-not-crash
- `adr-2026-07-11-semantic-attribution-verification-lane` — ADR: Semantic attribution verification lane at the build evidence gate
- `adr-2026-07-11-verdict-aware-resume-entry` — ADR: Verdict-Aware Resume Entry (Backward-Only Clamp)
- `adr-2026-07-12-judged-attribution-verdict-persistence` — ADR: Judged attribution verdicts must flip the current build's completion gate
- `adr-2026-07-12-progress-aware-build-halt` — ADR: Progress-aware build halt/park + progress-gated cross-dispatch re-kick (#280)
- `adr-2026-07-12-rebase-evidence-stamp-translation` — ADR: Engine translates sha-anchored evidence citations through its own rebases
- `adr-2026-07-12-wired-into-contract` — ADR: Wired-into contract — architecture decides, plan carries, Small tier falls back
- `adr-2026-07-12-wiring-check-gate` — ADR: wiring_check gate — deterministic reachability verification with layered probe
- `adr-2026-07-13-kickback-build-no-op-escalation` — ADR 2026-07-13: Kickback→build no-op guard + zero-progress/unchanged-verdict escalation
- `adr-2026-07-13-park-all-dispatch-paths` — ADR 2026-07-13: Operator park blocks every dispatch entry point (immediate-before-dispatch predicate)
- `adr-2026-07-13-retry-classify-rerun-vs-route` — ADR 2026-07-13: Classify step-failures rerun-vs-route before burning a retry (#646)
- `adr-2026-07-13-session-fresh-verdict-artifacts` — ADR 2026-07-13: Step completion checks require a session-fresh verdict artifact (per-attempt floor)
- `adr-2026-07-17-verify-only-judged-closure` — ADR: Class-scoped judged closure for verify-only (prove-closed) plan tasks
- `adr-2026-07-20-bounded-dirname-path-corroboration` — ADR: Bounded dirname/subsystem pass in autoheal path-corroboration
- `adr-2026-07-20-ci-fix-dispatch-via-steprunner` — ADR: Dispatch ci-fix via DefaultStepRunner, not a bespoke claude spawn
- `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification` — ADR: Fail-loud-once startup preflight + resolver error classification
- `adr-2026-07-20-post-rebase-delta-aware-invalidation` — ADR: Delta-aware post-rebase gate invalidation
- `adr-2026-07-21-completeness-as-build-review-rubric` — ADR: Plan-completeness judgement as a default-on build_review rubric item
- `adr-2026-07-21-decide-time-unmerged-overlap-scan` — ADR: DECIDE-time unmerged-overlap scan is a deterministic primitive, dual-hooked and advisory
- `adr-2026-07-21-demote-task-stamping-to-telemetry` — ADR: Demote per-task evidence stamping from a completion gate to telemetry
- `adr-2026-07-21-engine-owned-acceptance-red-execution` — ADR: Engine-owned RED execution for acceptance_specs, driven by a skill-recorded run contract
- `adr-2026-07-21-intake-only-enforcement` — ADR: Enforce intake criteria at capture/file time only — never downstream
- `adr-2026-07-21-no-diff-task-evidence-stamp` — ADR: A no-diff task earns completion currency deterministically — stamp Evidence: skipped, recognize Type: verification
- `adr-2026-07-21-owner-stamped-at-authoring` — ADR: Stamp Owner at authoring time; default-and-loudly-log an un-owned arrival — never silently skip
- `adr-2026-07-21-s-tier-pipeline-knobs` — ADR: Small features are cheap through the existing pipeline's own knobs — no separate SDLC flow (#668)
- `adr-2026-07-21-serena-removal-path` — ADR: Serena removal path — stop shipping it, migrate existing deployments via an approval-gated unregister, keep the repo-local ignore line
- `adr-2026-07-22-attempts-counter-on-crash-recovery` — ADR: `attempts` counter increments on stale-claim recovery
- `adr-2026-07-22-auth-failure-classification-observed-401-patterns` — ADR: Auth-failure classification — observed 401 patterns in text mode, structured status in the probe
- `adr-2026-07-22-build-dispatch-json-usage-capture` — ADR 2026-07-22-a — Capture build-session usage via `--output-format json`
- `adr-2026-07-22-canonical-tagged-source-ref` — ADR: Canonical tagged source-ref module (GitHub refs + Jira keys)
- `adr-2026-07-22-canonical-tracker-client-seam` — ADR: Canonical tracker-client seam with per-backend transport contract
- `adr-2026-07-22-coherence-gate-placement-and-validation-split` — ADR: Coherence gate — authoring step after /plan, deterministic validation at land
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim` — ADR: Coherence waiver format and duplicate-intake-claim lookback scope
- `adr-2026-07-22-daemon-level-missing-credential-gate` — ADR: Daemon-level missing-credential gate — one waiting condition, per-feature preflight retained as backstop
- `adr-2026-07-22-examples-state-isolation` — ADR: Examples isolate all shared state via env overrides + a throwaway root
- `adr-2026-07-22-gate-evidence-code-validity-on-redispatch` — ADR: Judged-gate evidence is preserved on re-dispatch by code-state validity, not timestamp freshness
- `adr-2026-07-22-headless-vs-guided-examples` — ADR: Two example modes — headless self-asserting vs guided launcher
- `adr-2026-07-22-heartbeat-lease-deferred` — ADR: Defer a claim heartbeat/lease; accept a bounded duplicate-processing window now
- `adr-2026-07-22-intake-closed-issue-reconciliation` — ADR: Reconcile closed GitHub issues out of the intake ledger at two control points
- `adr-2026-07-22-origin-refresh-before-engine-rebuild` — ADR: Fast-forward origin refresh before the quiescent engine rebuild, loud staleness fallback
- `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` — ADR 2026-07-22-b — Per-feature cost rollup lives in the committed shipped-record
- `adr-2026-07-22-per-task-work-happened-floor` — ADR 2026-07-22 — Per-task "work happened at all" floor under build_review
- `adr-2026-07-22-phase-scoped-docs-write-guard` — ADR: Phase-scoped .docs write-guard — separate marker, engine-resolved allowlist, dumb hook
- `adr-2026-07-22-requeue-claimed-distinct-from-reopen` — ADR: A dedicated `claimed → pending` recovery transition, distinct from `reopen`
- `adr-2026-07-22-stale-claim-staleness-window-default` — ADR: Staleness window default for automatic stale-claim recovery
- `adr-2026-07-22-token-liveness-probe-via-cli-invocation` — ADR: Token liveness verification via minimal CLI invocation (not raw API probe)
- `adr-2026-07-23-build-review-fresh-base-disposition` — ADR: build_review grades against a verified-fresh base; scope FAILs get a bounded deterministic disposition
- `adr-2026-07-23-commit-movement-liveness-floor` — ADR: Commit-movement liveness floor under the build stall breaker; attributed-task count demoted to advisory
- `adr-2026-07-23-intake-label-authority-scoped-replace` — ADR: Intake label authority — explicit > existing > default, applied by namespace-scoped replace
- `adr-2026-07-23-session-hook-repair-before-halt` — ADR: Repair missing session hooks at the build preflight instead of removing the gate
- `adr-2026-07-23-trailer-union-build-step-routing` — ADR: Build-step exit routes on the trailer-union task resolution
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` — ADR: Provider-aware step execution with fresh step-scoped sessions
- `adr-2026-07-25-content-addressed-full-suite-proof` — ADR: Content-addressed full-suite proof at the BUILD-to-SHIP boundary
- `adr-2026-07-25-custom-step-completion-artifacts` — ADR: Custom steps may declare fresh completion artifacts
- `adr-2026-07-25-fail-closed-durable-shipment-evidence` — ADR: Fail-Closed Durable Shipment Evidence
- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` — ADR: First-class Codex skill and guidance adaptation
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` — ADR: Concurrent task telemetry and symmetric self-host isolation
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` — ADR: The kickback bound is durable across dispatches and keyed on the tree, not the commit
- `adr-2026-07-26-daemon-decide-preseed-ownership` — ADR: DECIDE-phase steps are preseeded by derivation, and vetted at discovery
- `adr-2026-07-26-event-sink-registry-exhaustiveness` — ADR 2026-07-26: Compile-time exhaustive event-sink registry
- `adr-2026-07-26-protected-artifact-seal-rebaseline` — ADR: rebaseline the protected-artifact seal on proven base inheritance
- `adr-2026-07-26-rebase-tail-current-branch-before-publication` — ADR: Rebase the current validated branch before publication
- `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` — ADR 2026-07-27-b — The `## Cost` block evolves by addition, and cost aggregates split from token aggregates
- `adr-2026-07-27-ancestry-proven-park-reconciliation` — ADR: Ancestry-proven parked-feature auto-reconciliation with config kill-switch
- `adr-2026-07-27-codex-never-resumes-a-harness-minted-session` — ADR: Codex never resumes — session resume becomes a declared provider capability
- `adr-2026-07-27-cold-start-within-step-retries` — ADR: Claude declares no resume — the harness never resumes any session
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state` — ADR 2026-07-27-a — Absent provider cost is a first-class `cost-unmetered` state, never zero
- `adr-2026-07-27-daemon-decide-kickback-halt` — ADR: One kickback-phase policy, consulted at both backward-navigation seams
- `adr-2026-07-27-project-config-scaffolder` — ADR: Deterministic project-config scaffolder (#683)
- `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` — ADR: Protected-artifact seal hands self-amendment to build_review instead of halting
- `adr-2026-07-28-feature-aware-artifact-resolution` — ADR: Feature-aware artifact contracts resolve step outputs for every generic consumer
- `adr-2026-07-28-total-halt-classification-legacy-boundary` — ADR: Require total HALT classification with an explicit legacy boundary
- `adr-2026-07-29-codex-readiness-probe-failure-disposition` — ADR: Codex readiness separates probe failure from credential failure
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` — ADR: Defer the feature-worktree reap until the shipped record is present on main
- `adr-2026-07-29-deterministic-build-verification-fanout` — ADR: Deterministic BUILD verification fan-out before model review
- `adr-2026-07-29-engine-observed-provider-time-partition` — ADR: Engine-observed provider intervals form an overlap-safe elapsed-time partition
- `adr-2026-07-29-operator-park-scheduling-unit-boundary` — ADR: Operator park drains one scheduling unit, then stops with a typed outcome
- `adr-2026-07-29-ship-start-draft-pr` — ADR: The implementation PR opens as a draft at SHIP-phase start
- `adr-2026-07-30-contract-aware-same-file-wiring` — ADR: Contract-aware same-file wiring requires symbol and root proof
- `adr-2026-07-30-finish-only-mergeability-gate` — ADR: Limit mergeability-first skipping to normal finish
- `adr-2026-07-30-pinned-remote-theme-for-pages-navigation` — ADR: Use a pinned remote theme for Pages navigation
- `adr-2026-07-30-provider-preparation-lifecycle-supervision` — ADR: Supervise provider preparation with fenced attempt identities
- `adr-2026-08-01-bot-owned-release-pr` — ADR: Use a bot-owned release PR as the sole pending-release writer
- `adr-2026-08-01-engine-owned-resumable-finish-publication` — ADR: Engine-owned resumable FINISH publication from observed state
- `adr-2026-08-01-engine-owned-scoped-test-invocation` — ADR: Engine-owned scoped test invocation
- `adr-2026-08-01-multi-proof-park-deletion-authority` — ADR: Parked-feature deletion rests on a set of equal-strength proofs, and every refusal names its cause
- `adr-2026-08-01-rebase-full-replay-intent-validation` — ADR: Require full-replay intent validation for judgment-based rebase resolution
- `adr-2026-08-01-scoped-run-verb-release-surface` — ADR: The scoped-run verb ships without a migration block or waiver
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` — ADR: Manual dispatch now, reusable fail-closed gate mode reserved for release
- `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` — ADR: The live tier asserts pipeline outcomes, not scripted agent output
- `adr-2026-08-02-plan-scope-containment-at-commit-boundary` — ADR: Plan-scope containment enforced at the commit boundary
- `adr-2026-08-03-build-repair-member-reuse-validity` — ADR: A BUILD repair re-dispatches every verification member; reuse lives in the member's own evidence
- `adr-2026-08-03-fail-closed-decide-entry` — ADR: One fail-closed DECIDE-entry policy, consulted at every navigation seam
- `adr-2026-08-03-ledgered-per-block-migration-execution` — ADR: Ledgered, per-block migration execution
- `adr-2026-08-03-uncommitted-work-floor-under-build-completion` — ADR: Uncommitted work is a build-completion floor, enforced at both doors to `status:done`
- `adr-2026-08-04-classify-before-spend-release-smoke-gate` — ADR: Classify before spend — the release smoke gate runs once per release, not once per merge
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` — ADR: DECIDE mutates accepted `.docs/` artifacts directly, and never emits a task that mutates one
- `adr-2026-08-04-live-tier-provisions-its-own-provider-home` — ADR: The live tier provisions its own provider home from the checkout under test
- `adr-2026-08-04-unresolved-step-command-fails-by-name` — ADR: An unresolved step command fails by name — before spend, and at the provider boundary
- `adr-2026-08-05-blocked-classification-after-dedup` — ADR: Blocked classification runs after dedup, and the gauntlet is reordered to allow it
- `adr-2026-08-05-blocked-is-a-distinct-state-from-halted` — ADR: `BLOCKED` is a distinct daemon state, not an extension of `HALTED`
- `adr-2026-08-05-build-settle-outcome-stamp` — ADR: Build settle outcome stamp and pre-dispatch no-op refusal
- `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` — ADR: Every non-done dispatch outcome leaves an operator-clearable lever
- `adr-2026-08-05-provenance-based-protected-artifact-inheritance` — ADR: A protected artifact this branch never touched is inherited, whatever revision it is
- `adr-2026-08-05-token-first-stories-reference-normalization` — ADR: Token-first normalization of the plan `**Stories:**` reference
- `adr-2026-08-05-worktree-classification-evidence-derived-reasons` — ADR: Worktree dashboard classification and reasons are evidence-derived, never asserted
- `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` — ADR: A non-charging publication re-entry is bounded by its own allowance and a stuck-transition cap
- `adr-2026-08-06-honest-park-termination-boundary` — ADR: Honest park termination boundary
- `adr-2026-08-06-publication-progress-is-its-own-disposition` — ADR: Publication progress is its own disposition, not an exempted retry reason
- `adr-2026-08-07-project-teardown-hook-contract-and-containment` — ADR: Project teardown hook — contract, time bound, and failure containment
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` — ADR: Provider-neutral commit gate for protected DECIDE artifacts
- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` — ADR: The release smoke gate goes live without pre-characterizing every previously-ungated file
- `adr-2026-08-07-worktree-removal-coverage-guard` — ADR: Worktree-removal coverage is enforced by an AST structural guard with an exemption registry
- `adr-2026-08-08-finish-human-required-halt-rendering` — ADR: FINISH human-required halts render reason, next action, and provider detail
- `adr-2026-08-08-pipeline-owned-closeout-timestamps` — ADR: Pipeline emits closeout events onto the bus from its own process
- `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition` — ADR: Repo-wide ADR conformance is a once-per-pass discovery precondition, reported per slug
- `adr-2026-08-08-single-adr-approval-parser-three-rungs` — ADR: One ADR-approval parser, read at three enforcement rungs
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` — ADR: Acceptance-RED lifecycle on the event spine, with provenance-bearing evidence
- `adr-2026-08-09-adr-contradiction-detection-in-two-halves` — ADR: ADR-versus-story contradiction detection is split across two DECIDE gates
- `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal` — ADR: The coherence `adr` layer is gated by a committed ADR signal, not always required
- `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config` — ADR: Bash reaches the `conductor:` block through `conduct-ts config`, never through PyYAML
- `adr-2026-08-09-checkout-is-sole-version-identity-authority` — ADR: The checkout is the sole version-identity authority
- `adr-2026-08-09-conductor-block-single-source-of-truth` — ADR: The schema-owned `conductor:` block is the single source of truth for update-check state
- `adr-2026-08-09-declared-pattern-replication-in-build` — ADR: Declared pattern replication — the copy is a plan task, and TDD pays only for the deltas
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` — ADR: Clearing the halt state removes the marker and the label together, and preserves draft
- `adr-2026-08-09-hook-owned-containment-event-ledger` — ADR: An unresolvable containment check is a ConductorEvent on a hook-owned sibling ledger
- `adr-2026-08-09-legacy-json-seed-migration-rule` — ADR: The legacy JSON seeds the YAML once and wins that seed; the rename is the idempotence marker
- `adr-2026-08-09-non-blocking-plan-scope-containment` — ADR: Plan-scope containment widens its floor and records rationale instead of refusing commits
- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` — ADR: A feature branch has exactly one PR; a HALT is a state on it, never a second PR
- `adr-2026-08-09-operator-only-scoped-artifact-reseal` — ADR: Operator-only scoped reseal of protected DECIDE artifacts
- `adr-2026-08-09-recorded-red-exception-for-remediation` — ADR: A remediation waiver of the RED requirement must be recorded, attributable and observable
- `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` — ADR: The repo-wide ADR sweep is staged behind a default-off config key
- `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` — ADR: The reseal audit entry rides the existing event spine and audit-trail sink
- `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator` — ADR: rotation provenance is resolved outside the pure evaluator
- `adr-2026-08-09-seal-rotation-authorship-predicate` — ADR: seal rotation permission is authorship, not base-identity
- `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` — ADR: "Unverifiable" is triggered by no reachable tag, not by a missing record
- `adr-2026-08-09-worktree-local-provider-scratch` — ADR: Throwaway provider homes live in the worktree, reclaimed by lease-owner liveness
- `adr-2026-08-11-deprecated-no-op-step-retirement` — ADR: A step whose machinery is removed is retained as a deprecated no-op
- `adr-2026-08-11-halt-events-ride-the-persisted-spine` — ADR: Halt events ride the persisted spine, with a centrally stamped step
- `adr-2026-08-12-cumulative-build-review-convergence-bound` — ADR: build_review carries a cumulative convergence bound that tree movement cannot reset
- `adr-2026-08-12-execution-lifecycle-completeness-for-timing` — ADR: Every started execution closes on the ledger, or the rollup names why it could not
- `adr-2026-08-12-live-provider-coverage-from-plugin-registry` — ADR: Live-tier provider coverage is derived from the plugin registry, not a maintained list
- `adr-2026-08-12-operator-reseal-as-second-scope-justification` — ADR: An operator reseal is a second admissible Scope justification
- `adr-2026-08-12-per-provider-live-smoke-legs` — ADR: Live provider coverage is one smoke file per provider, and gate enforcement follows the credential
- `adr-2026-08-12-removal-anchored-tautology-exemption` — ADR: the Tautology rubric exempts removal maintenance, anchored to engine-computed removal evidence
- `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns` — ADR: A publication transition advances only when it moves the dimension it owns
- `adr-2026-08-13-durable-base-advance-attribution` — ADR: base-advance attribution is a durable spine record, not a gate-verdict field
- `adr-2026-08-13-engine-managed-build-review-rubric-branches` — ADR: Engine-managed build_review rubric branches with skill-owned judgement policy
- `adr-2026-08-13-markdown-default-inversion` — ADR: markdown is runtime source by default; only documentation paths are excluded
- `adr-2026-08-13-stable-build-review-finding-dispositions` — ADR: Stable per-finding build_review dispositions are typed, transactional operator state
- `adr-2026-08-14-retire-build-review-wiring-rubric` — ADR: The build_review wiring rubric is retired
- `adr-2026-08-15-verify-only-anchored-tautology-exemption` — ADR: the Tautology rubric exempts verify-only maintenance, anchored to engine-parsed plan markers
- `adr-2026-08-16-closed-build-review-finding-vocabularies` — ADR: Close the build_review finding-identity vocabularies
- `adr-2026-08-16-preservation-anchored-completeness-exemption` — ADR: the Completeness rubric exempts preservation maintenance, anchored to engine-derived removal evidence and a behavior-level plan clause
- `adr-2026-08-16-restore-the-current-head-publication-fence` — ADR: Restore the current-HEAD publication fence on the coordinator path
- `adr-2026-08-17-framework-agnostic-tautology-scoped-run` — ADR: the Tautology counterfactual is classified by exit code, never by runner output
- `adr-2026-08-17-structural-live-checkout-containment` — ADR: Contain the self-host dispatch instead of attributing live-checkout drift
- `adr-2026-08-18-content-anchored-finding-reference-schema` — ADR: Finding-identity references are content-anchored; a closed class-level reference schema for all four rubrics
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` — ADR: A mechanical rubric fault is its own lane — non-charging retry, then an operator reduced-coverage decision
- `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` — ADR: a rebase that invalidates build_review refunds its convergence laps; a PASS never clears them
- `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` — ADR: The engine stamps the rubric judged-result envelope; the provider returns only findings
- `adr-2026-08-19-live-provider-stream-observation` — ADR: The autonomous provider dispatch is observed as a live stream, not only at its result
- `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` — ADR: A tree-attesting gate re-checks its predicate before the loop honors a persisted `done`
- `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` — ADR: A step-runner failure whose inputs cannot change routes instead of retrying
- `adr-2026-08-21-engine-identity-in-build-review-cache-key` — ADR: The judging engine is part of the build_review cache identity
- `adr-2026-08-21-review-bound-by-plan-done-when-criteria` — ADR: build_review is bound by each plan task's Done when: criteria
- `adr-2026-08-22-as-built-review-runs-always-with-plan-gap` — ADR: The as-built architecture review runs always, with per-check policy and a PLAN_GAP verdict
- `adr-2026-08-22-build-review-opt-in-rubric-container` — ADR: build_review is an opt-in rubric container
- `adr-2026-08-22-done-when-evidence-at-task-close` — ADR: Done when: checks are evidenced at BUILD task close when the block exists
- `adr-2026-08-22-one-owner-per-review-question` — ADR: One owner per review question
- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` — ADR: prd_audit judges stories as authority, runs always, and owns the only bounded kickback
- `adr-2026-08-23-committed-halt-record` — ADR: A halt writes a committed, pushed `.docs/halted/<slug>.md` record at the `writeHaltMarker` seam
- `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote` — ADR: A coverage claim is grounded by a verbatim quote, not re-judged at land
- `adr-2026-08-23-criterion-layer-is-structural-at-land` — ADR: The coherence `criterion` layer is structural, and all its strictness stays at land
- `adr-2026-08-23-diff-locality-is-an-authored-disposition` — ADR: Diff-locality is an authored disposition, not a detected property
- `adr-2026-08-24-evidentiary-defects-are-not-waivable` — ADR: The coherence waiver covers coverage gaps, not evidentiary defects
- `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` — ADR: The provider contract has one dispatch member; live observation is a seam on it
- `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` — ADR: OVER_SCOPE decision block and durable refusals
- `adr-2026-08-24-refused-step-status` — ADR: A typed `refused` step status distinct from `failed`
- `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` — ADR: Every non-REPL dispatch requests the machine envelope; live visibility comes from the stream observer
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` — ADR: As-built BLOCKED findings are classified per finding, and remediable ones take a bounded route to BUILD
- `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot` — ADR: A committed rate card prices codex dispatches, and the codex REPL is a bounded one-shot
- `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity` — ADR: Engine-stamped run identity for SHIP-tail verdict artifacts
- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` — ADR: Config-key consumer registry and one-shot dead-surface removal
- `adr-2026-08-26-music-vocabulary-player-composer-rename` — ADR: v1.0 naming — engineer→Composer, ai-conductor as the canonical CLI; daemon stays
- `adr-2026-08-26-remove-retrospectives-one-shot` — ADR: Remove retrospectives (full and micro) in one shot
- `adr-2026-08-26-setup-once-per-worktree-marker` — ADR: Project setup runs once per worktree, gated by a content-addressed success marker
- `adr-2026-08-26-shared-coherence-parser-at-discovery` — ADR: Discovery consumes the shared coherence parser; the bespoke triple-scan is deleted
- `adr-2026-08-27-daemon-dispatcher-executor-seam` — ADR: Daemon dispatcher/executor seam with pinned-base work orders and policy-gated maintenance
- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` — ADR: test_suite drift budget and verification mode
- `adr-2026-08-29-build-review-remediate-case-adjudication` — ADR: build_review failures fan in through one remediate case judgement
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` — ADR: mixed build_review laps preserve content adjudication
- `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded` — ADR: Counterfactual sensitivity is judged from the excerpt, not decreed by exit code
- `adr-2026-08-30-shared-plan-task-reference-resolver` — ADR: Cited plan-task references resolve through one shared resolver, not per-consumer parses
- `adr-2026-08-31-coverage-binding-judge-step` — ADR: Coverage claims bind to `Done when`; a default-off pre-BUILD judge confirms the binding
- `adr-2026-08-31-kickback-ledger-read-fails-closed` — ADR: An unreadable kickback ledger fails closed, and audit history is separable from enforcement state
- `adr-2026-09-02-adr-decision-citability-contract` — ADR: ADR Decision Citability Contract
- `adr-2026-09-05-gh-cli-version-floor-and-environment-gate` — ADR: A declared `gh` version floor, enforced as a machine-level environment gate
- `adr-2026-09-06-engine-owned-test-quality-scope` — ADR: Engine-owned test-quality scope with explicit candidate judgment
- `adr-2026-09-06-inbound-intake-trust-boundary` — ADR: Inbound intake trust boundary — tracker text is evidence, never instruction
- `adr-2026-09-06-reopened-task-resolution` — ADR: Shared resolution of explicitly reopened task obligations
- `adr-2026-09-10-portable-build-review-policy` — ADR: Portable build review policy with candidate-bound evidence and one repair authority
- `adr-2026-09-10-separate-custom-review-coverage-identity` — ADR: Separate custom review risk identity from reduced-coverage identity
- `adr-2026-09-10-shared-step-lifecycle-telemetry` — ADR: Shared lifecycle instrumentation for sequential and parallel telemetry
- `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` — ADR: Finish mergeability must respect active review inputs
