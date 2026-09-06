# Track: Root the vitest run temp state on a disk-backed parent

Track: technical

Scope boundary: Small fix for #2224, approved by the operator on 2026-09-06 (delegated). Change only the parent directory the per-run temp root is created in, and keep the real tmpdir observable to the guards that already watch it. The `TMPDIR` redirect, the run-root prefix, the stray-entry guard's verdict logic, and teardown reap behavior are unchanged. Stale-root accumulation, per-worktree partitioning, tmpfs quotas, worker counts, and any change to how many temp directories the suite creates are outside this slice.

This is the harness repository's own test infrastructure; acceptance criteria live in technical stories rather than a PRD.

The operator-delegate chose a user-scoped cache parent (`$XDG_CACHE_HOME/ai-conductor/vitest-tmp`, defaulting to `~/.cache/ai-conductor/vitest-tmp`) over a repository-ignored build directory on 2026-09-06 (delegated). A repository-scoped parent would put hundreds of megabytes of fixture churn inside the checkout the self-host live boundary fingerprints, and every unexcluded path there halts a running self-host build; the cache parent sits outside every checkout and needs no exclusion.

Scope check: A — harness-repo-only (Step 1 signal: this repository's own vitest suite, its leak guards, and its package test runner; no consumer repository has this suite, so the mechanism does not exist outside this repository); B — n/a (no new skill); C — provider-agnostic (no provider path, variable, or capability is involved). The rule is purely additive, so no "global harness convention remains unchanged" sentence is owed. No catalog registration is required.

Verified foundation: `src/conductor/scripts/run-vitest.mjs` creates the run root with `mkdtempSync(join(tmpdir(), 'ai-conductor-vitest-run-'))` before spawning vitest; `src/conductor/vitest.config.ts` and `src/conductor/vitest.smoke.config.ts` each call `ensureRunTmpRootSync(tmpdir())` at module scope; `src/conductor/test/global-setup.ts` falls back to `createRunTmpRoot(tmpdir())` and then derives `realTmpdir` as `dirname(runTmpRoot)`. `createRunTmpRoot` and `ensureRunTmpRootSync` in `src/conductor/test/tmpdir-leak-guard.ts` both take the parent as an argument and never call `os.tmpdir()` themselves, so the injection point already exists at every call site. On the operator's machine `df` reports `/tmp` as a 15G tmpfs and `/` as a 935G disk filesystem.
