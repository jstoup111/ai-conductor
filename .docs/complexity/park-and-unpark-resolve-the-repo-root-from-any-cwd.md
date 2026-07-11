# Complexity: park and unpark resolve the repo root from any cwd

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None (uses `git rev-parse`, already a dependency) |
| Auth / permission surface | None |
| State machines | None |
| Story count | 2 (happy: park/unpark from any cwd resolve the same root; negative: outside any repo → clear error, no state touched) |
| Files touched | 2 code (`daemon-park-cli.ts`, `index.ts`) + 1 test + 1 runbook doc + `CHANGELOG.md` |
| New runtime code | One small pure-ish helper (`resolveMainRepoRoot`) wrapping `git rev-parse --git-common-dir`; no new subsystem |

## Rationale

This is a localized correctness fix to a single pre-boot CLI path. The root-resolution technique
is already proven in `memory-store.ts` (#486 precedent) — resolve `git rev-parse --git-common-dir`,
take its parent directory as the main repo root, which is identical for the main checkout and every
linked worktree, so `.docs/plans/` and `.worktrees/` are always scanned under the right root.

No new entities, no schema change, no state machine, no daemon/supervisor involvement (these verbs
run filesystem-direct, pre-boot, and exit). The change is strictly widening — every invocation that
worked before still works — plus a friendlier not-found message and a runbook. The blast radius is
one module and its wiring; tests inject `cwd` directly and the new helper is unit-testable with real
temp git repos + `git worktree`. → **Tier S.**
