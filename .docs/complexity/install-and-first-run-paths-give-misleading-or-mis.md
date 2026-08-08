# Complexity: Install and first-run paths give misleading or missing signals

Tier: S

## Rationale

Scored against the standard signals:

| Signal | Present | Note |
|---|---|---|
| Data models / schema | No | Writes an existing config schema through existing code; no schema change. |
| Third-party integrations | No | Removes one (PyYAML); adds none. |
| Auth / permissions | No | Touches `settings.json` permission-write reporting, not any auth model. |
| State machines | No | All five defects are straight-line reporting or file-removal fixes. |
| Cross-component coupling | Low | Four sites in `bin/install`, one root file. |
| Story count (est.) | 5 | One per defect, each independently verifiable. |

Four of the five changes are one-to-few-line corrections in a single shell script:
a missing summary line before `return 2` (`:292-294`), an omitted `--help` entry
(`:42-52`), an `$?` captured after an intervening `rm` (`:385-387`), and deletion of an
empty root `package-lock.json`.

The fifth (PyYAML removal, per the approved Approach B) is the only one with real
structure — it replaces four Python YAML call sites with a `conduct-ts` config-write
path. It stays Small because the target machinery already exists
(`user-config.ts` reads and writes the same file via `js-yaml`) and already runs first
(`build_conduct_ts` at `:1309` precedes the config writes at `:1374-1375`). No new
design is required; this is substitution against a proven seam.

## Consequences for DECIDE

Small tier — `/architecture-diagram`, `/architecture-review`, `/conflict-check`, and
`/coherence-check` are skipped. DECIDE proceeds directly to `/stories`, then `/plan`.

## Carried risk

The one non-mechanical element is the fallback path: `build_conduct_ts` is invoked as
`|| true` and can legitimately skip (Node <20.5, npm absent). If the PyYAML removal does
not give that case an explicit named message, it reintroduces the exact silent-swallow
failure this work exists to remove. This belongs in the stories as a negative-path
acceptance criterion, not as added architectural scope.
