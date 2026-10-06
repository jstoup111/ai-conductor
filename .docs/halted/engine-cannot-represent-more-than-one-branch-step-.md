# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-06T16:04:21.492Z
Slug: engine-cannot-represent-more-than-one-branch-step-
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-engine-cannot-represent-more-than-one-branch-step-
Head SHA: 14a615c678ab0df4bb467fa0313bcb24434ef68f
Halted at: 2026-10-06T15:29:55.823Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: plan tasks conflict with sealed criteria or ADR decisions.

Claim: adr-2026-08-01-multi-proof-park-deletion-authority#D8
Text: 8. **The shipped-record precondition is scoped by branch kind.** A candidate on a
   `feat/daemon-*` branch keeps the record-on-main precondition, because the daemon backlog
   dedups dispatch on that record. A candidate on any other branch is reclaimable on the proof
   set alone; no record is required or consulted for it, because no dispatch depends on one.
   This adds no proof to the set: nothing becomes deletable that both proofs would refuse.

**Amended 2026-09-21 by jstoup111/ai-conductor#2636 (spec `daemon-reclaim-sweep-deletes-a-worktree-that-holds`):**
the reclaim sweep removed an operator worktree holding uncommitted edits, on a freshly created
branch whose tip still equalled `origin/main`. The reason logged was `ancestry`. A branch with no
commits beyond its base and a fully merged branch are identical under
`git merge-base --is-ancestor`, because that test is true exactly when the branch tip is the merge
base. This amendment narrows what the set can delete; it adds no proof.
Task ids: 13
Done when checks: `requiresShippedRecord(branch)` returns true when `branch` is undefined or `isDaemonOwnedBranchName(branch)` is true, so it is true for `feat/c1/x`, `feat/daemon-x`, `feat/daemon-` and `undefined` and false for `spec/x`, and the sweep's `hasRecordGatedCandidate` prefetch treats a `feat/c1/x` worktree as record-gated, never as a non-daemon branch reclaimable on its deletion proofs alone, as asserted in `test/engine/park-reconciliation.test.ts`. | `RefusalReason` gains `child-branch`, and `reconcileMergedPark` returns `{ refusal: 'child-branch', steps: [] }` for a listed `feat/c1/x` branch immediately after the in-flight checks and before `gatherMergeEvidence`, the shipped-record precondition and any `gh pr list` lookup, so the injected `git` records no `ls-tree`, `merge-base`, `worktree remove` or `branch -d` call and the injected `gh` records zero calls. | `reconcileParkedFeatures` counts that outcome in `counts.refused` and `refusedByReason['child-branch']`, and emits `{ type: 'worktree_reclaim_failed', slug: 'x', branch: 'feat/c1/x', refusal: 'child-branch' }`, while `.worktrees/x` and branch `feat/c1/x` remain. | With a merged PR whose head is `feat/c1/x` and no `.docs/shipped/x.md` on `origin/main`, `requestRecordRepair` is never called and no `gh pr list --head` argv names `feat/c1/x`.
Conflict: Task 13 requires `feat/c1/x` to be record-gated by `requiresShippedRecord`, whereas the claim requires candidates on any non-`feat/daemon-*` branch to be reclaimable without requiring or consulting a shipped record.

Claim: adr-2026-09-29-plan-slice-manifest#D6
Text: 6. **`coverage_binding` slice layer: re-validation after amendment, with visible membership
   change.** Following the precedent of D17 in `adr-2026-08-31-coverage-binding-judge-step`, the
   `coverage_binding` runner calls `validatePlanSlices` on the plan it resolved.
   - **When it runs:** before the judge, whatever the judge's enabled key says, at every tier. That
     includes the re-run that D16's operator reseal triggers when the plan changed.
   - **An `invalid` result:** records `refused` and ends needs-human through the existing refusal
     path and halt writer. It names each violation, never appends a task, and never routes to
     `plan` (D6).
   - **Membership recording:** the runner records the engine-computed membership in the envelope
     as an optional field: task id → slice position, plus the ordered slice titles, excluding
     exempt ids. That field is kept when the envelope is invalidated. It is not completion evidence,
     leaves `COVERAGE_BINDING_COMPLETION_STATUSES` unchanged, and never enters the judge prompt.
   - **`plan_slices_changed`:** emitted only when the prior envelope recorded membership and the
     current membership differs. The event names the moved, added, and removed tasks, and whether
     the manifest was dropped. A manifest newly added to an unsliced plan has no prior membership,
     so it is a baseline (below) and emits nothing.
   - **Baseline:** a prior envelope with no recorded membership (legacy, first run, or a recreated
     worktree) is a baseline, per D19. It records membership and emits nothing.
   - **Unsliced plans:** the layer is inert for a plan that is unsliced both before and after.

