**Status:** Accepted

## Story 1: Shipped code-removal skill carries the removal doctrine

**Requirement:** Technical intent — single removal reference

As a build or DECIDE agent, I want one shipped skill that explains how to remove code so that removal-shaped work follows one doctrine instead of scattered fragments.

### Acceptance Criteria

#### Happy Path
- Given the harness catalog, when `skills/code-removal/SKILL.md` is read, then it states the absence-test prohibition (never spec or author a test whose subject is that removed code no longer exists), the survivor method, the test-triage rule, and the completeness sweep
- Given the skill file, when its frontmatter is parsed, then `name`, `description`, `enforcement`, and `phase` are present and `description` triggers on removal-shaped work (deleting a file, seam, flag, or code path)

#### Negative Paths
- Given `test/test_harness_integrity.sh`, when the new skill lacks a HARNESS.md model-table entry or valid frontmatter, then the validation suite fails and the change cannot land

### Done When
- [ ] `skills/code-removal/SKILL.md` exists with valid frontmatter and the four doctrine sections (prohibition, survivor method, test triage, completeness sweep)
- [ ] HARNESS.md model-selection table has a `code-removal` row generated via `bin/generate-model-table`
- [ ] `docs/reference/skills.md` lists the new skill
- [ ] `test/test_harness_integrity.sh` passes

## Story 2: Absence tests are barred at spec time, not just build time

**Requirement:** Technical intent — close the plan-declared loophole

As an operator, I want plans and stories to never spec absence tests so that tdd is never instructed to author one.

### Acceptance Criteria

#### Happy Path
- Given a removal-shaped feature, when `skills/plan/SKILL.md` guides task authoring, then a removal-routing line directs removal tasks to `/code-removal` and forbids specifying tasks whose test subject is the removed code's absence
- Given a removal-shaped feature, when `skills/stories/SKILL.md` guides criteria authoring, then a removal-routing line forbids acceptance criteria asserting that code, files, or symbols no longer exist
- Given `skills/tdd/SKILL.md`, when its Removal Boundary section is read, then it defers to `/code-removal` for doctrine while keeping its local no-RED-for-deletion rule intact

#### Negative Paths
- Given the three pointer edits, when `test/test_harness_integrity.sh` checks cross-skill references, then a `/code-removal` reference to a missing skill directory fails check 4

### Done When
- [ ] `skills/plan/SKILL.md` and `skills/stories/SKILL.md` each carry a removal-routing line referencing `/code-removal`
- [ ] `skills/tdd/SKILL.md` Removal Boundary references `/code-removal` and retains the ADR citation (`adr-2026-08-12-removal-anchored-tautology-exemption.md`)
- [ ] No skill text instructs writing a test that asserts code absence

## Story 3: Survivor behavior is protected before deletion

**Requirement:** Technical intent — survivor method

As a build agent, I want survivor coverage established before deleting so that removals cannot silently break behavior that must remain.

### Acceptance Criteria

#### Happy Path
- Given a removal where surviving behavior is non-obvious, when the skill's method is followed, then a survivor inventory (what must keep working) is written and uncovered survivors get characterization tests added and committed BEFORE any deletion
- Given a removal where survivors are obvious and already covered, when the skill's method is followed, then no new tests are added and the existing suite passing after deletion is the evidence

#### Negative Paths
- Given a survivor with no existing coverage, when deletion is attempted before its characterization test exists, then the skill directs the agent to stop and add the coverage first rather than proceeding

### Done When
- [ ] Skill defines when a survivor inventory is required (non-obvious survivors) vs skipped
- [ ] Skill orders characterization tests strictly before deletion in the task sequence
- [ ] Skill states suite-green-after-delete as the removal's evidence, replacing any RED cycle

## Story 4: Existing tests are triaged, and removal completeness is swept

**Requirement:** Technical intent — test triage + completeness sweep

As a build agent, I want a deterministic rule for the removed code's tests and a required sweep so that removals are complete and only the right tests die.

### Acceptance Criteria

#### Happy Path
- Given tests whose sole subject is the removed code, when the removal executes, then those tests are deleted in the same change
- Given tests that touch the removed code incidentally (shared fixtures, integration flows, acceptance tests of surviving features), when the removal executes, then they are mutated to exercise the surviving behavior — never deleted
- Given the deletion is complete, when the required sweep runs, then grep finds zero dangling references to the removed symbols/files across source, tests, config, and docs, and each hit found earlier was either removed or justified

#### Negative Paths
- Given the sweep finds a dangling reference, when the removal task is closed anyway, then the skill defines the removal as incomplete — the task may not close until the hit is resolved or explicitly justified in the commit
- Given this repo's grep shim (`ugrep -I`) silently skips NUL-bearing files, when the sweep is specified, then the skill directs sweeping by literal symbol/path names with results reviewed, not treating empty output alone as proof of absence

### Done When
- [ ] Skill defines the direct-vs-incidental test classification with the delete/mutate rule
- [ ] Skill specifies the sweep targets (imports, references, config keys, doc mentions) as a required closing step
- [ ] Skill defines incomplete-sweep handling (resolve or justify before task close)
