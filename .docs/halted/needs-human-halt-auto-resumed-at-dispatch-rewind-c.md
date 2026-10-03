# Halt record

Status: halted
Slug: needs-human-halt-auto-resumed-at-dispatch-rewind-c
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-needs-human-halt-auto-resumed-at-dispatch-rewind-c
Head SHA: f9d84673f3a7c590847e1a5e5efde6457aff3b43
Halted at: 2026-10-03T13:50:51.220Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 happy: Given a feature worktree whose `.pipeline/HALT` exists, whose `.pipeline/HALT.class` reads `needs-human`, and whose `.pipeline/conduct-state.json` records `last_step` as `build`, when the operator runs `ai-conductor halt clear --feature <slug> --rationale "plan amended and resealed"` from an interactive terminal, then the command exits 0, both `.pipeline/HALT` and `.pipeline/HALT.class` are absent, and `last_step` is still `build`.
Task ids: 2
Done when checks: The CLI test drives `detectHaltClearCommand` into `dispatchHaltClearCommand` on a `needs-human` halt with `last_step` `build` and asserts exit 0, `.pipeline/HALT` and `.pipeline/HALT.class` both absent, and `conduct-state.json` byte-identical so `last_step` is still `build`. | The same test asserts `.pipeline/events.jsonl` contains exactly one `halt_clear_authorized` event with the resolved operator identity, the trimmed rationale, `haltClass` `needs-human`, and the feature slug, and the `appendEvent` spy observed both `.pipeline/HALT` and `.pipeline/HALT.class` still present when the event was appended. | The same test asserts `.docs/halted/<slug>.md` is committed with status resolved and cause `operator` by `supersedeHaltRecord`. | A parameterized test seeds `HALT.class` as each of `kickback-cap`, `plan-gap`, `over-scope`, `protected-artifact` and asserts exit 0, both markers absent, and the `halt_clear_authorized` event's `haltClass` equals the seeded class.
Missing assertion: "from an interactive terminal"
```
