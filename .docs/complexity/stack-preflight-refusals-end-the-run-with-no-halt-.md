# Complexity: Stack preflight refusals end the run with no HALT or reason (#3446)

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None. `StackPreflightResult`'s stopping arms gain a required `detail` |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None changed. A stopping preflight result now leaves a HALT stating its reason (needs-human, or `mechanical` for a live journal owner) unless one is already live |
| Event spine | Existing `loop_halt`; `RestackRefusalReason` gains one value for the live-owner refusal |
| Story count | ~4–5 |
| Files touched | ~5–6: `restack/stack-preflight.ts`, `restack/restack-recovery.ts`, `restack/restack-types.ts`, `conductor.ts` (rebase caller), `daemon-cli.ts` (rekick caller) |
| ADR work | None. Strengthens the one shared preflight of `adr-2026-10-10-stacked-restack-journaled-replay` D7 without changing a decision |

## Rationale

One invariant enforced at one existing boundary: every stopping `runStackPreflight` result states its
reason durably. No new module, layer, or architectural decision. Operator-confirmed Small on
2026-10-26; a HALT-free daemon retry path for the live owner was rejected (it would need new daemon retry machinery) in favour of the existing `mechanical` HALT class.
