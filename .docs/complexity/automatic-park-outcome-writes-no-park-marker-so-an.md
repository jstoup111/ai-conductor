# Complexity: Automatic park outcome writes no park marker

Tier: M

## Rationale

Scored against the standard conduct signals:

- **Models / persistence:** none. The only durable state is the existing `.daemon/parked/<slug>`
  marker file, already owned by `park-marker.ts`.
- **Integrations:** none. No network, no provider call, no third-party boundary.
- **Auth:** none.
- **State machine:** yes, and this is what lifts the work above Small. The change alters the
  daemon's dispatch-eligibility state transition (`error` → parked vs. `error` → re-dispatchable)
  and must preserve the distinction. Getting it wrong in either direction is a live failure mode:
  over-parking silently strands features that should retry; under-parking restores the infinite
  re-dispatch loop this work exists to close.
- **Story count:** roughly 4-6 — park on triage `park`; honest HALT rendering derived from
  on-disk state; non-park errors still dispatch; the `SetupFailureError`-without-triage gap at the
  catch-all; reconciliation reporting the performed park.
- **Blast radius:** a new boundary primitive consumed by all four `writeErrorHalt` call sites in
  `daemon-runner.ts` (`:356`, `:484`, `:536`, `:556`), each with different termination semantics
  (`error` vs `halted`, escalation vs none). Not a single-site edit.

Not Small: the four call sites do not share one termination contract, and the eligibility
transition needs deliberate architecture review before stories. Not Large: one module, no new
subsystem, no schema, no external contract, and the marker writer it must route through
(`writeAutoPark`) already exists and is already honored by `daemon-backlog.ts:846`.

Consistent with the intake issue's own `size: M` label.
