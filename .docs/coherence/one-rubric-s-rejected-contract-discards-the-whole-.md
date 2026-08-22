# Coherence: one-rubric-s-rejected-contract-discards-the-whole- (#1740)

Tier M, technical track (no PRD — `fr` rows omitted). No `.docs/decisions/adr-*` file is in this spec's change set — `adr` rows omitted. Outcomes are the five staged Desired-outcome bullets from jstoup111/ai-conductor#1740. Every counterpart id was confirmed against the real stories/plan files; §4d consistency pass found no contradiction (the explore-stage approach that would have contradicted adr-2026-08-18 D3 was replaced before stories were written).

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-2 | covered | Well-formed verdicts still count toward the lap: Story 2 keeps the three judged branch artifacts and forbids their replacement by a prior lap (Task 3, Task 10). |
| outcome | outcome-2 | story-1, story-2 | covered | Kickback reason names only current-lap findings: Story 1 makes a prior-lap non-PASS aggregate `absent`; Story 2's mixed case publishes only the current lap's finding (Tasks 6, 10). |
| outcome | outcome-3 | story-3 | covered | Rejected rubric's concern is a first-class record: `lastMechanicalFault` in the ledger, rendered in the halt and `build-review findings` (Tasks 1–5). |
| outcome | outcome-4 | story-1 | covered | Stale-verdict condition is observable: completion reason names both lap ids and `build_review_stale_aggregate` is persisted (Tasks 6, 9). |
| outcome | outcome-5 | story-2 | covered | A rejected rubric still blocks PASS: no aggregate below cap, infrastructure-failure coverage with effective FAIL at cap (Task 10). |
| story | story-1 | task-6, task-7, task-8, task-9 | covered | All eight happy/negative criteria mapped: guard (6), preservation/mtime/git-failure/stale-PASS negatives (7), untouched file + ledger + no kickback event (8), spine event (9). |
| story | story-2 | task-3, task-10 | covered | Ledger write from the lap join (3); three-lap acceptance proof with at-cap, mixed, and all-infra variants (10, verify-only). |
| story | story-3 | task-1, task-2, task-4, task-5 | covered | Type + validator (1), write/replace/bound/credit/PASS-retain (2), halt fallback (4), findings renderer (5). |
| task | task-1 | story-3 | covered | Infrastructure task; serves Story 3's legacy-parse and malformed-reject criteria. |
| task | task-2 | story-3 | covered | Write, replace, truncation, credit-clears, PASS-retains. |
| task | task-3 | story-2 | covered | Producer; asserts no aggregate written and `currentLapMechanicalFault: true`. |
| task | task-4 | story-3 | covered | Exhausted halt renders the record when the current-lap diagnostic is unavailable. |
| task | task-5 | story-3 | covered | Findings line and JSON key; byte-identical output without a record. |
| task | task-6 | story-1 | covered | Stale non-PASS → absent; current FAIL → named-route. |
| task | task-7 | story-1 | covered | Negative paths: stamped PASS preserved, mtime floor, git failure, stale PASS. |
| task | task-8 | story-1 | covered | File bytes, ledger counters, and event list unchanged on the absent route. |
| task | task-9 | story-1 | covered | `EVENT_SINKS` declaration and single emission from `completion.staleLap`. |
| task | task-10 | story-2 | covered | Verify-only acceptance proof across three laps plus the at-cap and mixed variants. |
