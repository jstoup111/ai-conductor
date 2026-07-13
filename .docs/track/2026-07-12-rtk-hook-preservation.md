# Track: RTK / operator hook preservation across harness install & update

Track: technical

## Why technical

This is an infrastructure correctness fix to `bin/install`. There is no user-facing
product surface, no new screen or API, and no product requirements to enumerate — the
acceptance signals are all observable install/update behaviors. Acceptance criteria live
in the stories (Given/When/Then), not in a PRD.

## Problem (confirmed against code — see issue jstoup111/ai-conductor#608)

After running the harness `bin/install` and/or its `--update` flow, the operator's RTK
("Rust Token Killer") Claude Code hook stops firing and the token savings silently
disappear. RTK integrates as a Bash-command-rewriting hook (`~/.claude/hooks/rtk-rewrite.sh`
+ an entry in the operator's global `~/.claude/settings.json` / `settings.local.json`).

Three code-confirmed gaps make the loss silent and unrecoverable through the harness:

- **G1 — reinit gate is a file-existence proxy.** `bin/install:496` (and the `--check`
  block at `:184`) gate RTK reinit on `[ -f ~/.claude/hooks/rtk-rewrite.sh ]`, i.e. the
  *script file*, not the settings *entry*. Once that script exists, install reports
  "rtk hook already initialized" and never restores a missing settings entry.
- **G2 — `--update` never runs RTK reinit.** `rtk init` lives only inside
  `install_dependencies` (`bin/install:494–506`), and `bin/install:1170–1175` skips
  `install_dependencies` entirely in `--update` mode. So the auto-update path an operator
  actually hits can never restore RTK.
- **G3 — no preservation invariant / no warning.** `configure_hooks` (`bin/install:298`,
  `:425–444`) merges (dedup-append) and does preserve a pre-existing RTK entry, but nothing
  detects a loss or surfaces it — the operator only discovers it via a token-burn spike.

The *removal agent* (what deletes the entry) is external/unidentified — candidates: RTK's
own `--auto-patch`, the entry living in `settings.local.json` while only `settings.json` is
reconciled, or a partial write. The durable fix does **not** depend on pinning it: the
harness owns the preserve / detect / restore / warn invariant regardless of cause.

## Scope

- In: `bin/install` (install path, `--update` path, `--check` path) RTK-hook handling;
  operator-custom-hook preservation guarantee; bash tests in `test/`.
- Out: fixing RTK itself; changing the harness's own hook set; any consumer-project behavior.

## Discovery notes

- `configure_hooks` merge logic verified at `bin/install:425–444` — read existing settings,
  dedup by command string, append only missing harness entries, re-dump whole dict.
- `--update` dispatch verified at `bin/install:1256` → `UPDATE_MODE=true; install`, and the
  skip at `:1170–1175`.
- The `--check` RTK block verified at `bin/install:182–191`.

_Hypotheses from the issue are carried as candidates only. The chosen fix (operator-directed,
Small) sidesteps the unidentified removal agent entirely: run the idempotent `rtk init -g
--auto-patch` on both install and update whenever `rtk` is on PATH, so a lost entry is simply
re-created. See the stories and plan._
