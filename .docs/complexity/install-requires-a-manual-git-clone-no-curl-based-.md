# Complexity: install-requires-a-manual-git-clone-no-curl-based-

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None new — public HTTPS `git clone` of this repository and the existing GitHub Pages site |
| Auth / permission surface | None — the point is to remove the SSH-credential requirement |
| State machines | None |
| Story count | ~5 (fresh install, re-run, pass-through options, prerequisite refusal, foreign-directory refusal) |
| Files touched | 1 new POSIX shell script (`docs/install.sh`), 1 symlink (`bin/bootstrap`), 1 test, README + Quickstart |
| New runtime code | One self-contained bootstrap script; `bin/install` and `bin/update` are reused unchanged |

## Rationale

A single new shell script that acquires a checkout and delegates to the existing, already
non-interactive-safe install flow (#1711 shipped in PR #1720). No engine code, no schema, no
new update mechanism, and no change to existing checkouts. → **Small.** Architecture-diagram,
architecture-review, conflict-check, and coherence-check are skipped for this tier.
