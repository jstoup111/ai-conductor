# Coherence Mapping: Preservation-Anchored Completeness Exception (#1580)

Technical track — no PRD, so the `fr` row class is omitted. Outcome ids derive from the four staged
Desired-outcome bullets of jstoup111/ai-conductor#1580. Outcomes 3 and 4 are recorded as `gap` and
waived in `.docs/coherence-waivers/plan-over-prescription-drives-completeness-finding.md`: the
operator scoped this spec to outcomes 1 and 2 on 2026-08-16, and claiming the other two as covered
would be a false traceability claim. Consistency pass (§4d) run over every covered row; the
cross-layer pair worth checking (outcome-1's "still FAILs" against Story 3's exemption tasks) is
adjudicated in the notes on `outcome-1` and found non-contradictory.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-3, story-4, story-5 | covered | Finding-load drop comes from story-3 (relocation with equivalence yields no finding). The bullet's own negative half — "genuinely absent from the diff still FAILs" — is story-4, whose whole subject is that a deleted carrier with no surviving equivalent still produces a finding. §4d check: story-3 and story-4 are disjoint on condition 3 of the same predicate, so satisfying either leaves the other holding; no contradiction. story-5 keeps the drop from over-applying by forcing per-clause evaluation. |
| outcome | outcome-2 | story-1, story-3 | covered | "Express existing coverage must not regress without enumerating named test cases" is story-1's `**Preserves:** <behavior>` form and its behavior-level boundary; "relocated or reorganized coverage with equivalent assertions produces no finding" is story-3's happy path verbatim. |
| outcome | outcome-3 |  | gap | outcome-3 — task-count warning band. Out of scope by operator decision 2026-08-16; measurement showed the premise does not hold (49 of the last 60 plans sit in the normal 1-20 band). Waived. |
| outcome | outcome-4 |  | gap | outcome-4 — non-human resolution path for over-specified plans. Out of scope by operator decision 2026-08-16; the valve shipped separately as rubric dispositions (PR #1563) after this issue was filed. Waived. |
| story | story-1 | task-7, task-8 | covered | Authoring form (task-7) and harness-integrity repair (task-8) |
| story | story-2 | task-1, task-2, task-3, task-4, task-5, task-6 | covered | Parser happy/multi/fail-closed, snapshot, projection, digest identity |
| story | story-3 | task-9, task-11, task-12 | covered | Predicate stated (task-9), relocation-with-equivalence exempt (task-11), weakened relocation still fails (task-12) |
| story | story-4 | task-13, task-14 | covered | Lost coverage still FAILs with a contract-shaped anchor (task-13); surviving name is not surviving assertion, plus the different-behavior and skipped-replacement shapes (task-14) |
| story | story-5 | task-15 | covered | Mixed relocate-one/lose-one yields exactly one finding; distinct anchors so dispositions cannot alias; extended to the three-behavior case |
| story | story-6 | task-10, task-16 | covered | Doctrine narrowed in place and per-clause evaluation stated (task-10); neither removal evidence nor a clause grants an exemption alone (task-16) |
| task | task-1 | story-2 | covered | Cites Story 2 single-clause happy path |
| task | task-2 | story-2 | covered | Cites Story 2 multi-clause criterion |
| task | task-3 | story-2 | covered | Cites Story 2 fail-closed negatives |
| task | task-4 | story-2 | covered | Cites Story 2 frozen-snapshot criterion |
| task | task-5 | story-2 | covered | Cites Story 2 projection criterion; Completeness-only scoping per adr-2026-08-13 §2 |
| task | task-6 | story-2 | covered | Cites Story 2 digest-identity negative |
| task | task-7 | story-1 | covered | Cites Story 1 authoring form |
| task | task-8 | story-1 | covered | Cites Story 1 harness-integrity negative |
| task | task-9 | story-3 | covered | Cites Story 3 three-condition predicate |
| task | task-10 | story-6 | covered | Cites Story 6 doctrine narrowing and per-clause statement |
| task | task-11 | story-3 | covered | Cites Story 3 happy path |
| task | task-12 | story-3 | covered | Cites Story 3 weakened-relocation negative |
| task | task-13 | story-4 | covered | Cites Story 4 primary negative path — the High-impact risk in the register |
| task | task-14 | story-4 | covered | Cites Story 4 surviving-name negative |
| task | task-15 | story-5 | covered | Cites Story 5 per-clause criterion |
| task | task-16 | story-6 | covered | Cites Story 6 removal-evidence-alone negative |
| adr | adr-2026-08-16-preservation-anchored-completeness-exemption | story-1, story-2, story-3, story-4, story-5, story-6 | covered | D1 (behavior-level `**Preserves:**` form) → story-1; D2 (deterministic parse into the v2 projection) → story-2; D3 (three-condition per-clause predicate) → story-3, story-4 and story-5, with condition 3 owned by story-4 and the per-clause grain by story-5; D4 (narrow the removal doctrine in place) and D5 (holistic judgement untouched) → story-6. The five conditions from `architecture-review-2026-08-16-plan-over-prescription-drives-completeness-finding.md` map as: condition 1 → story-4, condition 2 → story-5, condition 3 → story-3 Done-When and the plan's Technical Approach, condition 4 → story-6, condition 5 → story-2 fail-closed negatives. |
