# Implementation Plan: code-removal skill

**Date:** 2026-08-25
**Stories:** .docs/stories/code-removal-skill.md

## Summary
Adds the shipped `skills/code-removal` skill carrying the harness's removal doctrine, routes plan/stories/tdd to it, and registers it in the generated model table. 6 tasks, prose + metadata only.

## Technical Approach
This is a skill-text feature: no engine code changes except the model-table metadata entry that the generated HARNESS.md table is rendered from. The new SKILL.md is authored in three passes (prohibition core, survivor method, triage + sweep) so each section lands as a reviewable unit, then the three existing skills gain routing lines, then the catalog registration lands last. `test/test_harness_integrity.sh` is the mechanical verifier throughout (frontmatter check 2, cross-skill references check 4, model-table checks 5/5a/5b); there is no dedicated test suite for prose. Frontmatter follows the shape used by `skills/tdd/SKILL.md` (`name`, `description`, `enforcement`, `phase`); the skill is guidance loaded into DECIDE and BUILD sessions, not a dispatched step, so its model-table entry uses `inherits caller` like `intake` (no opus pin, so check 5b is unaffected).

## Prerequisites
- None (worktree on spec branch; all edits are repo files)

## Tasks

### Task 1: Author skills/code-removal/SKILL.md with frontmatter and the absence-test prohibition
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Create `skills/code-removal/SKILL.md` with YAML frontmatter: `name: code-removal`, a `description` that triggers on removal-shaped work (deleting a file, seam, flag, or code path), `enforcement: advisory`, `phase: all` (both DECIDE and BUILD read it — match the value style used by existing multi-phase skills; check what `verify-claims` uses and copy its convention).
2. Write the Purpose section: removal is a first-class change type; the deliverable of a removal is the deletion itself plus an intact surviving suite — never a test asserting absence.
3. Write the Absence-Test Prohibition section: at spec time, no plan task or story criterion may have as its subject that code/files/symbols no longer exist; at build time, no agent authors such a test; the removal-anchored tautology exemption ADR (adr-2026-08-12) governs review treatment. State the evidence rule: deletion diff + full suite green.

**Done when:**
- `skills/code-removal/SKILL.md` exists; frontmatter carries `name`, `description`, `enforcement`, `phase` (integrity check 2 passes for it)
- The file contains a section whose text forbids both speccing and authoring absence tests, covering plan tasks, story criteria, and build-time test authoring
- The file states suite-green-after-delete as the removal's evidence

**Files likely touched:**
- skills/code-removal/SKILL.md — new file

**Dependencies:** none

### Task 2: Write the survivor method section
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Add a Survivor Method section to `skills/code-removal/SKILL.md`: define the survivor inventory (enumerate what must keep working after the removal) and when it is required — only when survivors are non-obvious (shared seams, behavior partially carried by the removed code); obvious fully-covered survivors skip it.
2. Order the method: inventory → check each survivor for existing coverage → add characterization tests for uncovered survivors and commit them BEFORE any deletion → delete → suite green.
3. State the stop rule: if a survivor lacks coverage, deletion does not proceed until its characterization test exists.

**Done when:**
- The section defines the required-vs-skipped condition for the inventory in closed terms (non-obvious survivors: shared seams or partially-carried behavior)
- The section sequences characterization tests strictly before deletion and states the stop rule verbatim as a hard order

**Files likely touched:**
- skills/code-removal/SKILL.md — new section

**Dependencies:** 1

### Task 3: Write the test-triage and completeness-sweep sections
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Add a Test Triage section: classify every test touching the removed code as DIRECT (sole subject is the removed behavior) or INCIDENTAL (shared fixtures, integration flows, acceptance tests of surviving features). Rule: direct tests are deleted in the same change; incidental tests are mutated to exercise the surviving behavior and are never deleted. Acceptance tests are deleted only when direct.
2. Add a Completeness Sweep section: a required closing step that greps for the removed symbols, file paths, config keys, and doc mentions across source, tests, config, and docs. Every hit is removed or explicitly justified in the commit; an unresolved hit means the removal task may not close.
3. Add the sweep caveat: grep variants that skip binary/NUL-bearing files can return silently empty output — sweep by literal symbol and path names and review the hit list; empty output alone is not proof of absence.

