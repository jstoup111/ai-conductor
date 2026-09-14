# Architecture Review: Reclaim merged feature worktrees without depending on the mergeable watch registry

**Date:** 2026-09-14
**Mode:** lightweight (Medium tier) — §2 Feasibility and §4 Alignment in full; §3/§5 skipped per tier
**Input reviewed:** `.docs/track/reclaim-merged-feature-worktrees-without-depending.md` (scope
boundary), `.docs/architecture/reclaim-merged-feature-worktrees-without-depending.md`, the
repo-wide ADR sweep over all 585 files in `.docs/decisions/`, and `jstoup111/ai-conductor#1510`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new packages or services. `git worktree list --porcelain`, `ls-tree`, `for-each-ref`, `merge-base`, and `gh pr list --json headRefOid` are all already invoked by `park-reconciliation.ts`. |
| Prerequisites | None outside the diff. The guarded helper `reconcileMergedPark`, its teardown invitation, and its `sweepBestEffort` wiring exist and run at four boundaries (startup, idle, busy, terminal collection). |
| Integration surface | One module widened (`park-reconciliation.ts`), one composition-root binding extended (`daemon-cli.ts`), one sweep-context field threaded (`daemon.ts`), one config key (`config.ts` + consumer registry), three event variants (`types/events.ts` + `event-sinks.ts` + `daemon-cli.ts` renderer). No new removal module, so `worktree-removal-coverage.test.ts`'s routed set is untouched. |
| Data implications | None. `.docs/shipped/` is read, never written. The watch registry is neither read nor written by this path. |
| Performance risk | The sweep already prefetches the record and ref listings once per pass. The new enumeration adds one `git worktree list --porcelain` per pass. `gh` is called only for candidates whose branch is not an ancestor of `origin/main`, capped by the candidate count (67 here on the first pass, falling as worktrees are reclaimed). No per-candidate `git fetch`: the existing pass reads `origin/main` as already fetched by the daemon's own refresh. |
| Worktree isolation | The sweep runs from the main root only. It never reclaims `engineer-*` or `resolve-*` worktrees, and it never reclaims an in-flight slug. Two daemons on one repo are already excluded by the pidfile lock. |

**Verified claims (basis: read in this checkout on 2026-09-14):**

- `reconcileParkedFeatures` iterates `listOperatorParkedSlugs` only; `.daemon/parked/` holds 0
  entries here while 67 git-registered worktrees sit under `.worktrees/`. Confidence 100%, verified.
- `reconcileMergedPark` resolves branches by the ref's undated final path segment, so
  `feat/daemon-<slug>` (segment `daemon-<slug>`) and `hotfix/x` under directory `hotfix-x` are both
  missed today. Confidence 100%, verified by reading `listBranchesBySlug` and `gatherMergeEvidence`.
- Measured: 10 of 67 worktrees carry a shipped record on `origin/main`; 23 more carry a MERGED PR
  and no record; 17 are `feat/daemon-*` with no record; 11 `engineer-*`; 1 `resolve-*`; 1 open
  PR; 4 no PR. Confidence 100%, verified by cross-referencing `git worktree list`, `ls-tree`, and
  `gh pr list --state merged --head`.
- Two registered worktrees have nested paths (`.worktrees/feat/…`, `.worktrees/fix/…`), so a flat
  `readdir` is an incorrect enumeration source. Confidence 100%, verified.
- Production `teardownWorktree` (`daemon-deps.ts`) ignores `FeatureWorktree.branch`; the filer's
  branch-naming hypothesis is a no-op on that path. Confidence 100%, verified.
- `DaemonSweepContext.isFeatureInFlight` is passed to `sweepMergeableLabels` but not to
  `reconcileParkedFeatures`. Confidence 100%, verified at the `sweepBestEffort` call sites.

## Alignment

**Governing decisions applied and reused (no new ADR):**

