# Coherence: Scoped invocation cannot expand to the aggregate suite

**Plan stem:** build-review-repeats-aggregate-verification-despit
**Tier:** M — **Track:** technical — **Source-Ref:** jstoup111/ai-conductor#1173
**Date:** 2026-08-01

Row classes present: outcome, story, task. The `fr` class is omitted because this is a
technical-track spec with no PRD and therefore no enumerated FR ids; the stories file's TR-1..TR-8
table is a local traceability aid, not a PRD requirement set.

Four outcome rows are recorded as gaps. They are real, deliberate descopes rather than oversights:
the operator narrowed this feature to command-expansion prevention, and those outcomes are owned by
issue #1176 (critical, size L, milestone v1.0, assigned) and issue #1205. A coherence waiver naming
exactly those four gap ids is committed alongside this artifact at
`.docs/coherence-waivers/build-review-repeats-aggregate-verification-despit.md`. Every verdict below
was confirmed by reading the counterpart artifact file, not inferred from a plausible id.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-3, story-4, story-5, story-7, story-8 | covered | A scoped command cannot silently expand. Two independent guards plus surface repair and call-site alignment. |
| outcome | outcome-2 |  | gap | gap id outcome-2. Descoped to #1176; the reuse path already exists in FullSuiteVerifier's REUSED branch. Waived. |
| outcome | outcome-3 | story-6 | covered | Missing, stale, or failed aggregate evidence still runs the suite and blocks. Preserved as a regression invariant, not extended. |
| outcome | outcome-4 |  | gap | gap id outcome-4. Descoped to #1176. Premise also corrected during review: build_review is already input-isolated to diff plus plan body. Waived. |
| outcome | outcome-5 |  | gap | gap id outcome-5. Review size and duration targets descoped to #1176. Waived. |
| outcome | outcome-6 |  | gap | gap id outcome-6. Model-tier and effort shadow calibration descoped to #1176. Waived. |
| story | story-1 | task-4, task-5, task-6, task-13 | covered | Scoped run executes only the selection. Happy in tasks 4, 5, 13; negative in task 6. |
| story | story-2 | task-1, task-2, task-3 | covered | Template ignoring the selection is rejected. Happy in task 1; negative in tasks 2 and 3. |
| story | story-3 | task-4, task-7, task-8 | covered | Empty selection refused. Happy in task 4; negative in tasks 7 and 8. |
| story | story-4 | task-9, task-10 | covered | Selectors reach the runner intact. Happy in task 9; negative in task 10. |
| story | story-5 | task-11, task-12 | covered | Unconfigured key is explicit. Happy in task 12; negative in task 11. |
| story | story-6 | task-14, task-15 | covered | Aggregate semantics unchanged. Happy in task 15; negative in task 14. |
| story | story-7 | task-16, task-17 | covered | No invocation form expands a scoped request. Happy in task 16; negative in task 17. |
| story | story-8 | task-18, task-19 | covered | Call sites use the interface. Happy in task 18; negative in task 19. |
| task | task-1 | story-2 | covered | Accept the scoped-run template key in test_suite config. |
| task | task-2 | story-2 | covered | Reject a template with no selector placeholder. |
| task | task-3 | story-2 | covered | Reject empty, whitespace-only, and non-string templates. |
| task | task-4 | story-1, story-3 | covered | Substitute selectors and execute via an injected runner. |
| task | task-5 | story-1 | covered | Multiple selectors and mid-template placeholder. |
| task | task-6 | story-1 | covered | Runner, launch, and timeout failures never escalate. |
| task | task-7 | story-3 | covered | Refuse an empty selector list without spawning a process. |
| task | task-8 | story-3 | covered | Blank selectors treated as empty; refusal names the verifier route. |
| task | task-9 | story-4 | covered | A selector containing a space arrives as one argument. |
| task | task-10 | story-4 | covered | Shell metacharacters passed literally. |
| task | task-11 | story-5 | covered | Report scoped running unavailable when the key is unconfigured. |
| task | task-12 | story-5 | covered | Missing config file and scoped-only config handled. |
| task | task-13 | story-1 | covered | Register the scoped-run verb in the conduct-ts dispatch. |
| task | task-14 | story-6 | covered | Scoped run writes no aggregate evidence and cannot satisfy the gate. |
| task | task-15 | story-6 | covered | Regression-prove aggregate semantics unchanged. Verify-only. |
| task | task-16 | story-7 | covered | Repair the argument-swallowing package scripts. |
| task | task-17 | story-7 | covered | Prove forwarded arguments reach the runner and failures propagate. |
| task | task-18 | story-8 | covered | Grader instruction names the interface; stale ownership clause corrected. |
| task | task-19 | story-8 | covered | Grader isolation preserved and the four fallback triggers intact. |
| task | task-20 |  | covered | Infrastructure task: the release-gate Unreleased changelog entry required by condition C6. Supporting-purpose exemption, so it carries no story citation by design. |

## Confirmation notes

Every `covered` verdict above was checked against the artifact that owns the counterpart id:

- Story ids 1 through 8 were read from the `## Story <id>:` headings in
  `.docs/stories/build-review-repeats-aggregate-verification-despit.md`. All eight parse under the
  engine's heading grammar.
- Task ids 1 through 20 were read from the `### Task <id>:` headings in
  `.docs/plans/build-review-repeats-aggregate-verification-despit.md`, and each task's story
  citations were read from its own `**Story:**` lines. Each such line carries exactly one id, so no
  citation is silently dropped by the single-id-per-line parse.
- Both happy and negative path types are registered for all eight stories, verified by extracting
  each task's `**Type:**` line and grouping by cited story.
- Outcome bullets were read verbatim from the staged intake outcomes for
  jstoup111/ai-conductor#1173, in bullet order, giving outcome-1 through outcome-6.

## Assumptions

- **A1 (confirmed, 95%).** outcome-3 is satisfied by preservation rather than new behavior. Story 6
  asserts the aggregate gate still blocks on missing, stale, or failed evidence, and that a scoped
  pass cannot satisfy it. Impact if wrong: outcome-3 would be an unwaived gap. Confirmed by reading
  Story 6's negative-path criteria.
- **A2 (confirmed, 90%).** outcome-1 is genuinely delivered rather than partially delivered. The
  guarantee rests on two independent guards, engine-owned argv assembly and empty-selection refusal,
  plus repair of the one invocation form known to expand in this repository. Residual, recorded in
  the ADR as A2 and A3: an agent that deliberately types the bare aggregate command is still not
  prevented, and a runner whose selection cannot be expressed in one templated invocation has no
  scoped path. Neither residual is claimed as covered here.
