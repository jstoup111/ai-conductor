# Stories: build_review severity definitions have one engine-owned source

**Status:** Accepted

Source: jstoup111/ai-conductor#3381. Track: technical (`.docs/track/build-review-severity-definitions-are-duplicated-p.md`).
Governing decision: `adr-2026-10-19-build-review-finding-severity-advisory-threshold` D1, as amended 2026-10-28.

"The shared severity definitions" below means the one engine-owned text that defines `critical`, `major`, `minor`, and `nit`, in that order, with the meanings in that ADR's D1.

## Story 1: Every built-in rubric dispatch prompt carries the shared severity definitions

As the build_review engine, I want every built-in rubric reviewer to receive the same severity definitions from one engine-owned source, so that the same defect is graded on the same scale whichever rubric reports it.

### Acceptance Criteria

#### Happy Path
- Given each rubric id in the built-in rubric registry (testQuality, security, implementationQuality), when build_review dispatches that rubric, then the dispatched prompt contains the shared severity definitions exactly once, byte-identical to the engine-owned text, in the paragraph after the result schema.
- Given the engine-owned severity definition text is changed in its one source, when each registered built-in rubric is dispatched, then every dispatched prompt carries the changed text and no rubric SKILL.md is edited.

#### Negative Paths
- Given a registered built-in rubric whose dispatch prompt omits the shared severity definitions or carries a different wording of them, when the dispatch-prompt test runs, then the test fails and names that rubric id.

### Done When
- [ ] A test iterates every id in the built-in rubric registry, dispatches each through the engine's rubric dispatch, and asserts the prompt contains the engine-owned severity text exactly once.
- [ ] The severity text in the built-in prompt comes from the engine-owned constant, not from any SKILL.md.

## Story 2: The custom rubric dispatch prompt carries the same definitions word for word

As the build_review engine, I want custom rubric reviewers to receive the identical severity definitions that built-in reviewers receive, so that `min_severity` thresholds mean the same thing for custom and built-in rubrics.

### Acceptance Criteria

#### Happy Path
- Given a custom review policy, when the engine renders its build-review policy contract prompt, then the prompt contains the shared severity definitions exactly once, byte-identical to the text in every built-in rubric dispatch prompt, after the shared findings payload schema line.

#### Negative Paths
- Given the rendered custom policy contract prompt, when it is inspected for severity guidance, then it contains no second severity definition: the inline parenthetical sentence that begins "Every finding requires severity: critical (" is absent, and the payload-variants line still names the custom-findings and unsupported-policy variants.

### Done When
- [ ] A test renders the custom policy contract prompt and asserts the engine-owned severity text appears exactly once and the old inline sentence is absent.

## Story 3: No rubric skill defines the severity scale

As a rubric skill author, I want the severity scale to live only in the engine, so that a new or edited rubric skill cannot drift from it and needs no severity paragraph.

### Acceptance Criteria

#### Happy Path
- Given the installed SKILL.md of every rubric in the built-in rubric registry, when its text is read, then it contains none of the four severity meanings and no backticked severity level name (`critical`, `major`, `minor`, `nit`), and its judgement vocabulary and non-finding guidance are unchanged.

#### Negative Paths
- Given a registered rubric's SKILL.md that contains a severity meaning or a backticked severity level name, when the rubric-skill test runs, then the test fails and names that skill's directory.

### Done When
- [ ] `skills/build-review-implementation-quality/SKILL.md`, `skills/build-review-security/SKILL.md`, and `skills/build-review-test-quality/SKILL.md` carry no severity definition.
- [ ] A test reads each registered rubric's SKILL.md through the registry's skill name and asserts it is free of the severity scale.
