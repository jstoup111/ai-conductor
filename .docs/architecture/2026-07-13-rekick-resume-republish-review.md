# Architecture review (light, S-tier): rekick-resume-republish-stale-worktree-engine

**Source:** jstoup111/ai-conductor#625 · **Track:** technical · **Tier:** S
**Scope:** feasibility + alignment only (no ADR required at S). No architecture-diagram change:
this adds a build step reusing an existing component and data flow; no new C4 component/edge.

## The seam this fix lives on

The self-host engine-publish seam already exists and is well-defined:

- `scripts/publish-engine.mjs` computes a `versionId` = `<timestamp>-<contentHash>` from the
  built engine and, via `engine-store.ts` `flipCurrent`, atomically flips the worktree's
  `dist` symlink to the new version. It **skips the flip when the content hash is unchanged**
  (`[publish-engine] content unchanged (…) — publish skipped, dist stays at …`). This is the
  idempotence guarantee the fix leans on.
- `daemon-cli.ts:rebuildEngineFromSource(conductorRoot)` already shells `npm run build` in a
  given conductor root and throws on non-zero. It exists today for the DAEMON's own rebuild
  (#598's sibling surface). The fix reuses this exact primitive, pointed at the WORKTREE's
  `src/conductor`.

## Alignment findings

1. **Right insertion point.** `resumeRebaseFirst` returns a typed `RekickResumeResult`
   (`'skipped' | 'rebased' | 'halted' | 'already_shipped'`). The republish binds strictly to
   `'rebased'`, in `runConductorInWorktree` (`daemon-cli.ts` ~line 779), before the
   `await conductor.run()` at ~line 801. This is after the rebase mutates worktree source and
   before the gate loads the engine — the only correct window.
2. **Self-host gating is already in scope.** `runConductorInWorktree` already computes
   `isSelfHost` (passed to `new Conductor({ selfHost })`). The republish reuses that flag —
   no new detection. Consumer worktrees (no per-worktree `dist`) skip cleanly.
3. **Idempotence covers the no-op path.** Because publish is content-hashed, the fix can be
   conservative: even an unconditional post-`'rebased'` republish self-skips when engine
   source is unchanged. A cheap pre-guard (rebase replayed commits touching `src/conductor`)
   is an optimization to avoid the tsup build cost, not a correctness requirement.
4. **Fail-closed is consistent with existing HALT discipline.** `resumeRebaseFirst` already
   re-parks via 9.0's `writeHalt` on a re-conflict; a failed republish routes through the
   same HALT path (worktree kept), so the gate never runs on a stale `dist`. This matches the
   harness rule that the engine surfaces at the point of the mistake rather than proceeding.
5. **No evidence/attribution surface touched.** Unlike the #535/#520/#581 cluster, this fix
   does not read or write task-evidence, task-status, memos, or trailers. Blast radius is the
   resume path only.

## Feasibility verdict

Feasible and minimal on the existing seam. No new component, store, CLI, hook, or schema.
Reuses `rebuildEngineFromSource` + the content-addressed publish. Approved to proceed to
stories → conflict-check → plan at S tier.
