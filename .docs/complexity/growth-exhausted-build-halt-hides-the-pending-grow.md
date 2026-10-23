# Complexity: Growth-exhausted BUILD halt shows the pending growth charge and the halting gate's findings

Tier: S

Rationale: One new pure projection over existing durable state (settled `ledger.growth`, the flat
`pendingRepair.charges`, and the already-resolved growth cap) plus rendering on three existing
operator surfaces that already share `kickback-budget-view.ts`: the BUILD settlement halt
(`conductor.ts`), `daemon status` (`daemon-observe-cli.ts`), and `kickback-budget inspect`
(`kickback-budget-cli.ts`, human line plus an additive JSON field mirroring `pendingLaps`).
`settlePendingRepair` (`kickback-ledger.ts`) switches its growth refusal to read the same
projection, behavior-preserving: same all-or-nothing settlement, same charge order, same halting
gate, same `kickback-cap` class (architecture-review-2026-09-29 condition 1 and adr-2026-08-22 as
amended by #2753 are unchanged). The halt's `Findings:` line selects by halting gate while still
naming every pending finding, as condition 1 requires. No ledger schema, cap formula, config key,
raise/reset binding, event, sidecar, CLI flag, or new module; no ADR is needed. The event-spine
procedure does not apply: nothing new observes, stamps, or signals — it renders existing durable
state. Risk is confined to rendered text, one additive JSON field, and a pure refactor of an
arithmetic check that the existing settlement suite already pins.
