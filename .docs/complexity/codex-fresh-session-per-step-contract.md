# Complexity: codex-fresh-session-per-step-contract

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None. One boolean capability field added to the existing `LLMProvider` interface. |
| External integrations | One — the Codex CLI (`codex exec` / `codex exec resume`) argv contract. Behavior is asserted via a faithful fake; one opt-in real-Codex smoke. |
| Auth / permission surface | Untouched. Auth source selection, `CODEX_API_KEY` handling, and the self-host credential handoff are out of scope. |
| State machines | One, small — the per-step provider-session lifecycle (`ProviderSessionScope`: create → prepare → markCreated → replace). Changed at one seam, not restructured. |
| Story count | 4 (resume suppression, retry cold-start, diagnostics, coverage) |
| Files touched | ~5 source (`llm-provider.ts`, `codex-provider.ts`, `claude-provider.ts`, `provider-execution.ts`, `provider-session.ts`) + unit/integration tests + one smoke + CHANGELOG + docs |
| New runtime code | Modest — a capability field, a resume-suppression seam, and removal of the Codex `exec resume` argv branch. |

## Rationale

Not Small: it changes a cross-cutting dispatch seam that every step in every phase flows through,
it edits the shared `LLMProvider` interface (so both adapters are affected), and it must be
reasoned against an adjacent open issue (#1042) to avoid overlapping ownership. That warrants a
recorded architecture decision and a conflict check.

Not Large: no new subsystem, no schema, no auth change, no migration, and the blast radius is a
single boolean forced through one existing call path. The retry-prompt path already re-sends the
full system prompt (`step-runners.ts:1819-1902`), so no prompt redesign is needed.

→ **Medium.** Architecture-diagram, lightweight architecture-review, conflict-check, and
coherence-check all run.