**Done when:**
- The triage section defines DIRECT/INCIDENTAL with the delete/mutate rule and names acceptance tests as delete-only-when-direct
- The sweep section lists the four target categories (imports/references, file paths, config keys, doc mentions) and states the resolve-or-justify-before-close rule
- The sweep caveat about silently-skipped files is present

**Files likely touched:**
- skills/code-removal/SKILL.md — new sections

**Dependencies:** 1

### Task 4: Add removal-routing lines to the plan and stories skills
**Story:** 2
**Type:** infrastructure

**Steps:**
1. In `skills/plan/SKILL.md`, add a short removal-routing paragraph in the task-generation practice: a task whose subject is a removal follows `/code-removal` — spec it as a deletion naming what dies and what survives; never spec a task whose test subject is the removed code's absence, and never declare such a task verify-only to force a documenting absence test.
2. In `skills/stories/SKILL.md`, add a matching line in the story-generation practice: acceptance criteria describe surviving observable behavior; never write a criterion asserting code, files, or symbols no longer exist — route removal doctrine to `/code-removal`.

**Done when:**
- Both files contain a `/code-removal` reference (integrity check 4 passes — the referenced skill directory exists from Task 1)
- The plan skill's line covers both the absence-test spec bar and the verify-only misuse
- The stories skill's line bars absence criteria

**Files likely touched:**
- skills/plan/SKILL.md — routing paragraph
- skills/stories/SKILL.md — routing line

**Dependencies:** 1

### Task 5: Shrink tdd's Removal Boundary to a pointer
**Story:** 2
**Type:** infrastructure

**Steps:**
1. In `skills/tdd/SKILL.md`, rewrite the Removal Boundary section to keep its local build-time rule (deletion starts no RED cycle; maintenance edits keeping tests compiling are ordinary edits) and the removal-anchored tautology exemption ADR citation, while deferring doctrine — survivor method, test triage, sweep — to `/code-removal`.
2. Verify the section no longer duplicates doctrine now owned by the new skill.

**Done when:**
- The Removal Boundary section references `/code-removal` and retains the `adr-2026-08-12-removal-anchored-tautology-exemption.md` citation
- The no-RED-for-deletion rule remains stated locally in tdd
- No paragraph in tdd restates survivor/triage/sweep doctrine

**Files likely touched:**
- skills/tdd/SKILL.md — Removal Boundary rewrite

**Dependencies:** 1

### Task 6: Register the skill in the model table and pass the integrity suite
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Add a `code-removal` entry to the metadata array in `src/conductor/src/engine/model-table-metadata.ts` with `claudeModel: 'inherits caller'`, empty effort, and a one-line why (guidance loaded into the observing session; no dedicated dispatch) — mirror the existing `intake` entry's shape.
2. Run `bin/generate-model-table` and commit the regenerated HARNESS.md model-selection-table section.
3. Run `test/test_harness_integrity.sh`; fix any failures it reports in the files this plan touched.

**Done when:**
- `model-table-metadata.ts` contains a `code-removal` entry and the regenerated HARNESS.md table has its row (checks 5/5a pass)
- No opus pin is introduced, so check 5b is unaffected
- `test/test_harness_integrity.sh` exits 0

**Files likely touched:**
- src/conductor/src/engine/model-table-metadata.ts — new entry
- HARNESS.md — regenerated table section

**Dependencies:** 1

## Task Dependency Graph
```
Task 1 ─┬─ Task 2
        ├─ Task 3
        ├─ Task 4
        ├─ Task 5
        └─ Task 6
```

## Integration Points
- After Task 6: full integrity suite green over the complete skill + routing + registration set

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
