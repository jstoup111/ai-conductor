# Complexity: conduct daemon --help omits the supported pause and resume verbs

Tier: S

Rationale: Two `.command()` declarations added to an existing hand-maintained commander subtree in `src/conductor/src/cli.ts`, plus one unit test asserting `renderDaemonHelp()` output covers the dispatcher's daemon verb set (`MANAGEMENT_VERBS` ∪ `DAEMON_SUBVERBS` in `src/conductor/src/engine/daemon-command.ts`). No new models, integrations, auth, or state machines; expected 1-2 stories.
