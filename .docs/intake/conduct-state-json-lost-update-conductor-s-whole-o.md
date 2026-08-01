# Intake origin: conduct-state-json-lost-update-conductor-s-whole-o

Source-Ref: jstoup111/ai-conductor#1167
Owner: jstoup111

## Desired outcome

- An out-of-process write to `conduct-state.json` is not lost when the conductor next writes, for any field rather than one named field.
- The fix is structural and deterministic, not a growing per-field preservation allowlist.
- A deterministic test reproduces the two-writer race and proves the out-of-process value survives the later conductor write.
- Deliberate clears such as `--reset` and start-over still clear state.
- A discarded update or detected conflict is no longer silent and identifies the involved field or fields.
