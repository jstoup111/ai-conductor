# Architecture Review: Existing-task remediation restage survives the Task-trailer union (#2196)

**Date:** 2026-09-06
**Stem:** `existing-task-remediation-restage-is-undone-by-the`
**Mode:** lightweight (Tier M) — §2 Feasibility and §4 Alignment in full; §3/§5 skipped per tier
**Track:** technical · **Scope boundary (binding, from `.docs/track/`):** targeted — the
restage/trailer-union interaction only; #859 and the #647 D1 guard preserved; no change to evidence
stamps, kickback budgets, or other remediation dispositions
**Stories reviewed:** none yet (pre-stories review); input is the explore output and the approved
diagrams in `.docs/architecture/existing-task-remediation-restage-is-undone-by-the.md`
**Verdict:** APPROVED WITH CONDITIONS

## Design under review

An existing-task remediation flips a bound task's `.pipeline/task-status.json` row to `pending`
(`restageExistingRemediationTaskStatuses`, `conductor.ts`), but `resolveTaskIds`
(`task-progress.ts`) unions rows with every `Task:` trailer in the merge-base range, and the earlier
lap's trailer is permanent history. The build completion predicate reports done and the #647 D1
guard halts `derived-already-complete`.

**Fix — count-based restage watermark.** At restage, record per reopened id the number of trailered
commits already carrying that id, at `<mainRoot>/.daemon/restage-watermarks/<plan-stem>.json` —
outside the worktree, resolved with the park-marker primitive `resolveMainRepoRoot`. In `resolveTaskIds`, a watermarked id resolves from trailers only when
its trailer count has grown. Rows keep their meaning unchanged. Selected over a sha watermark
(the filer's hypothesis) because a sha comparison is exactly what adr-2026-07-23 Decision 4 forbids
inside the fold and is orphaned by rebase; a count is a plain integer test on the scan the fold
already performs and survives a 1:1 rebase.

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Pure engine change; no new packages, services, or infrastructure. |
| Prerequisites | None. `listCommitsWithTrailers` (`autoheal.ts`) already yields one record per commit with its `Task` trailers — verified by reading the function — so per-id counting is a change to the fold's aggregation, not to git plumbing. |
| Integration surface | Three engine modules (`conductor.ts` restage seam, `artifacts.ts` engine-state helpers, `task-progress.ts` fold) plus an additive optional field on the `kickback` event (`types/events.ts`). The fold has four consumers — build completion predicate, D1 no-op guard, stall circuit breaker via `countResolvedTasks`, and `build-progress-watcher.ts` — all of which are meant to move together (adr-2026-07-23 Decision 2). |
| Data implications | One new per-feature JSON file under the main root's `.daemon/` (already gitignored and live-boundary-excluded), tolerant-read, atomic write. No migration. |
| Performance risk | None new; the trailer scan already runs on every evaluation and the unmerged memoization spec (`spec/trailer-scans-re-spawn-identical-git-subprocess-fa`, keyed on HEAD sha) remains compatible — a restage does not change HEAD or the trailer set. |
| Worktree isolation | The file is keyed by plan stem at the main root, the same keying park markers use; one feature per stem, so concurrent worktrees never share a file. |

**Verified claims (read from source this session, ~95% unless noted):** the fold's row/trailer
union (`task-progress.ts:66-99`); the flattening `distinctTaskTrailerIds` that must become a per-id
count (`task-progress.ts:107-121`); the restage writing `pending` then re-seeding
(`conductor.ts:12880-12923`); the D1 guard consulting `checkStepCompletion('build')` after restage
(`conductor.ts:4703-4718`); `seedTaskStatus` preserving existing rows on an ordinary re-seed and
reading trailers only when reconstructing (`task-seed.ts:229-283`); the `Done when:` close contract
writing `status = 'completed'` rows (`task-progress.ts:262`), which is why no-diff/verify-only
closures need no exemption (~90% — inferred from the row branch of the fold); `rewind.ts` touching
neither engine-state nor task-status, so operator rewind has no interaction to clear; a
recreated worktree's `seedTaskStatus` restoring trailered tasks as `completed` rows
(`task-seed.ts:342-358`), which is why a worktree-resident watermark could not fail closed —
there would be no trace left to fail on; `resolveMainRepoRoot` in `park-marker.ts:48`
(`git rev-parse --git-common-dir`) as the reusable main-root resolver.

**Assumption (surfaced):** the harness rebase (`performRebase`, adr-2026-07-12 patch-id map) replays
commits 1:1 and never squashes — ~85%, inferred from the ADR. Impact if wrong: a squashed branch
lowers a watermarked id's count and the task stays unresolved until a new trailered commit lands —
fail-closed toward re-dispatch, never a false done. Acceptable under adr-2026-07-20's "when in
doubt, widen toward re-run".

## Alignment

Full sweep of all 306 ADRs in `.docs/decisions/` (two delegated passes, no keyword narrowing).
No ADR forbids the design. Governing decisions and how the design satisfies them:

- **adr-2026-08-25-as-built-remediable-findings-bounded-build-route Decision 9** — requires every
  `existing-task` kickback to re-stage its bound ids effectively, fail-closed, "otherwise the next
  dispatch sees the bound tasks still done and the kickback delivers nothing." This feature is the
  missing half of that decision; it changes no text.
- **adr-2026-07-23-trailer-union-build-step-routing** — D1 (trailers are routing telemetry, never
  completion authority): the watermark only withholds a trailer resolution, never grants one. D2
  (one definition, all consumers): the change lives in `resolveTaskIds`, so predicate, guard,
  breaker, and watcher agree. D4 (plain trailer-id fold, no sha reachability / pinned stamps /
  attribution): satisfied by construction — the count is aggregated from the same scan; no sha is
  stored or compared. D5 (fail-closed gate, fail-soft trailer read): unchanged.
- **adr-2026-07-13-kickback-build-no-op-escalation** (#647 D1/D3) — the guard is not weakened or
  bypassed; its input becomes truthful. A round that stages nothing records no watermark and still
  halts `derived-already-complete`. Its Non-goals reject per-task stamp invalidation; the watermark
  is a resolution-time filter, not stamp invalidation.
- **adr-2026-07-21-demote-task-stamping-to-telemetry** — no per-task evidence derivation is
  revived; the watermark is a suppression window on routing telemetry.
- **adr-2026-08-03-uncommitted-work-floor-under-build-completion D1/D3** — copied shape: withhold
  only; open on absence.
- **adr-2026-07-05-engine-owned-task-status H6/H7** — durable engine state goes in the engine
  sidecar (`engine-state.json`), written by the engine at the restage seam, never by an agent.
- **adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch D3** — the completion re-check
  reads; the watermark is written only at the restage seam, never inside the predicate.
- **adr-2026-07-26-cross-dispatch-kickback-livelock-bound D1** and its accepted "#497 class" note,
  repeated by adr-2026-08-12 and adr-2026-08-18 — the tolerant-read / atomic-write conventions for
  a durable `.pipeline/` field, and the precedent that loss on worktree recreation fails open.
- **adr-2026-08-31-kickback-ledger-read-fails-closed D1** — absent ≠ corrupt: an absent file means
  no task was ever restaged for this feature; a present-but-unparseable file must not read as "no
  watermarks". Condition 2.
- **adr-2026-08-12 D5 / adr-2026-08-18 D3 / adr-2026-07-26-event-sink-registry-exhaustiveness** —
  a durable `.pipeline/` control field is legal only when the occurrence is also emitted; prefer an
  additive optional field on the existing `kickback` event over a new union member (no new sink
  declaration needed). Condition 3.
- **adr-2026-07-06-manual-test-fail-routing (#1987 amendment)** and **adr-2026-07-10-validation-group-join** —
  restage sites are skip-preserving. The existing restage already writes only `pending` for bound
  ids; the watermark write rides that same seam.
- **adr-2026-08-30-shared-plan-task-reference-resolver D1** — stored ids are the canonical ids the
  admission seam already resolved (`resolveExistingTaskBindingsForAdmission`); no new parse.
- **adr-2026-08-22-one-owner-per-review-question** — `prd_audit` at SHIP remains completion
  authority; this is handoff routing only and is not argued as a completion check.
- **adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main** — a reconstructed
  worktree rebuilds rows from trailers (`task-seed.ts` reconstructing branch), restoring every
  restaged task as `completed` — and a `completed` row resolves through the fold's row branch,
  bypassing the trailer watermark. The reconstruction branch of `seedTaskStatus` therefore also
  consults the watermark (found at plan time): a watermarked id whose count has not grown is
  restored `pending`, not `completed`. Ordinary re-seeds read nothing new (Condition 4).
- **Storage location** (revised at conflict-check, operator decision 2026-09-06).
  adr-2026-07-10-park-marker-main-root-resolution put per-feature control state at the main root
  because worktree-scoped state vanished on recreate. That is exactly the watermark's failure:
  reconstruction leaves no trace of the restage, so a `.pipeline/`-resident record could neither
  survive nor fail closed. The watermark therefore reuses the park-marker carrier and resolver;
  `mid-loop-pipeline-wipe-549` Story 6's "never silently converge green on absent state" is met
  without a new halt. `.daemon/` is excluded from the self-host live boundary (CLAUDE.md), so the
  write is safe during self-host builds. No ADR needed — the carrier and its rationale are already
  decided.

**ADR decision:** no new ADR and no amendment. The structural prerequisite (§7) is not met: no
boundary, decomposition, integration seam, or persistence model is created or revised — the change
adds one field to an existing engine-owned sidecar and one comparison to an existing fold, under
decisions already recorded in adr-2026-07-23 and adr-2026-08-25. The operator confirmed this
disposition on 2026-09-06.

**Diagram accuracy:** `.docs/architecture/existing-task-remediation-restage-is-undone-by-the.md`
and its sequence reflect the count-based design and render (`render-diagrams --check`).

**Focused local pattern basis.** The watermark store should replicate the semantic traits of the
park-marker store in `park-marker.ts`: main-root resolution through `resolveMainRepoRoot`, a
per-feature file under `.daemon/` keyed by the feature's stem, atomic temp+rename write, and a
tolerant read where an absent file is the empty base case. From the `appendedRemediationTaskIds`
pair in `artifacts.ts` (`recordAppendedRemediationTaskIds` / `readAppendedRemediationTaskIds`) it
keeps string-id filtering and merge-on-record. Allowed variation: the value shape is `id → count`;
the corrupt-file rung abstains loudly rather than failing open (Condition 2). Rediscovery hints:
`park-marker.ts` symbol `resolveMainRepoRoot`; `artifacts.ts` symbols
`recordAppendedRemediationTaskIds`, `readAppendedRemediationTaskIds`; `conductor.ts` symbol
`restageExistingRemediationTaskStatuses`.

## Wiring Surface

| New/changed surface | Called from in production |
|---|---|
| Watermark record helper (main-root `.daemon/restage-watermarks/<stem>.json` write, new `restage-watermark.ts`) | `restageExistingRemediationTaskStatuses` in `conductor.ts`, invoked by the remediation route after admission and before the D1 guard. |
| Watermark read helper (main-root file read, same module) | `resolveTaskIds` in `task-progress.ts` — and through it the build completion predicate (`artifacts.ts` `build:`), the D1 guard, `countResolvedTasks` (stall breaker, kickback baselines, re-kick eligibility), and `build-progress-watcher.ts`. |
| Per-id trailer count in the fold | Replaces the flattened set inside `resolveTaskIds`; same callers. |
| Watermark-aware reconstruction | The `reconstructing` branch of `seedTaskStatus` (`task-seed.ts`), invoked at build entry and by every re-seed when no usable `task-status.json` exists. |
| Additive optional restage field on the `kickback` event | Emitted at the restage seam through `ConductorEventEmitter`; persisted by the existing `EventPersister` to `.pipeline/events.jsonl`; no new sink. |

Overlap scan (advisory): `conductor.ts`/`artifacts.ts` overlap with most open spec branches (noise).
The one material neighbour is `spec/trailer-scans-re-spawn-identical-git-subprocess-fa`, which
memoizes `listCommitsWithTrailers` on HEAD sha and does not alter its record shape — compatible.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Count lowered by an off-process squash leaves a restaged task unresolved | Data | Low | Low | Fails toward re-dispatch, never false done; a new trailered commit clears it; note in the runbook. |
| Kickback baselines captured via `countResolvedTasks` before the restage misread the post-restage drop as movement | Technical | Medium | Medium | Story: baselines for the round are captured after the restage, or the no-op classifier compares against the watermarked count. Verify in `classifyBuildProgress` consumers. |
| Corrupt watermark file read as "no watermarks" silently reopens the defect | Data | Low | Medium | Condition 2 — corrupt abstains loudly, distinct from absent. |
| Main root unresolvable (non-git dir, detached test fixture) | Technical | Low | Medium | Record fails the restage closed (`needs-human`, like a missing bound id); read degrades to "no watermarks" only when the feature never restaged. Tests inject the root. |
| Stale watermark file outlives the feature (shipped, parked, abandoned) | Data | Medium | Low | Same lifecycle as park markers: removed by the existing feature-teardown/shipped-record path; a stale file for a stem that no longer exists is inert. |

## ADRs Created

None. Governing: adr-2026-07-23-trailer-union-build-step-routing (D1, D2, D4, D5),
adr-2026-08-25-as-built-remediable-findings-bounded-build-route (D9),
adr-2026-07-13-kickback-build-no-op-escalation (D1, D3). No amendment required.

## Conditions

1. **Watermark scopes the trailer branch only.** A row in `completed`/`skipped` state still
   resolves; no exemption logic for no-diff or verify-only closures is added.
2. **Absent ≠ corrupt.** An absent watermark file → no watermarks (nothing was ever restaged for
   this stem). A present but unparseable file → every id it might name is treated as unresolved
   and a diagnostic is emitted; never the more permissive reading.
3. **Emit on the spine.** The restage emits the reopened ids and their recorded counts as an
   additive optional field on the existing `kickback` event, once per restage mutation, from the
   restage seam. No new event member, no sidecar file.
4. **The watermark outlives the worktree.** It is written under the main root's `.daemon/` via
   `resolveMainRepoRoot`, keyed by plan stem, and read by both the fold and the reconstruction
   branch of `seedTaskStatus`, so a recreated worktree restores a reopened task as `pending` and
   still sees it unresolved. The record fails closed (`needs-human`) when the main root cannot be
   resolved.
5. **Baselines are post-restage.** The #647 no-op baselines and stall-breaker counts for the round
   are captured after the watermark is recorded, so the deliberate count drop is not misread as
   movement or stall.
6. **Regression fixtures preserved.** The #859 shape (all tasks trailer-resolved, zero completed
   rows ⇒ build done) and the genuine no-op round (nothing restaged ⇒ `derived-already-complete`)
   keep passing unchanged.
