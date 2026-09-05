# Track: sweep-stale-vitest-run-temp-roots-at-global-setup-

Track: technical

Scope boundary: Sweep only (operator-confirmed 2026-09-05). Add a pre-run sweep of stale
`ai-conductor-vitest-run-*` roots to this repository's own vitest global setup
(`src/conductor/test/global-setup.ts` + `tmpdir-leak-guard.ts`), using a namespace-independent
heartbeat ownership marker inside each root as the liveness predicate, retaining on ambiguity,
enumerating and logging before deleting, and failing open. Repo-only: the guard exists in no
consumer project, so HARNESS.md, `skills/`, and the shipped engine are untouched. Excludes the
tmpfs siting of the run root (#2224) and any consumer-facing generalisation of the leak guard.

Test-infrastructure fix to this repository's own suite; no user-facing behaviour changes.
