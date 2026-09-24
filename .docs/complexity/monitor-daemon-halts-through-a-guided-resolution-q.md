# Complexity: Monitor daemon HALTs through a guided resolution queue

Tier: L

## Rationale

Large. The balanced scope crosses six surfaces that are each independently reviewable, and one of
them is a new engine seam rather than a new caller of an existing one.

**New engine seam (the tier driver).** There is no provider-agnostic way to launch an interactive
session and await its exit. The `interactive: true` plumbing on both adapters has exactly one
caller, bound to a live pipeline `StepRunner`, and every adapter-spawned session is stamped
`CONDUCT_DAEMON_SESSION=1` — which makes the launched session unable to run the very recovery verbs
it exists to run. The only standalone precedent hardcodes the `claude` binary. Generalising that to
the configured provider is new capability, not reuse, and it lands on the provider contract.

**New CLI verb across two surfaces.** Subcommand dispatch is a hand-rolled detect/dispatch chain in
`index.ts` whose ordering is load-bearing, plus a separate Commander declaration in `cli.ts` for
help. The verb also carries a documented docs obligation (full help reference, `README.md`,
`src/conductor/README.md`) and a binding release condition: the implementation must not edit
`bin/conduct`, or it triggers the migration-block gate.

**Cross-project enumeration that does not exist.** No API returns halted features with their halt
class, and nothing iterates registered projects continuously — the one fleet helper is one-shot and
sequential. Both need extending.

**New spine members.** Queue transitions are occurrences, so each needs a `ConductorEvent` variant
plus an exhaustive sink declaration; the union is type-checked to reject a member that does not
declare where it goes.

**Governing-decision density.** The design sits against several APPROVED ADRs that constrain it
directly — always-on process policy, non-autonomy, state-file placement, no session resume, the
no-stream-consumer-when-interactive rule, and the live-boundary rules a long-running watcher and an
interactive session both touch. That density is what makes the full architecture review worth its
cost rather than a formality, and it is why this is not Medium.

Not larger than L: the loop itself is small, the queue holds no independent durable state, and the
diagnostic body is an existing skill invoked as-is rather than new machinery.
