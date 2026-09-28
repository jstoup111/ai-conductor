# Track: Skills may bundle executable helpers

Track: technical

Scope boundary: Balanced. In scope: an ADR recording that shipped skills may bundle executable helpers inside their skill directory; migrating `intake-file` to `skills/intake/scripts/intake-file`, invoked by skill-directory path so it works from consumer repositories and files into the caller's repository; extending shell lint and the integrity syntax check to cover bundled skill scripts; making helper harness-root resolution correct under the self-host provider-home copy; removing every reference to the dead `src/conductor/bin/intake-file` (the file and its directory stay on disk, unreferenced: deleting that directory is a separate follow-up removal feature per the repository's two-feature deletion rule); and updating the architecture and contributor docs that state skills are Markdown-only. Out of scope: migrating `intake-backfill` or any other `bin/` executable, a generic "referenced script exists and is executable" integrity contract, a process-spawn smoke test for helpers, and any `bin/install` or PATH change.

Harness tooling convention plus a consumer-visible bug fix in the intake skill; no product requirements worth a PRD.
