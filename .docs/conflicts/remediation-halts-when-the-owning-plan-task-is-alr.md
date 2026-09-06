# Conflict check: Reopened task resolution (#1831)

**Status:** CLEAN — operator approved all five resolutions; post-approval re-check passed.
**Source:** jstoup111/ai-conductor#1831.
**Current stories:** `.docs/stories/remediation-halts-when-the-owning-plan-task-is-alr.md` (seven accepted stories).
**Governing decision:** `adr-2026-09-06-reopened-task-resolution` (approved).

The operator-approved architecture supplies the boundaries used below. This report requests review of their concrete application to older story assertions; it does not introduce a new completion authority. Five conflicts are documented with prepared corrections. No degrading compromise is proposed. Operator approval was received in this composer session. Re-reading the changed assertions against the accepted stories and the controlling ADR boundaries found zero unresolved blocking or degrading conflicts.

## Corpus and method

`conflict_check.adr_corpus` is `repo_wide` in `.ai-conductor/config.yml`. Inventory and text screening covered 366 story files, 52 spec files, 555 decision files, and 246 prior conflict reports. Those are corpus counts, not a claim that every unrelated artifact received detailed semantic review. Shared subjects were completion evidence, task restaging, repair admission, scope acceptance, state persistence, and bounded retries. Prior conflict reports were screened for recurrence of those subjects.

Detailed review concentrates on the contracts cited below and the ADR selection appendix. Supersession does not silently erase an old contract: partial or ambiguous successors retain the incorporated decisions, including budget recovery and build-review case adjudication. Legacy stamp derivation is read through the later telemetry/task-close decisions, not revived as a new gate.

## Interactions within the seven new stories

All six conflict classes were considered in both directions for these shared-subject groups:

| Pairs | Shared boundary and two-directional result |
| --- | --- |
| 1–2, 1–3, 1–4, 2–3, 2–4, 3–4 | Admission precedes dispatch; current evidence closes only its obligation; serialized durable mutations preserve siblings. Resolving one does not erase another or re-create a resolved replay. |
| 1–5, 2–5, 3–5, 4–5 | Effective acceptance is evaluated before actionable repair. It closes only its covered scope finding and survives restart; it neither substitutes for unrelated completion evidence nor requires reopening accepted-only work. |
| 1–6, 2–6, 3–6, 4–6, 5–6 | A passing effective review terminates. Unchanged unresolved failure retains pre-reopen baselines, lap bounds, and configured semantic-case authority. Replay is not a new lap; a budget grant is not acceptance. |
| 1–7, 2–7, 3–7, 4–7, 5–7, 6–7 | Diagnostics report the existing state transition or refusal without altering authority, recovery, accounting, or completion. Empty output cannot stand in for rejected work. |

This covers all 21 new-story pairs. The dangerous oscillation—reopen on historical completion, then refuse close because no tree movement—has an explicit exit through current task evidence plus a passing effective review. Accepted-only scope has an earlier exit without BUILD.

## Conflict: Historical trailers cannot permanently close an explicit current repair

**Files:** `.docs/stories/trailer-union-build-completion.md` versus `.docs/stories/remediation-halts-when-the-owning-plan-task-is-alr.md`.
**Type:** state-conflict. **Severity:** blocking before reconciliation.
**Confidence:** 99% — opposing acceptance text is explicit; repository code confirms the distinction.

**Prior opposing sentence (verbatim):**
> Given a plan id with no resolving row but a branch commit carrying `Task: <id>`, when `resolveTaskIds` runs, then that id is in the resolved set.

**New opposing sentence (verbatim):**
> Given old completion evidence for an explicitly reopened task, when completion is checked before the repair has supplied current evidence, then the task remains unresolved and the route is not refused as already complete.

**Description and prepared resolution:** The legacy union scenarios now explicitly exclude a current repair obligation. Every caller still shares one resolver; untouched tasks retain terminal-row/trailer resolution. The approved July 23 ADR amendment records the bounded exception. Satisfying repair freshness does not break legacy completion, and preserving legacy completion does not close an open repair.

**Resolution options:**
1. Apply the prepared boundary correction, consistent with the operator-approved ADR.
2. Remove historical trailer resolution for all tasks, expanding the change into a migration.
3. Abandon current repair obligations and append substitute tasks for every finding.

**Recommendation:** Option 1. It preserves existing behavior outside explicit repair and gives the approved work a reachable close.
**State:** Correction approved and re-checked; original text remains available in Git. No amendment note is added to story artifacts.

## Conflict: An unchanged tree must not halt a passing review

**Files:** `.docs/stories/every-as-built-blocked-verdict-halts-needs-human-i.md` versus `.docs/stories/remediation-halts-when-the-owning-plan-task-is-alr.md`.
**Type:** contradiction. **Severity:** blocking before reconciliation.
**Confidence:** 99% — opposing acceptance text is explicit; repository code confirms the distinction.

**Prior opposing sentence (verbatim):**
> Given a remediation lap whose rebuild produced no tree movement, when the no-op escalation check runs for the as-built gate, then the lap escalates to a halt instead of re-dispatching

**New opposing sentence (verbatim):**
> Given a repaired task with valid current completion evidence, when the governing effective review passes, then the repair cycle ends and the workflow advances even when no code-tree change was necessary.

