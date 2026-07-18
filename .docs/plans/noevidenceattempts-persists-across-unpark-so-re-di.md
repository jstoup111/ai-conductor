# Plan: unpark grants a fresh evidence budget (issue #667)

Tier: S (see `.docs/complexity/noevidenceattempts-persists-across-unpark-so-re-di.md`).
Stories: `.docs/stories/noevidenceattempts-persists-across-unpark-so-re-di.md`.

All conductor code lives under `src/conductor/`; run vitest from that directory
(`cd src/conductor && npx vitest run <file>`), never from the repo root.

## Tasks

### Task 1 — RED: failing tests for operator-unpark counter reset
**Dependencies:** none
Extend `src/conductor/test/engine/daemon-park-cli.test.ts`:
- Update the test at ~line 350 ("unpark only resets counter for auto-parked features") —
  the encoded behavior is the #667 bug. Replace with: operator-parked unpark resets
  `noEvidenceAttempts` to 0 and clears `noEvidenceReasons` (Story 1.1).
- Keep/verify the auto-park reset test (~line 303) green unchanged (Story 1.2).
- Extend the reset-failure test (~line 496) to cover the operator-park branch: failed
  reset ⇒ non-zero exit, marker survives (Story 1.3).
**Files:** src/conductor/test/engine/daemon-park-cli.test.ts

### Task 2 — GREEN: reset counter on unpark regardless of provenance
**Dependencies:** Task 1
In `src/conductor/src/engine/daemon-park-cli.ts` (unpark branch, ~143-172): call
`resetNoEvidenceAttempts` for BOTH provenances — hoist the reset out of the
`provenance === 'auto'` conditional, preserving the existing worktree-root /
resolved-root fallback (~line 157) and the fail-loudly-keep-marker ordering.
**Files:** src/conductor/src/engine/daemon-park-cli.ts

### Task 3 — RED: failing test for the root-mismatch hazard
**Dependencies:** Task 2
Add a test (daemon-park-cli.test.ts or a focused new test) asserting Story 1.4: after
unpark, a read via `readNoEvidenceAttempts` at the root the auto-park gate uses
(`projectRoot` as passed to `checkAndAutoPark`) observes 0. If the current
worktree-vs-projectRoot resolution already guarantees this, the test documents it; if
not, it exposes the gap for Task 4.
**Files:** src/conductor/test/engine/daemon-park-cli.test.ts

### Task 4 — GREEN: close (or prove closed) the root-mismatch
**Dependencies:** Task 3
Make the Task 3 test pass: ensure the unpark reset targets the same sidecar the gate
reads (reset both worktree and resolved main-repo root if they can diverge, or assert a
single canonical root). Keep the change minimal and deterministic.
**Files:** src/conductor/src/engine/daemon-park-cli.ts

### Task 5 — RED: failing tests for the inherited-budget halt message
**Dependencies:** none
In `src/conductor/test/engine/daemon-auto-park.test.ts` (and conductor-level test if the
message is composed there): add cases for Story 2 — (a) threshold reached within the
cycle ⇒ today's "no completion evidence after 3 attempts" message; (b) counter already
at/over threshold with zero increments this cycle ⇒ reason names an inherited budget;
(c) fresh-failure case never claims "inherited".
**Files:** src/conductor/test/engine/daemon-auto-park.test.ts

### Task 6 — GREEN: truthful halt reason
**Dependencies:** Task 5
Implement the inherited-budget wording. Seams: `checkAndAutoPark`
(`src/conductor/src/engine/daemon-auto-park.ts` ~122-148, reason at ~137) and the
auto-park block in `src/conductor/src/engine/conductor.ts` (~3355-3441, marker text at
~3427-3429). Detection must be deterministic: track attempts-at-cycle-start (e.g.
snapshot `readNoEvidenceAttempts` at dispatch start, or count increments this cycle via
the existing in-memory gate state at conductor.ts:3275-3292) — no LLM judgement. Keep
the unpark remedy line in both message variants.
**Files:** src/conductor/src/engine/daemon-auto-park.ts, src/conductor/src/engine/conductor.ts

### Task 7 — Regression: park→unpark→dispatch budget cycle test
**Dependencies:** Task 2, Task 6
Add an acceptance-style test (alongside
`src/conductor/test/acceptance/task-status-auto-park-survivability.acceptance.test.ts`
conventions) for Story 3: exhausted budget → park → unpark → counter is 0 → gate takes 3
fresh attempts before re-parking; and a second unpark cycle is again bounded at 3.
Confirm the survivability suite still passes (counter must still survive plain daemon
restarts — reset happens ONLY at the unpark verb).
**Files:** src/conductor/test/engine/daemon-park-cli.test.ts, src/conductor/test/acceptance/task-status-auto-park-survivability.acceptance.test.ts

### Task 8 — Docs + CHANGELOG
**Dependencies:** Task 7
Add a `## [Unreleased]` Fixed entry in `CHANGELOG.md` describing: unpark now resets the
no-evidence budget for operator- and auto-parked features, and the auto-park halt message
distinguishes an inherited budget from fresh failures. Update
`src/conductor/README.md` daemon park/unpark section if it documents the reset behavior.
**Files:** CHANGELOG.md, src/conductor/README.md

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3 ──▶ Task 4 ──┐
                                          ├─▶ Task 7 ──▶ Task 8
Task 5 ──▶ Task 6 ─────────────────────────┘
```

## Verification

- `cd src/conductor && npx vitest run test/engine/daemon-park-cli.test.ts test/engine/daemon-auto-park.test.ts test/engine/task-evidence.test.ts`
- Full suite green; `test/test_harness_integrity.sh` passes.
