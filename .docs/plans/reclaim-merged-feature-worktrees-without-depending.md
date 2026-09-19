# Implementation Plan: Reclaim merged feature worktrees without depending on the mergeable watch registry

**Date:** 2026-09-14
**Stories:** .docs/stories/reclaim-merged-feature-worktrees-without-depending.md
**Stories status:** Accepted; Stories 1–8
**Design:** .docs/decisions/architecture-review-2026-09-14-reclaim-merged-feature-worktrees-without-depending.md
**Conflict check:** PASS, 2026-09-14; .docs/conflicts/reclaim-merged-feature-worktrees-without-depending.md
**Source:** jstoup111/ai-conductor#1510
**Tier:** M
**Track:** technical

## Summary

**Amendment 2026-09-17 (prd_audit PLAN_GAP S2.1/S2.3/S2.5/S2.6):** Story 2 guards (in-flight, live or unreadable `.pipeline/HALT`) apply to operator-parked candidates too. Story 8's preservation criterion and Task 11's preservation check now carve out guard-retained parked slugs, so Task 5's unconditional guard and Task 11's parked-path preservation no longer contradict.

Eleven scoped tasks widen the existing parked-feature reconciliation sweep so it enumerates every git-registered worktree under `.worktrees/`, hands each surviving candidate one at a time to the existing guarded helper `reconcileMergedPark`, scopes the shipped-record precondition to `feat/daemon-*` branches, and records every outcome on the event spine behind a boolean config key. No new removal module is introduced.

## Technical Approach