**Description and prepared resolution:** The old as-built negative scenario now requires no net resolved progress and a still-failing unchanged effective review. The corresponding plan-growth story has the same correction. A passing review ends the cycle; pending-to-completed alone is not progress against the pre-reopen baseline.

**Resolution options:**
1. Apply the prepared boundary correction, consistent with the operator-approved ADR.
2. Require an artificial tree change even when current evidence and the review pass.
3. Disable no-progress escalation for all reopened work, allowing repeated unchanged failure.

**Recommendation:** Option 1. It preserves existing behavior outside explicit repair and gives the approved work a reachable close.
**State:** Correction approved and re-checked; original text remains available in Git. No amendment note is added to story artifacts.

## Conflict: Empty output and completed emitted work need distinct causes

**Files:** `.docs/stories/kickback-to-build-no-op-when-target-evidence-stamped.md` versus `.docs/stories/remediation-halts-when-the-owning-plan-task-is-alr.md`.
**Type:** overlap. **Severity:** blocking before reconciliation.
**Confidence:** 99% — opposing acceptance text is explicit; repository code confirms the distinction.

**Prior opposing sentence (verbatim):**
>   carries the blocking finding plus "remediation produced no dispatchable build work; the implicated
>   task(s) are already evidence-complete — human needed", and surfaces it via the existing
>   `surfaceRemediationPr` path — the build step is never re-entered for this round.

**New opposing sentence (verbatim):**
> Given remediation that emits no concrete work and no valid owning-task binding, when the route cannot proceed, then its diagnostic identifies empty output rather than claiming completed tasks prevented dispatch.

**Description and prepared resolution:** Story 2 now distinguishes genuinely empty output from emitted-but-refused or already-resolved work, retaining the finding and actual refusal cause. D1 in the July 13 ADR is amended additively beside its original diagnostic contract. The halt itself and existing event path remain.

**Resolution options:**
1. Apply the prepared boundary correction, consistent with the operator-approved ADR.
2. Keep one generic diagnostic and lose the issue’s requested distinction.
3. Introduce a separate reporting channel, contrary to the existing event-spine contract.

**Recommendation:** Option 1. It preserves existing behavior outside explicit repair and gives the approved work a reachable close.
**State:** Correction approved and re-checked; original text remains available in Git. No amendment note is added to story artifacts.

## Conflict: An admitted repair is dispatchable despite earlier completion

**Files:** `.docs/stories/kickback-to-build-no-op-when-target-evidence-stamped.md` versus `.docs/stories/remediation-halts-when-the-owning-plan-task-is-alr.md`.
**Type:** sequencing. **Severity:** blocking before reconciliation.
**Confidence:** 99% — opposing acceptance text is explicit; repository code confirms the distinction.

**Prior opposing sentence (verbatim):**
> - **Given** a repeat kickback for the same still-blocking gap, whose deterministic `rem-*` task id
>   already exists and is already evidence-complete (idempotent upsert, `remediation-append.ts:100-127`),
> - **When** the engine resolves the route to `build`,
> - **Then** build completion recomputed from disk is already satisfied and the engine does **not**
>   navigate back into a guaranteed no-op build (Story 2 governs the outcome).

**New opposing sentence (verbatim):**
> Given an admitted existing-task repair whose owning task has prior completion evidence, when the repair route is taken, then BUILD is dispatched for that task with the current finding and repair instruction, without appending a duplicate plan task.

**Description and prepared resolution:** The historical no-op scenarios now explicitly exclude an admitted open repair. Admission persists the obligation before completion is re-evaluated. Genuine no-work still halts; no duplicated task or extra lap is introduced.

**Resolution options:**
1. Apply the prepared boundary correction, consistent with the operator-approved ADR.
2. Bypass only the route guard while leaving the completion resolver able to skip repair.
3. Remove the no-dispatchable-work guard for every remediation route.

**Recommendation:** Option 1. It preserves existing behavior outside explicit repair and gives the approved work a reachable close.
**State:** Correction approved and re-checked; original text remains available in Git. No amendment note is added to story artifacts.

## Conflict: An accepted disposition cannot serve as the unknown-word example

**Files:** `.docs/stories/an-unrecognized-remediation-disposition-is-dropped.md` versus `.docs/stories/remediation-halts-when-the-owning-plan-task-is-alr.md`.
**Type:** contradiction. **Severity:** blocking before reconciliation.
**Confidence:** 99% — opposing acceptance text is explicit; repository code confirms the distinction.

**Prior opposing sentence (verbatim):**
> Given a planner output with AB-1 → `build` (with tasks) and AB-2 → `existing-task`, when remediation routing reads it, then AB-1 routes to `build` with its tasks appended exactly as it does today, one `remediation_disposition_rejected` event is emitted for AB-2, and the route's `evidence`/hint text mentions AB-2 as dropped.

**New opposing sentence (verbatim):**
> Given an unknown task reference or a finding not authorized for existing-task repair, when admission runs, then the engine refuses that repair with the finding and invalid ownership/authority identified and does not append substitute work or grant an extra lap.

**Description and prepared resolution:** The rejected-word examples now use `unsupported-disposition`. Current existing-task admission remains conditional on valid ownership and authority, while truly unsupported input retains its rejection event and diagnostic. This is a stale example correction, not a vocabulary expansion.

