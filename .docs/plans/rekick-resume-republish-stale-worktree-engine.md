# Implementation Plan: Re-kick resume republishes a stale worktree engine after the rebase

**Date:** 2026-07-13
**Source:** jstoup111/ai-conductor#625
**Track:** technical · **Tier:** S
**Stories:** `.docs/stories/rekick-resume-republish-stale-worktree-engine.md` (5 stories)
**Architecture review:** `.docs/architecture/2026-07-13-rekick-resume-republish-review.md` (light, S — no ADR)
**Conflict check:** `.docs/conflicts/rekick-resume-republish-stale-worktree-engine.md` (PASS; independent of #532/#535/#598/#280)

## Summary

Close the worktree-engine variant of the stale-engine class (#625; sibling of #598). On a
self-host re-kick resume, after `resumeRebaseFirst`'s rebase replays commits that touch
`src/conductor`, republish the worktree engine (reusing the existing content-addressed
`npm run build` → `publish-engine.mjs`) BEFORE `conductor.run()` executes the gate — so the
gate never runs on the pre-rebase `dist`. Fail-closed on a republish failure. ~7 TDD tasks.

## Technical approach

The `RebaseOutcome` already distinguishes the exact case:
`{ kind: 'changed'; changedCodePaths: string[] }` (`engine/rebase.ts:348`). `changelog_resolved`
only touches `CHANGELOG.md` and `noop` replays nothing, so **only** a `changed` outcome whose
`changedCodePaths` intersect `src/conductor/` requires a republish. No extra git diff is needed.

- **Wire a `republishEngine` callback into `resumeRebaseFirst`** (`engine/daemon-rekick.ts`):
  an optional injected `republishEngine?: (changedCodePaths: string[]) => Promise<void>`.
  After `runGatedRebaseResolution` yields a non-conflict `outcome`, and before returning
  `'rebased'`, if `outcome.kind === 'changed'` and any `changedCodePaths` entry starts with
  `src/conductor/`, invoke `republishEngine(outcome.changedCodePaths)`. Absent callback →
  today's behavior exactly (backward-compatible; keeps the pure function testable without a
  build). A throw from the callback becomes a `conflict_halt`-style re-park (Story 4) — write
  HALT with a republish-failure reason and return `'halted'` so the caller skips
  `conductor.run()`.
- **Daemon wiring** (`daemon-cli.ts` `runConductorInWorktree`, at the `resumeRebaseFirst`
  call ~line 763): pass `republishEngine` ONLY when `isSelfHost` (already in scope, line 595;
  Story 3). The impl calls the existing `rebuildEngineFromSource(join(wt.path, 'src',
  'conductor'))` (already defined, `daemon-cli.ts:131`) — building/publishing the WORKTREE's
  engine, never the daemon's own pinned `dist-versions/<id>`. Content-hash idempotence (Story
  2) means a rebuild whose engine source is byte-identical self-skips the flip.
- **No new store, CLI, hook, or schema.** Reuses `rebuildEngineFromSource` + `flipCurrent`.

## Tasks (TDD: RED → GREEN → COMMIT each)

1. **Path predicate.** Add a small pure `engineSourceChanged(changedCodePaths: string[]):
   boolean` (in `daemon-rekick.ts` or a shared util) = `some(p => p.startsWith('src/conductor/'))`.
   RED: table test — engine paths true; `CHANGELOG.md` / `README.md` / consumer paths false;
   empty false.
2. **`resumeRebaseFirst` invokes `republishEngine` on an engine-touching `changed` outcome.**
   RED: inject a spy `republishEngine`; drive a `changed` outcome carrying a `src/conductor/…`
   path (stub `performRebase`); assert the spy is called once with the changed paths and the
   result is `'rebased'`. (Story 1.)
3. **No republish on noop / changelog_resolved / non-engine `changed`.** RED: for each of
   those outcomes assert the spy is NOT called and the result is unchanged (`'rebased'` /
   `'skipped'`). (Story 2.)
4. **Callback absent → unchanged behavior.** RED: no `republishEngine` injected + engine-
   touching `changed` outcome → returns `'rebased'`, no throw, no build. (Backward-compat.)
5. **Republish failure fails closed.** RED: `republishEngine` rejects → `resumeRebaseFirst`
   writes a HALT whose reason names the failed worktree-engine republish and returns
   `'halted'`; assert `writeHalt` called and `conductor.run()` is not reached (caller returns
   on `'halted'`, `daemon-cli.ts:780`). (Story 4.)
6. **Daemon self-host wiring + re-entrancy.** RED (unit around the wiring / a focused
   integration): `republishEngine` is passed only when `isSelfHost` and, when invoked, shells
   `rebuildEngineFromSource(<wt>/src/conductor)`; non-self-host passes `undefined` (Story 3).
   Assert the sentinel-consumed re-entry path (`'skipped'`) forces no republish (Story 5).
7. **Docs + changelog.** CHANGELOG `[Unreleased] > Fixed` entry citing #625; note the
   worktree-engine republish in `src/conductor/README.md`'s daemon/self-host section. No
   VERSION change. Run `test/test_harness_integrity.sh` before commit.

## Verification

- Unit suite green (tasks 1-6). Integration: a re-kick `changed` outcome touching
  `src/conductor` triggers exactly one worktree republish and the flip moves `dist` to the
  new content hash; a non-engine `changed` and a `noop` trigger none.
- Manual/acceptance signal (self-host): reproduce the #625 shape — a worktree whose rebase
  brings a merged `src/conductor` parser fix now gates on the post-rebase engine (plan parses
  to real task count, not `▶ build 0/0`).
- Fail-closed: an injected build failure yields a HALT (worktree kept), not a stale-`dist`
  gate run.

## Out of scope

- The daemon's OWN long-running stale engine (#598) — different engine, tracked separately.
- Reordering setup ahead of the rebase (direction H-a) — rejected as larger for no added
  correctness given content-hash idempotence.
- Any change to evidence/attribution/task-status stores or the halt-decision logic (#280).
