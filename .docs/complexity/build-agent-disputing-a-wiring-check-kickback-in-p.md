# Complexity: build agent disputing a wiring_check kickback halts needs-human

Tier: M

## Rationale

Medium. The change is confined to the conductor engine and its durable sidecars, but it
crosses several coupled seams rather than one:

- a new observation point at the **build step settle boundary** in `conductor.ts` (tree
  hash before/after, provider final-text capture), alongside the existing gate-re-failure
  observation in `captureKickbackToBuildContext`;
- a **new durable record** (build-outcome stamp) with its own schema, atomic write, and
  fail-open read semantics, mirroring `kickback-ledger.ts`;
- a **halt-disposition routing change** — `needs-human` is currently hardcoded at each halt
  site (`conductor.ts:4251`, `:6766`) and consumed by `daemon-rekick.ts:186`; adding a
  distinct disposition touches both producer and consumer plus `halt-marker.ts`'s
  `HaltDisposition` union and its migration path;
- **cross-dispatch state** that must reconcile with #984's within-dispatch kickback bound
  rather than duplicate it — a correctness interaction, not just an addition;
- operator-facing **log/render surfaces** (`ui/create-renderer.ts`, `daemon-cli.ts`) and the
  documentation upkeep those imply.

Not Large: no new models, no external integrations, no auth surface, no new provider or
adapter, no schema migration of an existing on-disk contract beyond an additive union
member. Not Small: more than one module, a new persisted artifact, and a state-machine
disposition change with a negative-path requirement (a genuine wiring failure must still
halt needs-human) that needs explicit conflict and coherence checking.

Estimated 6-8 stories.
