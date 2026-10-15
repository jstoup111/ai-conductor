# Track: CLI help disagrees with behavior

Track: technical

Scope boundary: Balanced — fix all six symptoms from jstoup111/ai-conductor#1012 (land/handoff help text, `--idle-poll` declared default, missing commands in help, undeclared real flags, undocumented `--auto`/`--interactive` exclusion, `register --help`/`create --help`) plus drift machinery: a test that fails when any pre-commander-dispatched command is not declared in commander (visible or hidden), and shared constants so declared defaults equal runtime fallbacks. Excluded: migrating the 42 pre-commander intercepts in `src/index.ts` into commander actions (single dispatch path).

Operator-facing CLI tooling correctness with no new capability, so no PRD; observable help/`--help` behavior changes, so this is not a maintenance change.
