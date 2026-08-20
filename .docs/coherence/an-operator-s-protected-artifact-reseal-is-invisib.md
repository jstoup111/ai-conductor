# Coherence Mapping: an-operator-s-protected-artifact-reseal-is-invisib

**Date:** 2026-08-12
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD, therefore no `FR-N` ids). Stories
carry intake outcome references directly on their `**Requirement:**` lines.
**Source-Ref:** jstoup111/ai-conductor#1502
**Outcomes source:** the `## Desired outcomes` section of the claimed intake issue, bullets
numbered 1-6 in file order.
**Plan stem:** `an-operator-s-protected-artifact-reseal-is-invisib`
**Result:** COVERED — zero gaps

Every `covered` verdict below was confirmed by reading the counterpart artifact and checking the
cited id exists there, not inferred from a phrase match. Story ids were read from the five
`## Story <id>:` headings; task ids from the eleven `### Task <id>:` headings and their eleven
single-id `**Story:**` lines.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-3 | covered | "After an operator reseals a protected artifact, a subsequent `build_review` on an unchanged diff does not fail Scope on the resealed paths' hunks." Story 1 makes the reseal readable; Story 3 puts it in the grader's prompt with its path and rationale, which is the whole basis on which the hunk can pass. |
| outcome | outcome-2 | story-4 | covered | "The grader treats a reseal as evidence, not a blanket exemption... unmatched work outside the resealed paths still fails Scope." Story 4 asserts the Scope rubric sentence stays unmodified, the other four rubric items are unchanged, and a path outside the resealed set receives no evidence entry. |
| outcome | outcome-3 | story-3, story-4 | covered | "The reseal's operator rationale is visible to the grader, so a reseal whose stated reason does not justify the amendment can still be failed." Story 3 asserts the rationale renders byte-identical to the input `reason` and that an empty reason still renders visibly; Story 4 asserts the framing directs the grader to judge it. |
| outcome | outcome-4 | story-4 | covered | "A reseal of paths A and B does not license an unrelated post-BUILD edit to path C." Story 4's happy path asserts only A and B appear and C is not labeled anywhere; its negative path carries the smoke-tagged grader-verdict half. |
| outcome | outcome-5 | story-1, story-3, story-5 | covered | "Re-running the affected feature reaches BUILD and attempts its remediation tasks, rather than halting a fourth time on the same finding." Stories 1 and 3 deliver the mechanism that removes the halt; Story 5 pins it with a fixture reproducing #1502's exact shape. The operational step of unparking and re-dispatching `interrupted-self-host-runs-leak-provider-homes-unt` is recorded as a follow-up action in `adr-2026-08-12-operator-reseal-as-second-scope-justification`, since it is an operator action on another feature rather than code this plan ships. |
| outcome | outcome-6 | story-5 | covered | "Regression coverage: a feature whose diff amends a resealed DECIDE artifact passes Scope, and the same diff without the reseal still fails it." Story 5 is exactly this paired assertion, plus the prompts-differ-only-in-the-evidence-section check and rotation survival. |
| story | story-1 | task-1, task-2, task-3, task-4 | covered | Reader over the seal's `rebaselines[]`. Task 1 the happy path, Task 2 order and multi-path entries, Task 3 the machinery-trigger exclusion negative path, Task 4 the absent-rationale negative path. |
| story | story-2 | task-4, task-5 | covered | Degradation. Task 4 covers absent file, malformed JSON, version-1 seal, non-array `rebaselines`, and unreadable file at the reader; Task 5 covers the non-feature-root assembly branch where `repairContext` already resolves to `[]`. |
| story | story-3 | task-6, task-7, task-8 | covered | Prompt section. Task 6 the happy path including verbatim rationale and commit range, Task 7 the `(none)` and omitted-field negative paths, Task 8 the empty-reason and instruction-shaped-reason negative paths. |
| story | story-4 | task-8, task-9 | covered | Evidence-not-exemption. Task 8 lands the judged framing; Task 9 pins the Scope rubric sentence unmodified, the other four rubric items identical with and without reseals, and no entry for an unresealed path. |
| story | story-5 | task-10, task-11 | covered | Both-directions regression. Task 10 the paired with-reseal / without-reseal fixtures and the prompts-differ-only assertion, Task 11 rotation survival and the unused-reseal rendering case. |
| adr | adr-2026-07-27-protected-artifact-seal-self-amendment-visibility | story-3, story-4 | covered | Amended, not superseded, and the amendment was executed during DECIDE rather than as a BUILD task. Its decision 3 named the approved plan as the only admissible Scope justification for a protected-artifact edit; an additive note beside that decision now admits an operator reseal as a second source, with the original text preserved verbatim and `Status: APPROVED` retained. Decisions 1 and 2 are untouched and carry no obligation here. The amended rule is what Stories 3 and 4 assert: a resealed path is judged on its recorded rationale, and an edit justified by neither plan nor reseal is still a Scope failure. Full adjudication in C1 of `.docs/conflicts/an-operator-s-protected-artifact-reseal-is-invisib.md`. |
| adr | adr-2026-08-12-operator-reseal-as-second-scope-justification | story-3, story-4, task-6, task-8, task-9 | covered | D2 (filter to the `operator-reseal` trigger) lands in Tasks 1 and 3; D3 (isolation, maker cannot forge) is a design property with no code obligation; D4 (evidence never exemption) lands in Tasks 8 and 9 and is asserted by Story 4; D5 (degrade quietly) lands in Tasks 4 and 5. D1 (extend decision 3 of `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`) was executed during DECIDE as an additive amendment and carries no BUILD task by design. |
