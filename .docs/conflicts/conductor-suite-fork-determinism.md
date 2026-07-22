# Conflict Check: Conductor suite fork determinism (#573)

Status: Clear (no blocking conflicts)

Method: cross-checked the six stories against each other and against the existing suite
seams they touch (`BuildProgressWatcher`, the three timer test blocks, the inline `git
init` sites, `vitest.config.ts`).

## Intra-spec (story-vs-story)

- **Story 1 (clock seam) ↔ Story 2/3 (test rewrites).** Ordering dependency, not a
  conflict: the seam must exist before the tests can drive it. Captured as a plan
  dependency (Story 2/3 depend on Story 1). No contradiction.
- **Story 4 (git config hardening) ↔ Story 5 (fork isolation).** Explicitly declared
  complementary; Story 5's negative path forbids it from *replacing* Story 4. No state or
  resource contention — Story 4 edits repo config inside each test's tmpdir; Story 5 edits
  vitest project wiring. Disjoint surfaces.
- **Story 6 (verification) is orthogonal** — it asserts the aggregate outcome and the
  no-flake-masking invariant; it constrains *how* 1–5 are implemented (no `test.retry`, no
  timeout inflation) but does not contradict them.

## Spec-vs-existing-system

- **Clock seam vs existing watcher callers.** `BuildProgressWatcher` is constructed by the
  conductor build wiring and by tests; the new `now` option is optional with a `Date.now`
  default, so no existing caller is broken and no call site must change. No conflict.
- **`change-driven emission` block (already stable).** It already drives `tick()` directly;
  Story 2 aligns the other two blocks to the same pattern — reinforcing, not conflicting
  with, the established convention (and its documented header comment).
- **Shared git helper vs 53 inline `git init` sites.** Adding `initTestRepo` does not force
  a global migration (Story 4 non-goal); un-migrated files keep working unchanged. No
  contention.
- **`gc.auto=0` / `core.fsync` vs real-git integration tests.** These knobs are set
  per-tmpdir-repo, never on `$HOME`/global config (the issue confirmed no global-config
  mutation), so rebase/daemon-rekick "real primitives" tests that build their own repos are
  unaffected unless explicitly migrated. No conflict with `test/setup.ts`'s
  `AI_CONDUCTOR_NO_REAL_EXEC` seam (that guards the gh/git *pr-labels* exec path, a
  different seam).
- **Second vitest project config vs `global-setup.ts` / `test/setup.ts`.** A second project
  must reuse the same `setupFiles` + `globalSetup` so the daemon/exec kill-switches and the
  `.pipeline`-leak guard still apply to serialized files. Flagged as a plan constraint, not
  a conflict.

## Resolution

No blocking conflicts. One ordering dependency (Story 1 before 2/3) and one wiring
constraint (second vitest project must inherit the shared setup/globalSetup) are carried
into the plan.
