# Track: removed-but-registered worktree causes a silent 128 loop with no halt written

Track: technical

Source issue: jstoup111/ai-conductor#1022

## Why technical

This is an internal engine-reliability fix to the daemon's worktree create/reconcile
mechanism and its failure-recording path. No user-facing product surface, no data model,
no new operator command. Acceptance criteria are mechanical (a prunable registration is
not treated as reusable; a stale registration is pruned; a worktree-creation failure
produces a durable dispatch-gating record). Acceptance criteria live in the stories, not
a PRD.

## The filer's hypothesis — carried as a candidate, not the chosen approach

Issue #1022 arrived with an embedded fix direction naming two seams. Both diagnoses are
**confirmed**; one of the two proposed remedies is **not viable** and one is
**insufficient**. Recorded here so the plan does not inherit the sketch verbatim.

| Filer's claim | Verdict | Evidence |
|---|---|---|
| `isRegisteredWorktree` does not filter prunable entries, so `ensureWorktree` returns `'reused'` for a path that does not exist | **Confirmed** | `worktree-shared.ts:92-98` filters `l.startsWith('worktree ')` and matches the path; nothing inspects the sibling `prunable` line |
| `createWorktree` throws before a worktree exists, so `writeErrorHalt` never runs and no `.pipeline/HALT` is written | **Confirmed** | `daemon-runner.ts:311` assigns `worktree`; the catch at `:535` guards `if (worktree)`, so a throw from `createWorktree` writes nothing |
| Remedy: "a `git worktree add` failure writes a durable halt" (i.e. `.pipeline/HALT`) | **Not viable as stated** | `.pipeline/` lives *inside* the worktree. When creation is what failed there is no directory to write into. A different durable surface is required — see below |
| Remedy: filter prunable in `isRegisteredWorktree` | **Necessary but insufficient** | Verified by reproduction: with the entry filtered out, `ensureWorktree` falls through to the attach path, and `git worktree add <path> <branch>` **also** exits 128 against the surviving stale registration |

## Verified reproduction (throwaway repo, this session)

```
$ git worktree add -b feat .worktrees/slug main
$ rm -rf .worktrees/slug
$ git worktree list --porcelain
worktree /tmp/repro/.worktrees/slug
HEAD 1791e0d…
branch refs/heads/feat
prunable gitdir file points to non-existent location      <-- sibling line, same record

$ git worktree add .worktrees/slug feat
fatal: '.worktrees/slug' is a missing but already registered worktree;
use 'add -f' to override, or 'prune' or 'remove' to clear
exit=128

$ git worktree prune && git worktree add .worktrees/slug feat
HEAD is now at 1791e0d init                                exit=0
```

Two structural facts fall out of this and constrain the design:

1. **`prunable` is a sibling line within the same porcelain record**, not a modifier on the
   `worktree` line. A line-wise filter cannot see it — `isRegisteredWorktree` must parse
   the porcelain into blank-line-separated **records** and reject a record carrying
   `prunable`.
2. **Both `git worktree prune` and `git worktree add -f` clear the condition** (both
   verified). `prune` is preferred: it is scoped to registrations whose directory is
   already gone, touches no live worktree, and is the remedy the repo's own runbook
   already tells operators to run. `add -f` masks the stale registration rather than
   reconciling it.

## Why the durable failure record must be an auto-park

`.pipeline/HALT` is unavailable (no worktree). Surveying the durable surfaces that live in
the primary checkout under `.daemon/`, only one both **survives restart** and **gates
dispatch**:

- `.daemon/parked/<slug>` — written by `writeAutoPark(projectRoot, slug, reason)`
  (`park-marker.ts:220`), always resolved to the main repo root even when called from a
  worktree (`resolveMainRepoRoot`, `park-marker.ts:50`). `pickEligible` skips a parked slug
  **unconditionally** (`daemon.ts:136`), before the in-memory `parked`/`started` sets are
  consulted. Provenance is distinguishable from an operator park by the `auto-parked:` body
  prefix (`getProvenanceType`, `park-marker.ts:265`).
- `.daemon/processed/<slug>` — shipped features only; wrong semantics.
- `.daemon/warned/<slug>` — one-shot log dedup; does not gate dispatch.
- `.daemon/gated.json` — rewritten wholesale every discovery pass; a failure record would
  be erased on the next poll.

This confirms the loop mechanism precisely. Today, on a `createWorktree` throw the runner
returns `status:'error'`, `daemon.ts:853-866` adds the slug to the **in-memory** `parked`
set, and the next `pickEligible` calls `isHalted(slug)` → `exists(<worktree>/.pipeline/HALT)`
→ **false** (there is no worktree) → the slug falls through as eligible and is re-dispatched
immediately with no backoff. That is the #681 hot spin, and a daemon restart clears even the
in-memory set.

## Approaches considered

1. **Record-aware `isRegisteredWorktree` + prune-then-proceed in `ensureWorktree` + auto-park
   on creation failure in `daemon-runner` (chosen).** Three small, independently testable
   changes at the three seams where the failure actually manifests. Layer 1 stops the false
   `'reused'`; layer 2 makes the subsequent add succeed instead of 128-ing; layer 3 guarantees
   that *any* residual creation failure is recorded durably and stops the spin. Layers 2 and 3
   are defence in depth: even a 128 from an unrelated cause now parks with evidence rather
   than spinning.

2. **`git worktree add -f` on the attach/create paths.** Rejected: force-adding over a stale
   registration leaves the bogus entry in git's metadata and would equally happily stomp a
   registration that is stale for a reason we have not diagnosed. `prune` is the narrower,
   self-describing operation and matches the documented operator remedy.

3. **Retry-with-backoff around `createWorktree`.** Rejected as the primary fix: it treats a
   deterministic, permanently-reproducing condition as if it were transient. Backoff would
   slow the spin without ever resolving it or leaving evidence. (Layer 3 subsumes the real
   requirement — stop re-dispatching and say why.)

4. **Prune unconditionally at daemon startup.** Rejected as the primary fix: it is a
   repo-global side effect at a distance that hides the per-feature failure, and it does
   nothing for a registration that goes stale mid-run. Pruning at the point of use, only
   when a prunable record for *this path* is observed, is the deterministic-at-the-seam
   version.

Decision: **Approach 1.**

## Scope note — the engineer path is affected by the same bug

`ensureWorktree` has two callers. The daemon (`daemon-deps.ts:97`) is the one #1022 reports.
The engineer (`worktree-authoring.ts:82`) hits the same false `'reused'` and then calls
`worktreeStatusExcluding(worktreePath, …)` (`worktree-authoring.ts:108`), which runs
`git status` with `cwd` set to the nonexistent directory — execa throws a bare `ENOENT`
before git runs (verified). So the engineer surfaces a confusing filesystem error instead of
its documented FR-7 strict-abort message. Layer 1 fixes this caller for free; the stories
pin it so the fix is not silently daemon-only.

## Out of scope

- General dispatch backoff/retry machinery for non-worktree failures (#681's broader surface).
- Recovering `.pipeline/` state lost with the removed directory — that is the existing
  `docs/runbooks/worktree-and-evidence-recovery.md` flow and is unchanged by this work.
- The `WorktreeManager.cleanup()` prune at `worktree.ts:87` (interactive path, not the
  daemon create path) — untouched.
