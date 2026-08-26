# Coherence: One owner per review question (#1805)

**Date:** 2026-08-22
**Tier:** L
**Track:** product — `fr` rows from the PRD's FR-1..FR-23.
**Outcome source:** the Desired-outcome bullets of jstoup111/ai-conductor#1805, staged at `.pipeline/intake-outcomes.md` and carried into `.docs/intake/` by land.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-7, story-10, story-13 | covered | A feature whose implementation matches its approved plan reaches SHIP without an operator … — A plan-conformant feature reaches SHIP with no gate-vs-gate arbitration: prd_audit is the only completion authority (7), its kickback is capped (10), and the as-built review never kicks back (13). |
| outcome | outcome-2 | story-5, story-11, story-13 | covered | No gate can direct BUILD to implement a mechanism the approved plan does not authorize; wh… — No gate orders off-plan work: a BUILD plan gap halts (5), a prd_audit plan gap halts or is recorded (11), as-built PLAN_GAP halts or is recorded (13). |
| outcome | outcome-3 | story-1, story-6, story-9 | covered | The same question is not asked twice by two gates against two artifacts — a delivered-outc… — Single owner per question: the overlapping rubrics are removed (1); delivered outcomes belong to prd_audit (6) including scope-as-intent (9). |
| outcome | outcome-4 | story-3, story-12, story-13 | covered | Correctness defects found only after the code exists (the `a-gate-halt` lap-2 class above)… — Post-code defects still caught: test-quality judges real tests (3); the as-built review runs on every tier with reachability and PLAN_GAP (12, 13). |
| outcome | outcome-5 | story-10, story-14, story-16 | covered | The number of plan tasks a feature accumulates is bounded by its authored plan plus explic… — Task growth bounded by the authored plan plus capped additions (10), visible per feature (14), with pre-existing additions counted as authored (16). |
| fr | fr-1 | story-1 | covered | Story `**Requirement:**` line cites FR-1. |
| fr | fr-2 | story-2 | covered | Story `**Requirement:**` line cites FR-2. |
| fr | fr-3 | story-3 | covered | Story `**Requirement:**` line cites FR-3. |
| fr | fr-4 | story-3 | covered | Story `**Requirement:**` line cites FR-4. |
| fr | fr-5 | story-4 | covered | Story `**Requirement:**` line cites FR-5. |
| fr | fr-6 | story-5 | covered | Story `**Requirement:**` line cites FR-6. |
| fr | fr-7 | story-6 | covered | Story `**Requirement:**` line cites FR-7. |
| fr | fr-8 | story-7 | covered | Story `**Requirement:**` line cites FR-8. |
| fr | fr-9 | story-9 | covered | Story `**Requirement:**` line cites FR-9. |
| fr | fr-10 | story-8 | covered | Story `**Requirement:**` line cites FR-10. |
| fr | fr-11 | story-8 | covered | Story `**Requirement:**` line cites FR-11. |
| fr | fr-12 | story-10 | covered | Story `**Requirement:**` line cites FR-12. |
| fr | fr-13 | story-10 | covered | Story `**Requirement:**` line cites FR-13. |
| fr | fr-14 | story-11 | covered | Story `**Requirement:**` line cites FR-14. |
| fr | fr-15 | story-12 | covered | Story `**Requirement:**` line cites FR-15. |
| fr | fr-16 | story-13 | covered | Story `**Requirement:**` line cites FR-16. |
| fr | fr-17 | story-13 | covered | Story `**Requirement:**` line cites FR-17. |
| fr | fr-18 | story-10 | covered | Story `**Requirement:**` line cites FR-18. |
| fr | fr-19 | story-14 | covered | Story `**Requirement:**` line cites FR-19. |
| fr | fr-20 | story-15 | covered | Story `**Requirement:**` line cites FR-20. |
| fr | fr-21 | story-16 | covered | Story `**Requirement:**` line cites FR-21. |
| fr | fr-22 | story-16 | covered | Story `**Requirement:**` line cites FR-22. |
| fr | fr-23 | story-1 | covered | Story `**Requirement:**` line cites FR-23. |
| story | story-1 | task-7, task-12, task-30 | covered | Tasks whose `**Story:**` line is 1. |
| story | story-2 | task-11, task-32 | covered | Tasks whose `**Story:**` line is 2. |
| story | story-3 | task-4, task-13, task-14, task-16 | covered | Tasks whose `**Story:**` line is 3. |
| story | story-4 | task-15 | covered | Tasks whose `**Story:**` line is 4. |
| story | story-5 | task-1, task-2, task-3 | covered | Tasks whose `**Story:**` line is 5. |
| story | story-6 | task-18, task-20 | covered | Tasks whose `**Story:**` line is 6. |
| story | story-7 | task-8 | covered | Tasks whose `**Story:**` line is 7. |
| story | story-8 | task-9, task-17 | covered | Tasks whose `**Story:**` line is 8. |
| story | story-9 | task-25 | covered | Tasks whose `**Story:**` line is 9. |
| story | story-10 | task-6, task-22, task-23 | covered | Tasks whose `**Story:**` line is 10. |
| story | story-11 | task-24, task-28 | covered | Tasks whose `**Story:**` line is 11. |
| story | story-12 | task-10, task-21 | covered | Tasks whose `**Story:**` line is 12. |
| story | story-13 | task-26, task-27 | covered | Tasks whose `**Story:**` line is 13. |
| story | story-14 | task-19 | covered | Tasks whose `**Story:**` line is 14. |
| story | story-15 | task-5 | covered | Tasks whose `**Story:**` line is 15. |
| story | story-16 | task-29, task-31 | covered | Tasks whose `**Story:**` line is 16. |
| task | task-1 | story-5 | covered | Done when: block parser per plan task |
| task | task-2 | story-5 | covered | Task close requires Done when: evidence when the block exists |
| task | task-3 | story-5 | covered | Unsatisfiable Done when: check halts as plan-gap |
| task | task-4 | story-3 | covered | Covers: marker parser accepts FR, story-criterion, and task references |
| task | task-5 | story-15 | covered | Config accepts retired rubric keys as no-ops with a one-time warning |
| task | task-6 | story-10 | covered | prd_audit cap and as-built per-check config keys |
| task | task-7 | story-1 | covered | Registry lists only test-quality; retired ids are unregistered |
| task | task-8 | story-7 | covered | prd_audit runs on every track; gate surface includes stories and specs |
| task | task-9 | story-8 | covered | prd_audit verdict parser reads per-criterion rows and grades |
| task | task-10 | story-12 | covered | As-built step runs on every tier and track |
| task | task-11 | story-2 | covered | Coordinator dispatches only enabled registered rubrics; empty set is PASS |
| task | task-12 | story-1 | covered | Verdict validator rejects unregistered rubric ids as mechanical faults |
| task | task-13 | story-3 | covered | test-quality projection intersects changed tests with Covers:-bound tests |
| task | task-14 | story-3 | covered | Empty scope passes without dispatch or preflight |
| task | task-15 | story-4 | covered | Preflight is typed evidence, gated on enabled + non-empty scope |
| task | task-16 | story-3 | covered | build-review-test-quality skill replaces build-review-tautology |
| task | task-17 | story-8 | covered | Malformed grades and unbound FIXABLE findings are rejected |
| task | task-18 | story-6 | covered | Unreadable criteria fail the gate naming the stories file |
| task | task-19 | story-14 | covered | Growth record in the kickback ledger |
| task | task-20 | story-6 | covered | prd-audit skill re-keyed to stories with grades |
| task | task-21 | story-12 | covered | Per-check policy resolved from config and artifact presence |
| task | task-22 | story-10 | covered | Cap enforcement before appending prd_audit fix tasks |
| task | task-23 | story-10 | covered | Over-cap and second-lap FAILs halt with every finding listed |
| task | task-24 | story-11 | covered | PLAN_GAP routing by criterion section |
| task | task-25 | story-9 | covered | OVER_SCOPE routing and operator-accepted widenings |
| task | task-26 | story-13 | covered | As-built parser accepts PLAN_GAP; no as-built → build route |
| task | task-27 | story-13 | covered | architecture-review §12 updated for always-run, policy, PLAN_GAP |
| task | task-28 | story-11 | covered | Recorded findings copied into the shipped record |
| task | task-29 | story-16 | covered | Readers ignore retired-rubric dispositions and verdicts |
| task | task-30 | story-1 | covered | Delete retired rubric skills, engine branches, exemptions, fixtures, tests |
| task | task-31 | story-16 | covered | Acceptance: pre-change feature and plan-conformant feature reach SHIP |
| task | task-32 | story-2 | covered | This repository enables test-quality; scaffolder emits no retired keys; migration block |
| adr | adr-2026-06-29-explore-prd-split-track-in-explore | story-7 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-06-29-track-marker-location | story-7 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-05-engine-owned-task-status | story-5 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-10-validation-group-join | story-13 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-13-kickback-build-no-op-escalation | story-10 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-13-retry-classify-rerun-vs-route | story-8 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-17-verify-only-judged-closure | story-5 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-20-post-rebase-delta-aware-invalidation | story-7 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-21-completeness-as-build-review-rubric | story-1 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-21-demote-task-stamping-to-telemetry | story-5 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-21-no-diff-task-evidence-stamp | story-5 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-21-s-tier-pipeline-knobs | story-12 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-22-per-task-work-happened-floor | story-5 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-23-commit-movement-liveness-floor | story-6 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-23-trailer-union-build-step-routing | story-5 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-26-cross-dispatch-kickback-livelock-bound | story-10 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-07-27-protected-artifact-seal-self-amendment-visibility | story-9 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-03-uncommitted-work-floor-under-build-completion | story-6 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-09-non-blocking-plan-scope-containment | story-9 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-12-cumulative-build-review-convergence-bound | story-10 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-12-operator-reseal-as-second-scope-justification | story-9 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-12-removal-anchored-tautology-exemption | story-3 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-13-engine-managed-build-review-rubric-branches | story-1 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-13-markdown-default-inversion | story-7 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-13-stable-build-review-finding-dispositions | story-1 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-14-retire-build-review-wiring-rubric | story-1 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-15-verify-only-anchored-tautology-exemption | story-3 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-16-closed-build-review-finding-vocabularies | story-1 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-16-preservation-anchored-completeness-exemption | story-1 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-17-framework-agnostic-tautology-scoped-run | story-3 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-18-content-anchored-finding-reference-schema | story-1 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence | story-7 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-19-engine-stamped-rubric-judged-result-envelope | story-1 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-21-engine-identity-in-build-review-cache-key | story-16 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-21-review-bound-by-plan-done-when-criteria | story-5 | covered | Existing ADR amended/superseded by #1805 (additive note appended); story that now carries the changed decision. |
| adr | adr-2026-08-22-as-built-review-runs-always-with-plan-gap | story-12, story-13 | covered | New ADR; stories it governs. |
| adr | adr-2026-08-22-build-review-opt-in-rubric-container | story-2, story-3, story-4, story-15 | covered | New ADR; stories it governs. |
| adr | adr-2026-08-22-done-when-evidence-at-task-close | story-5, story-16 | covered | New ADR; stories it governs. |
| adr | adr-2026-08-22-one-owner-per-review-question | story-1, story-6, story-13 | covered | New ADR; stories it governs. |
| adr | adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback | story-6, story-7, story-8, story-9, story-10, story-11, story-14 | covered | New ADR; stories it governs. |
