# Complexity: daemon-mode DECIDE kickbacks HALT instead of re-running (#551)

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — no schema, no config key, no new state field |
| External integrations | None new (the halt reuses the existing remediation-PR surface) |
| Auth / permission surface | None |
| State machines | **Yes** — changes which transitions the gate loop may take in daemon mode (backward navigation from a loop gate to a DECIDE gate becomes a terminal HALT). This is the signal that lifts it off Small. |
| Story count | 5 (halt on daemon DECIDE kickback; BUILD targets stay autonomous; interactive unchanged; cap/ping-pong preserved; resume-after-human-clear) |
| Files touched | 1 new pure module + `engine/conductor.ts` (two call sites) + tests + `docs/explanation/gates.md` + `CHANGELOG.md` |
| New runtime code | ~60 lines, most of it the extracted predicate and its halt body |

## Rationale

The diff is small, but it is a **routing-semantics change to the autonomous loop**: a condition
that previously dispatched a step now terminates the run and parks for a human. Getting the
boundary wrong in either direction is expensive — too broad and the daemon halts on ordinary
`build` kickbacks (losing outcome 2 and stalling every feature); too narrow and the guard does not
close the hole it was filed for. It also has to leave two already-shipped behaviors byte-identical:
the #644 remediation guard (`conductor.ts:1722-1737`) and the anti-ping-pong cap
(`MAX_KICKBACKS_PER_GATE`), both of which have live test coverage that must stay green.

That combination — state-machine transition change, a halt that must be classified
`needs-human` so `daemon-rekick` never auto-clears it (`daemon-rekick.ts:173-193`), and an
interactive path that must be provably untouched — warrants architecture review and a
conflict check. It is not Large: no new provider surface, no schema, no migration, single
module, bounded story count.

→ **Medium.** Architecture-diagram, architecture-review (lightweight), conflict-check and
coherence-check all run; the PRD is skipped (technical track).

## Issue label corroboration

Issue #551 is filed `size: M`, `priority: high`; this independent assessment agrees.
