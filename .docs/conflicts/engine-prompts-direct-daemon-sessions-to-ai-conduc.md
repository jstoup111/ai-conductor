# Conflict check: Daemon session command compatibility and visibility

Date: 2026-10-02
Source: jstoup111/ai-conductor#2709
Status: Approved; operator confirmed conflict output on 2026-10-02
Result: Three overlapping-contract conflicts reconciled under the already approved D2/D5 decisions. No remaining blocking conflict identified in the examined feature interactions. No accepted degrading compromise. No new superseding ADR required.

## Corpus and method

Configuration: `conflict_check.adr_corpus: repo_wide` in `.ai-conductor/config.yml`.
Baseline: `b5e2032fbd91fbd81ea8477b1043d8b23a33c4a1`, plus this specification's approved DECIDE artifacts.

Discovery scanned 524 story files, 60 specification files, 638 decision/review files and 308 previous conflict reports. Source text, headings and intersecting contract passages selected the comparisons below. Search covered session guards, command authorization, FINISH recording, bootstrap/prelude, GitHub transport/ownership, provider invocation/containment, event persistence/tailing and read-only review. The guided-setup PRD was also followed from its story's source reference rather than relying on keyword presence. Historical implementation-preservation criteria are read within their named refactor, not as a permanent prohibition on later approved changes.

The pairwise conclusion concerns these seven new stories against one another and the overlapping existing contracts listed below. It does not certify unrelated historical story pairs as mutually consistent. Unexamined pairs are not represented as verified clean. The ADR appendix records subject narrowing; partial or ambiguous supersession does not exclude an ADR. The two older FINISH ADRs retain their primitive/protection decisions; only recording ownership is superseded by the explicit D6 of the August FINISH ADR.

Every intersecting pair below was considered in both directions, testing contradiction, incompatible behavioral overlap, impossible state, resource contention, sequencing and oscillation. Confidence for textual incompatibilities: 99%, verified by the quoted source passages. Compatibility conclusions: 95%, inferred from the cited scope and ordering constraints; this is a specification review, not implementation proof.

## Conflict 1: Unattended setup promises forbidden managed initialization

**Stories involved:** new Story 3 versus guided-setup Story 8 and its FR-12.
**Files:** `.docs/stories/engine-prompts-direct-daemon-sessions-to-ai-conduc.md`; `.docs/stories/bootstrap-register-never-walk-the-user-through-use.md`; `.docs/specs/bootstrap-register-never-walk-the-user-through-use.md`.
**Type:** contradiction
**Severity:** blocking before correction; resolved

**Opposing text before correction:** Older Story 8: “Given onboarding runs with no operator present, when it reaches configuration, then it asks no question, records today's defaults, and completes.” New Story 3: “Given required configuration is missing, when managed prelude runs, then it reports that operator bootstrap is required before launching the provider and writes no replacement configuration.”

Fully satisfying the old daemon interpretation creates configuration the new contract forbids; satisfying the new refusal breaks the old unconditional completion promise.

**Resolution options:** (1) distinguish unmarked setup from managed refresh; (2) broaden managed command permission; (3) introduce an engine config writer. **Recommendation and applied resolution:** option 1, expressly selected by the operator's prior approval of D2 and Story 3. No new setup writer or permission is authorized. Story 8 and its scope were replaced in place; the FR-12 correction is an additive note beside the original assertion. Operator-guided setup, unmarked unattended defaults and no-clobber behavior remain available.

**Root:** stale product-scope generalization, already decided by the approved architecture. DECIDE owns the correction; it is not a BUILD task.

## Conflict 2: Older stories retain provider-owned FINISH recording

**Stories involved:** new Story 2 versus the recording retry/instruction stories in the two earlier FINISH artifacts.
**Files:** `.docs/stories/finish-step-completion-becomes-engine-machinery-re.md`; `.docs/stories/finish-step-fails-try-1-on-every-daemon-ship-skill.md`; new stories.
**Type:** oscillating
**Severity:** blocking before correction; resolved

**Opposing text before correction:** The older surgical-retry story said “then the dispatched prompt is the narrow finish-record instruction carrying the exact `conduct-ts finish-record` command line” and its negative criterion said “the engine never writes the marker itself.” New Story 2 requires “the engine records and verifies the authorized outcome without assigning recording to a provider.”

The old instruction would fail the new compatibility audit, and restoring engine ownership would fail the old instruction/sole-owner criteria. Repeated implementation repair cannot satisfy both.

**Resolution options:** (1) replace stale story clauses with the approved coordinator ownership; (2) admit finish-record to marked sessions; (3) add a second recorder. **Recommendation and applied resolution:** option 1, already authorized by D2 and by adr-2026-08-01-engine-owned-resumable-finish-publication D3–D6. The stale recording sections and remaining agent-recording wording were replaced in place. Evidence verification, ordered primitive writes, retry bounds, presentation quality and no automatic merge remain governing constraints.

**Root:** stale story phrasing after partial architectural supersession. The older ADRs are retained for surviving decisions, not marked wholly superseded. Missing coordinator means explicit refusal, never a full provider recording walk.

## Conflict 3: Counting every emission would duplicate replayed occurrences

**Stories involved:** new Story 7 versus telemetry Story 4.1-2.
**Files:** `.docs/stories/wave-c-telemetry-event-log.md`; new stories.
**Type:** state-conflict
**Severity:** blocking before correction; resolved

**Opposing text before correction:** Older story: “Given multiple events are emitted, when the run completes, then every line in events.jsonl parses as valid JSON and the count equals the number of events emitted”. New Story 7: “Given an earlier projection persisted but another subscriber failed or the process stopped, when recovery replays the producer record, then the durable record is not duplicated; a repeated log delivery retains the same event identity.”

Counting replay deliveries as new occurrences breaks the approved durable uniqueness contract. Deduplicating replay breaks an unqualified emit-count assertion.

**Resolution options:** (1) qualify persistence by sink declaration and stable observation identity; (2) suppress recovery after partial delivery, risking loss; (3) allow duplicate durable occurrences. **Recommendation and applied resolution:** option 1, already approved in D5 and Story 7. The older story now distinguishes ordinary append behavior from idempotent session-observation replay and explicitly keeps distinct ids distinct. The canonical writer remains EventPersister; producers never append to its file.

## Compatible interactions and two-direction checks

| Pair | Satisfying new preserves existing because | Satisfying existing permits new because |
|---|---|---|
| New Stories 1/2/3; operator-session authority and monitor | The sanctioned set is not widened; operator-only instructions remain legitimate. | Operator launch and marked engine dispatch have separate authority; the audit follows real context. |
| New Stories 1/6; GitHub ownership Story 8 and ADR D7 | Harness-authored mutations still require per-operation authorization; the wrapper is not a fallback. | The approved D7 amendment names only the private observation passthrough; no file-wide exemption exists. |
| New Stories 2/5; engine FINISH and durable shipment | Observation events never create completion authority; record/verify still requires coherent evidence. | Typed local publication recovery can emit command observations without replaying verified publication effects. |
| New Stories 3/4; prelude and config scaffolder | Engine readiness reads do not instruct a marked provider to run config; configuration is never silently initialized. | The deterministic unmarked config writer remains the setup owner and preserves existing choices. |
| New Stories 4/6; provider catalog, Pi containment and routing | Context extends the existing invoke path, retains marker precedence and tmux scrubbing, and preserves authentication and candidate policy. | Catalog capabilities and setup refusal permit added preparation; Pi's required marker agrees with D18. |
| New Story 4; native read-only review | Source, seals, evidence and operator config protections remain binding; no general writable fallback is allowed. | D6 requires proof of both native policy and the narrow destination; unavailable combinations refuse before dispatch. Native capability alone is insufficient. |
| New Stories 5/7; event sinks, closeout and replay | Same union/emitter/persister; no competing canonical writer or rollup input; only observation ids deduplicate. | Per-producer inputs are permitted by the existing cross-process schema contract and converge on existing consumers. |
| New Story 7; closeout corruption recovery | Ordinary partial lines remain pending, bad complete records do not hide later valid records, and one traversal owns progress. | Awaited final drain is a separate owner operation; existing synchronous stop remains synchronous. Settled-boundary diagnostics apply to managed producer records, not every ordinary poll. |
| New Story 6; destructive-git guard | The gh wrapper cannot remove the existing git PATH guard or alter its refusal policy. | Each wrapper resolves its own underlying executable before overlay; adding observation is not a git bypass. |
| New Story 6; operator/bot credentials | Guarded transport retains credential selection; events expose no payload or secret. | Private real-gh execution distinguishes guarded calls without a public session authorization flag. |
| New Stories 1–7, all 21 internal pairs | Audit permission, setup readiness, command refusal, transport observation and durable delivery have distinct owners. | Prerequisite order is prepare/context → producer → canonical projection/drain; no reporter success grants command permission or completion. |