**Amended 2026-10-03 by #2940:** (adr-2026-10-03-stacked-child-plans-identity-and-state decisions 5–7) The recorded membership is also the source
of a stacked feature's child identities: a child id is a declared slice position. The recovery
CLIs read it to validate `--child`, and later tickets read it to resolve the active child. It
remains non-completion evidence and still never enters the judge prompt. Once any child state or
child branch exists, declared positions must not change. #2942 implements the guard that halts a
reseal that would move them.
Task ids: 19
Done when checks: `src/conductor/src/types/events.ts` exports `ConductorEvent` as the existing union intersected with `{ child?: ChildId }` (`import type { ChildId } from '../engine/child-context.js'`), adds no event type, and `EVENT_SINKS` in `event-sinks.ts` still typechecks against `ConductorEvent['type']` with no new row. | `test/engine/event-persister.test.ts` asserts that for `step_started`, `step_completed` and `operator_rewind` emitted without a child, the persisted `events.jsonl` line contains no `child` substring and the parsed record has no `child` own property (neither `null` nor an empty value). | The same test asserts that an event built by spreading a persisted no-child `operator_rewind` record into a new event persists with no `child` own property, and that an event spread with `child: 2` persists a record whose parsed `child` is the number 2.
Conflict: It requires emitting a new `plan_slices_changed` ConductorEvent, while Task 19 requires no event type be added.

Claim: adr-2026-09-29-plan-slice-manifest#D7
Text: 7. **Event `plan_slices_changed` joins the persisted spine.** It is a new `ConductorEvent` member
   with an `EVENT_SINKS` row `{ render: false, persist: true, audit: false, otel: false }`. It is
   classified not-audited-by-design, like its `coverage_binding_*` siblings, because a slice move
   is a record of what changed, not an operator-friction record. It is not added to the OTel
   visualizer list or the metrics listener. A slice move is a new fact that no existing event
   carries, which is why it is a new type rather than an extra field. No sidecar log, marker, or
   timestamp is added.
Task ids: 19
Done when checks: `src/conductor/src/types/events.ts` exports `ConductorEvent` as the existing union intersected with `{ child?: ChildId }` (`import type { ChildId } from '../engine/child-context.js'`), adds no event type, and `EVENT_SINKS` in `event-sinks.ts` still typechecks against `ConductorEvent['type']` with no new row. | `test/engine/event-persister.test.ts` asserts that for `step_started`, `step_completed` and `operator_rewind` emitted without a child, the persisted `events.jsonl` line contains no `child` substring and the parsed record has no `child` own property (neither `null` nor an empty value). | The same test asserts that an event built by spreading a persisted no-child `operator_rewind` record into a new event persists with no `child` own property, and that an event spread with `child: 2` persists a record whose parsed `child` is the number 2.
Conflict: It requires a new `plan_slices_changed` ConductorEvent member and EVENT_SINKS row, while Task 19 requires no event type and no new EVENT_SINKS row.

Claim: adr-2026-09-11-github-operation-ownership#D5
Text: ### D5 — Remote Git writes carry the same constraints

Resolve actual push destination and all affected refs before authorization. Refuse ambiguous implicit destinations, broad/mirror pushes, or multi-ref writes with any unauthorized target before invoking a mutating transport. Named remote deletion is a write, as is a force-with-lease push. Preserve existing force-push restrictions and leases; ownership is an additional gate, not permission to weaken them.

Local reads, commits, and worktree actions remain on their existing paths. Owned publication may proceed when all affected remote targets are authorized; there is no requirement to centralize every local Git command.