- **One module widened, no new deleter.** `park-reconciliation.ts` already owns the multi-proof deletion authority (ancestry or merged-PR head identity), the project-teardown invitation, the refusal taxonomy, and branch deletion. The sweep's candidate source changes from `listOperatorParkedSlugs` alone to that set unioned with `listRegisteredWorktrees` — a new prefetch over `git worktree list --porcelain` that returns `{ slug, branch }` for depth-1 entries under `.worktrees/`. A flat `readdir` is never used: it cannot supply the branch and it misreads the nested `feat/…` and `fix/…` paths that exist today.
- **Proofs keyed on the listed branch.** `reconcileMergedPark` gains an optional `branch`; when present, evidence is gathered for that ref rather than for a branch whose final path segment equals the slug. This is what makes `hotfix-x`/`hotfix/x` and `<slug>`/`feat/daemon-<slug>` resolvable. Without `branch` the helper behaves exactly as today, so the operator verb and the parked path are unchanged.
- **Record precondition by branch kind.** `requiresRecord` is true for an absent branch (today's parked semantics) or a `feat/daemon-*` branch; otherwise a proven-merged candidate is reclaimed without a record and no repair is requested. The proof gate above it is untouched.
- **Exclusions live in the sweep, before the helper,** in this order: in-flight (`isFeatureInFlight` from the sweep context), `engineer-*`/`resolve-*` prefix, `SINGLE_SLUG`, live or unreadable `.pipeline/HALT`, park-marker read error. Each is a `retained` disposition with a closed-union reason. A `null` worktree listing retains every candidate for the pass.
- **Unpark is conditional** on an existing marker, so a never-parked candidate cannot fail with `unpark-failed`.
- **Outcomes ride the spine.** Three `ConductorEvent` variants are appended at the end of the union and declared in `EVENT_SINKS` (`retained` is `render: false, persist: true` so ~60 retentions per boundary do not flood the log; `reclaimed`/`failed` render). The daemon log line is a rendering; the daemon-root `events.jsonl` is the durable record, which matters because a reclaimed worktree's own ledger dies with it.
- **Gate.** `reclaim_merged_worktrees` (boolean, default `true`) has the same semantics as its sibling `reconcile_parked_auto_cleanup`: it changes who initiates, never what is checked. Off, enumerated candidates are still evaluated and emitted as `disabled`, giving a report-only first pass.
- **Local pattern to preserve** (search hints: `listShippedStemsOnMain`, `listBranchesBySlug`, `gatherMergeEvidence`, `reconcileMergedPark`, `sweepSummarySignatures` in `park-reconciliation.ts`; `sweepFeatureWorktreeScratch` in `self-host/provider-scratch.ts` for the readdir → reclaimed/retained → event shape): listings read once per pass and tolerate failure with `null`; per-slug error isolation; the helper re-derives evidence and never trusts the sweep's classification; outcomes counted once and summarized with a de-duplication signature. Allowed variation: the candidate source, the evidence key, and the added event emission. Tests use the existing `GitWorld` fake in `park-reconciliation.test.ts`; no test starts a provider, a real daemon loop, or the network.
- **Sequencing.** Listing helper and helper extensions first (Tasks 1–4), then the sweep widening and gate (5–6), then the spine (7–8) and config (9), then the composition-root integration (10) and the pinning tests (11).

## Non-goals

- No on-demand operator command reporting per-worktree reclaimability (intake Desired-outcome #4 is deferred by operator decision).
- No change to `mergeable-sweep.ts`; its registry-driven reap stays as a second, now-redundant automatic path.
- No repair of watch-registry enrollment coverage or of its 100-entry trim.
- No reclamation of `engineer-*` or `resolve-*` worktrees; they are owned by their own lifecycles.

## Prerequisites

- Accepted eight-story artifact, approved architecture review, and clean conflict report above.
- Amendments to adr-2026-08-01 (D6–D8), adr-2026-07-29 (D8–D9), and adr-2026-07-27 (notes) are committed on the spec branch as part of this DECIDE change; BUILD never edits them.
- Each task performs scoped RED/GREEN with `ai-conductor scoped-run`. BUILD entry owns acceptance specs; `test_suite` and SHIP own aggregate verification. No terminal validation task is included.

## Tasks

### Task 1: Enumerate registered worktrees from the porcelain listing

**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in a new `park-reconciliation-worktree-listing.test.ts` with a scripted `git worktree list --porcelain` output containing: three depth-1 entries under `<root>/.worktrees/`, one nested entry `<root>/.worktrees/feat/daemon-x`, the project root itself, one entry under `<root>/.claude/worktrees/x`, and a `detached` entry. Assert the returned candidates are exactly the depth-1 entries, each `{ slug, branch }` with the branch taken from the `branch refs/heads/...` line, and that nested/outside/detached entries are absent. Assert a rejected runner returns `null`.
2. Verify RED. Implement `listRegisteredWorktrees(runGit, projectRoot)` in `park-reconciliation.ts` beside `listBranchesBySlug`: run `worktree list --porcelain`, split records on blank lines, keep records whose `worktree` path's parent is exactly `join(projectRoot, '.worktrees')`, derive `slug` from the basename and `branch` from the `branch` line with the `refs/heads/` prefix stripped; a detached record has no branch and is excluded; any thrown error returns `null`. Follow the module's prefetch trait: read once per pass, tolerate failure with `null`, never throw.
3. Verify GREEN. Commit: "feat(park-reconciliation): enumerate registered worktrees from the porcelain listing".

**Done when:**
- `listRegisteredWorktrees` returns one `{ slug, branch }` per depth-1 registered worktree under `.worktrees/` with the branch read from the porcelain `branch` line, as asserted by the depth-1 listing test
- `listRegisteredWorktrees` excludes a nested path, a path outside `.worktrees/`, and a detached worktree, as asserted by the exclusion test, so none of them can become a candidate
- `listRegisteredWorktrees` returns `null` when the git runner rejects, as asserted by the listing-failure test, and never throws

**Files:**
- `src/conductor/src/engine/park-reconciliation.ts`
- `src/conductor/test/engine/park-reconciliation-worktree-listing.test.ts`

**Dependencies:** none

### Task 2: Key merge evidence on the listed branch

**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `park-reconciliation-merge-evidence.test.ts` using the existing `GitWorld` fake: (a) slug `hotfix-x` with listed branch `hotfix/x` contained in origin/main is proven by ancestry with no gh call; (b) slug `<slug>` with listed branch `feat/daemon-<slug>` not contained but whose MERGED PR `headRefOid` equals the tip is proven by head identity; (c) with a listed branch, the branch deleted at the end is the listed one even when another local branch shares the slug's final segment; (d) refusals `no-merge-proof`, `unmerged-commits` (naming commits), `branch-missing` (no branch and no record), and gh capability error → `no-merge-proof` each leave every path and branch untouched.
2. Verify RED. Add an optional `branch?: string` to `ReconcileMergedParkOptions` and thread it into `gatherMergeEvidence`: when supplied, `branches` is `[branch]` if that ref exists in the prefetched ref listing (else `[]`), instead of the `branchesBySlug` lookup by final segment; the record check is unchanged. Keep the existing slug-segment lookup when `branch` is absent so the parked path and the operator verb behave as today.
3. Verify GREEN. Commit: "feat(park-reconciliation): key merge evidence on the worktree's listed branch".

**Done when:**
- `gatherMergeEvidence` evaluates the supplied listed branch, so `hotfix-x`/`hotfix/x` is proven by ancestry and `<slug>`/`feat/daemon-<slug>` by merged-PR head identity, as asserted by the listed-branch evidence tests where the slug-segment lookup found no branch
- `reconcileMergedPark` deletes exactly the listed branch after proof, as asserted by the shared-final-segment test
- each of `no-merge-proof`, `unmerged-commits`, `branch-missing`, and the gh-capability refusal returns before any removal, as asserted by the refusal tests that check every path and branch is untouched

**Files:**
- `src/conductor/src/engine/park-reconciliation.ts`
- `src/conductor/test/engine/park-reconciliation-merge-evidence.test.ts`

**Dependencies:** none

### Task 3: Scope the shipped-record precondition to daemon branches

**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `park-reconciliation.test.ts`: (a) proven-merged `feat/daemon-<slug>` with record present → reclaimed; (b) proven-merged `hotfix/x` with no record → reclaimed and `requestRecordRepair` not called; (c) proven-merged `spec/<slug>` with no record → reclaimed, no repair; (d) proven-merged `feat/daemon-<slug>` with no record → `record-missing`, `deferred: true`, repair requested; (e) `hotfix/x` with no proof and no record → `no-merge-proof`; (f) unreadable `origin/main:.docs/shipped` listing for a `feat/daemon-*` candidate → `ancestry-check-failed`.
2. Verify RED. In `reconcileMergedPark`, compute `requiresRecord = branch === undefined || branch.startsWith('feat/daemon-')` (absent branch keeps today's parked semantics) and enter the `record-missing` arm only when `requiresRecord && !evidence.shippedRecordOnMain`. Leave the proof gate above it untouched so a non-daemon candidate without proof is still refused.
3. Verify GREEN, then run the existing parked record-missing deferral tests unchanged. Commit: "feat(park-reconciliation): require the shipped record only for feat/daemon branches".

**Done when:**
- `reconcileMergedPark` reclaims a proven-merged candidate on a non-`feat/daemon-*` branch with no shipped record and requests no record repair, and still returns `record-missing` with `deferred: true` for a `feat/daemon-*` candidate without one, as asserted by the branch-kind record tests
- a non-daemon candidate with no merge proof is refused `no-merge-proof` regardless of the record rule, as asserted by the no-proof hotfix test
- an unreadable shipped-record listing yields `ancestry-check-failed` for a `feat/daemon-*` candidate rather than treating the record as absent, as asserted by the unreadable-listing test; the existing parked record-missing deferral tests pass unchanged

**Files:**
- `src/conductor/src/engine/park-reconciliation.ts`
- `src/conductor/test/engine/park-reconciliation.test.ts`

**Dependencies:** Task 2

### Task 4: Unpark only when a park marker exists

**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `park-reconciliation.test.ts`: (a) a proven, eligible, non-parked candidate → outcome `steps` end at `branch-deleted` (or `branch-absent`) with no `unparked` step and no `dispatchDaemonPark` call; (b) a parked candidate → `unparked` remains the last step, as today; (c) `git worktree remove` failing on a git-owned path → `worktree-remove-failed` and no branch deletion; (d) a glob, path separator, or comma list → `invalid-slug` with no git call; (e) a caller-classified merged slug whose branch gained a commit before the helper runs → refused by the helper's own re-derived evidence. Assert (a) also proves project teardown ran before removal via the `TEARDOWN_SCRIPT` fixture.
2. Verify RED. In `reconcileMergedPark`, before the unpark step call `isOperatorParked(projectRoot, slug)` (from `park-marker.ts`, main-root resolved); when false, skip the unpark and return `steps` without `unparked`. Keep the unpark path byte-identical when the marker exists.
3. Verify GREEN. Commit: "feat(park-reconciliation): skip unpark for candidates that were never parked".

**Done when:**
- `reconcileMergedPark` runs project teardown then removes the single worktree path and, for a non-parked candidate, returns reconciled with no `unparked` step and no unpark dispatch, as asserted by the non-parked reclaim test
- a parked candidate still ends with `unparked` as its last step, as asserted by the parked reclaim test
- `worktree-remove-failed` stops before branch deletion and `invalid-slug` is returned before any git call, as asserted by the refusal tests
- the helper's own re-derived evidence refuses a slug the caller classified merged but which changed before the destructive step, as asserted by the stale-classification test

**Files:**
- `src/conductor/src/engine/park-reconciliation.ts`
- `src/conductor/test/engine/park-reconciliation.test.ts`

**Dependencies:** Task 3

### Task 5: Widen the sweep candidate set and exclude non-reclaimable candidates

**Story:** 1
**Story:** 2
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `park-reconciliation.test.ts` for `reconcileParkedFeatures`: (a) three registered worktrees and no park markers → three candidates evaluated, summary counts three; (b) one parked slug without a worktree plus two registered non-parked worktrees → candidate set is the union, no slug twice; (c) a slug that is both parked and registered → evaluated once; (d) no `.daemon/mergeable-watch.jsonl` → candidates still enumerated, no error line; (e) `isFeatureInFlight(slug)` true → helper not invoked, retained `in-flight`, even when proof and record are present; (f) `engineer-*`/`resolve-*` → retained `foreign-lifecycle`; (g) slug failing `SINGLE_SLUG` (nested or invalid) → retained `invalid-slug`; (h) `.pipeline/HALT` present → retained `halted`; (i) HALT read failing with EACCES → retained `halted`; (j) park-marker read throwing → retained, no removal.
2. Verify RED. Extend `ReconcileParkedFeaturesOptions` with `isFeatureInFlight?: (slug: string) => boolean` and `worktreeListing?` injection; build `candidates` as parked slugs unioned (by slug) with `listRegisteredWorktrees` results, each carrying its listed branch when known. Before the helper, apply the exclusions in this order: in-flight, foreign-lifecycle prefix, `SINGLE_SLUG`, halted (`access` on `.pipeline/HALT`; any non-ENOENT error counts as halted), park-marker read error; each produces a `retained` disposition with a closed-union reason. Pass `branch` to `reconcileMergedPark` for enumerated candidates. Preserve per-slug error isolation and the summary-signature de-duplication; extend the signature with the new retained counts.
3. Verify GREEN. Commit: "feat(park-reconciliation): enumerate registered worktrees and exclude non-reclaimable candidates".

**Done when:**
- `reconcileParkedFeatures` evaluates the union of parked slugs and depth-1 registered worktrees once per slug, with the listed branch attached, no dependence on the mergeable watch registry, and the summary line reporting the enumerated candidate count, as asserted by the union, once-per-slug, and missing-registry tests
- an in-flight candidate is retained with reason `in-flight` before the helper is called even when fully proven, as asserted by the in-flight-wins test
- `engineer-*`/`resolve-*`, invalid or nested slugs, and a present or unreadable `.pipeline/HALT` are each retained with reasons `foreign-lifecycle`, `invalid-slug`, and `halted` before the helper is called, as asserted by the exclusion tests
- a throwing park-marker read retains the candidate with no removal, as asserted by the marker-throw test
- the summary line's new enumerated-candidate and retained fields are printed only when at least one enumerated non-parked candidate exists, so a parked-only pass prints today's line byte-for-byte, as asserted by the parked-only preservation test in Task 11

**Files:**
- `src/conductor/src/engine/park-reconciliation.ts`
- `src/conductor/test/engine/park-reconciliation.test.ts`

**Dependencies:** Task 1, Task 4

### Task 6: Retain the whole pass on listing failure and honour the reclaim gate

**Story:** 1
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `park-reconciliation.test.ts`: (a) worktree listing returns `null` → every candidate retained `listing-unavailable`, zero helper calls; (b) `reclaimMergedWorktrees: false` → enumerated candidates are evaluated, eligible ones retained `disabled`, none removed; (c) `reclaimMergedWorktrees: false` with `autoCleanup: true` → a parked merged slug is still reclaimed exactly as today while enumerated non-parked candidates are held.
2. Verify RED. Add `reclaimMergedWorktrees?: boolean` (default `true`) to `ReconcileParkedFeaturesOptions`. When the listing is `null`, mark each candidate `listing-unavailable` and skip the helper for all of them. When the gate is `false`, run classification for enumerated non-parked candidates but replace the helper call with a `disabled` retention; parked candidates keep the `autoCleanup` rule.
3. Verify GREEN. Commit: "feat(park-reconciliation): retain the pass on listing failure and honour reclaim_merged_worktrees".

**Done when:**
- a failed worktree listing retains every candidate with reason `listing-unavailable` and makes zero helper calls, as asserted by the listing-failure sweep test
- `reclaimMergedWorktrees: false` evaluates enumerated candidates, retains eligible ones with reason `disabled`, and removes nothing, as asserted by the disabled-gate test
- with the gate off, parked merged slugs are still reclaimed under `autoCleanup` while enumerated non-parked candidates are held, as asserted by the gate-off-parked test

**Files:**
- `src/conductor/src/engine/park-reconciliation.ts`
- `src/conductor/test/engine/park-reconciliation.test.ts`

**Dependencies:** Task 5

### Task 7: Declare the reclaim event variants and their sinks

**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing tests: in `event-sinks.test.ts` assert `EVENT_SINKS` declares `worktree_reclaim_reclaimed` and `worktree_reclaim_failed` with `render: true, persist: true` and `worktree_reclaim_retained` with `render: false, persist: true`; in `daemon-render.test.ts` assert `renderDaemonEvent` prints one line for a reclaimed and a failed event and prints nothing for a retained event; rely on the existing exhaustiveness guard in `event-sink-registry.test.ts` to fail while the declarations are missing.
2. Verify RED. Append three variants at the END of the `ConductorEvent` union in `types/events.ts`: `worktree_reclaim_reclaimed { slug, branch?, proof?: 'ancestry' | 'merged-pr-head' }` (both `branch` and `proof` are omitted together when a parked-only candidate had no branch to prove or delete; the shipped record is a precondition, never a proof kind, and the empty string is never emitted as a branch), `worktree_reclaim_retained { slug, branch?, reason: WorktreeReclaimRetainedReason }`, `worktree_reclaim_failed { slug, branch?, refusal: string }`, where `WorktreeReclaimRetainedReason` is the closed union `'in-flight' | 'foreign-lifecycle' | 'invalid-slug' | 'halted' | 'listing-unavailable' | 'disabled' | RefusalReason`. Add the three `EVENT_SINKS` rows and the `renderDaemonEventUnsafe` arms.
3. Verify GREEN. Commit: "feat(events): add worktree reclaim event variants and sink declarations".

**Done when:**
- `EVENT_SINKS` declares `worktree_reclaim_reclaimed` and `worktree_reclaim_failed` with `render: true, persist: true` and `worktree_reclaim_retained` with `render: false, persist: true`, as asserted by the sink declaration test, and the union exhaustiveness guard passes with the three variants appended at the end of the union
- `renderDaemonEvent` prints one line for a reclaimed or failed event and nothing for a retained event, as asserted by the renderer test
- the `reason` field of the retained variant is the closed union named in Steps, so an unlisted reason fails type-check

**Files:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/event-sinks.test.ts`
- `src/conductor/test/engine/daemon-render.test.ts`

**Dependencies:** none

### Task 8: Emit reclaim outcomes from the sweep

**Story:** 5
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `park-reconciliation.test.ts` with an injected `onEvent` collector: (a) a reclaimed candidate emits exactly one `worktree_reclaim_reclaimed` with slug, branch, and proof, and a parked-only candidate reclaimed with no branch emits one with `branch` and `proof` both omitted; (b) each retained candidate emits exactly one `worktree_reclaim_retained` with its reason; (c) a `worktree-remove-failed` or `branch-delete-failed` helper outcome emits exactly one `worktree_reclaim_failed` carrying the refusal and is counted as failed, not reconciled; (d) with no `onEvent` supplied the sweep completes and still logs the summary line.
2. Verify RED. Add `onEvent?: (event: ConductorEvent) => void` to `ReconcileParkedFeaturesOptions`; emit after each candidate's disposition is known: reclaimed on `refusal === undefined`, failed on `worktree-remove-failed` or `branch-delete-failed`, retained for every other refusal and every sweep-side exclusion. Wrap each emit so a throwing sink cannot break per-slug isolation.
3. Verify GREEN. Commit: "feat(park-reconciliation): emit reclaim outcomes on the event spine".

**Done when:**
- the sweep emits exactly one `worktree_reclaim_reclaimed` per reclaimed candidate carrying slug plus the branch and its ancestry or merged-pr-head proof kind when a branch existed, and neither field when none did, as asserted by the reclaimed-event test
- the sweep emits exactly one `worktree_reclaim_retained` per retained candidate carrying its closed-union reason, as asserted by the retained-event test
- a `branch-delete-failed` or `worktree-remove-failed` outcome emits one `worktree_reclaim_failed` carrying the refusal and is reported as failed rather than reclaimed, as asserted by the failed-event test
- the sweep completes and logs its summary line when no emitter is injected, as asserted by the missing-emitter test

**Files:**
- `src/conductor/src/engine/park-reconciliation.ts`
- `src/conductor/test/engine/park-reconciliation.test.ts`

**Dependencies:** Task 5, Task 7

### Task 9: Validate and register the reclaim_merged_worktrees config key

**Story:** 7
**Type:** infrastructure

**Steps:**
1. Write failing tests: in `config-validation.test.ts` assert `validateConfig({ reclaim_merged_worktrees: 'yes' })` returns an error matching `/reclaim_merged_worktrees.*boolean/i`, that an absent key normalizes to `true`, and that `false` is preserved; rely on the config-key consumer registry test to fail until the key declares its consumer.
2. Verify RED. In `config.ts` add `reclaim_merged_worktrees` to the documented top-level key list beside `reconcile_parked_auto_cleanup`, validate it as a boolean, and default it to `true`. In `test/engine/config-consumer-registry.ts` add `reclaim_merged_worktrees: consumer(DAEMON_CLI)`.
3. Verify GREEN. Commit: "feat(config): add reclaim_merged_worktrees (boolean, default true)".

**Done when:**
- `validateConfig` rejects a non-boolean `reclaim_merged_worktrees` with an error naming the key, defaults an absent key to `true`, and preserves `false`, as asserted by the config validation tests
- `reclaim_merged_worktrees` is declared in the config-key consumer registry with consumer `daemon-cli.ts`, so the registry test passes with the key documented

**Files:**
- `src/conductor/src/engine/config.ts`
- `src/conductor/test/config-validation.test.ts`
- `src/conductor/test/engine/config-consumer-registry.ts`

**Dependencies:** none

### Task 10: Wire the widened sweep at the daemon composition root

**Story:** 2
**Story:** 6
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `daemon-cli-parked-reconciliation-wiring.test.ts` (extend the existing wiring test): assert the `reconcileParkedFeatures` dep binding passes `isFeatureInFlight` from the sweep context, `reclaimMergedWorktrees` from config (absent → `true`), and an `onEvent` that forwards to the root daemon emitter; and in a daemon-loop test assert `sweepBestEffort` calls the dep with `{ disposeHaltWatcher, isFeatureInFlight }`. Add an integration test that runs the real sweep against a temp git repo with one merged non-daemon worktree and asserts the worktree is removed and a `worktree_reclaim_reclaimed` record is present in the daemon-root `events.jsonl` after the pass.
2. Verify RED. In `daemon.ts` extend the `reconcileParkedFeatures` dep signature to receive `isFeatureInFlight` from `DaemonSweepContext` and pass it in `sweepBestEffort`. In `daemon-cli.ts` read `config?.reclaim_merged_worktrees ?? true`, and bind `isFeatureInFlight`, `reclaimMergedWorktrees`, and `onEvent: (e) => events.emit(e)` in the `reconcileParkedFeatures` binding beside the existing `disposeHaltWatcher`.
3. Verify GREEN. Commit: "feat(daemon): wire enumerated worktree reclamation into the reconciliation sweep".

**Done when:**
- the daemon's `reconcileParkedFeatures` binding forwards the sweep context's `isFeatureInFlight`, the resolved `reclaim_merged_worktrees` value (absent → `true`), and an `onEvent` bound to the root emitter, as asserted by the wiring test
- `sweepBestEffort` passes `isFeatureInFlight` to the `reconcileParkedFeatures` dep at every boundary it runs, as asserted by the daemon-loop test
- a merged non-daemon worktree in a temp repo is removed by one sweep pass and its `worktree_reclaim_reclaimed` record is present in the daemon-root `events.jsonl` after the worktree is gone, as asserted by the integration test

**Files:**
- `src/conductor/src/engine/daemon.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/daemon-cli-parked-reconciliation-wiring.test.ts`
- `src/conductor/test/engine/daemon.test.ts`

**Dependencies:** Task 6, Task 8, Task 9

### Task 11: Prove single removal and parked-path preservation

**Story:** 2
**Story:** 5
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing tests in `park-reconciliation.test.ts`: (a) five candidates of which one is proven and eligible → exactly one `git worktree remove` invocation naming that path and four retentions with named reasons; (b) two proven, eligible candidates → two separate helper invocations, each with exactly one slug; (c) only parked slugs on `feat/daemon-*` branches and no other registered worktrees → classifications, counts, refusal breakdown, and the summary line equal the pre-change expectations already pinned by the existing suite; (d) an orphaned parked slug is annotated `orphan` and never deleted; (e) an unreadable record listing classifies each parked slug `unclassified` with no removal.
2. Verify RED where any assertion is new; keep any already-green existing assertion as a pinned regression rather than a new mechanism. Adjust fixtures that now need a worktree listing to supply an empty listing so the parked-only path is exercised in isolation. Add one preservation fixture whose listing names an ordinary unmerged park's own worktree and assert `refused=0` with an empty refusal breakdown.
3. Verify GREEN. Commit: "test(park-reconciliation): pin single removal and parked-path preservation".

**Done when:**
- a sweep over five candidates with one eligible slug issues exactly one `git worktree remove` for that path and retains the other four with named reasons, as asserted by the single-removal test
- two eligible candidates produce two helper invocations each carrying exactly one slug, as asserted by the two-candidate test
- with only `feat/daemon-*` parked slugs, whether the worktree listing is empty or names only those slugs' own worktrees, an unmerged park never reaches the helper and classifications, counts, refusal breakdown, and the summary line match the pre-change expectations except that a parked slug retained by a Story 2 guard keeps its named reason instead of being reclaimed, an orphaned park is annotated `orphan` and never deleted, and an unreadable record listing yields `unclassified` with no removal, as asserted by the preservation tests

**Files:**
- `src/conductor/test/engine/park-reconciliation.test.ts`

**Dependencies:** Task 8

## Task Dependency Graph

```
Task 1 ─┐
Task 2 ─┼─> Task 3 ─> Task 4 ─┐
        │                      ├─> Task 5 ─> Task 6 ─┐
Task 7 ─┼──────────────────────┼─> Task 8 ───────────┼─> Task 10
Task 9 ─┘                      │                      │
                               └────────── Task 11 <──┘ (after Task 8)
```

Tasks 1, 2, 7, and 9 are independent roots. Task 11 depends on Task 8; Task 10 depends on Tasks 6, 8, and 9.

## Integration Points and Coverage Ownership

- After Task 5: the widened sweep can be exercised end to end against the `GitWorld` fake with a scripted worktree listing.
- After Task 8: every outcome is observable on an injected emitter.
- Task 10 owns the cross-boundary integration proof: the daemon composition root binds the sweep context, the config key, and the root emitter, and a real temp-repo pass removes a merged non-daemon worktree and persists its reclaim record in the daemon-root ledger.
- Task 11 owns the single-removal and parked-path preservation proofs.

## Coverage Check

Each row quotes the extracted criterion verbatim and one owning task's exact completion check. All dispositions are `diff-local`: every criterion's truth is decided by code and deterministic fakes inside this feature's diff.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a checkout whose `git worktree list --porcelain` reports three worktrees directly under `.worktrees/` and no park markers, when the sweep runs, then all three are evaluated as candidates and the summary reports three candidates | 5 | "`reconcileParkedFeatures` evaluates the union of parked slugs and depth-1 registered worktrees once per slug, with the listed branch attached, no dependence on the mergeable watch registry, and the summary line reporting the enumerated candidate count, as asserted by the union, once-per-slug, and missing-registry tests" | diff-local |
| Story 1 happy: Given a checkout with one parked slug that has no worktree on disk and two registered worktrees that are not parked, when the sweep runs, then the candidate set is the union of the three and no slug appears twice | 5 | "`reconcileParkedFeatures` evaluates the union of parked slugs and depth-1 registered worktrees once per slug, with the listed branch attached, no dependence on the mergeable watch registry, and the summary line reporting the enumerated candidate count, as asserted by the union, once-per-slug, and missing-registry tests" | diff-local |
| Story 1 happy: Given a registered worktree at `.worktrees/hotfix-x` whose listed branch is `hotfix/x`, when the sweep builds its candidate for it, then the candidate carries slug `hotfix-x` and branch `hotfix/x` exactly as listed | 1 | "`listRegisteredWorktrees` returns one `{ slug, branch }` per depth-1 registered worktree under `.worktrees/` with the branch read from the porcelain `branch` line, as asserted by the depth-1 listing test" | diff-local |
| Story 1 happy: Given a checkout with no `.daemon/mergeable-watch.jsonl` at all, when the sweep runs, then candidates are still enumerated and the registry's absence is not logged as an error | 5 | "`reconcileParkedFeatures` evaluates the union of parked slugs and depth-1 registered worktrees once per slug, with the listed branch attached, no dependence on the mergeable watch registry, and the summary line reporting the enumerated candidate count, as asserted by the union, once-per-slug, and missing-registry tests" | diff-local |
| Story 1 negative: Given a registered worktree at a nested path `.worktrees/feat/daemon-x`, when the sweep enumerates, then it is not treated as a candidate named `feat` and is retained with reason `invalid-slug` | 1 | "`listRegisteredWorktrees` excludes a nested path, a path outside `.worktrees/`, and a detached worktree, as asserted by the exclusion test, so none of them can become a candidate" | diff-local |
| Story 1 negative: Given a plain directory under `.worktrees/` that `git worktree list` does not report, when the sweep enumerates, then it is not a candidate and nothing under that directory is removed | 1 | "`listRegisteredWorktrees` excludes a nested path, a path outside `.worktrees/`, and a detached worktree, as asserted by the exclusion test, so none of them can become a candidate" | diff-local |
| Story 1 negative: Given a registered worktree outside `.worktrees/` (for example the project root or `.claude/worktrees/x`), when the sweep enumerates, then it is never a candidate | 1 | "`listRegisteredWorktrees` excludes a nested path, a path outside `.worktrees/`, and a detached worktree, as asserted by the exclusion test, so none of them can become a candidate" | diff-local |
| Story 1 negative: Given `git worktree list --porcelain` fails, when the sweep runs, then every candidate for that pass is retained with reason `listing-unavailable` and no removal is attempted | 6 | "a failed worktree listing retains every candidate with reason `listing-unavailable` and makes zero helper calls, as asserted by the listing-failure sweep test" | diff-local |
| Story 2 happy: Given a candidate slug for which the sweep context reports `isFeatureInFlight` true, when the sweep evaluates it, then the guarded helper is not invoked for it and it is retained with reason `in-flight` | 5 | "an in-flight candidate is retained with reason `in-flight` before the helper is called even when fully proven, as asserted by the in-flight-wins test" | diff-local |
| Story 2 happy: Given a candidate whose directory name starts with `engineer-` or `resolve-`, when the sweep evaluates it, then the guarded helper is not invoked and it is retained with reason `foreign-lifecycle` | 5 | "`engineer-*`/`resolve-*`, invalid or nested slugs, and a present or unreadable `.pipeline/HALT` are each retained with reasons `foreign-lifecycle`, `invalid-slug`, and `halted` before the helper is called, as asserted by the exclusion tests" | diff-local |
| Story 2 happy: Given a candidate whose worktree contains a live `.pipeline/HALT`, when the sweep evaluates it, then the guarded helper is not invoked and it is retained with reason `halted` | 5 | "`engineer-*`/`resolve-*`, invalid or nested slugs, and a present or unreadable `.pipeline/HALT` are each retained with reasons `foreign-lifecycle`, `invalid-slug`, and `halted` before the helper is called, as asserted by the exclusion tests" | diff-local |
| Story 2 happy: Given a candidate whose slug fails the single-slug pattern, when the sweep evaluates it, then it is retained with reason `invalid-slug` | 5 | "`engineer-*`/`resolve-*`, invalid or nested slugs, and a present or unreadable `.pipeline/HALT` are each retained with reasons `foreign-lifecycle`, `invalid-slug`, and `halted` before the helper is called, as asserted by the exclusion tests" | diff-local |
| Story 2 negative: Given a candidate that is in flight and also carries every merge proof and a shipped record, when the sweep evaluates it, then it is still retained with reason `in-flight` and no path is removed | 5 | "an in-flight candidate is retained with reason `in-flight` before the helper is called even when fully proven, as asserted by the in-flight-wins test" | diff-local |
| Story 2 negative: Given a candidate whose `.pipeline/HALT` is unreadable for a reason other than absence, when the sweep evaluates it, then it is retained with reason `halted` rather than proceeding to the helper | 5 | "`engineer-*`/`resolve-*`, invalid or nested slugs, and a present or unreadable `.pipeline/HALT` are each retained with reasons `foreign-lifecycle`, `invalid-slug`, and `halted` before the helper is called, as asserted by the exclusion tests" | diff-local |
| Story 2 negative: Given a candidate whose slug is operator-parked and whose park marker read throws, when the sweep evaluates it, then it is retained and no removal is attempted | 5 | "a throwing park-marker read retains the candidate with no removal, as asserted by the marker-throw test" | diff-local |
| Story 2 negative: Given a sweep over N candidates of which exactly one is proven merged and eligible, when the sweep completes, then exactly one worktree path is removed and N-1 candidates are retained with named reasons | 11 | "a sweep over five candidates with one eligible slug issues exactly one `git worktree remove` for that path and retains the other four with named reasons, as asserted by the single-removal test" | diff-local |
| Story 3 happy: Given a candidate at `.worktrees/hotfix-x` on branch `hotfix/x` that is an ancestor of `origin/main`, when the helper runs with that branch, then ancestry proves it merged without consulting `gh` | 2 | "`gatherMergeEvidence` evaluates the supplied listed branch, so `hotfix-x`/`hotfix/x` is proven by ancestry and `<slug>`/`feat/daemon-<slug>` by merged-PR head identity, as asserted by the listed-branch evidence tests where the slug-segment lookup found no branch" | diff-local |
| Story 3 happy: Given a candidate at `.worktrees/<slug>` on branch `feat/daemon-<slug>` that is not an ancestor but whose MERGED PR `headRefOid` equals the branch tip, when the helper runs with that branch, then head identity proves it merged | 2 | "`gatherMergeEvidence` evaluates the supplied listed branch, so `hotfix-x`/`hotfix/x` is proven by ancestry and `<slug>`/`feat/daemon-<slug>` by merged-PR head identity, as asserted by the listed-branch evidence tests where the slug-segment lookup found no branch" | diff-local |
| Story 3 happy: Given a candidate whose listed branch is proven merged, when the helper completes, then the proven branch is the one deleted, not a branch that merely shares the slug's final path segment | 2 | "`reconcileMergedPark` deletes exactly the listed branch after proof, as asserted by the shared-final-segment test" | diff-local |
| Story 3 negative: Given a candidate whose listed branch is not an ancestor and has no merged PR, when the helper runs, then it refuses with `no-merge-proof` and nothing is removed | 2 | "each of `no-merge-proof`, `unmerged-commits`, `branch-missing`, and the gh-capability refusal returns before any removal, as asserted by the refusal tests that check every path and branch is untouched" | diff-local |
| Story 3 negative: Given a candidate whose listed branch has advanced past its merged PR head, when the helper runs, then it refuses with `unmerged-commits` naming the dropped commits and nothing is removed | 2 | "each of `no-merge-proof`, `unmerged-commits`, `branch-missing`, and the gh-capability refusal returns before any removal, as asserted by the refusal tests that check every path and branch is untouched" | diff-local |
| Story 3 negative: Given a candidate whose listed branch no longer exists locally and no shipped record is on `origin/main`, when the helper runs, then it refuses with `branch-missing` and nothing is removed | 2 | "each of `no-merge-proof`, `unmerged-commits`, `branch-missing`, and the gh-capability refusal returns before any removal, as asserted by the refusal tests that check every path and branch is untouched" | diff-local |
| Story 3 negative: Given `gh` reports a capability error while proving head identity, when the helper runs, then it refuses with `no-merge-proof` and nothing is removed | 2 | "each of `no-merge-proof`, `unmerged-commits`, `branch-missing`, and the gh-capability refusal returns before any removal, as asserted by the refusal tests that check every path and branch is untouched" | diff-local |
| Story 4 happy: Given a proven-merged candidate on branch `feat/daemon-<slug>` with `.docs/shipped/<slug>.md` on `origin/main`, when the helper runs, then the worktree is reclaimed | 3 | "`reconcileMergedPark` reclaims a proven-merged candidate on a non-`feat/daemon-*` branch with no shipped record and requests no record repair, and still returns `record-missing` with `deferred: true` for a `feat/daemon-*` candidate without one, as asserted by the branch-kind record tests" | diff-local |
| Story 4 happy: Given a proven-merged candidate on branch `hotfix/x` with no shipped record on `origin/main`, when the helper runs, then the worktree is reclaimed | 3 | "`reconcileMergedPark` reclaims a proven-merged candidate on a non-`feat/daemon-*` branch with no shipped record and requests no record repair, and still returns `record-missing` with `deferred: true` for a `feat/daemon-*` candidate without one, as asserted by the branch-kind record tests" | diff-local |
| Story 4 happy: Given a proven-merged candidate on branch `spec/<slug>` with no shipped record, when the helper runs, then the worktree is reclaimed and no record repair is requested | 3 | "`reconcileMergedPark` reclaims a proven-merged candidate on a non-`feat/daemon-*` branch with no shipped record and requests no record repair, and still returns `record-missing` with `deferred: true` for a `feat/daemon-*` candidate without one, as asserted by the branch-kind record tests" | diff-local |
| Story 4 negative: Given a proven-merged candidate on branch `feat/daemon-<slug>` with no shipped record on `origin/main`, when the helper runs, then it refuses with `record-missing`, defers, and requests record repair exactly as before | 3 | "`reconcileMergedPark` reclaims a proven-merged candidate on a non-`feat/daemon-*` branch with no shipped record and requests no record repair, and still returns `record-missing` with `deferred: true` for a `feat/daemon-*` candidate without one, as asserted by the branch-kind record tests" | diff-local |
| Story 4 negative: Given a candidate on branch `hotfix/x` with no merge proof and no shipped record, when the helper runs, then the absence of the record requirement does not make it reclaimable and it refuses with `no-merge-proof` | 3 | "a non-daemon candidate with no merge proof is refused `no-merge-proof` regardless of the record rule, as asserted by the no-proof hotfix test" | diff-local |
| Story 4 negative: Given the `origin/main:.docs/shipped` listing cannot be read, when the helper evaluates a `feat/daemon-*` candidate, then it refuses with `ancestry-check-failed` rather than treating the record as absent | 3 | "an unreadable shipped-record listing yields `ancestry-check-failed` for a `feat/daemon-*` candidate rather than treating the record as absent, as asserted by the unreadable-listing test; the existing parked record-missing deferral tests pass unchanged" | diff-local |
| Story 5 happy: Given a proven, eligible candidate, when the sweep reclaims it, then project teardown runs on the worktree path before `git worktree remove --force` of that single path | 4 | "`reconcileMergedPark` runs project teardown then removes the single worktree path and, for a non-parked candidate, returns reconciled with no `unparked` step and no unpark dispatch, as asserted by the non-parked reclaim test" | diff-local |
| Story 5 happy: Given a proven, eligible candidate that is not parked, when the helper completes, then it reports reconciled without attempting an unpark | 4 | "`reconcileMergedPark` runs project teardown then removes the single worktree path and, for a non-parked candidate, returns reconciled with no `unparked` step and no unpark dispatch, as asserted by the non-parked reclaim test" | diff-local |
| Story 5 happy: Given a proven, eligible candidate that is parked, when the helper completes, then the park marker is removed last, as today | 4 | "a parked candidate still ends with `unparked` as its last step, as asserted by the parked reclaim test" | diff-local |
| Story 5 happy: Given two proven, eligible candidates, when the sweep reclaims them, then two separate helper invocations occur, each with exactly one slug | 11 | "two eligible candidates produce two helper invocations each carrying exactly one slug, as asserted by the two-candidate test" | diff-local |
| Story 5 negative: Given a candidate whose `git worktree remove` fails on a path git owns, when the helper runs, then it refuses with `worktree-remove-failed` and the branch is not deleted | 4 | "`worktree-remove-failed` stops before branch deletion and `invalid-slug` is returned before any git call, as asserted by the refusal tests" | diff-local |
| Story 5 negative: Given a candidate whose branch deletion fails after the worktree was removed, when the helper runs, then it refuses with `branch-delete-failed` and the outcome is reported as failed, not reclaimed | 8 | "a `branch-delete-failed` or `worktree-remove-failed` outcome emits one `worktree_reclaim_failed` carrying the refusal and is reported as failed rather than reclaimed, as asserted by the failed-event test" | diff-local |
| Story 5 negative: Given the helper is invoked with a list or a glob instead of one slug, when it validates input, then it refuses with `invalid-slug` before any evidence is gathered | 4 | "`worktree-remove-failed` stops before branch deletion and `invalid-slug` is returned before any git call, as asserted by the refusal tests" | diff-local |
| Story 5 negative: Given a candidate whose evidence was classified merged by the sweep but changes before the helper re-derives it, when the helper runs, then the helper's own re-derived evidence decides and the stale classification is not trusted | 4 | "the helper's own re-derived evidence refuses a slug the caller classified merged but which changed before the destructive step, as asserted by the stale-classification test" | diff-local |
| Story 6 happy: Given a candidate is reclaimed, when the sweep completes it, then a `worktree_reclaim_reclaimed` event carrying the slug, plus the branch and its proof kind when the candidate had a branch, is emitted on the daemon's emitter | 8 | "the sweep emits exactly one `worktree_reclaim_reclaimed` per reclaimed candidate carrying slug plus the branch and its ancestry or merged-pr-head proof kind when a branch existed, and neither field when none did, as asserted by the reclaimed-event test" | diff-local |
| Story 6 happy: Given a candidate is retained, when the sweep completes it, then a `worktree_reclaim_retained` event carrying the slug and a closed-union reason is emitted | 8 | "the sweep emits exactly one `worktree_reclaim_retained` per retained candidate carrying its closed-union reason, as asserted by the retained-event test" | diff-local |
| Story 6 happy: Given a removal or branch deletion fails, when the sweep completes it, then a `worktree_reclaim_failed` event carrying the slug and the refusal is emitted | 8 | "a `branch-delete-failed` or `worktree-remove-failed` outcome emits one `worktree_reclaim_failed` carrying the refusal and is reported as failed rather than reclaimed, as asserted by the failed-event test" | diff-local |
| Story 6 happy: Given the three variants exist, when the sink registry is read, then each has a declaration with `persist: true`, `retained` has `render: false`, and `reclaimed` and `failed` have `render: true` | 7 | "`EVENT_SINKS` declares `worktree_reclaim_reclaimed` and `worktree_reclaim_failed` with `render: true, persist: true` and `worktree_reclaim_retained` with `render: false, persist: true`, as asserted by the sink declaration test, and the union exhaustiveness guard passes with the three variants appended at the end of the union" | diff-local |
| Story 6 negative: Given a `worktree_reclaim_retained` event, when the daemon renders its log, then no per-slug line is printed for it and the sweep's existing summary line still reports counts | 7 | "`renderDaemonEvent` prints one line for a reclaimed or failed event and nothing for a retained event, as asserted by the renderer test" | diff-local |
| Story 6 negative: Given a new `ConductorEvent` variant is added without a sink declaration, when the exhaustiveness guard runs, then it fails naming the variant | 7 | "`EVENT_SINKS` declares `worktree_reclaim_reclaimed` and `worktree_reclaim_failed` with `render: true, persist: true` and `worktree_reclaim_retained` with `render: false, persist: true`, as asserted by the sink declaration test, and the union exhaustiveness guard passes with the three variants appended at the end of the union" | diff-local |
| Story 6 negative: Given the emitter is absent (no root emitter injected), when the sweep runs, then it completes without throwing and the summary line is still logged | 8 | "the sweep completes and logs its summary line when no emitter is injected, as asserted by the missing-emitter test" | diff-local |
| Story 6 negative: Given a reclaim removes the worktree, when the pass completes, then the reclaim event is present in the daemon-root ledger even though the worktree's own `.pipeline/events.jsonl` no longer exists | 10 | "a merged non-daemon worktree in a temp repo is removed by one sweep pass and its `worktree_reclaim_reclaimed` record is present in the daemon-root `events.jsonl` after the worktree is gone, as asserted by the integration test" | diff-local |
| Story 7 happy: Given `reclaim_merged_worktrees` is absent from config, when the daemon reads its config, then the enumerated path is enabled | 9 | "`validateConfig` rejects a non-boolean `reclaim_merged_worktrees` with an error naming the key, defaults an absent key to `true`, and preserves `false`, as asserted by the config validation tests" | diff-local |
| Story 7 happy: Given `reclaim_merged_worktrees: true`, when the sweep runs, then enumerated candidates are evaluated and eligible ones are reclaimed | 10 | "a merged non-daemon worktree in a temp repo is removed by one sweep pass and its `worktree_reclaim_reclaimed` record is present in the daemon-root `events.jsonl` after the worktree is gone, as asserted by the integration test" | diff-local |
| Story 7 happy: Given `reclaim_merged_worktrees: false`, when the sweep runs, then enumerated candidates are evaluated and every eligible one is retained with reason `disabled` and emitted, and none is removed | 6 | "`reclaimMergedWorktrees: false` evaluates enumerated candidates, retains eligible ones with reason `disabled`, and removes nothing, as asserted by the disabled-gate test" | diff-local |
| Story 7 negative: Given `reclaim_merged_worktrees: "yes"` (a non-boolean), when config validation runs, then it returns an error naming the key and the daemon does not start | 9 | "`validateConfig` rejects a non-boolean `reclaim_merged_worktrees` with an error naming the key, defaults an absent key to `true`, and preserves `false`, as asserted by the config validation tests" | diff-local |
| Story 7 negative: Given `reclaim_merged_worktrees: false` and `reconcile_parked_auto_cleanup: true`, when the sweep runs, then parked merged slugs are still reclaimed exactly as today and only the enumerated non-parked candidates are held | 6 | "with the gate off, parked merged slugs are still reclaimed under `autoCleanup` while enumerated non-parked candidates are held, as asserted by the gate-off-parked test" | diff-local |
| Story 7 negative: Given the key is added to the documented key list, when the config-key consumer registry test runs, then it fails unless the key declares its consumer | 9 | "`reclaim_merged_worktrees` is declared in the config-key consumer registry with consumer `daemon-cli.ts`, so the registry test passes with the key documented" | diff-local |
| Story 8 happy: Given only parked slugs on `feat/daemon-*` branches and no registered worktrees beyond them, when the sweep runs, then classifications, counts, refusal breakdown, and the de-duplicated summary line are identical to the pre-change behavior, except that a parked slug retained by a Story 2 guard (in-flight, or a live or unreadable `.pipeline/HALT`) keeps its named reason instead of being reclaimed | 11 | "with only `feat/daemon-*` parked slugs, whether the worktree listing is empty or names only those slugs' own worktrees, an unmerged park never reaches the helper and classifications, counts, refusal breakdown, and the summary line match the pre-change expectations except that a parked slug retained by a Story 2 guard keeps its named reason instead of being reclaimed, an orphaned park is annotated `orphan` and never deleted, and an unreadable record listing yields `unclassified` with no removal, as asserted by the preservation tests" | diff-local |
| Story 8 happy: Given a parked slug that is orphaned (closed source issue, not merged), when the sweep runs, then it is annotated `orphan` and never deleted, as today | 11 | "with only `feat/daemon-*` parked slugs, whether the worktree listing is empty or names only those slugs' own worktrees, an unmerged park never reaches the helper and classifications, counts, refusal breakdown, and the summary line match the pre-change expectations except that a parked slug retained by a Story 2 guard keeps its named reason instead of being reclaimed, an orphaned park is annotated `orphan` and never deleted, and an unreadable record listing yields `unclassified` with no removal, as asserted by the preservation tests" | diff-local |
| Story 8 negative: Given the record listing is unreadable, when the sweep runs over parked slugs, then each is classified `unclassified` and no removal occurs, as today | 11 | "with only `feat/daemon-*` parked slugs, whether the worktree listing is empty or names only those slugs' own worktrees, an unmerged park never reaches the helper and classifications, counts, refusal breakdown, and the summary line match the pre-change expectations except that a parked slug retained by a Story 2 guard keeps its named reason instead of being reclaimed, an orphaned park is annotated `orphan` and never deleted, and an unreadable record listing yields `unclassified` with no removal, as asserted by the preservation tests" | diff-local |
| Story 8 negative: Given a parked slug whose worktree was already removed by the enumerated path in the same pass, when the parked classification reaches it, then it is not evaluated a second time and is not double-counted | 5 | "`reconcileParkedFeatures` evaluates the union of parked slugs and depth-1 registered worktrees once per slug, with the listed branch attached, no dependence on the mergeable watch registry, and the summary line reporting the enumerated candidate count, as asserted by the union, once-per-slug, and missing-registry tests" | diff-local |

## Architecture Obligation Coverage

The changed land-accepted ADRs are adr-2026-08-01-multi-proof-park-deletion-authority (D6–D8 added), adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main (D8–D9 added), and adr-2026-07-27-ancestry-proven-park-reconciliation (additive notes under D1 and D4). Their amendments are DECIDE work committed on the spec branch, never a BUILD mutation.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-01-multi-proof-park-deletion-authority#D1 | existing | none | `reconcileMergedPark` and `proveByMergedPrHead` in `park-reconciliation.ts` already gate deletion on ancestry or merged-PR head identity and re-derive evidence at the point of deletion; unchanged |
| adr-2026-08-01-multi-proof-park-deletion-authority#D2 | no-change | none | no proof is added to the set; the branch-kind record rule removes a precondition for non-daemon branches and grants no new deletion authority |
| adr-2026-08-01-multi-proof-park-deletion-authority#D3 | existing | none | the `RefusalReason` taxonomy in `park-reconciliation.ts` is reused verbatim for every helper refusal |
| adr-2026-08-01-multi-proof-park-deletion-authority#D4 | existing | none | `reconcileParkedFeatures` already counts `refused` with a per-reason breakdown folded into `sweepSummarySignatures`; Task 5 extends the signature with the new retained counts without changing the contract |
| adr-2026-08-01-multi-proof-park-deletion-authority#D5 | no-change | none | deletion strength for parked slugs is unchanged; Task 11 pins the parked-only path against pre-change expectations |
| adr-2026-08-01-multi-proof-park-deletion-authority#D6 | task | task-1, task-5 | `reconcileParkedFeatures` evaluates the union of parked slugs and depth-1 registered worktrees once per slug, with the listed branch attached, no dependence on the mergeable watch registry, and the summary line reporting the enumerated candidate count, as asserted by the union, once-per-slug, and missing-registry tests |
| adr-2026-08-01-multi-proof-park-deletion-authority#D7 | task | task-2 | `gatherMergeEvidence` evaluates the supplied listed branch, so `hotfix-x`/`hotfix/x` is proven by ancestry and `<slug>`/`feat/daemon-<slug>` by merged-PR head identity, as asserted by the listed-branch evidence tests where the slug-segment lookup found no branch |
| adr-2026-08-01-multi-proof-park-deletion-authority#D8 | task | task-3 | `reconcileMergedPark` reclaims a proven-merged candidate on a non-`feat/daemon-*` branch with no shipped record and requests no record repair, and still returns `record-missing` with `deferred: true` for a `feat/daemon-*` candidate without one, as asserted by the branch-kind record tests |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D1 | existing | none | `daemon-runner.ts` no longer tears down on `outcome.done`; unchanged by this feature |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D2 | existing | none | the `MERGED` reap in `sweepMergeableLabels` is untouched; this feature adds a second path and modifies no line of `mergeable-sweep.ts` |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D3 | existing | none | `shippedRecordOnMain` and `listShippedStemsOnMain` still decide record presence by file presence on `origin/main`, never ancestry or `mergedAt` |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D4 | existing | none | `mergeable-sweep.ts` retains on `CLOSED` and `NOTFOUND`; unchanged |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D5 | existing | none | the mergeable sweep logs every retain-or-reap condition today; the new path logs through the rendered events of Task 7 and the summary line |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D6 | existing | none | the single-slug operator verb `daemon reclaim-worktree <slug>` in `daemon-park-cli.ts` is unchanged |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D7 | no-change | none | the helper remains idempotent and fail-open toward retention; the new path adds retention branches only |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D8 | task | task-5, task-6, task-10 | a merged non-daemon worktree in a temp repo is removed by one sweep pass and its `worktree_reclaim_reclaimed` record is present in the daemon-root `events.jsonl` after the worktree is gone, as asserted by the integration test |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D9 | task | task-5, task-6, task-8 | the sweep emits exactly one `worktree_reclaim_retained` per retained candidate carrying its closed-union reason, as asserted by the retained-event test |
| adr-2026-07-27-ancestry-proven-park-reconciliation#D1 | task | task-5 | `reconcileParkedFeatures` evaluates the union of parked slugs and depth-1 registered worktrees once per slug, with the listed branch attached, no dependence on the mergeable watch registry, and the summary line reporting the enumerated candidate count, as asserted by the union, once-per-slug, and missing-registry tests |
| adr-2026-07-27-ancestry-proven-park-reconciliation#D2 | existing | none | `reconcile_parked_auto_cleanup` is read in `daemon-cli.ts` and passed as `autoCleanup`; unchanged, and Task 6 keeps it governing parked candidates when the new key is off |
| adr-2026-07-27-ancestry-proven-park-reconciliation#D3 | existing | none | all deletion still flows through `reconcileMergedPark`, which accepts one slug and re-verifies; amended by adr-2026-08-01 D1 |
| adr-2026-07-27-ancestry-proven-park-reconciliation#D4 | task | task-3 | `reconcileMergedPark` reclaims a proven-merged candidate on a non-`feat/daemon-*` branch with no shipped record and requests no record repair, and still returns `record-missing` with `deferred: true` for a `feat/daemon-*` candidate without one, as asserted by the branch-kind record tests |
| adr-2026-07-27-ancestry-proven-park-reconciliation#D5 | task | task-5 | an in-flight candidate is retained with reason `in-flight` before the helper is called even when fully proven, as asserted by the in-flight-wins test |
| adr-2026-07-27-ancestry-proven-park-reconciliation#D6 | task | task-4 | a parked candidate still ends with `unparked` as its last step, as asserted by the parked reclaim test |
| adr-2026-07-27-ancestry-proven-park-reconciliation#D7 | existing | none | `daemon reconcile-parked <slug>` invokes the same helper with no `branch`, preserving today's behavior |
| adr-2026-07-27-ancestry-proven-park-reconciliation#D8 | no-change | none | the single-writer exception is unchanged: unpark still happens only inside the guarded helper, now conditioned on an existing marker |

## Verify-Claims Ledger

- `reconcileParkedFeatures` iterates `listOperatorParkedSlugs` only, and `.daemon/parked/` holds 0 entries on this checkout while 67 registered worktrees sit under `.worktrees/` — verified 2026-09-14, 100%.
- `listBranchesBySlug` keys refs by undated final path segment, so `feat/daemon-<slug>` and `hotfix/x` under `hotfix-x` are unmatched today — verified by reading `gatherMergeEvidence`, 100%.
- Record-only reclaims 10 of 67 worktrees here; merge proof reclaims 33 — verified by cross-referencing the worktree list, `ls-tree`, and `gh pr list --state merged --head`, 100%.
- `DaemonSweepContext.isFeatureInFlight` is not passed to `reconcileParkedFeatures` today — verified at the `sweepBestEffort` call sites, 100%.
- `EVENT_SINKS` is exhaustiveness-checked by `test/event-sink-registry.test.ts` — verified, 100%.

## Verification

- [ ] All happy path criteria covered by at least one task (Coverage Check: 27 rows)
- [ ] All negative path criteria covered by at least one task (Coverage Check: 28 rows)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks on single physical lines; no unbounded quality word is left open
- [ ] Dependencies are explicit and acyclic
- [ ] Every citable decision in the three amended ADRs has exactly one Architecture Obligation Coverage row (25 rows)
- [ ] Task 10 owns the cross-boundary integration proof through the daemon composition root

### Task rem-as-built-rem-ab1-1: src/conductor/src/daemon-cli.ts:2126-2134 — pass `reclaimMergedWorktrees: false` explicitly beside the existing `autoCleanup: false` at the startup-dashboard reconcileParkedFeatures call so the observational pass can never reach reconcileMergedPark for enumerated non-parked candidates; extend src/conductor/test/engine/daemon-cli-parked-reconciliation-wiring.test.ts with an assertion that the renderStartupDashboard call site passes both gates off, keeping the existing operational-binding assertions (`reclaimMergedWorktrees,`, `isFeatureInFlight`, `onEvent`) unchanged
**Gate:** as-built
**Rationale:** Verified 99% from current source: src/conductor/src/daemon-cli.ts:2126-2134 calls reconcileParkedFeatures with only `autoCleanup: false`, and src/conductor/src/engine/park-reconciliation.ts:640-643 gates enumerated non-parked candidates on `opts.reclaimMergedWorktrees === false`, so an omitted option is NOT disabled and the call reaches reconcileMergedPark at :648-666 even when `reclaim_merged_worktrees: false` is configured. The approved D8 kill switch is unchanged and authoritative, so this is conforming implementation drift on a second production caller, not an architectural question: route build. No existing plan task admits it — Task 6's Done-when governs the sweep's behaviour when the gate is false and Task 10's Done-when governs only the operational `reconcileParkedFeatures` dep binding; neither requires the startup-dashboard call to be non-reclaiming, so this is new remediation work rather than existing-task. Sibling sweep: exactly two production call sites of the sweep exist (daemon-cli.ts:2126 and :2272); the operational one already passes the resolved gate, so this one change closes the class, and the source-level invariant test in rem-ab2-1 prevents a third. No regression: `autoCleanup: false` and the observational dashboard behaviour are preserved verbatim, Task 6's disabled-gate and gate-off-parked assertions and Task 10's wiring assertions are untouched, and the new assertion is added beside them. Found and excluded: the three diagram/record-listing drifts under Drift Notes are non-blocking (absent from the Blocking Findings table) and live in this feature's sealed protected architecture artifact, which BUILD may not amend, so they are deliberately not tasked here.
**Governing clause:** adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main D8
**Done when:**
- adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main D8 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab1-1 is complete.

### Task rem-as-built-rem-ab2-1: src/conductor/test/engine/daemon-cli-parked-reconciliation-wiring.test.ts — add an invariant test over src/conductor/src/daemon-cli.ts source that every `reconcileParkedFeatures({` call site either passes both `autoCleanup: false` and `reclaimMergedWorktrees: false` or passes `onEvent:`, deriving the asserted option names from the ReconcileParkedFeaturesOptions declaration at src/conductor/src/engine/park-reconciliation.ts:100-120 so the two lists cannot drift; keep every existing wiring assertion in the file unchanged
**Gate:** as-built
**Rationale:** Verified 99% from current source: the same caller at src/conductor/src/daemon-cli.ts:2126-2134 supplies no `onEvent`, while emission is optional at src/conductor/src/engine/park-reconciliation.ts:667-713, so any reclaim, retention, or failure on that path is invisible to the daemon spine required by approved D9. Approved architecture is unchanged, so this is implementation drift and routes build; no existing plan task's Done-when covers a second sweep caller (Task 8 governs emission from the sweep given an injected emitter, Task 10 governs the operational binding), so it is not existing-task. The primary repair is rem-ab1-1 making that call report-only; this task adds the machinery that closes the class rather than the cited instance — a source-level invariant test asserting every reconcileParkedFeatures call site in daemon-cli.ts either disables both cleanup gates or supplies `onEvent`, so a future third caller cannot silently reclaim. Matched pair named: the invariant test enumerates call sites from daemon-cli.ts source only, and the option names it asserts (`autoCleanup`, `reclaimMergedWorktrees`, `onEvent`) are the exact ReconcileParkedFeaturesOptions fields at park-reconciliation.ts:100-120; the test reads those names from that interface rather than duplicating a literal list, so the two cannot drift. No regression: Task 8's missing-emitter criterion (the sweep completes and logs its summary line with no emitter injected) is preserved — nothing changes in the sweep's emitter handling — and no existing assertion is removed or relaxed.
**Governing clause:** adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main D9
**Done when:**
- adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main D9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab2-1 is complete.

### Task rem-as-built-rem-ab3-1: src/conductor/src/engine/park-reconciliation.ts — add `isFeatureInFlight?: (slug: string) => boolean` to ReconcileMergedParkOptions (:19-40), add `'in-flight'` to the RefusalReason union (:68-78) and to the `refusedByReason` zero-initializer (:521-540) in the same change so the two cannot drift, and refuse with `in-flight` inside reconcileMergedPark before project teardown and worktree removal (:890-930) when either the injected predicate reports the slug active or the candidate worktree has a live `.pipeline/phase-active` marker read via `phaseMarkerPath` from src/conductor/src/engine/phase-marker.ts; thread `isFeatureInFlight: opts.isFeatureInFlight` through the sweep's helper call at :648-666 so the helper re-derives liveness instead of trusting the sweep's pre-helper retention at :575, which stays unchanged
**Gate:** as-built
**Rationale:** Verified 97% from current source: ReconcileMergedParkOptions at src/conductor/src/engine/park-reconciliation.ts:19-40 carries no liveness input and reconcileMergedPark reaches teardown and removal at :890-930 without any in-flight check, while approved adr-2026-07-27 Decision 5 assigns that refusal to the helper itself; the operator verb calls the helper directly at src/conductor/src/engine/daemon-park-cli.ts:165-190 with no predicate, so the only liveness guard today is the sweep-side one at :575, which that caller bypasses. The approved decision is unambiguous and unchanged, so this is conforming implementation drift and routes build, not architecture_review or halt. Not existing-task: Task 5's Done-when pins sweep-side retention `before the helper is called`, and Task 4's helper Done-when lists teardown, unpark, worktree-remove-failed, invalid-slug, and stale-classification refusals only — no plan task's Done-when admits a helper-level liveness refusal. Sibling sweep: both helper call sites are named and carried (the sweep at :648-666 must thread its predicate through so the helper re-derives rather than trusts the caller, and the operator CLI at daemon-park-cli.ts:165-190 gets the marker-derived refusal and prints it); no third caller exists and nothing is removed, so there is no orphan. Matched pair: `RefusalReason` at park-reconciliation.ts:68-78 is duplicated by the `refusedByReason` zero-initializer at :521-540 and is embedded in `WorktreeReclaimRetainedReason` in src/conductor/src/types/events.ts, so the added `in-flight` member must be added to the initializer in the same task; the retained union already carries the literal `in-flight`, so the closed event union and its sink declarations are unchanged. No regression: Task 5's in-flight-wins retention test, Task 4's refusal and stale-classification tests, and Task 11's single-removal and parked-path preservation tests all keep asserting their existing outcomes and the new helper-level tests are added beside them; the sweep's pre-helper retention is kept rather than replaced, because it is what keeps the retained event reason `in-flight` rather than a refusal.
**Governing clause:** adr-2026-07-27-ancestry-proven-park-reconciliation D5
**Done when:**
- adr-2026-07-27-ancestry-proven-park-reconciliation D5 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab3-1 is complete.

### Task rem-as-built-rem-ab3-2: src/conductor/src/engine/daemon-park-cli.ts:165-190 — the direct operator `reconcile-parked` call now receives the helper's marker-derived `in-flight` refusal and prints `Could not reconcile '<slug>': in-flight` through the existing refusal branch; add tests in src/conductor/test/engine/park-reconciliation.test.ts asserting the helper refuses `in-flight` with no teardown, no `git worktree remove`, no branch deletion and no unpark for (a) an injected predicate reporting active and (b) a live `.pipeline/phase-active` marker with no predicate injected, plus a test in the daemon-park CLI suite pinning the operator-verb refusal line, keeping the existing parked-reclaim, worktree-remove-failed, invalid-slug and stale-classification assertions unchanged
**Gate:** as-built
**Rationale:** Verified 97% from current source: ReconcileMergedParkOptions at src/conductor/src/engine/park-reconciliation.ts:19-40 carries no liveness input and reconcileMergedPark reaches teardown and removal at :890-930 without any in-flight check, while approved adr-2026-07-27 Decision 5 assigns that refusal to the helper itself; the operator verb calls the helper directly at src/conductor/src/engine/daemon-park-cli.ts:165-190 with no predicate, so the only liveness guard today is the sweep-side one at :575, which that caller bypasses. The approved decision is unambiguous and unchanged, so this is conforming implementation drift and routes build, not architecture_review or halt. Not existing-task: Task 5's Done-when pins sweep-side retention `before the helper is called`, and Task 4's helper Done-when lists teardown, unpark, worktree-remove-failed, invalid-slug, and stale-classification refusals only — no plan task's Done-when admits a helper-level liveness refusal. Sibling sweep: both helper call sites are named and carried (the sweep at :648-666 must thread its predicate through so the helper re-derives rather than trusts the caller, and the operator CLI at daemon-park-cli.ts:165-190 gets the marker-derived refusal and prints it); no third caller exists and nothing is removed, so there is no orphan. Matched pair: `RefusalReason` at park-reconciliation.ts:68-78 is duplicated by the `refusedByReason` zero-initializer at :521-540 and is embedded in `WorktreeReclaimRetainedReason` in src/conductor/src/types/events.ts, so the added `in-flight` member must be added to the initializer in the same task; the retained union already carries the literal `in-flight`, so the closed event union and its sink declarations are unchanged. No regression: Task 5's in-flight-wins retention test, Task 4's refusal and stale-classification tests, and Task 11's single-removal and parked-path preservation tests all keep asserting their existing outcomes and the new helper-level tests are added beside them; the sweep's pre-helper retention is kept rather than replaced, because it is what keeps the retained event reason `in-flight` rather than a refusal.
**Governing clause:** adr-2026-07-27-ancestry-proven-park-reconciliation D5
**Done when:**
- adr-2026-07-27-ancestry-proven-park-reconciliation D5 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab3-2 is complete.

### Task rem-as-built-rem-ab4-1: src/conductor/src/engine/park-reconciliation.ts:279-305 — stop discarding branchless porcelain records in listRegisteredWorktrees: require only the `worktree ` line, make `RegisteredWorktree.branch` optional (`branch?: string`), and emit a directly nested detached entry as `{ slug: basename, branch: undefined, reclaimable: false }` so it is enumerated as one fail-closed candidate and never reaches reconcileMergedPark; add `'detached'` to WorktreeReclaimRetainedReason at src/conductor/src/types/events.ts:20-28 and to the `retainedByReason` zero-initializer at park-reconciliation.ts:522-540 in the same change so the two cannot drift; in the sweep's guard chain at :574-577 select reason `detached` (not `invalid-slug`) when the candidate is non-reclaimable because it carries no branch, keeping the existing nested-path `invalid-slug` retention unchanged; and restrict `hasRecordGatedCandidate` at :558-560 to reclaimable candidates so a branchless entry cannot reintroduce the shipped-record listing read that the all-non-daemon pass skips
**Gate:** as-built
**Rationale:** Verified 99% from current source: listRegisteredWorktrees at src/conductor/src/engine/park-reconciliation.ts:283-287 requires a `branch refs/heads/` line and `continue`s otherwise, so a directly nested, git-registered detached worktree under `.worktrees/` is dropped before the depth-one check at :291-294 and never becomes a candidate; the fixture at src/conductor/test/engine/park-reconciliation-worktree-listing.test.ts:11-29 pins that exclusion. Approved adr-2026-08-01 D6 (.docs/decisions/adr-2026-08-01-multi-proof-park-deletion-authority.md:98-104) requires reconcileParkedFeatures to enumerate EVERY directly nested registered worktree, and approved adr-2026-07-29 D9 (:104-113) requires a named retained event for every enumerated non-reclaim; both approved decisions are unchanged and authoritative, so this is conforming implementation/test drift and routes build, not architecture_review or halt. Not existing-task: no active plan task's Done-when admits enumerating a detached worktree — Task 1's Done-when asserts the opposite exclusion and Task 5's Done-when governs only slug-shape and HALT retention — so the remedy is new remediation work; Task 1's Done-when wording is the drifted side of this conflict, and the as-built Resolution states the code, not the approved ADR, must change, so this is not a `plan` gap either. No regression: the safety Task 1's exclusion criterion actually delivers — a detached worktree is never handed to the destructive helper and its detached commits are never deleted — is preserved in the SAME task by emitting the entry with `reclaimable: false`, which the sweep's pre-helper retention at :574-577 turns into a named retained disposition before any evidence gathering or reconcileMergedPark call; only the listing's representation changes, and Task 1's nested-path, outside-path, depth-one branch-capture and null-on-reject assertions are all kept unchanged beside the new one. Matched pair named: the retained-reason union WorktreeReclaimRetainedReason at src/conductor/src/types/events.ts:20-28 is duplicated by the `retainedByReason` zero-initializer at park-reconciliation.ts:522-540, so the new `detached` member is added to both in one task; the event union carries the reason as a field, so EVENT_SINKS at src/conductor/src/engine/event-sinks.ts:164-166 and the renderer are unaffected (retained is persist-only) and are deliberately untouched. Sibling sweep: the porcelain parser is the only enumeration site (one caller at park-reconciliation.ts:542), and the only other record-shape assumption in the same parser — `requiresShippedRecord(undefined)` returning true at :196-198, which a branchless candidate would otherwise flip `hasRecordGatedCandidate` at :558-560 to true and reintroduce the shipped-record listing read that the 2026-09-18 adr-2026-07-29 D9 amendment removed for all-non-daemon passes — is carried in the same task. Found and excluded: the three Drift Notes (stale diagram listing-failure semantics, missing startup-caller edge, detached-candidate description) and the daemon-guide documentation note are not in the Blocking Findings table and live in this feature's own sealed `.docs/architecture/` and `.docs/decisions/` artifacts, which BUILD may not amend without a reseal, so they are deliberately not tasked here.
**Governing clause:** adr-2026-08-01-multi-proof-park-deletion-authority D6
**Done when:**
- adr-2026-08-01-multi-proof-park-deletion-authority D6 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab4-1 is complete.

### Task rem-as-built-rem-ab4-2: src/conductor/test/engine/park-reconciliation-worktree-listing.test.ts:9-29 — update the listing expectation so the `/project/.worktrees/detached` record is returned as `{ slug: 'detached', reclaimable: false }` with no branch, keeping the existing assertions that the nested `feat/daemon-x` entry is non-reclaimable, that the project root and `.claude/worktrees/x` entries are absent, that depth-one entries carry their `branch refs/heads/` value, and that a rejected runner returns `null`; add a sweep test in src/conductor/test/engine/park-reconciliation.test.ts asserting a detached registered worktree is counted as one enumerated candidate, retained with reason `detached`, emits exactly one `worktree_reclaim_retained` event with that reason, and causes zero reconcileMergedPark calls, zero `git worktree remove`, and zero branch deletion
**Gate:** as-built
**Rationale:** Verified 99% from current source: listRegisteredWorktrees at src/conductor/src/engine/park-reconciliation.ts:283-287 requires a `branch refs/heads/` line and `continue`s otherwise, so a directly nested, git-registered detached worktree under `.worktrees/` is dropped before the depth-one check at :291-294 and never becomes a candidate; the fixture at src/conductor/test/engine/park-reconciliation-worktree-listing.test.ts:11-29 pins that exclusion. Approved adr-2026-08-01 D6 (.docs/decisions/adr-2026-08-01-multi-proof-park-deletion-authority.md:98-104) requires reconcileParkedFeatures to enumerate EVERY directly nested registered worktree, and approved adr-2026-07-29 D9 (:104-113) requires a named retained event for every enumerated non-reclaim; both approved decisions are unchanged and authoritative, so this is conforming implementation/test drift and routes build, not architecture_review or halt. Not existing-task: no active plan task's Done-when admits enumerating a detached worktree — Task 1's Done-when asserts the opposite exclusion and Task 5's Done-when governs only slug-shape and HALT retention — so the remedy is new remediation work; Task 1's Done-when wording is the drifted side of this conflict, and the as-built Resolution states the code, not the approved ADR, must change, so this is not a `plan` gap either. No regression: the safety Task 1's exclusion criterion actually delivers — a detached worktree is never handed to the destructive helper and its detached commits are never deleted — is preserved in the SAME task by emitting the entry with `reclaimable: false`, which the sweep's pre-helper retention at :574-577 turns into a named retained disposition before any evidence gathering or reconcileMergedPark call; only the listing's representation changes, and Task 1's nested-path, outside-path, depth-one branch-capture and null-on-reject assertions are all kept unchanged beside the new one. Matched pair named: the retained-reason union WorktreeReclaimRetainedReason at src/conductor/src/types/events.ts:20-28 is duplicated by the `retainedByReason` zero-initializer at park-reconciliation.ts:522-540, so the new `detached` member is added to both in one task; the event union carries the reason as a field, so EVENT_SINKS at src/conductor/src/engine/event-sinks.ts:164-166 and the renderer are unaffected (retained is persist-only) and are deliberately untouched. Sibling sweep: the porcelain parser is the only enumeration site (one caller at park-reconciliation.ts:542), and the only other record-shape assumption in the same parser — `requiresShippedRecord(undefined)` returning true at :196-198, which a branchless candidate would otherwise flip `hasRecordGatedCandidate` at :558-560 to true and reintroduce the shipped-record listing read that the 2026-09-18 adr-2026-07-29 D9 amendment removed for all-non-daemon passes — is carried in the same task. Found and excluded: the three Drift Notes (stale diagram listing-failure semantics, missing startup-caller edge, detached-candidate description) and the daemon-guide documentation note are not in the Blocking Findings table and live in this feature's own sealed `.docs/architecture/` and `.docs/decisions/` artifacts, which BUILD may not amend without a reseal, so they are deliberately not tasked here.
**Governing clause:** adr-2026-08-01-multi-proof-park-deletion-authority D6
**Done when:**
- adr-2026-08-01-multi-proof-park-deletion-authority D6 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab4-2 is complete.
