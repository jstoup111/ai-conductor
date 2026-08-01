# Intake origin: mechanically-verify-llm-rebase-conflict-resolution

Source-Ref: jstoup111/ai-conductor#1152
Owner: jstoup111

## Desired outcome

- After each replayed commit during an engine rebase, the engine mechanically compares the replayed
- A rejected rebase HALTs with the specific drift cited (commit sha, file, the region that differs),
- A legitimate conflict resolution that only touches conflicted regions still completes with no new
- Whole-file side effects the resolver has no business making — EOF newline stripping, mode changes,
