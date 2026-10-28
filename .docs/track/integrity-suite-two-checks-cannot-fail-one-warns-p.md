# Track: Integrity suite hardening (#1014)

Track: technical

Scope boundary: All five remaining #1014 defects in `test/test_harness_integrity.sh` — check 5 fail-closed (with a reasoned no-row allowlist and `tdd-red`/`tdd-green` recognised for `tdd`), check 5b enforced in both directions (pinning `model: opus` on architecture-review, explore, prd, rebase, remediate), check 10 scanning `skills/` as its comment states — both skill scripts and SKILL.md prose that instructs a write of an engine-only status (`completed`/`skipped`) to `.pipeline/task-status.json`, with a reasoned allowlist (advisory `pending`/`in_progress` writes stay legal per `adr-2026-07-05-engine-owned-task-status` D4), check 5c running its corruption fixture on a copy instead of the tracked hook, and checks 5a/5b/5c hard-failing when `src/conductor/node_modules` or `jq` is absent — plus removing the matching "Known limitation" notes in `docs/contributing/validation.md`. Excluded: check 4 (already fail-closed on main) and check 1b's shellcheck-absent skip.

Internal validation tooling with no user-facing behavior; acceptance criteria live in stories.
