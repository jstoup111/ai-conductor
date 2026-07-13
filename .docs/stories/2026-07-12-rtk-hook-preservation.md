# Stories: RTK hook re-init on install & update

Relates-to: jstoup111/ai-conductor#608
Track: technical

Acceptance criteria (technical track — no PRD). `rtk` is mocked in tests: a fake binary on a
temp PATH that counts `init` invocations and, on `rtk init -g --auto-patch`, writes the RTK
hook entry into `$HOME/.claude/settings.json`. No test touches the real `~/.claude`.

The fix: run `rtk init -g --auto-patch` whenever `rtk` is on PATH, on **both** the install and
`--update` paths, no longer gated on `~/.claude/hooks/rtk-rewrite.sh` existing.

---

## S1 (happy) — Lost RTK entry is restored on install
**Given** a HOME where `~/.claude/hooks/rtk-rewrite.sh` exists but the RTK hook entry is absent
from settings,
**When** `bin/install` runs,
**Then** `rtk init -g --auto-patch` is invoked (mock records ≥1 init) and the RTK entry is
present afterward.
_G1 regression: the old script-file gate reported "already initialized" and skipped re-init._

## S2 (happy) — Lost RTK entry is restored on `--update`
**Given** the same lost-entry HOME,
**When** `bin/install --update` runs,
**Then** `rtk init -g --auto-patch` is still invoked (the re-init step runs on the always-run
path, not inside the `install_dependencies` block that `--update` skips) and the entry is
present afterward,
**And** no binary bootstrap (brew/cargo/curl) is attempted in update mode.
_G2 regression: `--update` previously skipped `install_dependencies` and never reached
`rtk init`._

## S3 (happy) — Existing RTK entry survives (idempotent)
**Given** a HOME with the RTK entry already present,
**When** `bin/install` runs (and re-invokes `rtk init -g --auto-patch`),
**Then** the RTK entry is still present and valid afterward — `rtk init`'s idempotency causes
no loss or duplication of the operator's entry.

## S4 (happy) — Operator's other custom hooks are preserved
**Given** a `settings.json` carrying a non-harness, non-RTK custom hook,
**When** `bin/install` and then `bin/install --update` run,
**Then** that custom hook entry is still present afterward (the `configure_hooks` merge is
unchanged and never removes it).

## S5 (negative) — RTK binary absent is a graceful no-op
**Given** a HOME where `rtk` is not on PATH,
**When** `bin/install` runs,
**Then** no `rtk init` is attempted and no settings change is made — identical to today's
"rtk not installed" behavior.

## S6 (negative / no-regression) — Fresh environment still initializes RTK
**Given** a fresh HOME with the `rtk` binary present but no hook script and no settings entry,
**When** `bin/install` runs,
**Then** `rtk init -g --auto-patch` runs and the entry ends up present — first-time setup is
unchanged.

---

Status: Accepted
