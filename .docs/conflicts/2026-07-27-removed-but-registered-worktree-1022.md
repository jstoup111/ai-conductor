# Conflict Check: removed-but-registered worktree 128 loop (#1022)

**Date:** 2026-07-27
**New stories:** .docs/stories/removed-but-registered-worktree-causes-a-silent-gi.md (5 stories)
**Scanned against:** all `.docs/stories/` on the spec base, the park/worktree/dispatch
subsystem sources, and all open PRs (#1064, #1063, #1058, #997, #995, #890, #869, #770)
**Result:** PASSED — zero blocking conflicts; one degrading overlap resolved by
re-grounding an ADR rationale, two compatible interactions recorded

## Overlap 1 — PR #770 relocates `.pipeline/` out of the worktree (degrading, resolved)

**Stories involved:** #1022 Story 3 vs open spec PR #770
(`.docs/stories/pipeline-run-state-lives-inside-the-worktree-cwd-r.md`,
ADR `adr-2026-07-21-run-state-home-dir-placement.md`, APPROVED, **unmerged**)
**Files:** `.docs/decisions/adr-2026-07-27-worktree-prune-reconciliation-and-creation-failure-park.md`
vs `.docs/decisions/adr-2026-07-21-run-state-home-dir-placement.md`
**Type:** rationale dependency
**Severity:** degrading (resolved)

**Description:** #1022's ADR Decision 2 argues the durable failure record must be an
auto-park because `.pipeline/HALT` is *structurally unavailable* — it lives inside a
worktree that failed to be created. PR #770 proposes relocating all run-state, `HALT`
included, to `~/.ai-conductor/runs/<project-key>/<slug>/` with the in-tree `.pipeline/`
becoming an outward symlink, addressed by **feature identity rather than cwd**. If #770
merges first, a HALT becomes writable without a worktree and the "structurally unavailable"
premise no longer holds as stated. Notably, #770's own ADR cites #486 — an auto-park
placement bug — as one of the failures its relocation makes impossible, so the two changes
are reasoning about the same durability surface from opposite ends.

**Resolution applied (re-ground the rationale, no scope change):** #1022's ADR Decision 2 is
justified on the **dispatch-gating** property, not merely on HALT's unavailability. That
property is independent of #770: `pickEligible` consults `isParked` **first and
unconditionally** (`daemon.ts:136`), whereas `isHalted` is a later, conditional check whose
production wiring resolves a worktree-relative path (`daemon-deps.ts:265`). A HALT — wherever
its bytes live — would therefore still not gate dispatch for a feature with no worktree
without additionally rewiring `isHalted`. The auto-park is the correct gate under both
orderings. The unavailability argument is retained as the *immediate* reason and is explicitly
scoped to today's layout; the ADR's Decision 2 leads with the gating property. No ADR is
superseded and neither PR blocks the other.

**Merge-order note for the implementer:** if #770 lands first, the only touchpoint is that
`.pipeline/HALT` is no longer worktree-relative. Story 3e (post-worktree throws still write
a HALT and keep the worktree) is expressed in terms of `writeErrorHalt`'s behavior, not its
path, so it survives either ordering unchanged.

## Overlap 2 — #651 guarded dispatch and the provenance of the gate (compatible, verified)

**Stories involved:** #1022 Story 3c vs `.docs/stories/park-all-dispatch-paths.md` (#651,
Accepted)
**Type:** shared predicate
**Severity:** none (compatible — verified, not assumed)

**Description:** #651 states the dispatch gate is wired to `isOperatorParked`, which read
naively suggests the gate honors only **operator** parks and would ignore the **auto**-park
#1022 writes — which would defeat Story 3c entirely. This was treated as load-bearing and
verified against source rather than inferred.

**Finding:** no conflict. `isOperatorParked` (`park-marker.ts:158-176`) is
provenance-**agnostic** — it tests only for the existence of `parkedMarkerPath(mainRoot,
slug)` and returns `true` for any marker, including a zero-byte one. `writeAutoPark`
(`park-marker.ts:230`) writes to that exact same path. So an auto-park is honored by the
gate wired at `daemon-cli.ts:1360`, and #651's `guardedDispatch` re-check strengthens #1022
by closing the selection→dispatch window for it too. Provenance is recovered separately by
`getProvenanceType` reading the `auto-parked:` body prefix, which is why Story 3d asserts it.

**Second-order note:** `writeAutoPark` uses an exclusive create (`wx`) and treats `EEXIST` as
a no-op, so a #1022 auto-park can never clobber a pre-existing operator park. That is the
desired precedence and needs no new machinery.

## Overlap 3 — #1060/#1063 park reconciliation is a deletion authority (compatible, recorded)

**Stories involved:** #1022 Story 3 vs `.docs/stories/parked-feature-reconciliation-1060.md`
(open, in remediation on PR #1063)
**Type:** lifecycle interaction
**Severity:** none (compatible — recorded so it is not rediscovered)

**Description:** #1060 introduces `reconcileMergedPark` as the **sole deletion authority**
for park markers, called from a sweep (`park-reconciliation.ts`) and a
`daemon reconcile-parked <slug>` verb. Any new park marker must be safe under it.

**Finding:** no conflict. That reconciler deletes a park only when the feature's branch has
genuinely merged (ancestry via `merge-base --is-ancestor` against real git). A worktree that
could not be created has, by construction, no merged branch, so a #1022 auto-park is
classified as live and preserved. #1022 adds no deletion path of its own and does not
auto-clear its park (an explicit ADR decision — a silent self-unpark would reintroduce the
unobserved retry loop being fixed), so it introduces no second deletion authority.

## Non-conflict checked: `reconcileStrandedParkMarkers`

`reconcileStrandedParkMarkers` (`park-marker.ts:310`) migrates markers found under a
*worktree's* `.daemon/parked/` up to the main root — the #486 misplacement repair. It reads
`<mainRoot>/.worktrees/*/` and never deletes a marker at the main root. A #1022 auto-park is
written directly to the main root via `resolveMainRepoRoot`, so it is outside this
reconciler's scan set and cannot be moved or removed by it. No interaction.

## Non-conflict checked: the other open PRs

#1064 (Codex usage-metric parsing), #1058 (version-freeze tracking), #997 (protected-artifact
seal staleness), #995 (staleness event sinks), #890 (trailer-scan subprocess caching), and
#869 (engineer unclaim/requeue) touch neither `worktree-shared.ts`, the daemon worktree
create path, nor the park-marker surface. No story-level overlap.

## Non-conflict checked: the interactive `WorktreeManager` prune

`WorktreeManager.cleanup()` already calls `git worktree prune` (`worktree.ts:87`) as a
fallback after a failed `worktree remove`. It is used by the interactive path
(`index.ts:41`, `conductor.ts:182`) and **not** by the daemon create path, so #1022's
prune-at-the-seam neither duplicates nor contends with it. #1022 explicitly leaves it
untouched (recorded in the track doc's Out of scope).
