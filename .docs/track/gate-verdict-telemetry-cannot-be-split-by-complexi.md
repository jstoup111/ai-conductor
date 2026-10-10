# Track: Gate verdict telemetry split by complexity tier

Track: technical

Scope boundary: The exported gate counters `conductor.gate.verdicts` and `conductor.gate.kickbacks` gain the feature's complexity tier (S/M/L) as an optional data-point label. The label is carried on the existing `gate_verdict` and `kickback` events and stamped by the conductor at emission (adr-014 D14 amended by #2790). It is omitted when no tier is resolved and is never added to a `kickback` whose `from` is `rebase`. The change also locks, with tests, the existing guarantee that infrastructure failures never emit `gate_verdict` or `kickback`, so a counted fail or kickback is a substantive rejection. Excluded: new events, new instruments, or listener-side tier inference; exporting per-rubric `build_review` infrastructure failures (owned by #1835); tier on step retries, spans, or other instruments; and any dashboard edits. Totals that ignore tier are unchanged.

Internal telemetry instrumentation with no product requirements; acceptance criteria live in stories (intake jstoup111/ai-conductor#2790).
