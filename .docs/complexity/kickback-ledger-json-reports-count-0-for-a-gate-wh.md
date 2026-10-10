# Complexity: Remediation-gate budget readable from one place that agrees with enforcement

Tier: S

Rationale: Read-side changes to two existing operator surfaces that already share one projection
(`src/conductor/src/engine/kickback-budget-view.ts`): `kickback-budget inspect`
(`kickback-budget-cli.ts`) and the `daemon status` kickback section (`daemon-observe-cli.ts`). One
small shared resolver moves the fallback cap onto the engine's own `remediationLapCapForGate`. No
change to ledger schema, charging, settlement, cap enforcement, events, or CLI flags; no new
state or channel (the event-spine procedure does not apply: nothing new observes, stamps, or
signals — it renders existing durable state). Risk is confined to rendered text and the JSON view's
additive `pendingLaps` field, both unit-testable through the CLI entry points.
