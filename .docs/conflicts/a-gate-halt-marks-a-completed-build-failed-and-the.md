# Conflict Check: a-gate-halt-marks-a-completed-build-failed-and-the (respec 2026-08-24)

Scanned: the 7 respec stories against all `.docs/stories/` files touching step status, `failed`
stamps, HALT writing, `loop_halt`/`gate_blocked` events, resume entry, event-spine membership,
kickback routing, and seal halts (12 read in full, 6 grep-verified), plus the change-set ADR
`adr-2026-08-24-refused-step-status.md` and 7 governing APPROVED ADRs. ADR corpus:
`change_set` (config key unset). Every pair sharing a behavior was tested in both directions.

**Verdict: no blocking conflicts.** Two degrading overlaps accepted with resolutions below; one
boundary assumption pinned for the plan.

## Conflict: step_refused vs the pinned persisted-event set

**Stories involved:** Story 4 (refusals visible on the spine) vs `loop-halt-never-reaches-events-jsonl-so-a-halt-is-.md` Story 6
**Type:** behavioral overlap
**Severity:** degrading (accepted)

The old story pins the exact persisted event-type set so any *unintended* addition fails the
suite; Story 4 deliberately adds `step_refused`. Resolution: the implementation updates the
pinned set in the same diff that introduces `step_refused` — the pin story anticipates
deliberate additions; no story amendment needed.

## Conflict: gate-blocked exits leave the enriched no-verdict backstop

**Stories involved:** Story 6 (prerequisite-naming HALT) vs `conduct-loop-exits-silently-between-steps-no-termi.md`
**Type:** behavioral overlap
**Severity:** degrading (accepted)

The backstop's enriched "loop exited without a terminal verdict" diagnostics must remain for
every other no-verdict exit. Resolution: the gate-blocked HALT is written before the loop
returns, so the backstop's precondition (no HALT present) is false for that class and it simply
stops firing there; the backstop wording itself is untouched.

## Assumption pinned for /plan (not a conflict)

`gate-kickback-counter-resets-every-dispatch-so-no-.md` Story 5 requires the kickback-cap
exhausted HALT (`needs-human`). Whether that cap HALT is a "step-written needs-human halt site"
is unstated on both sides. **Pinned: out of scope** — cap exhaustion follows repeated genuine
FAIL verdicts, so the step keeps its current status behavior; only the three sites named in
`adr-2026-08-24-refused-step-status.md` adopt `refused`. The plan must state this boundary
explicitly.
