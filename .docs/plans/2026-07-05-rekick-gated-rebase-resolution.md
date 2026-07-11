# Plan: share the gated /rebase resolution loop with daemon-rekick play-forward (#300)

**Track:** technical · **Complexity:** Small · **Stories:** 2026-07-05-rekick-gated-rebase-resolution

## Design

Extract the gated conflict-resolution sub-loop currently inlined in
`conductor.ts:runRebaseStep` (lines ~2425–2456) into one exported helper,
`runGatedRebaseResolution`, in `rebase.ts`. Both `runRebaseStep` and
`daemon-rekick.ts:resumeRebaseFirst` call it, so a conflict on either path gets the same
bounded automated resolution before a human HALT.

The helper keeps `rebase.ts`'s "pure, git-injected, no event coupling" contract: event
emission stays at the call site via optional `onAttempt` / `onSettled` callbacks. It wraps the
existing pure `resolveRebaseConflicts`; a `cap <= 0` or absent resolver returns the conflict
unchanged (FR-7), and a throwing resolver degrades to a failed attempt.

## Tasks

1. **RED** — unit test `runGatedRebaseResolution` in `rebase-resolution.test.ts`:
   pass-through of non-conflict outcome; cap 0 / no resolver → unchanged; resolver resolves →
   reclassified + `onSettled('succeeded')`; resolver throws → HALT + `onSettled('exhausted')`;
   `onAttempt` receives `(index, cap)`.
2. **GREEN** — add `runGatedRebaseResolution` to `rebase.ts` after `resolveRebaseConflicts`.
3. **REFACTOR** — replace the inline block in `conductor.ts:runRebaseStep` with a call to the
   helper; drop now-unused `resolveRebaseConflicts` / `RebaseResolver` imports.
4. **RED** — extend `daemon-rekick.test.ts` `resumeRebaseFirst` describe: conflict + wired
   resolver that resolves → `rebased`, no HALT; conflict + resolver that never completes →
   `halted` after cap; no-resolver default → `halted` immediately (unchanged).
5. **GREEN** — add optional `resolveAttempts?: number` + `resolveConflict?: RebaseResolver` to
   `resumeRebaseFirst` opts; route `conflict_halt` through the helper before
   `applyRebaseVerdicts`. Default (unset) cap 0 → today's behavior.
6. **WIRE** — in `daemon-cli.ts`, pass `resolveAttempts: resolveRebaseResolutionAttempts(config)`
   and `resolveConflict: stepRunner.resolveRebaseConflict` into the `resumeRebaseFirst` call.
7. **VERIFY** — full conductor test suite green; harness integrity suite green; CHANGELOG entry.

## Out of scope
- #247 (post-PR CONFLICTING watch) — different code path.
- Changing the resolution loop mechanics, cap semantics, or the `/rebase` skill.
