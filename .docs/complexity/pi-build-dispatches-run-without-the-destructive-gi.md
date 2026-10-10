# Complexity: Pi build dispatches run without the destructive-git guard

Tier: S

Rationale: One production file, `src/conductor/src/execution/pi-provider.ts`, adopts the guard seam
Claude and Codex already use (`ensureGitGuardForDispatch` in `src/conductor/src/engine/git-guard.ts`
and `withGitGuardPath` in `src/conductor/src/execution/child-environment.ts`). There is no new
mechanism, schema, event, CLI surface or config key. The environment-claim audit already reads
`InvokeResult.gitGuardInstalled` for every provider (`src/conductor/src/engine/conductor.ts`), so a
Pi result carrying the field reaches it without further wiring. The governing decision is already
approved: adr-2026-09-23-engine-git-guard-on-agent-path D2 makes every provider adapter's
child-environment construction the enforcement point, and its 2026-10-01 amendments assign the Pi
adapter cells, Pi live guard smoke and Pi inventory entry to #2895, which this spec delivers. Risk is
confined to the Pi child environment's `PATH` and is covered by adapter tests plus an opt-in smoke.
Per tier rules, architecture-diagram, architecture-review, conflict-check and coherence-check are
skipped.
