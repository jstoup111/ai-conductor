# Complexity: Rekick resume runs finish while the build gate verdict is unsatisfied (#532)

Tier: M

## Rationale

- Engine correctness fix on a critical path (resume entry can currently reach `finish` — a false-ship path — with unsatisfied gate verdicts on disk).
- One state-machine seam: the resume index derivation in `conductor.run()` becomes verdict-aware by reusing the existing `gateSatisfied`/`selectNextGate` selector; no new models, integrations, or auth.
- Both `findResumeIndex` branches (first `in_progress` step; last-done+1 walk) must be covered, plus the daemon rekick path that shares the resume seam.
- Requires negative-path acceptance coverage (all-verdicts-satisfied resume must still fast-forward — no regression to re-running completed work).
- Medium ceremony: lightweight architecture review + conflict-check apply; no PRD (technical track).
