# Sequence: Phase-Scoped .docs Write-Guard (#788)

**Last updated:** 2026-07-22
**Scope:** Marker lifecycle around a BUILD/SHIP step and the docs-guard decision paths:
blocked spec edit, allowlisted retro write, pass-through outside `.docs/`, and inertness
during DECIDE.

## Diagram

```mermaid
sequenceDiagram
    participant C as Conductor engine
    participant T as Allowlist table
    participant M as .pipeline/phase-active
    participant S as Session agent
    participant G as docs-guard.sh
    participant D as .docs/ artifacts

    Note over C: Step entry - phase of step is BUILD or SHIP
    C->>T: resolve step name «step»
    T-->>C: allowed prefixes (empty for most steps)
    C->>M: write marker: step, phase, prefixes

    Note over S,G: BUILD step - agent tries to rewrite the plan
    S->>G: PreToolUse Edit .docs/plans/«slug».md
    G->>M: read marker
    M-->>G: present, no matching prefix
    G-->>S: exit 2 - spec artifacts frozen during BUILD, reason + redirect

    Note over S,G: Same step - non-docs write passes
    S->>G: PreToolUse Edit src/foo.ts
    G-->>S: exit 0 (target not under .docs/)
    S->>D: (n/a - write lands in src/)

    Note over C: Step exit
    C->>M: clear marker

    Note over C: SHIP retro step (non-daemon)
    C->>T: resolve step name retro
    T-->>C: .docs/retros/, .docs/stories/
    C->>M: write marker with retro prefixes
    S->>G: PreToolUse Write .docs/retros/2026-07-22-«slug».md
    G->>M: read marker
    M-->>G: present, prefix allowed
    G-->>S: exit 0
    S->>D: retro report written

    Note over S,G: DECIDE phase - no marker, guard inert
    S->>G: PreToolUse Write .docs/stories/«slug».md
    G->>M: read marker
    M-->>G: absent
    G-->>S: exit 0 (guard inert outside BUILD/SHIP)
    S->>D: authoring proceeds normally

    Note over C,M: Crash mid-step - stale marker
    C->>M: next run detects stale marker (age/PID check) and clears before DECIDE work
```

## Legend

- `docs-guard.sh` runs on the write surface (Edit, Write, NotebookEdit) as a sibling of
  the untouched attribution `mutation-gate.sh`.
- The marker carries the resolved allowlist so the hook needs no engine or YAML logic.
- Stale-marker handling: a marker left by a crashed step must not freeze `.docs/` for a
  later DECIDE session — cleared by the engine on next step transition (exact mechanism
  decided in architecture review / plan).
- `«…»` — placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | DECIDE phase for #788 (engineer spec authoring) |
