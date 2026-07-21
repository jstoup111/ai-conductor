# Sequence: Progress-aware build halt/re-kick (#280)

## Within-dispatch: retry loop with progress-delta gate + ceiling backstop

```mermaid
sequenceDiagram
  participant C as Conductor.run
  participant B as build step «claude -p dispatch»
  participant TS as task-status.json
  participant TE as task-evidence.json
  participant P as checkAndAutoPark

  loop attempt under absolute-ceiling
    C->>B: dispatch build
    B->>TS: resolve some tasks + commit
    C->>TS: countResolvedTasks «after»
    alt completion gate passes
      C-->>C: step succeeds, exit loop
    else miss and delta gt 0 «progress made»
      C->>TE: reset noEvidenceAttempts
      C-->>C: re-dispatch «does not push toward park»
    else miss and delta eq 0 «zero net progress»
      C->>TE: increment noEvidenceAttempts
      C->>P: checkAndAutoPark «existing wedge path»
      P-->>C: park «terminal for this run»
    end
  end
  Note over C: ceiling reached while still progressing -> park with a "made progress, ceiling hit" reason (backstop, not the common case)
```

## Across-dispatch: progress-gated re-kick on a quiet main

```mermaid
sequenceDiagram
  participant D as daemon idle/poll tick
  participant TE as task-evidence.json
  participant DC as per-spec dispatch ceiling
  participant C as Conductor.run «new dispatch»

  D->>TE: read last-dispatch progress marker
  alt last dispatch resolved >=1 task and under dispatch-ceiling
    D->>DC: check + increment dispatch count
    D->>C: re-kick build «no base advance required»
  else last dispatch made zero progress
    D-->>D: leave parked for base-advance rekickSweep / operator
  end
```

## Notes
- The zero-progress branch is unchanged from today's behavior — genuine wedges still park.
- The absolute ceiling and per-spec dispatch ceiling are the only NEW terminal conditions; both
  are configurable with conservative defaults and both emit a distinct, self-explaining reason.
- `rekickSweep` (base-advance) is untouched; the progress-gated re-kick is additive and bounded.
