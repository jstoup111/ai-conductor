# Track: conduct daemon --help omits the supported pause and resume verbs

Track: technical

Scope boundary: Balanced — add `pause`/`resume` help declarations in `cli.ts` and a drift test asserting `renderDaemonHelp()` covers every dispatcher-accepted daemon verb (`MANAGEMENT_VERBS` ∪ `DAEMON_SUBVERBS`). Excludes single-sourcing/generating help from the dispatcher enum, and excludes auditing other subcommands' help.

CLI help-text correctness plus a mechanical agreement check; no product requirements — acceptance criteria live in stories.