- `adr-2026-08-01-multi-proof-park-deletion-authority` — the proof set and the single-slug guarded
  helper are reused verbatim. Amended (D6–D8) to widen the helper's candidate source, key proofs
  on the listed branch, and scope the record precondition by branch kind. The proof set is
  unchanged; nothing becomes deletable that both proofs would refuse.
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` — D6 (single-slug
  operator verb) is preserved; amended (D8–D9) to add the enumeration-fed automatic path and the
  named retention branches with their spine events.
- `adr-2026-07-27-ancestry-proven-park-reconciliation` — D1 and D4 carry additive notes pointing
  at the `adr-2026-08-01` amendments so the chain stays readable.
- `adr-2026-08-07-project-teardown-hook-contract-and-containment` — unchanged and satisfied: the
  removal stays inside `park-reconciliation.ts`, one of the three invitation points, so "Three,
  exactly" holds and the structural coverage guard needs no new entry.
- `adr-2026-08-05-worktree-classification-evidence-derived-reasons` — every retention reason names
  a condition the sweep established; listing failure renders as `listing-unavailable`, a probe
  failure as the helper's `ancestry-check-failed`, never as "not merged".
- `adr-2026-07-26-event-sink-registry-exhaustiveness` and
  `adr-2026-08-26-setup-once-per-worktree-marker` — three new variants appended at the end of the
  `ConductorEvent` union, each declared in `EVENT_SINKS`, `reason` a closed union, log line rendered
  from the event.
- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` D4 — the new key
  `reclaim_merged_worktrees` is registered with consumer `daemon-cli.ts`.
- `adr-2026-08-27-daemon-dispatcher-executor-seam` D1 — the sweep stays dispatcher-side inside
  `sweepBestEffort`, ordered after `reconcileHaltPrs` as today.
- `adr-2026-09-11-github-operation-ownership` D5 — local worktree actions and `origin` reads need
  no ownership gate; D2 is why remote branch deletion stays out of scope (only local `branch -D`,
  which the helper already performs).
- `architecture-review-2026-08-05-worktree-with-no-conduct-state-is-retained-as-pr-o` condition 2
  — the dashboard is not a dispatch input: this path neither imports `daemon-dashboard.ts` nor is
  imported by it.

**Domain boundaries.** Reclamation stays inside the park-reconciliation module that already owns
worktree deletion. `mergeable-sweep.ts` is not modified; its registry-driven reap remains as a
second, now-redundant automatic path (retiring it is a separate decision).

**Pattern consistency.** The change follows the module's own shape: prefetch listings once per
pass, classify per slug, feed the single-slug helper, count outcomes, print one de-duplicated
summary line. The `provider-scratch` trio is the precedent for the event shape.

**State management.** Retention reasons and refusal reasons are closed string unions. No boolean
flags encode state; the config key is a genuine on/off with the same semantics as its sibling.

**Diagram accuracy.** `.docs/architecture/reclaim-merged-feature-worktrees-without-depending.md`
was rewritten to this design and renders.

**Focused local pattern basis.** Precedent: the existing prefetch-then-per-slug loop in
`reconcileParkedFeatures` (`park-reconciliation.ts`, symbols `listShippedStemsOnMain`,
`listBranchesBySlug`, `gatherMergeEvidence`, `reconcileMergedPark`). Traits to preserve: listings
read once per pass; per-slug error isolation; classification never trusted by the helper, which
re-derives evidence; outcomes counted and summarized once with a de-duplication signature.
Allowed variation: the candidate source, the evidence key (branch from listing), and the added
event emission. BUILD must rediscover these symbols on its own HEAD.

## Wiring Surface

