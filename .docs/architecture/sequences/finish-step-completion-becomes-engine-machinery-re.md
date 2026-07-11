# Sequence: finish step with engine-owned presentation repair (issue #499)

**Last updated:** 2026-07-11
**Scope:** One finish attempt for a feature whose branch carries a reused
needs-remediation halt PR — the class that failed try 1 on 6 of 7 ships
(2026-07-10/11). Shows the engine repair running pre-gate, the hardened gate,
and the surgical recording-only retry.

## Diagram

```mermaid
sequenceDiagram
  participant D as Conductor finish step
  participant R as engine repair (MOVED in-step)
  participant A as /finish agent session
  participant FR as finish-record CLI
  participant GH as GitHub (gh, injectable)
  participant G as finish gate (artifacts.ts)

  Note over D,GH: reused halt PR exists (draft, labeled, needs-remediation title)
  D->>A: dispatch /finish
  A->>GH: push, /pr rewrites title/body prose (quality path)
  A->>FR: conduct-ts finish-record --choice pr --pr-url «url»
  FR->>GH: verify PR exists + head pushed (fail-closed)
  FR-->>A: writes finish-choice + pr_url (or refuses, writes nothing)
  A-->>D: session ends

  D->>G: evaluate completion predicate
  Note over G: phase 1 — finish-choice + pr_url + push evidence
  alt phase 1 passes
    G->>R: order-gated repair «prUrl»
    R->>GH: gh pr ready + unlabel + Closes-inject + retitle-floor (warn-only, idempotent)
    Note over G: phase 2 — presentation (fail-open)
    G->>GH: gh pr view title + isDraft (NEW draft check, injected runner)
    G-->>D: done — first-try ship
  else miss is ONLY finish-choice or pr_url
    Note over R: repair SKIPPED — halt signals untouched
    G-->>D: recording-only miss
    D->>A: surgical retry — narrow finish-record prompt (no full re-walk)
  else genuine gap (push evidence, refusal)
    Note over R: repair SKIPPED — label, body marker, draft intact for redispatch + sweep
    G-->>D: step fails — bounded retry or halt (unchanged)
  end
```

## Legend

- The engine repair runs once per completion evaluation, ORDER-GATED: only after the
  non-presentation conditions (phase 1) all pass, strictly before the presentation
  checks (phase 2). A refusing or failing attempt never clears the halt-recovery
  signals (label, body marker, draft) — the redispatch arm and reconciliation sweep
  stay armed (conflict-check 2026-07-11 resolution). Idempotent and warn-only: a gh
  outage never blocks the ship.
- The agent's `finish-record` remains the only writer of `finish-choice`/`pr_url`;
  its absence is still the refusal signal (adr-2026-07-07 preserved). The surgical
  retry only fires when every other gate condition already holds.
- Halt-PR birth and the reconciliation sweep are out of frame and unchanged.
- `«»` marks variable label parts.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-11 | Initial generation | DECIDE phase for intake issue #499 (engineer flow) |
| 2026-07-11 | Repair order-gated into the completion evaluation; pre-dispatch pass removed | Conflict-check Finding 1 resolution (operator-approved) |