**Clarified 2026-10-06 (operator decision, #2709):** the bot-auth credential fallback of D9 item 5
belongs to the guarded GitHub runner and remote Git adapter only. The observation wrapper of
adr-2026-10-01-daemon-session-command-contracts D7–D8 is not an authorized operation: it forwards an
agent's raw `gh` command exactly once and never falls back to another credential or re-runs it.

5. *Loud credential fallback, not a retry.* A typed bot-auth refusal is raised at the runner
   boundary as a result kind, never matched downstream on text (adr-2026-09-05 D5,
   adr-2026-08-18 D1). Its triggers are: the token file is missing or unreadable, `gh`
   reports 401, 403, or bad credentials, or git reports an authentication or permission
   denial. Each trigger uses conservative patterns backed by verbatim fixtures
   (adr-2026-07-22-auth-failure-classification-observed-401-patterns D1). On that refusal,
   and only then, the same authorized invocation runs once more with the operator's
   credential, and a warning event is emitted on the ConductorEvent spine. Because the
   operation, target, actor, and payload do not change, this is a substitution within one
   authorized call, not a D1 retry. It uses no retry budget and triggers no escalation
   (adr-2026-07-04 D2). Ambiguous failures, such as timeouts and transport errors, never fall
   back, so an external effect is never repeated (adr-2026-08-01-engine-owned-resumable-finish-publication

5. *No bot, no change.* With no bot configured, no co-author value is written and the helper
   adds nothing, so daemon commits stay byte-for-byte what they are today.
Task ids: 19
Done when checks: `src/conductor/src/types/events.ts` exports `ConductorEvent` as the existing union intersected with `{ child?: ChildId }` (`import type { ChildId } from '../engine/child-context.js'`), adds no event type, and `EVENT_SINKS` in `event-sinks.ts` still typechecks against `ConductorEvent['type']` with no new row. | `test/engine/event-persister.test.ts` asserts that for `step_started`, `step_completed` and `operator_rewind` emitted without a child, the persisted `events.jsonl` line contains no `child` substring and the parsed record has no `child` own property (neither `null` nor an empty value). | The same test asserts that an event built by spreading a persisted no-child `operator_rewind` record into a new event persists with no `child` own property, and that an event spread with `child: 2` persists a record whose parsed `child` is the number 2.
Conflict: The claim requires a new closed warning-event variant, while Task 19 requires adding no event type.

Claim: adr-2026-09-11-github-operation-ownership#D6
Text: ### D6 — Refusal is a first-class result

Return typed reasons for other-owner, unresolved actor, missing/ambiguous provenance, unsupported operation, and explicit authorization required. A refused sweep item must not prevent processing authorized items. A refused publication cannot be recorded as successfully pushed, handed off, or healed. No mutation fallback runs after refusal, including an escalation comment on the same unauthorized resource.

Emit ownership refusal through the existing ConductorEvent union, emitter, persister, and consumers. No new bespoke log schema or sidecar. Standalone commands render the same typed result to the operator through existing output facilities.

6. *Warning event.* The fallback event is a closed, structured `ConductorEvent` variant. It
   carries the operation, the target, and a closed reason (`token-unavailable`,
   `auth-refused`, `unsupported-remote-transport`). It carries no raw stderr, no token, and
   no token path. It is emitted through the same emitter that carries
   `github_operation_refused` for that call, and it declares its `EVENT_SINKS` routing
   exactly as that variant does.

6. *Fail open, loudly.* If the identity cannot be resolved (no readable token, or the read
   fails), the trailer is omitted, the commit proceeds, and a closed `ConductorEvent` variant
   is emitted on the existing spine with a closed reason and no token, token path, or stderr.
   The identity read never falls back to the operator's credential, since that would credit
   the wrong account.
Task ids: 19
Done when checks: `src/conductor/src/types/events.ts` exports `ConductorEvent` as the existing union intersected with `{ child?: ChildId }` (`import type { ChildId } from '../engine/child-context.js'`), adds no event type, and `EVENT_SINKS` in `event-sinks.ts` still typechecks against `ConductorEvent['type']` with no new row. | `test/engine/event-persister.test.ts` asserts that for `step_started`, `step_completed` and `operator_rewind` emitted without a child, the persisted `events.jsonl` line contains no `child` substring and the parsed record has no `child` own property (neither `null` nor an empty value). | The same test asserts that an event built by spreading a persisted no-child `operator_rewind` record into a new event persists with no `child` own property, and that an event spread with `child: 2` persists a record whose parsed `child` is the number 2.
Conflict: The claim requires a closed structured fallback-event variant, while Task 19 requires adding no event type.

Claim: adr-2026-08-01-scoped-run-verb-release-surface#D1
Text: 1. **The verb is implemented under `src/conductor/`** and registered in the existing dispatch in
   `src/conductor/src/index.ts`, alongside the sibling `test-suite` verb whose detection and
   dispatch sit at `src/index.ts:404-406`. No path under `src/conductor/` is in the table.
Task ids: 2
Done when checks: `src/conductor/src/engine/child-context.ts` exports `MAX_CHILD_ID` equal to 9 and `parseChildId`, which returns a branded `ChildId` for `1` through `9` and `undefined` for `0`, `10`, `two`, `-1`, `1.5` and the empty string, as asserted by `test/engine/child-context.test.ts`. | `pipelinePathFor(root, relative)` returns today's `.pipeline/<relative>` path and `pipelinePathFor(root, relative, child)` returns `.pipeline/children/<k>/<relative>` with the same file name, and `isRegionStep` is true for exactly `acceptance_specs`, `build`, `test_suite` and `build_review`. | `childStateExists(root, child)` is true only when `.pipeline/children/<k>/` is a directory, and `listExistingChildren(root)` returns the ascending child ids of the `children/` subdirectories `parseChildId` accepts, skipping `foo` and `12`, and returns an empty list without creating anything when `children/` is absent. | `test/engine/child-context.test.ts` imports `MAX_PLAN_SLICES` from `plan-slices.ts` and asserts `MAX_PLAN_SLICES <= MAX_CHILD_ID`, while `child-context.ts` imports no `plan-slices` module and contains no `stacked_prs` token, and `test/engine/plan-slices-consumer-boundary.test.ts` is unmodified.
Conflict: Task 2 requires `src/conductor/src/engine/child-context.ts`, contrary to the claim that no path under `src/conductor/` is in the table.
```
