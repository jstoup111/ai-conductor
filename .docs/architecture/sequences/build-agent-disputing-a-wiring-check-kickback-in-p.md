# Sequences: disputed wiring_check kickback — observed vs target

Issue: jstoup111/ai-conductor#1336
Scope: the `build` → `wiring_check` → kickback → `build` cycle, across two daemon dispatches.

## Observed failure (as-built)

```mermaid
sequenceDiagram
  participant D as Daemon
  participant C as Conductor.run()
  participant P as Provider (build agent)
  participant G as wiring_check gate
  participant L as .pipeline/kickback-ledger.json
  participant H as .pipeline/HALT(.class)
  participant R as Re-kick sweep

  Note over D,R: Dispatch 1
  D->>C: dispatch feature «slug»
  C->>G: run BUILD verification group
  G-->>C: FAIL — task «n» declared no new surface, diff adds exports
  C->>L: captureKickbackToBuildContext(wiring_check) — treeBefore
  C->>P: re-enter build with kickback evidence
  P-->>C: settles done — prose: "the gate is wrong / this needs DECIDE"
  Note right of P: full turn paid · 0.5M–2.4M input tokens<br/>zero bytes changed · prose lands in events.jsonl tail<br/>where nothing reads it and the renderer drops it
  C-->>D: build ✓ done
  C->>G: re-run BUILD verification group
  G-->>C: FAIL — verdict unchanged
  C->>L: checkKickbackToBuildEscalation — treeAfter == treeBefore
  L-->>C: no-op
  C->>H: writeHaltMarker("kickback-to-build no-op: build produced no tree<br/>or resolved-count movement", needs-human)
  Note over H: the agent's stated reason is nowhere in this record

  Note over D,R: Every later sweep
  R->>H: readHaltClass(«slug»)
  H-->>R: needs-human
  R-->>D: skipped — halt disposition needs-human
  Note over D,R: terminal without an operator

  Note over D,R: Dispatch 2 (observed ~8h later, after the halt cleared)
  D->>C: dispatch feature «slug»
  C->>P: re-enter build — nothing knows this cycle was already empty
  P-->>C: settles done — same prose, same zero movement
  Note right of P: a second full turn paid for a known-empty cycle
```

## Target flow

```mermaid
sequenceDiagram
  participant D as Daemon
  participant C as Conductor.run()
  participant O as .pipeline/build-outcome.json
  participant P as Provider (build agent)
  participant G as wiring_check gate
  participant L as .pipeline/kickback-ledger.json
  participant H as .pipeline/HALT(.class)
  participant R as Re-kick sweep

  Note over D,R: Dispatch 1
  D->>C: dispatch feature «slug»
  C->>G: run BUILD verification group
  G-->>C: FAIL — wiring gaps for task «n»
  C->>L: captureKickbackToBuildContext(wiring_check) — treeBefore
  C->>O: read prior stamp for (wiring_check, tree «t», verdict fail, rung «r»)
  O-->>C: no prior stamp — dispatch is not a known-empty repeat
  C->>P: re-enter build with kickback evidence
  P-->>C: settles done — prose: the gate is wrong / this needs DECIDE

  rect rgb(240,240,240)
    Note over C,O: build settle boundary — the one new observation point<br/>reached on EVERY terminal outcome: done · failed · no-verdict
    C->>C: classifyBuildSettle(treeBefore, treeAfter, resolved delta)
    C->>O: stamp — outcome no-movement · gate · tree «t» · verdict · rung «r»<br/>note = step_completed tail (200-line bound, reused not re-read)<br/>category belongs-to-decide (advisory — gates nothing)
  end

  C-->>D: build ✓ done (no movement — tree «t» unchanged)
  Note right of D: outcome 1 — distinguishable from the log alone

  C->>G: re-run BUILD verification group
  G-->>C: FAIL — verdict unchanged
  C->>L: checkKickbackToBuildEscalation — no-op (unchanged logic)
  C->>O: read stamp — note + optional build-dispute.json category
  O-->>C: no-movement + category belongs-to-decide + verbatim note
  C->>H: writeHaltMarker(reason naming the operator's decision, needs-human)
  Note over H: outcomes 2 and 4 — the claim and the decision both survive<br/>in the reason text and the stamp, NOT in a new halt class

  R->>H: readHaltClass(«slug»)
  H-->>R: needs-human
  R-->>D: skipped — halt disposition needs-human
  Note over R: outcome 5 — still halts, still needs a human<br/>re-kick behavior byte-identical to today

  Note over D,R: Dispatch 2
  D->>C: dispatch feature «slug»
  C->>O: read prior stamp for (wiring_check, tree «t», verdict fail, rung «r»)
  O-->>C: DEFINITE match on all four — this cycle already produced nothing
  C->>H: halt WITHOUT dispatching build
  Note right of C: outcome 3 — the identical empty cycle is never re-paid<br/>a null/unreadable tree hash would have dispatched instead
```

## Negative path — a real wiring gap the build failed to close

```mermaid
sequenceDiagram
  participant C as Conductor.run()
  participant O as .pipeline/build-outcome.json
  participant P as Provider (build agent)
  participant G as wiring_check gate
  participant L as .pipeline/kickback-ledger.json
  participant H as .pipeline/HALT(.class)

  C->>G: run BUILD verification group
  G-->>C: FAIL — real wiring gap
  C->>O: read prior stamp
  O-->>C: prior stamp exists but tree hash differs — not a repeat
  C->>P: re-enter build
  P-->>C: settles done — edits committed, gap still open
  C->>O: stamp — outcome moved · tree «a»..«b»
  C->>G: re-run gate
  G-->>C: FAIL — gap still open
  C->>L: checkKickbackToBuildEscalation — did-work, no escalation
  L-->>C: budget consumed toward MAX_KICKBACKS_PER_GATE
  Note over C,L: unchanged from today — cap eventually trips
  C->>H: writeHaltMarker(cap reason, needs-human)
  Note over H: no auto-pass · no unbounded retry
```

## Legend

- `«slug»`, `«t»`, `«a»`, `«b»`, `«n»` — variable parts (feature slug, tree hashes, task id).
- Shaded block — the single new observation point this change introduces.
- `build-dispute.json` is optional enrichment: read when the agent happened to author it, never
  required for any outcome above.
- `«r»` is the escalation rung (model + effort) the dispatch would run at — part of the refusal key
  so the guard can never decline a strictly more-capable retry.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-05 | Initial generation | DECIDE for jstoup111/ai-conductor#1336 |
| 2026-08-05 | Applied review conditions C1–C5 | architecture-review-2026-08-05: definite-match refusal with inverted null polarity, escalation rung in the key, stamp on every terminal outcome, 200-line tail bound reusing `step_completed`, advisory-only category |