The read-only finding required an explicit clarification beside new ADR D6, preserving the existing profiles and fail-before-launch outcome. It is not a claim that all currently installed providers already support that destination. BUILD must prove that behavior with the selected policy; it cannot silently grant broader reviewer access.

## Re-check and gate

The three corrected families were compared again in both directions: initialized/uninitialized and marked/unmarked bootstrap; normal/missing-coordinator/invalid-evidence/retry FINISH; ordinary/distinct/replayed event occurrences. Their opposing assertions now select the same behavior. No blocking conflict remains in these comparisons. Architecture choices are unchanged; the existing approved new ADR supplies the authoritative resolution. The operator confirmed this conflict-check output before plan authoring on 2026-10-02.

No aggregate or executable tests were run: this is a DECIDE-only correction. Diff formatting and local target existence were checked. Behavioral proof belongs to the implementation plan and BUILD gates.

## ADR corpus disposition

The following inventory includes every `adr-*.md` decision file. “Examined” identifies overlapping governing clauses; “Narrowed out” identifies subjects outside the seven stories. Non-ADR architecture reviews were discovery/context inputs, not silently treated as ADRs. No ADR is excluded merely because it contains a partial supersession.

| ADR | Disposition | Subject / reason |
|---|---|---|
| `adr-002-engineer-store-and-retro-redirect` | Narrowed out | Separate decision subject: ADR 002: Engineer store format + retro-redirect mechanism |
| `adr-003-registry-write-and-integration` | Narrowed out | Separate decision subject: ADR 003: Registry write mechanism + bootstrap integration |
| `adr-005-non-autonomy-and-read-only-governor` | Narrowed out | Separate decision subject: ADR 005: Non-autonomy by construction + read-only governor |
| `adr-006-flywheel-lesson-selection-and-provenance` | Narrowed out | Separate decision subject: ADR 006: Flywheel — lesson selection + engineer-planned provenance |
| `adr-008-agent-hosted-loop-and-in-chat-authoring` | Narrowed out | Separate decision subject: ADR 008: Agent-hosted engineer loop + in-chat human-gated authoring (cross-repo isolation without a subprocess) |
| `adr-009-intake-adapter-port` | Narrowed out | Separate decision subject: ADR 009: Intake adapter port (hexagonal) + Envelope contract |
| `adr-010-pidfile-lock-daemon-liveness` | Narrowed out | Separate decision subject: ADR 010: Pidfile-lock daemon liveness, 1-per-repo mutex & ensure-running |
| `adr-011-async-intake-queue-and-github-source` | Narrowed out | Separate decision subject: ADR-011: Async Intake Queue + GitHub-Issues Source |
| `adr-012-durable-intake-ledger-sole-dedup-authority` | Narrowed out | Separate decision subject: ADR-012: Durable Intake Ledger as Sole Dedup Authority |
| `adr-014-otel-observability-exporter` | Narrowed out | Separate decision subject: ADR 014: OpenTelemetry Observability Exporter |
| `adr-015-daemon-pr-labeling-sweep` | Narrowed out | Separate decision subject: ADR 015: Daemon PR labeling — shared gh seam, tracked mergeable watch registry, best-effort sweep |
| `adr-2026-06-29-architecture-before-stories-convergent-kickback` | Narrowed out | Separate decision subject: ADR: Architecture before stories; convergent root-routed kickbacks |
| `adr-2026-06-29-brainstorm-rename-migration` | Narrowed out | Separate decision subject: ADR: Migration for `brainstorm → {explore, prd}` |
| `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` | Narrowed out | Separate decision subject: ADR: Daemon supervisor port + attachable foreground hosting |
| `adr-2026-06-29-explore-prd-split-track-in-explore` | Narrowed out | Separate decision subject: ADR: Split `brainstorm` into `explore` + `prd`; track decided in `explore` |
| `adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration` | Narrowed out | Separate decision subject: ADR: Memory Provider Plugin Kind & Agent-Queried Integration |
| `adr-2026-06-29-memory-resilience-write-fallback-and-reconcile` | Narrowed out | Separate decision subject: ADR: Memory Resilience — Best-Effort, Write-Fallback & Reconcile-on-Reconnect |
| `adr-2026-06-29-per-project-memory-provider-selection` | Narrowed out | Separate decision subject: ADR: Per-Project Memory Provider Selection |
| `adr-2026-06-29-per-provider-retrieval-guidance-location` | Narrowed out | Separate decision subject: ADR: Per-Provider Retrieval Guidance Location |
| `adr-2026-06-29-platform-adoption-and-removal-surface` | Narrowed out | Separate decision subject: ADR: Platform Adoption & Removal Surface |
| `adr-2026-06-29-rebase-conflict-resolution-dispatch` | Narrowed out | Separate decision subject: ADR: Gated rebase-conflict resolution dispatch (amends ADR-001) |
| `adr-2026-06-29-safe-reversible-memory-migration` | Narrowed out | Separate decision subject: ADR: Safe, Reversible Migration of Existing Memory |
| `adr-2026-06-29-shared-memory-store-placement-and-durability` | Narrowed out | Separate decision subject: ADR: Shared Memory Store Placement & Cross-Worktree Durability |
| `adr-2026-06-29-track-marker-location` | Narrowed out | Separate decision subject: ADR: Track marker is a dedicated `.docs/track/<slug>.md` |
| `adr-2026-06-30-background-intake-brain-loop` | Narrowed out | Separate decision subject: ADR: Background intake runs on a single brain/supervisor loop; ledger stays single-writer |
| `adr-2026-06-30-engineer-worktree-authoring-isolation` | Narrowed out | Separate decision subject: ADR 2026-06-30: Engineer authors in a per-idea worktree (ADR-008 escalation, for same-repo concurrency) |
| `adr-2026-06-30-grandfather-cutover-merge-time` | Narrowed out | Separate decision subject: ADR: Deriving a Spec's Merge Time for the Grandfather Cutover |
| `adr-2026-06-30-halt-based-release-gates` | Narrowed out | Separate decision subject: ADR: All self-host release gates are HALT-based and fail-closed |
| `adr-2026-06-30-origin-seeded-intake-routing` | Narrowed out | Separate decision subject: ADR: Origin-seeded routing for GitHub-intake ideas (human gate preserved) |
| `adr-2026-06-30-owner-gate-identity-resolution` | Narrowed out | Separate decision subject: ADR: Owner-Gate Identity Resolution and Fail-Open Posture |
| `adr-2026-06-30-owner-provenance-recording` | Narrowed out | Separate decision subject: ADR: Owner Provenance — How a Spec Records and Proves Its Owner |
| `adr-2026-06-30-sandbox-build-isolation` | Narrowed out | Separate decision subject: ADR: Sandbox harness self-builds via a throwaway CLAUDE_CONFIG_DIR |
| `adr-2026-06-30-self-host-detection-seam` | Narrowed out | Separate decision subject: ADR: Single swappable self-host detection seam |
| `adr-2026-07-01-machine-scoped-operator-identity` | Narrowed out | Separate decision subject: ADR 2026-07-01: Machine-scoped operator identity + fail-closed ownership gating |
| `adr-2026-07-03-daemon-auto-restart-stale-engine` | Narrowed out | Separate decision subject: ADR: Daemon auto-restart on stale engine code — exit-to-respawn at the idle boundary |
| `adr-2026-07-03-dependency-fail-closed-and-cache` | Narrowed out | Separate decision subject: ADR: Fail-closed indeterminate semantics and per-scan blocker cache |
| `adr-2026-07-03-dependency-gate-backlog-waiting-channel` | Narrowed out | Separate decision subject: ADR: DependencyGate placement and the backlog waiting-items channel |
| `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land` | Narrowed out | Separate decision subject: ADR: Engineer checkpoint commits + idempotent `land` |
| `adr-2026-07-03-gated-snapshot-status-read-model` | Narrowed out | Separate decision subject: ADR: Per-pass atomic gated snapshot as the status CLI's read model |
| `adr-2026-07-03-gated-writeback-announcements` | Narrowed out | Separate decision subject: ADR: Gated-spec announcements via the pr-labels seam, warn-once per state change |
| `adr-2026-07-03-generated-model-table-single-source` | Narrowed out | Separate decision subject: ADR: Generated HARNESS.md model table — typed engine metadata as single source |
| `adr-2026-07-03-halt-pr-rehabilitation-at-finish` | Narrowed out | Separate decision subject: ADR: Halt-PR Rehabilitation at Finish (skill presentation, engine mechanics, gate enforcement) |
| `adr-2026-07-03-harness-daemon-profile` | Narrowed out | Separate decision subject: ADR: Harness daemon profile — build-to-PR on the harness repo, human merge |
| `adr-2026-07-03-issue-dependencies-api-surface` | Narrowed out | Separate decision subject: ADR: GitHub Issue-Dependencies REST API as the dependency source of truth |
| `adr-2026-07-03-owner-gate-gated-channel` | Narrowed out | Separate decision subject: ADR: Owner-gate skips ride the discovery-result gated channel |
| `adr-2026-07-03-post-rebase-force-with-lease` | Narrowed out | Separate decision subject: ADR: Post-rebase refresh is the only force-push, and only `--force-with-lease` |
| `adr-2026-07-03-pr-timing-config-key` | Narrowed out | Separate decision subject: ADR: `pr_timing` config key — one setting, two publish flows |
| `adr-2026-07-03-pr-timing-self-host-precedence` | Narrowed out | Separate decision subject: ADR: Self-host builds ignore `early-draft` (guardrail precedence) |
| `adr-2026-07-03-priority-fetch-fail-soft` | Narrowed out | Separate decision subject: ADR: Priority-fetch failure degrades to pure date order with an in-memory once-per-outage warning |
| `adr-2026-07-03-priority-from-linked-issue-labels` | Narrowed out | Separate decision subject: ADR: Backlog priority resolved from linked-issue labels via a post-discovery ordering seam |
| `adr-2026-07-03-prose-to-link-migration` | Narrowed out | Separate decision subject: ADR: One-time prose→link migration — parse patterns and idempotency |
| `adr-2026-07-03-reactive-model-fallback-ladder` | Narrowed out | Separate decision subject: ADR: Reactive model fallback ladder in the invocation seam |
| `adr-2026-07-03-version-gate-semver-escalation` | Narrowed out | Separate decision subject: ADR: Version-gate semver escalation — PATCH auto-pass, MINOR/MAJOR HALT |
| `adr-2026-07-04-auth-failure-park-and-poll` | Narrowed out | Separate decision subject: ADR: Auth failures park-and-poll on operator credentials — never retry, never escalate |
| `adr-2026-07-04-autoresolve-state-and-config` | Narrowed out | Separate decision subject: ADR: Auto-Resolve State on the Watch Entry; Fail-Closed Suite Config |
| `adr-2026-07-04-claim-time-delivery-evidence-guard` | Narrowed out | Separate decision subject: ADR: Claim-Time Delivery-Evidence Guard (intake re-dispatch protection) |
| `adr-2026-07-04-durable-pause-marker` | Narrowed out | Separate decision subject: ADR: Durable repo-scoped pause marker at the dispatch boundary |
| `adr-2026-07-04-event-driven-halt-clear-wake` | Narrowed out | Separate decision subject: ADR 2026-07-04: Event-Driven HALT-Clear Wake with Poll Backstop |
| `adr-2026-07-04-kickback-event-emission-and-log-prominence` | Narrowed out | Separate decision subject: ADR: Kickback event emission completeness + log-line prominence |
| `adr-2026-07-04-operator-park-marker` | Narrowed out | Separate decision subject: ADR: Operator park state — repo-root `.daemon/parked/<slug>` marker, checked before every autonomous decision |
| `adr-2026-07-04-park-unpark-cli-verbs` | Narrowed out | Separate decision subject: ADR: `daemon park <slug>` / `daemon unpark <slug>` — filesystem-direct CLI verbs, no live daemon required |
| `adr-2026-07-04-pending-restart-queue` | Narrowed out | Separate decision subject: ADR: Pending-restart queues durably and fires at the idle boundary |
| `adr-2026-07-04-resolution-worktree-lifecycle` | Narrowed out | Separate decision subject: ADR: Dedicated Transient Worktree for Open-PR Conflict Resolution |
| `adr-2026-07-04-respawn-in-place-restart` | Narrowed out | Separate decision subject: ADR: Restart-in-place via pane respawn inside the existing tmux session |
| `adr-2026-07-04-versioned-engine-store-atomic-flip` | Narrowed out | Separate decision subject: ADR: Versioned engine store with atomic current-pointer flip (closes #215) |
| `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep` | Narrowed out | Separate decision subject: ADR: Widen the Rebase-Resolution Dispatch Exception to the Mergeable Sweep |
| `adr-2026-07-05-daemon-rate-limit-episode-coordinator` | Narrowed out | Separate decision subject: ADR: Daemon rate-limit episode is a coordinated in-process pause, not a per-feature failure |
| `adr-2026-07-05-engine-owned-task-status` | Narrowed out | Separate decision subject: ADR 2026-07-05: Engine-owned, git-derived task-status.json |
| `adr-2026-07-05-halt-pr-presentation-reliability` | Narrowed out | Separate decision subject: ADR 2026-07-05: Halt-PR presentation reliability — verify-after-write + reconciliation |
| `adr-2026-07-05-retry-as-escalation-ladder` | Narrowed out | Separate decision subject: ADR 2026-07-05: Retry-as-escalation ladder |
| `adr-2026-07-05-standalone-bin-update` | Narrowed out | Separate decision subject: ADR 2026-07-05 — Extract the self-update/channel flow to a standalone `bin/update` |
| `adr-2026-07-06-daemon-false-ship-guard` | Narrowed out | Separate decision subject: ADR: finish push-evidence gate and daemon ship guard (no false ships) |
| `adr-2026-07-06-installed-root-resolution-for-global-writes` | Narrowed out | Separate decision subject: ADR: Installed-root resolution for operator-global writes (worktree-install guard) |
| `adr-2026-07-06-manual-test-fail-routing` | Narrowed out | Separate decision subject: ADR: manual_test FAIL routing, fix-evidence gate, and gating enforcement |
| `adr-2026-07-06-migration-gate-waiver` | Narrowed out | Separate decision subject: ADR: TR-10 migration gate accepts a committed no-breaking-surface waiver |
| `adr-2026-07-06-stale-engine-respawn-in-place` | Narrowed out | Separate decision subject: ADR: Stale-engine restart rides the respawn-in-place transport; relink precedes every handoff |
| `adr-2026-07-07-audit-trail-event-sink` | Narrowed out | Separate decision subject: ADR: Audit-trail event-sink writer for retro friction records |
| `adr-2026-07-07-daemon-owned-build-credential` | Narrowed out | Separate decision subject: ADR: Daemon-owned build credential behind a BuildAuthProvider seam |
| `adr-2026-07-07-finish-record-primitive` | Examined governing clauses | ADR: `conduct-ts finish-record` — deterministic finish-completion marker primitive |
| `adr-2026-07-07-ship-ci-feedback-loop` | Narrowed out | Separate decision subject: ADR: Ship→CI feedback loop — sweep-native bounded remediation of red shipped PRs |
| `adr-2026-07-07-single-generation-stale-respawn` | Narrowed out | Separate decision subject: ADR: Stale-engine respawn is single-generation — predecessor exits unconditionally on a fired trigger; lock-losers terminate |
| `adr-2026-07-07-task-trailer-id-alias` | Narrowed out | Separate decision subject: ADR: Task-Trailer Id Alias (`task-<id>` ≡ `<id>`) in Evidence Derivation |
| `adr-2026-07-08-halt-issue-closure-sweep` | Narrowed out | Separate decision subject: ADR: Deterministic halt-issue closure sweep (ledger + Halt-Slug stamp + close-on-ship) |
| `adr-2026-07-08-main-checkout-leak-triage-and-write-fence` | Narrowed out | Separate decision subject: ADR: Main-checkout leak triage with byte-identity-gated auto-heal, plus a sandbox write-fence |
| `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify` | Narrowed out | Separate decision subject: ADR: Post-rebase gate-first mechanical re-verify (build only) |
| `adr-2026-07-09-deterministic-evidence-attribution-enforcement` | Narrowed out | Separate decision subject: ADR: Deterministic evidence attribution — engine-owned task transitions + worktree-local git hooks |
| `adr-2026-07-09-setup-failure-triage` | Narrowed out | Separate decision subject: ADR: Deterministic setup-failure triage (quarantine + bounded fix-session) |
| `adr-2026-07-10-concurrent-group-core` | Narrowed out | Separate decision subject: ADR: Concurrent group core — one capped, engine-integrated parallel executor |
| `adr-2026-07-10-daemon-stall-remediation` | Narrowed out | Separate decision subject: ADR: Route daemon build stalls (halt-user-input-required) through /remediate before halting |
| `adr-2026-07-10-evidence-range-anchor-resolution` | Narrowed out | Separate decision subject: ADR: Single-sourced evidence-range anchor resolution (branch base, never genesis) |
| `adr-2026-07-10-inline-work-attribution-enforcement` | Narrowed out | Separate decision subject: ADR: Inline build work attribution enforcement — fail-closed commit gate, dispatch-shaped execution, zero-work kickback |
| `adr-2026-07-10-intake-claim-priority-banding` | Narrowed out | Separate decision subject: ADR: Intake claim orders candidates by priority band above receivedAt FIFO, resolved at claim time, fail-open |
| `adr-2026-07-10-intra-step-build-progress-events` | Narrowed out | Separate decision subject: ADR: Intra-step build progress + stall as first-class ConductorEvents |
| `adr-2026-07-10-observed-close-watch-registry` | Narrowed out | Separate decision subject: ADR: Observed-close — watch registry + idle-tick sweep replaces close-on-merge for watched fixes |
| `adr-2026-07-10-park-marker-main-root-resolution` | Narrowed out | Separate decision subject: ADR: Park markers anchor to the MAIN repository root, resolved inside park-marker.ts |
| `adr-2026-07-10-retire-migration-grandfather` | Narrowed out | Separate decision subject: ADR: Retire the H8 migration-grandfather path — evidence stamps are the only completion currency |
| `adr-2026-07-10-session-hook-task-stamping` | Narrowed out | Separate decision subject: ADR: Session-hook task stamping at subagent dispatch |
| `adr-2026-07-10-validation-group-join` | Narrowed out | Separate decision subject: ADR: SHIP validation group — membership, join policy, and consolidated remediation |
| `adr-2026-07-11-attribution-abstain-or-loud` | Narrowed out | Separate decision subject: ADR: Attribution machinery is abstain-or-loud — a stale stamp is never left, an id is never guessed, an invalid id never passes |
| `adr-2026-07-11-attribution-spot-audit-measurement` | Narrowed out | Separate decision subject: ADR: Spot-audit measurement of fast-lane attribution accuracy |
| `adr-2026-07-11-attribution-verdict-interface` | Narrowed out | Separate decision subject: ADR: Attribution verdict interface and evidence-stamp schema evolution |
| `adr-2026-07-11-evidence-judge-cli-and-cutover` | Narrowed out | Separate decision subject: ADR: `conduct-ts evidence judge` CLI entry, cutover flag, and model-table entry |
| `adr-2026-07-11-finish-step-engine-completion-machinery` | Examined governing clauses | ADR: Finish-step completion becomes engine machinery (in-step presentation repair, hardened gate, surgical retry) |
| `adr-2026-07-11-pipeline-state-durability` | Narrowed out | Separate decision subject: ADR: `.pipeline` run-state durability — defense-in-depth, fail-loud-not-crash |
| `adr-2026-07-11-semantic-attribution-verification-lane` | Narrowed out | Separate decision subject: ADR: Semantic attribution verification lane at the build evidence gate |
| `adr-2026-07-11-verdict-aware-resume-entry` | Narrowed out | Separate decision subject: ADR: Verdict-Aware Resume Entry (Backward-Only Clamp) |
| `adr-2026-07-12-judged-attribution-verdict-persistence` | Narrowed out | Separate decision subject: ADR: Judged attribution verdicts must flip the current build's completion gate |
| `adr-2026-07-12-progress-aware-build-halt` | Narrowed out | Separate decision subject: ADR: Progress-aware build halt/park + progress-gated cross-dispatch re-kick (#280) |
| `adr-2026-07-12-rebase-evidence-stamp-translation` | Narrowed out | Separate decision subject: ADR: Engine translates sha-anchored evidence citations through its own rebases |
| `adr-2026-07-12-wired-into-contract` | Narrowed out | Separate decision subject: ADR: Wired-into contract — architecture decides, plan carries, Small tier falls back |
| `adr-2026-07-12-wiring-check-gate` | Narrowed out | Separate decision subject: ADR: wiring_check gate — deterministic reachability verification with layered probe |
| `adr-2026-07-13-kickback-build-no-op-escalation` | Narrowed out | Separate decision subject: ADR 2026-07-13: Kickback→build no-op guard + zero-progress/unchanged-verdict escalation |
| `adr-2026-07-13-park-all-dispatch-paths` | Narrowed out | Separate decision subject: ADR 2026-07-13: Operator park blocks every dispatch entry point (immediate-before-dispatch predicate) |
| `adr-2026-07-13-retry-classify-rerun-vs-route` | Narrowed out | Separate decision subject: ADR 2026-07-13: Classify step-failures rerun-vs-route before burning a retry (#646) |
| `adr-2026-07-13-session-fresh-verdict-artifacts` | Narrowed out | Separate decision subject: ADR 2026-07-13: Step completion checks require a session-fresh verdict artifact (per-attempt floor) |
| `adr-2026-07-17-verify-only-judged-closure` | Narrowed out | Separate decision subject: ADR: Class-scoped judged closure for verify-only (prove-closed) plan tasks |
| `adr-2026-07-20-bounded-dirname-path-corroboration` | Narrowed out | Separate decision subject: ADR: Bounded dirname/subsystem pass in autoheal path-corroboration |
| `adr-2026-07-20-ci-fix-dispatch-via-steprunner` | Narrowed out | Separate decision subject: ADR: Dispatch ci-fix via DefaultStepRunner, not a bespoke claude spawn |
| `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification` | Narrowed out | Separate decision subject: ADR: Fail-loud-once startup preflight + resolver error classification |
| `adr-2026-07-20-post-rebase-delta-aware-invalidation` | Narrowed out | Separate decision subject: ADR: Delta-aware post-rebase gate invalidation |
| `adr-2026-07-21-completeness-as-build-review-rubric` | Narrowed out | Separate decision subject: ADR: Plan-completeness judgement as a default-on build_review rubric item |
| `adr-2026-07-21-decide-time-unmerged-overlap-scan` | Narrowed out | Separate decision subject: ADR: DECIDE-time unmerged-overlap scan is a deterministic primitive, dual-hooked and advisory |
| `adr-2026-07-21-demote-task-stamping-to-telemetry` | Narrowed out | Separate decision subject: ADR: Demote per-task evidence stamping from a completion gate to telemetry |
| `adr-2026-07-21-engine-owned-acceptance-red-execution` | Narrowed out | Separate decision subject: ADR: Engine-owned RED execution for acceptance_specs, driven by a skill-recorded run contract |
| `adr-2026-07-21-intake-only-enforcement` | Narrowed out | Separate decision subject: ADR: Enforce intake criteria at capture/file time only — never downstream |
| `adr-2026-07-21-no-diff-task-evidence-stamp` | Narrowed out | Separate decision subject: ADR: A no-diff task earns completion currency deterministically — stamp Evidence: skipped, recognize Type: verification |
| `adr-2026-07-21-owner-stamped-at-authoring` | Narrowed out | Separate decision subject: ADR: Stamp Owner at authoring time; default-and-loudly-log an un-owned arrival — never silently skip |
| `adr-2026-07-21-s-tier-pipeline-knobs` | Narrowed out | Separate decision subject: ADR: Small features are cheap through the existing pipeline's own knobs — no separate SDLC flow (#668) |
| `adr-2026-07-21-serena-removal-path` | Narrowed out | Separate decision subject: ADR: Serena removal path — stop shipping it, migrate existing deployments via an approval-gated unregister, keep the repo-local ignore line |
| `adr-2026-07-22-attempts-counter-on-crash-recovery` | Narrowed out | Separate decision subject: ADR: `attempts` counter increments on stale-claim recovery |
| `adr-2026-07-22-auth-failure-classification-observed-401-patterns` | Narrowed out | Separate decision subject: ADR: Auth-failure classification — observed 401 patterns in text mode, structured status in the probe |
| `adr-2026-07-22-build-dispatch-json-usage-capture` | Narrowed out | Separate decision subject: ADR 2026-07-22-a — Capture build-session usage via `--output-format json` |
| `adr-2026-07-22-canonical-tagged-source-ref` | Narrowed out | Separate decision subject: ADR: Canonical tagged source-ref module (GitHub refs + Jira keys) |
| `adr-2026-07-22-canonical-tracker-client-seam` | Narrowed out | Separate decision subject: ADR: Canonical tracker-client seam with per-backend transport contract |
| `adr-2026-07-22-coherence-gate-placement-and-validation-split` | Narrowed out | Separate decision subject: ADR: Coherence gate — authoring step after /plan, deterministic validation at land |
| `adr-2026-07-22-coherence-waiver-and-duplicate-claim` | Narrowed out | Separate decision subject: ADR: Coherence waiver format and duplicate-intake-claim lookback scope |
| `adr-2026-07-22-daemon-level-missing-credential-gate` | Narrowed out | Separate decision subject: ADR: Daemon-level missing-credential gate — one waiting condition, per-feature preflight retained as backstop |
| `adr-2026-07-22-examples-state-isolation` | Narrowed out | Separate decision subject: ADR: Examples isolate all shared state via env overrides + a throwaway root |
| `adr-2026-07-22-gate-evidence-code-validity-on-redispatch` | Narrowed out | Separate decision subject: ADR: Judged-gate evidence is preserved on re-dispatch by code-state validity, not timestamp freshness |
| `adr-2026-07-22-headless-vs-guided-examples` | Narrowed out | Separate decision subject: ADR: Two example modes — headless self-asserting vs guided launcher |
| `adr-2026-07-22-heartbeat-lease-deferred` | Narrowed out | Separate decision subject: ADR: Defer a claim heartbeat/lease; accept a bounded duplicate-processing window now |
| `adr-2026-07-22-intake-closed-issue-reconciliation` | Narrowed out | Separate decision subject: ADR: Reconcile closed GitHub issues out of the intake ledger at two control points |
| `adr-2026-07-22-origin-refresh-before-engine-rebuild` | Narrowed out | Separate decision subject: ADR: Fast-forward origin refresh before the quiescent engine rebuild, loud staleness fallback |
| `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` | Narrowed out | Separate decision subject: ADR 2026-07-22-b — Per-feature cost rollup lives in the committed shipped-record |
| `adr-2026-07-22-per-task-work-happened-floor` | Narrowed out | Separate decision subject: ADR 2026-07-22 — Per-task "work happened at all" floor under build_review |
| `adr-2026-07-22-phase-scoped-docs-write-guard` | Narrowed out | Separate decision subject: ADR: Phase-scoped .docs write-guard — separate marker, engine-resolved allowlist, dumb hook |
| `adr-2026-07-22-requeue-claimed-distinct-from-reopen` | Narrowed out | Separate decision subject: ADR: A dedicated `claimed → pending` recovery transition, distinct from `reopen` |
| `adr-2026-07-22-stale-claim-staleness-window-default` | Narrowed out | Separate decision subject: ADR: Staleness window default for automatic stale-claim recovery |
| `adr-2026-07-22-token-liveness-probe-via-cli-invocation` | Narrowed out | Separate decision subject: ADR: Token liveness verification via minimal CLI invocation (not raw API probe) |
| `adr-2026-07-23-build-review-fresh-base-disposition` | Narrowed out | Separate decision subject: ADR: build_review grades against a verified-fresh base; scope FAILs get a bounded deterministic disposition |
| `adr-2026-07-23-commit-movement-liveness-floor` | Narrowed out | Separate decision subject: ADR: Commit-movement liveness floor under the build stall breaker; attributed-task count demoted to advisory |
| `adr-2026-07-23-intake-label-authority-scoped-replace` | Narrowed out | Separate decision subject: ADR: Intake label authority — explicit > existing > default, applied by namespace-scoped replace |
| `adr-2026-07-23-session-hook-repair-before-halt` | Narrowed out | Separate decision subject: ADR: Repair missing session hooks at the build preflight instead of removing the gate |
| `adr-2026-07-23-trailer-union-build-step-routing` | Narrowed out | Separate decision subject: ADR: Build-step exit routes on the trailer-union task resolution |
| `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` | Examined governing clauses | ADR: Provider-aware step execution with fresh step-scoped sessions |
| `adr-2026-07-25-content-addressed-full-suite-proof` | Narrowed out | Separate decision subject: ADR: Content-addressed full-suite proof at the BUILD-to-SHIP boundary |
| `adr-2026-07-25-custom-step-completion-artifacts` | Narrowed out | Separate decision subject: ADR: Custom steps may declare fresh completion artifacts |
| `adr-2026-07-25-fail-closed-durable-shipment-evidence` | Narrowed out | Separate decision subject: ADR: Fail-Closed Durable Shipment Evidence |
| `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` | Narrowed out | Separate decision subject: ADR: First-class Codex skill and guidance adaptation |
| `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` | Narrowed out | Separate decision subject: ADR: Concurrent task telemetry and symmetric self-host isolation |
| `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` | Narrowed out | Separate decision subject: ADR: The kickback bound is durable across dispatches and keyed on the tree, not the commit |
| `adr-2026-07-26-daemon-decide-preseed-ownership` | Narrowed out | Separate decision subject: ADR: DECIDE-phase steps are preseeded by derivation, and vetted at discovery |
| `adr-2026-07-26-event-sink-registry-exhaustiveness` | Examined governing clauses | ADR 2026-07-26: Compile-time exhaustive event-sink registry |
| `adr-2026-07-26-protected-artifact-seal-rebaseline` | Narrowed out | Separate decision subject: ADR: rebaseline the protected-artifact seal on proven base inheritance |
| `adr-2026-07-26-rebase-tail-current-branch-before-publication` | Narrowed out | Separate decision subject: ADR: Rebase the current validated branch before publication |
| `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` | Narrowed out | Separate decision subject: ADR 2026-07-27-b — The `## Cost` block evolves by addition, and cost aggregates split from token aggregates |
| `adr-2026-07-27-ancestry-proven-park-reconciliation` | Narrowed out | Separate decision subject: ADR: Ancestry-proven parked-feature auto-reconciliation with config kill-switch |
| `adr-2026-07-27-codex-never-resumes-a-harness-minted-session` | Narrowed out | Separate decision subject: ADR: Codex never resumes — session resume becomes a declared provider capability |
| `adr-2026-07-27-cold-start-within-step-retries` | Narrowed out | Separate decision subject: ADR: Claude declares no resume — the harness never resumes any session |
| `adr-2026-07-27-cost-unmetered-is-a-first-class-state` | Narrowed out | Separate decision subject: ADR 2026-07-27-a — Absent provider cost is a first-class `cost-unmetered` state, never zero |
| `adr-2026-07-27-daemon-decide-kickback-halt` | Narrowed out | Separate decision subject: ADR: One kickback-phase policy, consulted at both backward-navigation seams |
| `adr-2026-07-27-project-config-scaffolder` | Examined governing clauses | ADR: Deterministic project-config scaffolder (#683) |
| `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` | Narrowed out | Separate decision subject: ADR: Protected-artifact seal hands self-amendment to build_review instead of halting |
| `adr-2026-07-28-feature-aware-artifact-resolution` | Narrowed out | Separate decision subject: ADR: Feature-aware artifact contracts resolve step outputs for every generic consumer |
| `adr-2026-07-28-total-halt-classification-legacy-boundary` | Narrowed out | Separate decision subject: ADR: Require total HALT classification with an explicit legacy boundary |
| `adr-2026-07-29-codex-readiness-probe-failure-disposition` | Narrowed out | Separate decision subject: ADR: Codex readiness separates probe failure from credential failure |
| `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` | Narrowed out | Separate decision subject: ADR: Defer the feature-worktree reap until the shipped record is present on main |
| `adr-2026-07-29-deterministic-build-verification-fanout` | Narrowed out | Separate decision subject: ADR: Deterministic BUILD verification fan-out before model review |
| `adr-2026-07-29-engine-observed-provider-time-partition` | Narrowed out | Separate decision subject: ADR: Engine-observed provider intervals form an overlap-safe elapsed-time partition |
| `adr-2026-07-29-operator-park-scheduling-unit-boundary` | Narrowed out | Separate decision subject: ADR: Operator park drains one scheduling unit, then stops with a typed outcome |
| `adr-2026-07-29-ship-start-draft-pr` | Narrowed out | Separate decision subject: ADR: The implementation PR opens as a draft at SHIP-phase start |
| `adr-2026-07-30-contract-aware-same-file-wiring` | Narrowed out | Separate decision subject: ADR: Contract-aware same-file wiring requires symbol and root proof |
| `adr-2026-07-30-finish-only-mergeability-gate` | Narrowed out | Separate decision subject: ADR: Limit mergeability-first skipping to normal finish |
| `adr-2026-07-30-pinned-remote-theme-for-pages-navigation` | Narrowed out | Separate decision subject: ADR: Use a pinned remote theme for Pages navigation |
| `adr-2026-07-30-provider-preparation-lifecycle-supervision` | Narrowed out | Separate decision subject: ADR: Supervise provider preparation with fenced attempt identities |
| `adr-2026-08-01-bot-owned-release-pr` | Narrowed out | Separate decision subject: ADR: Use a bot-owned release PR as the sole pending-release writer |
| `adr-2026-08-01-conduct-state-mutation-port` | Narrowed out | Separate decision subject: ADR: Own conduct-state changes through an intent-bearing mutation port |
| `adr-2026-08-01-engine-owned-resumable-finish-publication` | Examined governing clauses | ADR: Engine-owned resumable FINISH publication from observed state |
| `adr-2026-08-01-engine-owned-scoped-test-invocation` | Narrowed out | Separate decision subject: ADR: Engine-owned scoped test invocation |
| `adr-2026-08-01-multi-proof-park-deletion-authority` | Narrowed out | Separate decision subject: ADR: Parked-feature deletion rests on a set of equal-strength proofs, and every refusal names its cause |
| `adr-2026-08-01-rebase-full-replay-intent-validation` | Narrowed out | Separate decision subject: ADR: Require full-replay intent validation for judgment-based rebase resolution |
| `adr-2026-08-01-scoped-run-verb-release-surface` | Narrowed out | Separate decision subject: ADR: The scoped-run verb ships without a migration block or waiver |
| `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` | Narrowed out | Separate decision subject: ADR: Manual dispatch now, reusable fail-closed gate mode reserved for release |
| `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` | Narrowed out | Separate decision subject: ADR: The live tier asserts pipeline outcomes, not scripted agent output |
| `adr-2026-08-02-plan-scope-containment-at-commit-boundary` | Narrowed out | Separate decision subject: ADR: Plan-scope containment enforced at the commit boundary |
| `adr-2026-08-03-build-repair-member-reuse-validity` | Narrowed out | Separate decision subject: ADR: A BUILD repair re-dispatches every verification member; reuse lives in the member's own evidence |
| `adr-2026-08-03-fail-closed-decide-entry` | Narrowed out | Separate decision subject: ADR: One fail-closed DECIDE-entry policy, consulted at every navigation seam |
| `adr-2026-08-03-ledgered-per-block-migration-execution` | Narrowed out | Separate decision subject: ADR: Ledgered, per-block migration execution |
| `adr-2026-08-03-uncommitted-work-floor-under-build-completion` | Narrowed out | Separate decision subject: ADR: Uncommitted work is a build-completion floor, enforced at both doors to `status:done` |
| `adr-2026-08-04-classify-before-spend-release-smoke-gate` | Narrowed out | Separate decision subject: ADR: Classify before spend — the release smoke gate runs once per release, not once per merge |
| `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` | Narrowed out | Separate decision subject: ADR: DECIDE mutates accepted `.docs/` artifacts directly, and never emits a task that mutates one |
| `adr-2026-08-04-live-tier-provisions-its-own-provider-home` | Narrowed out | Separate decision subject: ADR: The live tier provisions its own provider home from the checkout under test |
| `adr-2026-08-04-unresolved-step-command-fails-by-name` | Narrowed out | Separate decision subject: ADR: An unresolved step command fails by name — before spend, and at the provider boundary |
| `adr-2026-08-05-blocked-classification-after-dedup` | Narrowed out | Separate decision subject: ADR: Blocked classification runs after dedup, and the gauntlet is reordered to allow it |
| `adr-2026-08-05-blocked-is-a-distinct-state-from-halted` | Narrowed out | Separate decision subject: ADR: `BLOCKED` is a distinct daemon state, not an extension of `HALTED` |
| `adr-2026-08-05-build-settle-outcome-stamp` | Narrowed out | Separate decision subject: ADR: Build settle outcome stamp and pre-dispatch no-op refusal |
| `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` | Narrowed out | Separate decision subject: ADR: Every non-done dispatch outcome leaves an operator-clearable lever |
| `adr-2026-08-05-provenance-based-protected-artifact-inheritance` | Narrowed out | Separate decision subject: ADR: A protected artifact this branch never touched is inherited, whatever revision it is |
| `adr-2026-08-05-token-first-stories-reference-normalization` | Narrowed out | Separate decision subject: ADR: Token-first normalization of the plan `**Stories:**` reference |
| `adr-2026-08-05-worktree-classification-evidence-derived-reasons` | Narrowed out | Separate decision subject: ADR: Worktree dashboard classification and reasons are evidence-derived, never asserted |
| `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` | Narrowed out | Separate decision subject: ADR: A non-charging publication re-entry is bounded by its own allowance and a stuck-transition cap |
| `adr-2026-08-06-honest-park-termination-boundary` | Narrowed out | Separate decision subject: ADR: Honest park termination boundary |
| `adr-2026-08-06-publication-progress-is-its-own-disposition` | Narrowed out | Separate decision subject: ADR: Publication progress is its own disposition, not an exempted retry reason |
| `adr-2026-08-07-project-teardown-hook-contract-and-containment` | Narrowed out | Separate decision subject: ADR: Project teardown hook — contract, time bound, and failure containment |
| `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` | Narrowed out | Separate decision subject: ADR: Provider-neutral commit gate for protected DECIDE artifacts |
| `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` | Narrowed out | Separate decision subject: ADR: The release smoke gate goes live without pre-characterizing every previously-ungated file |
| `adr-2026-08-07-worktree-removal-coverage-guard` | Narrowed out | Separate decision subject: ADR: Worktree-removal coverage is enforced by an AST structural guard with an exemption registry |
| `adr-2026-08-08-finish-human-required-halt-rendering` | Narrowed out | Separate decision subject: ADR: FINISH human-required halts render reason, next action, and provider detail |
| `adr-2026-08-08-pipeline-owned-closeout-timestamps` | Examined governing clauses | ADR: Pipeline emits closeout events onto the bus from its own process |
| `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition` | Narrowed out | Separate decision subject: ADR: Repo-wide ADR conformance is a once-per-pass discovery precondition, reported per slug |
| `adr-2026-08-08-single-adr-approval-parser-three-rungs` | Narrowed out | Separate decision subject: ADR: One ADR-approval parser, read at three enforcement rungs |
| `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` | Narrowed out | Separate decision subject: ADR: Acceptance-RED lifecycle on the event spine, with provenance-bearing evidence |
| `adr-2026-08-09-adr-contradiction-detection-in-two-halves` | Narrowed out | Separate decision subject: ADR: ADR-versus-story contradiction detection is split across two DECIDE gates |
| `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal` | Narrowed out | Separate decision subject: ADR: The coherence `adr` layer is gated by a committed ADR signal, not always required |
| `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config` | Narrowed out | Separate decision subject: ADR: Bash reaches the `conductor:` block through `conduct-ts config`, never through PyYAML |
| `adr-2026-08-09-checkout-is-sole-version-identity-authority` | Narrowed out | Separate decision subject: ADR: The checkout is the sole version-identity authority |
| `adr-2026-08-09-conductor-block-single-source-of-truth` | Narrowed out | Separate decision subject: ADR: The schema-owned `conductor:` block is the single source of truth for update-check state |
| `adr-2026-08-09-declared-pattern-replication-in-build` | Narrowed out | Separate decision subject: ADR: Declared pattern replication — the copy is a plan task, and TDD pays only for the deltas |
| `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` | Narrowed out | Separate decision subject: ADR: Clearing the halt state removes the marker and the label together, and preserves draft |
| `adr-2026-08-09-hook-owned-containment-event-ledger` | Examined governing clauses | ADR: An unresolvable containment check is a ConductorEvent on a hook-owned sibling ledger |
| `adr-2026-08-09-legacy-json-seed-migration-rule` | Narrowed out | Separate decision subject: ADR: The legacy JSON seeds the YAML once and wins that seed; the rename is the idempotence marker |
| `adr-2026-08-09-non-blocking-plan-scope-containment` | Narrowed out | Separate decision subject: ADR: Plan-scope containment widens its floor and records rationale instead of refusing commits |
| `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` | Narrowed out | Separate decision subject: ADR: A feature branch has exactly one PR; a HALT is a state on it, never a second PR |
| `adr-2026-08-09-operator-only-scoped-artifact-reseal` | Narrowed out | Separate decision subject: ADR: Operator-only scoped reseal of protected DECIDE artifacts |
| `adr-2026-08-09-recorded-red-exception-for-remediation` | Narrowed out | Separate decision subject: ADR: A remediation waiver of the RED requirement must be recorded, attributable and observable |
| `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` | Narrowed out | Separate decision subject: ADR: The repo-wide ADR sweep is staged behind a default-off config key |
| `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` | Narrowed out | Separate decision subject: ADR: The reseal audit entry rides the existing event spine and audit-trail sink |
| `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator` | Narrowed out | Separate decision subject: ADR: rotation provenance is resolved outside the pure evaluator |
| `adr-2026-08-09-seal-rotation-authorship-predicate` | Narrowed out | Separate decision subject: ADR: seal rotation permission is authorship, not base-identity |
| `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` | Narrowed out | Separate decision subject: ADR: "Unverifiable" is triggered by no reachable tag, not by a missing record |
| `adr-2026-08-09-worktree-local-provider-scratch` | Narrowed out | Separate decision subject: ADR: Throwaway provider homes live in the worktree, reclaimed by lease-owner liveness |
| `adr-2026-08-11-deprecated-no-op-step-retirement` | Narrowed out | Separate decision subject: ADR: A step whose machinery is removed is retained as a deprecated no-op |
| `adr-2026-08-11-halt-events-ride-the-persisted-spine` | Narrowed out | Separate decision subject: ADR: Halt events ride the persisted spine, with a centrally stamped step |
| `adr-2026-08-12-cumulative-build-review-convergence-bound` | Narrowed out | Separate decision subject: ADR: build_review carries a cumulative convergence bound that tree movement cannot reset |
| `adr-2026-08-12-execution-lifecycle-completeness-for-timing` | Narrowed out | Separate decision subject: ADR: Every started execution closes on the ledger, or the rollup names why it could not |
| `adr-2026-08-12-fail-closed-intake-ledger-durability` | Narrowed out | Separate decision subject: ADR: Fail closed on an unparseable intake ledger, and serialize its writers with a lease |
| `adr-2026-08-12-live-provider-coverage-from-plugin-registry` | Narrowed out | Separate decision subject: ADR: Live-tier provider coverage is derived from the plugin registry, not a maintained list |
| `adr-2026-08-12-operator-reseal-as-second-scope-justification` | Narrowed out | Separate decision subject: ADR: An operator reseal is a second admissible Scope justification |
| `adr-2026-08-12-per-provider-live-smoke-legs` | Narrowed out | Separate decision subject: ADR: Live provider coverage is one smoke file per provider, and gate enforcement follows the credential |
| `adr-2026-08-12-removal-anchored-tautology-exemption` | Narrowed out | Separate decision subject: ADR: the Tautology rubric exempts removal maintenance, anchored to engine-computed removal evidence |
| `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns` | Narrowed out | Separate decision subject: ADR: A publication transition advances only when it moves the dimension it owns |
| `adr-2026-08-13-durable-base-advance-attribution` | Narrowed out | Separate decision subject: ADR: base-advance attribution is a durable spine record, not a gate-verdict field |
| `adr-2026-08-13-engine-managed-build-review-rubric-branches` | Narrowed out | Separate decision subject: ADR: Engine-managed build_review rubric branches with skill-owned judgement policy |
| `adr-2026-08-13-markdown-default-inversion` | Narrowed out | Separate decision subject: ADR: markdown is runtime source by default; only documentation paths are excluded |
| `adr-2026-08-13-stable-build-review-finding-dispositions` | Narrowed out | Separate decision subject: ADR: Stable per-finding build_review dispositions are typed, transactional operator state |
| `adr-2026-08-14-retire-build-review-wiring-rubric` | Narrowed out | Separate decision subject: ADR: The build_review wiring rubric is retired |
| `adr-2026-08-15-verify-only-anchored-tautology-exemption` | Narrowed out | Separate decision subject: ADR: the Tautology rubric exempts verify-only maintenance, anchored to engine-parsed plan markers |
| `adr-2026-08-16-closed-build-review-finding-vocabularies` | Narrowed out | Separate decision subject: ADR: Close the build_review finding-identity vocabularies |
| `adr-2026-08-16-preservation-anchored-completeness-exemption` | Narrowed out | Separate decision subject: ADR: the Completeness rubric exempts preservation maintenance, anchored to engine-derived removal evidence and a behavior-level plan clause |
| `adr-2026-08-16-restore-the-current-head-publication-fence` | Narrowed out | Separate decision subject: ADR: Restore the current-HEAD publication fence on the coordinator path |
| `adr-2026-08-17-framework-agnostic-tautology-scoped-run` | Narrowed out | Separate decision subject: ADR: the Tautology counterfactual is classified by exit code, never by runner output |
| `adr-2026-08-17-structural-live-checkout-containment` | Examined governing clauses | ADR: Contain the self-host dispatch instead of attributing live-checkout drift |
| `adr-2026-08-18-content-anchored-finding-reference-schema` | Narrowed out | Separate decision subject: ADR: Finding-identity references are content-anchored; a closed class-level reference schema for all four rubrics |
| `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` | Narrowed out | Separate decision subject: ADR: A mechanical rubric fault is its own lane — non-charging retry, then an operator reduced-coverage decision |
| `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` | Narrowed out | Separate decision subject: ADR: a rebase that invalidates build_review refunds its convergence laps; a PASS never clears them |
| `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` | Narrowed out | Separate decision subject: ADR: The engine stamps the rubric judged-result envelope; the provider returns only findings |
| `adr-2026-08-19-live-provider-stream-observation` | Examined governing clauses | ADR: The autonomous provider dispatch is observed as a live stream, not only at its result |
| `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` | Narrowed out | Separate decision subject: ADR: Returning a feature to an earlier step is an operator verb over the mutation port |
| `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` | Narrowed out | Separate decision subject: ADR: A tree-attesting gate re-checks its predicate before the loop honors a persisted `done` |
| `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` | Narrowed out | Separate decision subject: ADR: A step-runner failure whose inputs cannot change routes instead of retrying |
| `adr-2026-08-21-engine-identity-in-build-review-cache-key` | Narrowed out | Separate decision subject: ADR: The judging engine is part of the build_review cache identity |
| `adr-2026-08-21-review-bound-by-plan-done-when-criteria` | Narrowed out | Separate decision subject: ADR: build_review is bound by each plan task's Done when: criteria |
| `adr-2026-08-22-as-built-review-runs-always-with-plan-gap` | Narrowed out | Separate decision subject: ADR: The as-built architecture review runs always, with per-check policy and a PLAN_GAP verdict |
| `adr-2026-08-22-build-review-opt-in-rubric-container` | Narrowed out | Separate decision subject: ADR: build_review is an opt-in rubric container |
| `adr-2026-08-22-done-when-evidence-at-task-close` | Narrowed out | Separate decision subject: ADR: Done when: checks are evidenced at BUILD task close when the block exists |
| `adr-2026-08-22-one-owner-per-review-question` | Narrowed out | Separate decision subject: ADR: One owner per review question |
| `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` | Narrowed out | Separate decision subject: ADR: prd_audit judges stories as authority, runs always, and owns the only bounded kickback |
| `adr-2026-08-23-committed-halt-record` | Narrowed out | Separate decision subject: ADR: A halt writes a committed, pushed `.docs/halted/<slug>.md` record at the `writeHaltMarker` seam |
| `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote` | Narrowed out | Separate decision subject: ADR: A coverage claim is grounded by a verbatim quote, not re-judged at land |
| `adr-2026-08-23-criterion-layer-is-structural-at-land` | Narrowed out | Separate decision subject: ADR: The coherence `criterion` layer is structural, and all its strictness stays at land |
| `adr-2026-08-23-diff-locality-is-an-authored-disposition` | Narrowed out | Separate decision subject: ADR: Diff-locality is an authored disposition, not a detected property |
| `adr-2026-08-24-evidentiary-defects-are-not-waivable` | Narrowed out | Separate decision subject: ADR: The coherence waiver covers coverage gaps, not evidentiary defects |
| `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` | Examined governing clauses | ADR: The provider contract has one dispatch member; live observation is a seam on it |
| `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` | Narrowed out | Separate decision subject: ADR: OVER_SCOPE decision block and durable refusals |
| `adr-2026-08-24-refused-step-status` | Narrowed out | Separate decision subject: ADR: A typed `refused` step status distinct from `failed` |
| `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` | Narrowed out | Separate decision subject: ADR: Every non-REPL dispatch requests the machine envelope; live visibility comes from the stream observer |
| `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` | Narrowed out | Separate decision subject: ADR: As-built BLOCKED findings are classified per finding, and remediable ones take a bounded route to BUILD |
| `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot` | Narrowed out | Separate decision subject: ADR: A committed rate card prices codex dispatches, and the codex REPL is a bounded one-shot |
| `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity` | Narrowed out | Separate decision subject: ADR: Engine-stamped run identity for SHIP-tail verdict artifacts |
| `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` | Narrowed out | Separate decision subject: ADR: Config-key consumer registry and one-shot dead-surface removal |
| `adr-2026-08-26-music-vocabulary-player-composer-rename` | Narrowed out | Separate decision subject: ADR: v1.0 naming — engineer→Composer, ai-conductor as the canonical CLI; daemon stays |
| `adr-2026-08-26-remove-retrospectives-one-shot` | Narrowed out | Separate decision subject: ADR: Remove retrospectives (full and micro) in one shot |
| `adr-2026-08-26-setup-once-per-worktree-marker` | Narrowed out | Separate decision subject: ADR: Project setup runs once per worktree, gated by a content-addressed success marker |
| `adr-2026-08-26-shared-coherence-parser-at-discovery` | Narrowed out | Separate decision subject: ADR: Discovery consumes the shared coherence parser; the bespoke triple-scan is deleted |
| `adr-2026-08-27-daemon-dispatcher-executor-seam` | Narrowed out | Separate decision subject: ADR: Daemon dispatcher/executor seam with pinned-base work orders and policy-gated maintenance |
| `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` | Examined governing clauses | ADR: test_suite drift budget and verification mode |
| `adr-2026-08-29-build-review-remediate-case-adjudication` | Narrowed out | Separate decision subject: ADR: build_review failures fan in through one remediate case judgement |
| `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` | Narrowed out | Separate decision subject: ADR: Kickback budget recovery uses the existing needs-human halt class and typed ledger evidence |
| `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` | Narrowed out | Separate decision subject: ADR: mixed build_review laps preserve content adjudication |
| `adr-2026-08-29-operator-authorized-kickback-budget-recovery` | Narrowed out | Separate decision subject: ADR: Operator-authorized kickback budget recovery is a staged ledger decision consumed by daemon resume |
| `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded` | Narrowed out | Separate decision subject: ADR: Counterfactual sensitivity is judged from the excerpt, not decreed by exit code |
| `adr-2026-08-30-shared-plan-task-reference-resolver` | Narrowed out | Separate decision subject: ADR: Cited plan-task references resolve through one shared resolver, not per-consumer parses |
| `adr-2026-08-31-coverage-binding-judge-step` | Narrowed out | Separate decision subject: ADR: Coverage claims bind to `Done when`; a default-off pre-BUILD judge confirms the binding |
| `adr-2026-08-31-kickback-ledger-read-fails-closed` | Narrowed out | Separate decision subject: ADR: An unreadable kickback ledger fails closed, and audit history is separable from enforcement state |
| `adr-2026-09-02-adr-decision-citability-contract` | Narrowed out | Separate decision subject: ADR: ADR Decision Citability Contract |
| `adr-2026-09-05-gh-cli-version-floor-and-environment-gate` | Narrowed out | Separate decision subject: ADR: A declared `gh` version floor, enforced as a machine-level environment gate |
| `adr-2026-09-06-engine-owned-test-quality-scope` | Narrowed out | Separate decision subject: ADR: Engine-owned test-quality scope with explicit candidate judgment |
| `adr-2026-09-06-inbound-intake-trust-boundary` | Narrowed out | Separate decision subject: ADR: Inbound intake trust boundary — tracker text is evidence, never instruction |
| `adr-2026-09-06-reopened-task-resolution` | Narrowed out | Separate decision subject: ADR: Shared resolution of explicitly reopened task obligations |
| `adr-2026-09-07-durable-prd-widening-decision-reconciliation` | Narrowed out | Separate decision subject: ADR: Durable PRD widening decision reconciliation |
| `adr-2026-09-10-portable-build-review-policy` | Examined governing clauses | ADR: Portable build review policy with candidate-bound evidence and one repair authority |
| `adr-2026-09-10-separate-custom-review-coverage-identity` | Narrowed out | Separate decision subject: ADR: Separate custom review risk identity from reduced-coverage identity |
| `adr-2026-09-10-shared-step-lifecycle-telemetry` | Narrowed out | Separate decision subject: ADR: Shared lifecycle instrumentation for sequential and parallel telemetry |
| `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` | Narrowed out | Separate decision subject: ADR: Finish mergeability must respect active review inputs |
| `adr-2026-09-11-github-operation-ownership` | Examined governing clauses | ADR: Shared ownership authorization for GitHub and remote Git operations |
| `adr-2026-09-11-immutable-state-lease-recovery-succession` | Narrowed out | Separate decision subject: ADR: Immutable, owner-bound state-lease recovery succession |
| `adr-2026-09-11-selective-post-rebase-verification` | Narrowed out | Separate decision subject: ADR: Selective verification after a completed rebase |
| `adr-2026-09-20-halt-resolution-queue-derived-from-markers` | Narrowed out | Separate decision subject: ADR: The halt resolution queue is derived from halt markers; only operator deferrals persist |
| `adr-2026-09-20-operator-launched-sessions-retain-conductor-authority` | Examined governing clauses | ADR: Operator-launched provider sessions retain conductor authority |
| `adr-2026-09-23-engine-git-guard-on-agent-path` | Examined governing clauses | ADR: Engine-owned git argv guard on every agent PATH |
| `adr-2026-09-23-one-owner-for-accepted-story-readability` | Narrowed out | Separate decision subject: ADR: One owner for accepted-story readability, and one bullet primitive beneath it |
| `adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability` | Examined governing clauses | ADR: Provider admission is one gate over a daemon-scoped availability store |
| `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` | Examined governing clauses | ADR: One built-in provider catalog, boot-time provider discovery, and Pi as a third built-in |
| `adr-2026-09-24-project-owned-pr-body-regions` | Narrowed out | Separate decision subject: ADR: Project-owned pull request body regions are declared in the pull request template |
| `adr-2026-09-28-skills-may-bundle-executable-helpers` | Narrowed out | Separate decision subject: ADR: Shipped skills may bundle executable helpers |
| `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history` | Narrowed out | Separate decision subject: ADR: Automatic rebase flattens merge-bearing feature history along the first parent |
| `adr-2026-09-29-plan-slice-manifest` | Narrowed out | Separate decision subject: ADR: Plans declare ordered slices in one engine-validated manifest |
| `adr-2026-10-01-daemon-session-command-contracts` | Examined governing clauses | ADR: Daemon session command contracts and bounded mutation observation |
