# Track: Every bash test executes in CI or is removed

Track: technical

Scope boundary: every `test/*.sh` orphan (not executed by CI or `test_harness_integrity.sh`; ~37 of
67 at authoring) is triaged to kept-and-executed, fixed-and-executed, or deleted; kept scripts run
from a committed manifest through a sandboxed runner (isolated `HOME`/`TMPDIR`) in a new CI job; a
mechanical guard fails on any `test/*.sh` that is neither executed nor an exempt sourced helper.
Smoke side is limited to a guard that every smoke file declares a `smokeCapability`. Excluded:
unifying the in-file smoke `skipIf` idioms, and porting bash tests to Vitest. Deletions are
individual files inside the surviving `test/` directory, so the CLAUDE.md two-feature
directory-deletion rule does not apply; if a whole directory (e.g. a fixtures subtree) must go,
that removal ships as its own follow-on feature.

Internal test infrastructure with no user-facing behavior; adds a guard and CI job, so it is not a
pure maintenance change. Source: intake jstoup111/ai-conductor#1021.