**Resolution options:**
1. Apply the prepared boundary correction, consistent with the operator-approved ADR.
2. Restore rejection of all existing-task outputs, undoing the approved repair route.
3. Stop reporting unsupported dispositions, losing existing failure diagnostics.

**Recommendation:** Option 1. It preserves existing behavior outside explicit repair and gives the approved work a reachable close.
**State:** Correction approved and re-checked; original text remains available in Git. No amendment note is added to story artifacts.

## Retained architectural boundaries

- `adr-2026-07-23-trailer-union-build-step-routing`: only explicit current repair gets a freshness constraint; all consumers still share resolution. Its approved additive amendments resolve the old unconditional union/no-pinned-boundary assertions.
- `adr-2026-07-13-kickback-build-no-op-escalation`: genuine no-work and unchanged unresolved failure remain bounded. Its amendments distinguish dispatchable current repair and actual refusal causes.
- `adr-2026-07-10-evidence-range-anchor-resolution`: ordinary plan-anchor fallback remains legacy behavior; the new explicit repair boundary is strict and cannot silently fall back to whole-branch history.
- `adr-2026-07-11-pipeline-state-durability`: state failure reaches existing typed refusal/HALT handling; the design does not introduce an uncaught-crash or parallel halt subsystem.
- `adr-2026-07-21-demote-task-stamping-to-telemetry` and `adr-2026-08-22-done-when-evidence-at-task-close`: no general stamp gate is restored; task close retains its evidence checks and permitted verify-only path.
- `adr-2026-08-22-one-owner-per-review-question`: repair routing is not a new judge; applicable task-close and governing review authority remain separate.
- `adr-2026-08-24-over-scope-decision-block-and-durable-refusals`: explicit valid acceptance closes only covered scope; refusal and invalid/inert clears do not accept anything.
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`: existing-task eligibility, consolidated manual-test precedence, and lap-only accounting remain intact.
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`: incorporated semantic-case adjudication still bounds repeated unresolved work; reopening is not a reset.
- `adr-2026-08-31-kickback-ledger-read-fails-closed`: repair persistence cannot interpret malformed present control state as legacy absence.

The architecture review already records documentation and verification obligations. These DECIDE corrections are applied now, not deferred as off-plan BUILD tasks.

## Approved re-check

The operator approved the five prepared resolutions. The changed legacy scenarios now exclude open current repair, the no-progress scenarios require an unchanged failing effective verdict, and the disposition example is outside the actual accepted vocabulary. The additive ADR notes preserve historical decisions while recording the approved exception. Repeating the shared-subject two-directional comparisons above leaves zero blocking conflicts and zero degrading compromises. Plan authoring may proceed. The review marker records approval rather than authorizing another lap or accepting implementation work.

## ADR selection inventory

The following records the repo-wide narrowing. “Retained subject candidate” means included for completion/recovery/gate comparison; it is not an assertion that every historical decision is still operative. The focused architectural comparisons above identify the controlling contracts. Other ADRs are narrowed out because their subject is outside current task repair, evidence, acceptance, persistence, or termination.

