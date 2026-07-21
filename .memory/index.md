# Memory Index

| Entry | Category | Summary |
|---|---|---|
| [nested-subagent-mutation-gate-stamp-loss.md](entries/nested-subagent-mutation-gate-stamp-loss.md) | Pipeline / autonomy friction | Nested sub-agent dispatches inside a TDD agent lose the `Task:` stamp and get blocked by the mutation-gate hook; instruct TDD subagents to edit directly instead of nesting. |
| [compute-resolved-readonly-derivation-pattern.md](entries/compute-resolved-readonly-derivation-pattern.md) | Technique / reusable pattern | Reuse `deriveCompletion(..., { readOnly: true })` to live-derive progress from git without racing the gate's own reconciliation pass. |