| New or changed surface | Called from in production |
|---|---|
| `reconcileParkedFeatures` widened candidate set + `isFeatureInFlight` option | `daemon-cli.ts` composition root binding `reconcileParkedFeatures`, invoked by `daemon.ts` `sweepBestEffort` at startup, idle, busy, and terminal-collection boundaries |
| `reconcileMergedPark` accepting the listed branch and the branch-kind record rule | The widened sweep above; the operator verb `daemon reconcile-parked <slug>` (`daemon-park-cli.ts`) keeps its current behavior for parked slugs |
| Config key `reclaim_merged_worktrees` (boolean, default `true`) | Read in `daemon-cli.ts` beside `reconcile_parked_auto_cleanup`; validated in `config.ts`; declared in `test/engine/config-consumer-registry.ts` |
| Events `worktree_reclaim_reclaimed`, `worktree_reclaim_retained`, `worktree_reclaim_failed` | Emitted by the sweep through the daemon's root emitter; declared in `event-sinks.ts`; rendered by `daemon-cli.ts`'s event renderer; persisted to the daemon-root `events.jsonl` |
| `DaemonSweepContext.isFeatureInFlight` threaded to `reconcileParkedFeatures` | `daemon.ts` `sweepBestEffort` |
| `docs/guides/running-the-daemon.md` — "Parked-feature reconciliation" and "Retained worktrees" | Operator documentation of the widened sweep and the new config key |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Reclaiming a worktree whose slug is mid-dispatch | Data | Low | High | Sweep excludes `isFeatureInFlight` before the helper; helper is single-slug and re-derives proof. Test: N candidates with one in flight → that one retained with reason `in-flight`. |
| Reclaiming a halted worktree an operator still needs | Data | Low | High | `.pipeline/HALT` present → retained with reason `halted`, regardless of proof. |
| First pass on a long-lived checkout removes many worktrees at once | Data | High | Medium | Every removal is one proven slug through the guarded helper; each is logged and emitted. Operator can set `reclaim_merged_worktrees: false` first and read the retained/reclaimable events. |
| Nested or hand-created path shapes misclassified | Technical | Medium | Medium | Enumeration from `git worktree list --porcelain`, depth-1 filter, `SINGLE_SLUG` validation; anything else retained as `invalid-slug`. |
| `gh` calls per pass grow with the candidate count | Performance | Medium | Low | Only non-ancestor candidates hit `gh`; count falls as worktrees are reclaimed; capability errors retain. |
| Retained events flood the daemon log | Technical | High | Low | `worktree_reclaim_retained` declared `render: false, persist: true`; the existing summary line carries counts. |
| `mergeable-sweep`'s own reap and this path both act on one slug | Integration | Low | Low | Both are idempotent and best-effort; a missing worktree is `branch-absent`/no-op. |

## ADRs Created

None. Three governing ADRs amended additively; see Alignment.

## Conditions

1. **Enumeration source.** Candidates come from `git worktree list --porcelain`, filtered to paths
   directly under `<projectRoot>/.worktrees/`; never `readdir`. Each candidate carries its listed
   branch into the helper.
2. **Exclusions before the helper, each with a named reason:** in flight (sweep context),
   `engineer-*` / `resolve-*` prefix, invalid or nested slug, live `.pipeline/HALT`.
3. **Record precondition by branch kind** exactly as `adr-2026-08-01` D8: required for
   `feat/daemon-*`, not required otherwise.
4. **Unpark is conditional.** The helper's final unpark step runs only when a park marker exists
   for the slug; a non-parked candidate must not fail with `unpark-failed`.
5. **Events.** Three variants appended at the end of the union; `reason` closed union;
   `EVENT_SINKS` rows `reclaimed: render true`, `retained: render false`, `failed: render true`,
   all `persist: true`; renderer arms added; exhaustiveness test extended.
6. **Config key** `reclaim_merged_worktrees`, boolean, default `true`, validated in `config.ts`,
   registered in the consumer registry with consumer `daemon-cli.ts`, documented in the daemon
   guide. Default `true` is justified by the sibling `reconcile_parked_auto_cleanup` (same
   helper, same proofs, same blast radius); a consumer that wants a report-only first pass sets it
   `false` and reads the retained events.
7. **Whole-pass retention on listing failure.** An unreadable worktree, record, or ref listing
   retains every candidate for that pass with reason `listing-unavailable`; no partial verdicts.
8. **Single-removal property is tested:** a sweep over N candidates with exactly one proven slug
   removes exactly one path.
9. **Docs.** `docs/guides/running-the-daemon.md` "Parked-feature reconciliation" and "Retained
   worktrees" describe the widened candidate set, the branch-kind record rule, the new key, and
   the events.

## Deferred (recorded, out of scope by operator decision)

- An on-demand operator command reporting per-worktree reclaimability (intake Desired-outcome #4).
- Retiring the now-redundant registry-driven reap in `mergeable-sweep.ts`.
- Reclaiming abandoned `resolve-*` and `engineer-*` worktrees (owned by their own lifecycles).
