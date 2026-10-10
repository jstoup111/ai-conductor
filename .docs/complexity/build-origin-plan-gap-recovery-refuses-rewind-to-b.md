# Complexity: build-origin-plan-gap-recovery-refuses-rewind-to-b

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | None — the existing operator-run `rewind` command only gains a diagnostic line |
| State machines | None — step topology, `rewind`'s guard, and resume selection are unchanged |
| Story count | 2 (rewind refusal names the in-place recovery; triage routes BUILD-origin plan gaps) |
| Files touched | `src/conductor/src/engine/rewind.ts`, `src/conductor/test/engine/rewind.test.ts`, `skills/daemon-triage/SKILL.md` |
| New runtime code | One pure hint helper and one call site in the existing refusal path |

## Rationale

The supported recovery (`ai-conductor halt clear`) already exists and already resumes a halted
feature at its recorded step. The change is a diagnostic on an existing refusal plus a routing
correction in one agent-instruction table row; no state transition changes.
→ **Small**. Architecture-diagram, architecture-review, conflict-check, and coherence-check are
skipped for this tier.
