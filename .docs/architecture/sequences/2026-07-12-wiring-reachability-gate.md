# Sequence: wiring_check gate evaluation (#462)

**Last updated:** 2026-07-12
**Scope:** One evaluation of the new `wiring_check` gate after `build_review` passes —
contract verification, orphan backstop, inert waiver, and the kickback path.

## Diagram

```mermaid
sequenceDiagram
    participant SEL as selector / advanceTail
    participant PRED as wiring_check predicate<br/>(artifacts.ts)
    participant PARSE as Wired-into parser<br/>(autoheal.ts)
    participant PROBE as wiring probe<br/>(injected via CompletionContext)
    participant GIT as git diff base...HEAD
    participant GV as gate-verdicts

    SEL->>PRED: evaluate wiring_check
    PRED->>PARSE: parse plan Wired-into: lines per task
    alt line is none (inert until «ref»)
        PRED->>PRED: resolve «ref» (issue/spec)
        alt ref resolves
            PRED-->>GV: task waived (tracked follow-up)
        else ref missing/unresolvable
            PRED-->>GV: satisfied=false, gap: inert waiver without resolvable ref
        end
    else declared call sites
        PRED->>PROBE: verify each declared site
        PROBE->>GIT: new exported symbols in feature diff
        PROBE->>PROBE: a) declared site non-test-references symbol?
        PROBE->>PROBE: b) backstop: every new export reachable<br/>from an entry point via non-test imports?
        alt all verified
            PROBE-->>PRED: wired
            PRED-->>GV: satisfied=true
        else gap found
            PROBE-->>PRED: named gap(s)
            PRED-->>GV: satisfied=false, kickback to build,<br/>evidence: «symbol» unreachable / site unreferenced
            GV-->>SEL: re-open build (MAX_KICKBACKS_PER_GATE cap)
        end
    end
```

## Legend

- The predicate is pure and injectable (push-evidence `GitRunner` pattern) — deterministic,
  network-free except the waiver-ref resolution, test-injectable.
- A missing `Wired-into:` line on a task that adds exports is itself a named gap for the
  backstop path — undeclared primitives cannot pass silently.
- Kickback consumes the existing anti-ping-pong machinery; exhausting the cap escalates via
  the existing stall-halt path (unchanged behavior, not a new HALT).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-12 | Initial generation | DECIDE phase for issue #462 |
