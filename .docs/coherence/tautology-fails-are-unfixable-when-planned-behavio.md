# Coherence Mapping: Verify-Only-Anchored Tautology Exception (#1579)

Technical track — no PRD, so the `fr` row class is omitted. Outcome ids derive from the four
staged Desired-outcome bullets. Consistency pass (§4d) run over every covered row; the
cross-layer subjects (exception list count, skipped-closure channel) were resolved by
amendment during conflict-check and no contradiction remains.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-2, story-3, story-5 | covered | Convergence to PASS: exception (story-2), completeness relief (story-3), DECIDE-time marking (story-5) |
| outcome | outcome-2 | story-2, story-4 | covered | Negative path: unanchored/helper tests still FAIL (story-2 negatives); no invented assertions (story-4) |
| outcome | outcome-3 | story-4, story-5 | covered | First post-finding lap sanctioned exit (story-4 discovered case); first-lap anchor via markers (story-5) |
| outcome | outcome-4 | story-1, story-2 | covered | Auditability: engine-parsed evidence (story-1) applied via closed per-test predicate (story-2) |
| story | story-1 | task-1, task-2, task-3 | covered | Derivation, snapshot/digest, projections |
| story | story-2 | task-4, task-5, task-7 | covered | Evidence block, fourth exception (monolithic), fan-out tautology skill parity |
| story | story-3 | task-6, task-8 | covered | Completeness line in both lanes |
| story | story-4 | task-9, task-10 | covered | tdd and writing-system-tests boundaries |
| story | story-5 | task-11 | covered | plan marker guidance |
| task | task-1 | story-1 | covered | Cites Story 1 happy path |
| task | task-2 | story-1 | covered | Cites Story 1 snapshot/digest criterion |
| task | task-3 | story-1 | covered | Cites Story 1 + Story 2 content-free negative |
| task | task-4 | story-2 | covered | Cites Story 2 evidence-block criteria |
| task | task-5 | story-2 | covered | Cites Story 2 exception-list criteria |
| task | task-6 | story-3 | covered | Cites Story 3 criteria |
| task | task-7 | story-2 | covered | Fan-out parity for the predicate |
| task | task-8 | story-3 | covered | Fan-out parity for the completeness line |
| task | task-9 | story-4 | covered | tdd boundary, declared + discovered cases |
| task | task-10 | story-4 | covered | writing-system-tests boundary |
| task | task-11 | story-5 | covered | Marker guidance + over-marking prohibition |
| adr | adr-2026-08-15-verify-only-anchored-tautology-exemption | story-1, story-2, story-3, story-4, story-5 | covered | D1→story-1, D2/D3→story-2, D4→story-3, D5→story-4 and story-5; Evidence: skipped amendment reflected in story-4 |