| ADR | Selection |
| --- | --- |
| `adr-002-engineer-store-and-retro-redirect` | Narrowed out: unrelated subject |
| `adr-003-registry-write-and-integration` | Narrowed out: unrelated subject |
| `adr-005-non-autonomy-and-read-only-governor` | Narrowed out: unrelated subject |
| `adr-006-flywheel-lesson-selection-and-provenance` | Narrowed out: unrelated subject |
| `adr-008-agent-hosted-loop-and-in-chat-authoring` | Narrowed out: unrelated subject |
| `adr-009-intake-adapter-port` | Narrowed out: unrelated subject |
| `adr-010-pidfile-lock-daemon-liveness` | Narrowed out: unrelated subject |
| `adr-011-async-intake-queue-and-github-source` | Narrowed out: unrelated subject |
| `adr-012-durable-intake-ledger-sole-dedup-authority` | Narrowed out: unrelated subject |
| `adr-014-otel-observability-exporter` | Narrowed out: unrelated subject |
| `adr-015-daemon-pr-labeling-sweep` | Narrowed out: unrelated subject |
| `adr-2026-06-29-architecture-before-stories-convergent-kickback` | Retained subject candidate |
| `adr-2026-06-29-brainstorm-rename-migration` | Narrowed out: unrelated subject |
| `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` | Narrowed out: unrelated subject |
| `adr-2026-06-29-explore-prd-split-track-in-explore` | Narrowed out: unrelated subject |
| `adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration` | Narrowed out: unrelated subject |
| `adr-2026-06-29-memory-resilience-write-fallback-and-reconcile` | Narrowed out: unrelated subject |
| `adr-2026-06-29-per-project-memory-provider-selection` | Narrowed out: unrelated subject |
| `adr-2026-06-29-per-provider-retrieval-guidance-location` | Narrowed out: unrelated subject |
| `adr-2026-06-29-platform-adoption-and-removal-surface` | Narrowed out: unrelated subject |
| `adr-2026-06-29-rebase-conflict-resolution-dispatch` | Narrowed out: unrelated subject |
| `adr-2026-06-29-safe-reversible-memory-migration` | Narrowed out: unrelated subject |
| `adr-2026-06-29-shared-memory-store-placement-and-durability` | Narrowed out: unrelated subject |
| `adr-2026-06-29-track-marker-location` | Narrowed out: unrelated subject |
| `adr-2026-06-30-background-intake-brain-loop` | Narrowed out: unrelated subject |
| `adr-2026-06-30-engineer-worktree-authoring-isolation` | Narrowed out: unrelated subject |
| `adr-2026-06-30-grandfather-cutover-merge-time` | Narrowed out: unrelated subject |
| `adr-2026-06-30-halt-based-release-gates` | Narrowed out: unrelated subject |
| `adr-2026-06-30-origin-seeded-intake-routing` | Narrowed out: unrelated subject |
| `adr-2026-06-30-owner-gate-identity-resolution` | Narrowed out: unrelated subject |
| `adr-2026-06-30-owner-provenance-recording` | Narrowed out: unrelated subject |
| `adr-2026-06-30-sandbox-build-isolation` | Narrowed out: unrelated subject |
| `adr-2026-06-30-self-host-detection-seam` | Narrowed out: unrelated subject |
| `adr-2026-07-01-machine-scoped-operator-identity` | Narrowed out: unrelated subject |
| `adr-2026-07-03-daemon-auto-restart-stale-engine` | Narrowed out: unrelated subject |
| `adr-2026-07-03-dependency-fail-closed-and-cache` | Narrowed out: unrelated subject |
| `adr-2026-07-03-dependency-gate-backlog-waiting-channel` | Narrowed out: unrelated subject |
| `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land` | Narrowed out: unrelated subject |
| `adr-2026-07-03-gated-snapshot-status-read-model` | Narrowed out: unrelated subject |
| `adr-2026-07-03-gated-writeback-announcements` | Narrowed out: unrelated subject |
| `adr-2026-07-03-generated-model-table-single-source` | Narrowed out: unrelated subject |
| `adr-2026-07-03-halt-pr-rehabilitation-at-finish` | Narrowed out: unrelated subject |
| `adr-2026-07-03-harness-daemon-profile` | Narrowed out: unrelated subject |
| `adr-2026-07-03-issue-dependencies-api-surface` | Narrowed out: unrelated subject |
| `adr-2026-07-03-owner-gate-gated-channel` | Narrowed out: unrelated subject |
| `adr-2026-07-03-post-rebase-force-with-lease` | Narrowed out: unrelated subject |
| `adr-2026-07-03-pr-timing-config-key` | Narrowed out: unrelated subject |
| `adr-2026-07-03-pr-timing-self-host-precedence` | Narrowed out: unrelated subject |
| `adr-2026-07-03-priority-fetch-fail-soft` | Narrowed out: unrelated subject |
| `adr-2026-07-03-priority-from-linked-issue-labels` | Narrowed out: unrelated subject |
| `adr-2026-07-03-prose-to-link-migration` | Narrowed out: unrelated subject |
| `adr-2026-07-03-reactive-model-fallback-ladder` | Narrowed out: unrelated subject |
| `adr-2026-07-03-version-gate-semver-escalation` | Narrowed out: unrelated subject |
| `adr-2026-07-04-auth-failure-park-and-poll` | Narrowed out: unrelated subject |
| `adr-2026-07-04-autoresolve-state-and-config` | Narrowed out: unrelated subject |
| `adr-2026-07-04-claim-time-delivery-evidence-guard` | Narrowed out: unrelated subject |
| `adr-2026-07-04-durable-pause-marker` | Narrowed out: unrelated subject |
| `adr-2026-07-04-event-driven-halt-clear-wake` | Narrowed out: unrelated subject |
| `adr-2026-07-04-kickback-event-emission-and-log-prominence` | Retained subject candidate |
| `adr-2026-07-04-operator-park-marker` | Narrowed out: unrelated subject |
| `adr-2026-07-04-park-unpark-cli-verbs` | Narrowed out: unrelated subject |
| `adr-2026-07-04-pending-restart-queue` | Narrowed out: unrelated subject |
| `adr-2026-07-04-resolution-worktree-lifecycle` | Narrowed out: unrelated subject |
| `adr-2026-07-04-respawn-in-place-restart` | Narrowed out: unrelated subject |
| `adr-2026-07-04-versioned-engine-store-atomic-flip` | Narrowed out: unrelated subject |
| `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep` | Narrowed out: unrelated subject |
| `adr-2026-07-05-daemon-rate-limit-episode-coordinator` | Narrowed out: unrelated subject |
| `adr-2026-07-05-engine-owned-task-status` | Retained subject candidate |
| `adr-2026-07-05-halt-pr-presentation-reliability` | Narrowed out: unrelated subject |
| `adr-2026-07-05-retry-as-escalation-ladder` | Narrowed out: unrelated subject |
| `adr-2026-07-05-standalone-bin-update` | Narrowed out: unrelated subject |
| `adr-2026-07-06-daemon-false-ship-guard` | Narrowed out: unrelated subject |
| `adr-2026-07-06-installed-root-resolution-for-global-writes` | Narrowed out: unrelated subject |
| `adr-2026-07-06-manual-test-fail-routing` | Narrowed out: unrelated subject |
| `adr-2026-07-06-migration-gate-waiver` | Narrowed out: unrelated subject |
| `adr-2026-07-06-stale-engine-respawn-in-place` | Narrowed out: unrelated subject |
| `adr-2026-07-07-audit-trail-event-sink` | Narrowed out: unrelated subject |
| `adr-2026-07-07-daemon-owned-build-credential` | Narrowed out: unrelated subject |
| `adr-2026-07-07-finish-record-primitive` | Narrowed out: unrelated subject |
| `adr-2026-07-07-ship-ci-feedback-loop` | Narrowed out: unrelated subject |
| `adr-2026-07-07-single-generation-stale-respawn` | Narrowed out: unrelated subject |
| `adr-2026-07-07-task-trailer-id-alias` | Retained subject candidate |
| `adr-2026-07-08-halt-issue-closure-sweep` | Narrowed out: unrelated subject |
| `adr-2026-07-08-main-checkout-leak-triage-and-write-fence` | Narrowed out: unrelated subject |
| `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify` | Narrowed out: unrelated subject |
| `adr-2026-07-09-deterministic-evidence-attribution-enforcement` | Narrowed out: unrelated subject |
| `adr-2026-07-09-setup-failure-triage` | Narrowed out: unrelated subject |
| `adr-2026-07-10-concurrent-group-core` | Narrowed out: unrelated subject |
| `adr-2026-07-10-daemon-stall-remediation` | Retained subject candidate |
| `adr-2026-07-10-evidence-range-anchor-resolution` | Retained subject candidate |
| `adr-2026-07-10-inline-work-attribution-enforcement` | Retained subject candidate |
| `adr-2026-07-10-intake-claim-priority-banding` | Narrowed out: unrelated subject |
| `adr-2026-07-10-intra-step-build-progress-events` | Narrowed out: unrelated subject |
| `adr-2026-07-10-observed-close-watch-registry` | Narrowed out: unrelated subject |
| `adr-2026-07-10-park-marker-main-root-resolution` | Narrowed out: unrelated subject |
| `adr-2026-07-10-retire-migration-grandfather` | Narrowed out: unrelated subject |
| `adr-2026-07-10-session-hook-task-stamping` | Retained subject candidate |
| `adr-2026-07-10-validation-group-join` | Retained subject candidate |
| `adr-2026-07-11-attribution-abstain-or-loud` | Narrowed out: unrelated subject |
| `adr-2026-07-11-attribution-spot-audit-measurement` | Narrowed out: unrelated subject |
| `adr-2026-07-11-attribution-verdict-interface` | Narrowed out: unrelated subject |
| `adr-2026-07-11-evidence-judge-cli-and-cutover` | Narrowed out: unrelated subject |
| `adr-2026-07-11-finish-step-engine-completion-machinery` | Narrowed out: unrelated subject |
| `adr-2026-07-11-pipeline-state-durability` | Retained subject candidate |
| `adr-2026-07-11-semantic-attribution-verification-lane` | Narrowed out: unrelated subject |
| `adr-2026-07-11-verdict-aware-resume-entry` | Narrowed out: unrelated subject |
| `adr-2026-07-12-judged-attribution-verdict-persistence` | Narrowed out: unrelated subject |
| `adr-2026-07-12-progress-aware-build-halt` | Retained subject candidate |
| `adr-2026-07-12-rebase-evidence-stamp-translation` | Narrowed out: unrelated subject |
| `adr-2026-07-12-wired-into-contract` | Narrowed out: unrelated subject |
| `adr-2026-07-12-wiring-check-gate` | Narrowed out: unrelated subject |
| `adr-2026-07-13-kickback-build-no-op-escalation` | Retained subject candidate |
| `adr-2026-07-13-park-all-dispatch-paths` | Narrowed out: unrelated subject |
| `adr-2026-07-13-retry-classify-rerun-vs-route` | Narrowed out: unrelated subject |
| `adr-2026-07-13-session-fresh-verdict-artifacts` | Narrowed out: unrelated subject |
| `adr-2026-07-17-verify-only-judged-closure` | Retained subject candidate |
| `adr-2026-07-20-bounded-dirname-path-corroboration` | Narrowed out: unrelated subject |
| `adr-2026-07-20-ci-fix-dispatch-via-steprunner` | Narrowed out: unrelated subject |
| `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification` | Narrowed out: unrelated subject |
| `adr-2026-07-20-post-rebase-delta-aware-invalidation` | Narrowed out: unrelated subject |
| `adr-2026-07-21-completeness-as-build-review-rubric` | Narrowed out: unrelated subject |
| `adr-2026-07-21-decide-time-unmerged-overlap-scan` | Narrowed out: unrelated subject |
| `adr-2026-07-21-demote-task-stamping-to-telemetry` | Retained subject candidate |
| `adr-2026-07-21-engine-owned-acceptance-red-execution` | Narrowed out: unrelated subject |
| `adr-2026-07-21-intake-only-enforcement` | Narrowed out: unrelated subject |
| `adr-2026-07-21-no-diff-task-evidence-stamp` | Retained subject candidate |
| `adr-2026-07-21-owner-stamped-at-authoring` | Narrowed out: unrelated subject |
| `adr-2026-07-21-s-tier-pipeline-knobs` | Narrowed out: unrelated subject |
| `adr-2026-07-21-serena-removal-path` | Narrowed out: unrelated subject |
| `adr-2026-07-22-attempts-counter-on-crash-recovery` | Narrowed out: unrelated subject |
| `adr-2026-07-22-auth-failure-classification-observed-401-patterns` | Narrowed out: unrelated subject |
| `adr-2026-07-22-build-dispatch-json-usage-capture` | Narrowed out: unrelated subject |
| `adr-2026-07-22-canonical-tagged-source-ref` | Narrowed out: unrelated subject |
| `adr-2026-07-22-canonical-tracker-client-seam` | Narrowed out: unrelated subject |
| `adr-2026-07-22-coherence-gate-placement-and-validation-split` | Narrowed out: unrelated subject |
| `adr-2026-07-22-coherence-waiver-and-duplicate-claim` | Narrowed out: unrelated subject |
| `adr-2026-07-22-daemon-level-missing-credential-gate` | Narrowed out: unrelated subject |
| `adr-2026-07-22-examples-state-isolation` | Narrowed out: unrelated subject |
| `adr-2026-07-22-gate-evidence-code-validity-on-redispatch` | Narrowed out: unrelated subject |
| `adr-2026-07-22-headless-vs-guided-examples` | Narrowed out: unrelated subject |
| `adr-2026-07-22-heartbeat-lease-deferred` | Narrowed out: unrelated subject |
| `adr-2026-07-22-intake-closed-issue-reconciliation` | Narrowed out: unrelated subject |
| `adr-2026-07-22-origin-refresh-before-engine-rebuild` | Narrowed out: unrelated subject |
| `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` | Narrowed out: unrelated subject |
| `adr-2026-07-22-per-task-work-happened-floor` | Retained subject candidate |
| `adr-2026-07-22-phase-scoped-docs-write-guard` | Narrowed out: unrelated subject |
| `adr-2026-07-22-requeue-claimed-distinct-from-reopen` | Narrowed out: unrelated subject |
| `adr-2026-07-22-stale-claim-staleness-window-default` | Narrowed out: unrelated subject |
| `adr-2026-07-22-token-liveness-probe-via-cli-invocation` | Narrowed out: unrelated subject |
| `adr-2026-07-23-build-review-fresh-base-disposition` | Narrowed out: unrelated subject |
| `adr-2026-07-23-commit-movement-liveness-floor` | Retained subject candidate |
| `adr-2026-07-23-intake-label-authority-scoped-replace` | Narrowed out: unrelated subject |
| `adr-2026-07-23-session-hook-repair-before-halt` | Narrowed out: unrelated subject |
| `adr-2026-07-23-trailer-union-build-step-routing` | Retained subject candidate |
| `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` | Narrowed out: unrelated subject |
| `adr-2026-07-25-content-addressed-full-suite-proof` | Narrowed out: unrelated subject |
| `adr-2026-07-25-custom-step-completion-artifacts` | Narrowed out: unrelated subject |
| `adr-2026-07-25-fail-closed-durable-shipment-evidence` | Narrowed out: unrelated subject |
| `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` | Narrowed out: unrelated subject |
| `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` | Narrowed out: unrelated subject |
| `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` | Retained subject candidate |
| `adr-2026-07-26-daemon-decide-preseed-ownership` | Narrowed out: unrelated subject |
| `adr-2026-07-26-event-sink-registry-exhaustiveness` | Narrowed out: unrelated subject |
| `adr-2026-07-26-protected-artifact-seal-rebaseline` | Narrowed out: unrelated subject |
| `adr-2026-07-26-rebase-tail-current-branch-before-publication` | Narrowed out: unrelated subject |
| `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` | Narrowed out: unrelated subject |
| `adr-2026-07-27-ancestry-proven-park-reconciliation` | Narrowed out: unrelated subject |
| `adr-2026-07-27-codex-never-resumes-a-harness-minted-session` | Narrowed out: unrelated subject |
| `adr-2026-07-27-cold-start-within-step-retries` | Narrowed out: unrelated subject |
| `adr-2026-07-27-cost-unmetered-is-a-first-class-state` | Narrowed out: unrelated subject |
| `adr-2026-07-27-daemon-decide-kickback-halt` | Retained subject candidate |
| `adr-2026-07-27-project-config-scaffolder` | Narrowed out: unrelated subject |
| `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` | Narrowed out: unrelated subject |
| `adr-2026-07-28-feature-aware-artifact-resolution` | Narrowed out: unrelated subject |
| `adr-2026-07-28-total-halt-classification-legacy-boundary` | Narrowed out: unrelated subject |
| `adr-2026-07-29-codex-readiness-probe-failure-disposition` | Narrowed out: unrelated subject |
| `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` | Narrowed out: unrelated subject |
| `adr-2026-07-29-deterministic-build-verification-fanout` | Narrowed out: unrelated subject |
| `adr-2026-07-29-engine-observed-provider-time-partition` | Narrowed out: unrelated subject |
| `adr-2026-07-29-operator-park-scheduling-unit-boundary` | Narrowed out: unrelated subject |
| `adr-2026-07-29-ship-start-draft-pr` | Narrowed out: unrelated subject |
| `adr-2026-07-30-contract-aware-same-file-wiring` | Narrowed out: unrelated subject |
| `adr-2026-07-30-finish-only-mergeability-gate` | Narrowed out: unrelated subject |
| `adr-2026-07-30-pinned-remote-theme-for-pages-navigation` | Narrowed out: unrelated subject |
| `adr-2026-07-30-provider-preparation-lifecycle-supervision` | Narrowed out: unrelated subject |
| `adr-2026-08-01-bot-owned-release-pr` | Narrowed out: unrelated subject |
| `adr-2026-08-01-conduct-state-mutation-port` | Narrowed out: unrelated subject |
| `adr-2026-08-01-engine-owned-resumable-finish-publication` | Narrowed out: unrelated subject |
| `adr-2026-08-01-engine-owned-scoped-test-invocation` | Narrowed out: unrelated subject |
| `adr-2026-08-01-multi-proof-park-deletion-authority` | Narrowed out: unrelated subject |
| `adr-2026-08-01-rebase-full-replay-intent-validation` | Narrowed out: unrelated subject |
| `adr-2026-08-01-scoped-run-verb-release-surface` | Narrowed out: unrelated subject |
| `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` | Narrowed out: unrelated subject |
| `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` | Narrowed out: unrelated subject |
| `adr-2026-08-02-plan-scope-containment-at-commit-boundary` | Narrowed out: unrelated subject |
| `adr-2026-08-03-build-repair-member-reuse-validity` | Narrowed out: unrelated subject |
| `adr-2026-08-03-fail-closed-decide-entry` | Narrowed out: unrelated subject |
| `adr-2026-08-03-ledgered-per-block-migration-execution` | Narrowed out: unrelated subject |
| `adr-2026-08-03-uncommitted-work-floor-under-build-completion` | Retained subject candidate |
| `adr-2026-08-04-classify-before-spend-release-smoke-gate` | Narrowed out: unrelated subject |
| `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` | Narrowed out: unrelated subject |
| `adr-2026-08-04-live-tier-provisions-its-own-provider-home` | Narrowed out: unrelated subject |
| `adr-2026-08-04-unresolved-step-command-fails-by-name` | Narrowed out: unrelated subject |
| `adr-2026-08-05-blocked-classification-after-dedup` | Narrowed out: unrelated subject |
| `adr-2026-08-05-blocked-is-a-distinct-state-from-halted` | Narrowed out: unrelated subject |
| `adr-2026-08-05-build-settle-outcome-stamp` | Narrowed out: unrelated subject |
| `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` | Narrowed out: unrelated subject |
| `adr-2026-08-05-provenance-based-protected-artifact-inheritance` | Narrowed out: unrelated subject |
| `adr-2026-08-05-token-first-stories-reference-normalization` | Narrowed out: unrelated subject |
| `adr-2026-08-05-worktree-classification-evidence-derived-reasons` | Narrowed out: unrelated subject |
| `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` | Narrowed out: unrelated subject |
| `adr-2026-08-06-honest-park-termination-boundary` | Narrowed out: unrelated subject |
| `adr-2026-08-06-publication-progress-is-its-own-disposition` | Narrowed out: unrelated subject |
| `adr-2026-08-07-project-teardown-hook-contract-and-containment` | Narrowed out: unrelated subject |
| `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` | Narrowed out: unrelated subject |
| `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` | Retained subject candidate |
| `adr-2026-08-07-worktree-removal-coverage-guard` | Narrowed out: unrelated subject |
| `adr-2026-08-08-finish-human-required-halt-rendering` | Narrowed out: unrelated subject |
| `adr-2026-08-08-pipeline-owned-closeout-timestamps` | Narrowed out: unrelated subject |
| `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition` | Narrowed out: unrelated subject |
| `adr-2026-08-08-single-adr-approval-parser-three-rungs` | Narrowed out: unrelated subject |
| `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` | Retained subject candidate |
| `adr-2026-08-09-adr-contradiction-detection-in-two-halves` | Narrowed out: unrelated subject |
| `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal` | Narrowed out: unrelated subject |
| `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config` | Narrowed out: unrelated subject |
| `adr-2026-08-09-checkout-is-sole-version-identity-authority` | Narrowed out: unrelated subject |
| `adr-2026-08-09-conductor-block-single-source-of-truth` | Narrowed out: unrelated subject |
| `adr-2026-08-09-declared-pattern-replication-in-build` | Narrowed out: unrelated subject |
| `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` | Narrowed out: unrelated subject |
| `adr-2026-08-09-hook-owned-containment-event-ledger` | Narrowed out: unrelated subject |
| `adr-2026-08-09-legacy-json-seed-migration-rule` | Narrowed out: unrelated subject |
| `adr-2026-08-09-non-blocking-plan-scope-containment` | Narrowed out: unrelated subject |
| `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` | Narrowed out: unrelated subject |
| `adr-2026-08-09-operator-only-scoped-artifact-reseal` | Narrowed out: unrelated subject |
| `adr-2026-08-09-recorded-red-exception-for-remediation` | Retained subject candidate |
| `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` | Narrowed out: unrelated subject |
| `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` | Narrowed out: unrelated subject |
| `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator` | Narrowed out: unrelated subject |
| `adr-2026-08-09-seal-rotation-authorship-predicate` | Narrowed out: unrelated subject |
| `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` | Narrowed out: unrelated subject |
| `adr-2026-08-09-worktree-local-provider-scratch` | Narrowed out: unrelated subject |
| `adr-2026-08-11-deprecated-no-op-step-retirement` | Narrowed out: unrelated subject |
| `adr-2026-08-11-halt-events-ride-the-persisted-spine` | Narrowed out: unrelated subject |
| `adr-2026-08-12-cumulative-build-review-convergence-bound` | Narrowed out: unrelated subject |
| `adr-2026-08-12-execution-lifecycle-completeness-for-timing` | Narrowed out: unrelated subject |
| `adr-2026-08-12-fail-closed-intake-ledger-durability` | Narrowed out: unrelated subject |
| `adr-2026-08-12-live-provider-coverage-from-plugin-registry` | Narrowed out: unrelated subject |
| `adr-2026-08-12-operator-reseal-as-second-scope-justification` | Narrowed out: unrelated subject |
| `adr-2026-08-12-per-provider-live-smoke-legs` | Narrowed out: unrelated subject |
| `adr-2026-08-12-removal-anchored-tautology-exemption` | Narrowed out: unrelated subject |
| `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns` | Narrowed out: unrelated subject |
| `adr-2026-08-13-durable-base-advance-attribution` | Narrowed out: unrelated subject |
| `adr-2026-08-13-engine-managed-build-review-rubric-branches` | Narrowed out: unrelated subject |
| `adr-2026-08-13-markdown-default-inversion` | Narrowed out: unrelated subject |
| `adr-2026-08-13-stable-build-review-finding-dispositions` | Narrowed out: unrelated subject |
| `adr-2026-08-14-retire-build-review-wiring-rubric` | Narrowed out: unrelated subject |
| `adr-2026-08-15-verify-only-anchored-tautology-exemption` | Retained subject candidate |
| `adr-2026-08-16-closed-build-review-finding-vocabularies` | Narrowed out: unrelated subject |
| `adr-2026-08-16-preservation-anchored-completeness-exemption` | Narrowed out: unrelated subject |
| `adr-2026-08-16-restore-the-current-head-publication-fence` | Narrowed out: unrelated subject |
| `adr-2026-08-17-framework-agnostic-tautology-scoped-run` | Narrowed out: unrelated subject |
| `adr-2026-08-17-structural-live-checkout-containment` | Narrowed out: unrelated subject |
| `adr-2026-08-18-content-anchored-finding-reference-schema` | Narrowed out: unrelated subject |
| `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` | Narrowed out: unrelated subject |
| `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` | Narrowed out: unrelated subject |
| `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` | Narrowed out: unrelated subject |
| `adr-2026-08-19-live-provider-stream-observation` | Narrowed out: unrelated subject |
| `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` | Narrowed out: unrelated subject |
| `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` | Narrowed out: unrelated subject |
| `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` | Narrowed out: unrelated subject |
| `adr-2026-08-21-engine-identity-in-build-review-cache-key` | Narrowed out: unrelated subject |
| `adr-2026-08-21-review-bound-by-plan-done-when-criteria` | Retained subject candidate |
| `adr-2026-08-22-as-built-review-runs-always-with-plan-gap` | Narrowed out: unrelated subject |
| `adr-2026-08-22-build-review-opt-in-rubric-container` | Narrowed out: unrelated subject |
| `adr-2026-08-22-done-when-evidence-at-task-close` | Retained subject candidate |
| `adr-2026-08-22-one-owner-per-review-question` | Retained subject candidate |
| `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` | Retained subject candidate |
| `adr-2026-08-23-committed-halt-record` | Narrowed out: unrelated subject |
| `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote` | Narrowed out: unrelated subject |
| `adr-2026-08-23-criterion-layer-is-structural-at-land` | Narrowed out: unrelated subject |
| `adr-2026-08-23-diff-locality-is-an-authored-disposition` | Narrowed out: unrelated subject |
| `adr-2026-08-24-evidentiary-defects-are-not-waivable` | Narrowed out: unrelated subject |
| `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` | Narrowed out: unrelated subject |
| `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` | Retained subject candidate |
| `adr-2026-08-24-refused-step-status` | Narrowed out: unrelated subject |
| `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` | Narrowed out: unrelated subject |
| `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` | Retained subject candidate |
| `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot` | Narrowed out: unrelated subject |
| `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity` | Narrowed out: unrelated subject |
| `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` | Narrowed out: unrelated subject |
| `adr-2026-08-26-music-vocabulary-player-composer-rename` | Narrowed out: unrelated subject |
| `adr-2026-08-26-remove-retrospectives-one-shot` | Narrowed out: unrelated subject |
| `adr-2026-08-26-setup-once-per-worktree-marker` | Narrowed out: unrelated subject |
| `adr-2026-08-26-shared-coherence-parser-at-discovery` | Narrowed out: unrelated subject |
| `adr-2026-08-27-daemon-dispatcher-executor-seam` | Narrowed out: unrelated subject |
| `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` | Narrowed out: unrelated subject |
| `adr-2026-08-29-build-review-remediate-case-adjudication` | Retained subject candidate |
| `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` | Retained subject candidate |
| `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` | Retained subject candidate |
| `adr-2026-08-29-operator-authorized-kickback-budget-recovery` | Retained subject candidate |
| `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded` | Narrowed out: unrelated subject |
| `adr-2026-08-30-shared-plan-task-reference-resolver` | Narrowed out: unrelated subject |
| `adr-2026-08-31-coverage-binding-judge-step` | Retained subject candidate |
| `adr-2026-08-31-kickback-ledger-read-fails-closed` | Retained subject candidate |
| `adr-2026-09-02-adr-decision-citability-contract` | Narrowed out: unrelated subject |
| `adr-2026-09-05-gh-cli-version-floor-and-environment-gate` | Narrowed out: unrelated subject |
| `adr-2026-09-06-reopened-task-resolution` | Retained subject candidate |
