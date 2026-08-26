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
3. Write the Absence-Test Prohibition section: at spec time, no plan task or story criterion may have as its subject that code/files/symbols no longer exist; at build time, no agent authors such a test; review ownership is APPROVED `adr-2026-08-22-one-owner-per-review-question.md`, which retires the rubric exemptions the superseded `adr-2026-08-12-removal-anchored-tautology-exemption.md` carried — cite the APPROVED ADR, never the superseded one. State the evidence rule: deletion diff + full suite green.

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
- The negative direction is Task 7's: check 4 must FAIL when the referenced directory is absent

**Files likely touched:**
- skills/plan/SKILL.md — routing paragraph
- skills/stories/SKILL.md — routing line

**Dependencies:** 1

### Task 5: Shrink tdd's Removal Boundary to a pointer
**Story:** 2
**Type:** infrastructure

**Steps:**
1. In `skills/tdd/SKILL.md`, rewrite the Removal Boundary section to keep its local build-time rule (deletion starts no RED cycle; maintenance edits keeping tests compiling are ordinary edits) and cite review ownership from APPROVED `adr-2026-08-22-one-owner-per-review-question.md`, while deferring doctrine — survivor method, test triage, sweep — to `/code-removal`.
2. Verify the section no longer duplicates doctrine now owned by the new skill.

**Done when:**
- The Removal Boundary section references `/code-removal` and cites review ownership from APPROVED `adr-2026-08-22-one-owner-per-review-question.md` (the superseded `adr-2026-08-12` citation is removed)
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

### Task 7: Make integrity check 4 fail-closed on a dangling skill reference

**Story:** 1
**Type:** negative-path

**Steps:**
1. Verify the gap: check 4 (`test/test_harness_integrity.sh`) calls `warn_check` when a backticked `/name` reference resolves to no `skills/<name>/` directory, so the suite still exits 0. The three pointer edits from Tasks 4-5 would dangle silently if `skills/code-removal/` were renamed or deleted.
2. Add a `KNOWN_NON_SKILL_REFS` allowlist naming the two references that deliberately are not skills — `quit` (a Claude Code CLI command, `skills/engineer/SKILL.md`) and `skill-name` (an invocation-syntax placeholder, `skills/bootstrap/SKILL.md`) — each with an inline comment naming where it is used.
3. Replace the `warn_check` fallback with `assert`: an allowlisted reference passes, any other unresolved reference fails as a dangling pointer naming the missing directory.
4. Verify both directions from this worktree: the suite exits 0 with `skills/code-removal/` present, and exits 1 with `FAIL /code-removal — dangling reference: no skills/code-removal/ directory` when the directory is temporarily moved away.
5. Update `docs/contributing/validation.md` — check 4's row (it is no longer "Never — this is a `warn_check`") and the "Checks that cannot fail" limitation note, which must now name check 5 only.

**Done when:**
- Check 4 uses `assert`, not `warn_check`, for an unresolved reference.
- The full suite exits 0 at HEAD with the two allowlisted references passing.
- Moving `skills/code-removal/` aside makes the suite exit 1 with the dangling-reference diagnostic.
- `docs/contributing/validation.md` no longer describes check 4 as advisory.

**Files likely touched:**
- test/test_harness_integrity.sh — allowlist + fail-closed branch
- docs/contributing/validation.md — check 4 row and known-limitation note

**Dependencies:** 4

### Task 8: Route removal-shaped tasks to `/code-removal` from pipeline

**Story:** 2
**Type:** infrastructure

**Steps:**
1. Establish the gap: the `plan`, `stories`, and `tdd` pointers are authoring guidance; the session that actually executes a task is the `/pipeline` build session, which dispatches a TDD implementer and restates the RED cycle inline (`skills/pipeline/SKILL.md:89-95`). Nothing routed a removal-shaped task anywhere, so the doctrine never reached the implementer.
2. In `skills/pipeline/SKILL.md`, extend the DISPATCH step: a removal-shaped task (deletes a file, seam, flag, symbol, or code path) dispatches the implementer to `/code-removal` in place of opening a RED cycle, naming the evidence rule.
3. Make `/code-removal` activatable from that dispatch: replace `disable-model-invocation: true` with `implicit_invocation: required` in its frontmatter, delete `skills/code-removal/agents/openai.yaml`, and add `code-removal` to `EXPECTED_IMPLICIT_REQUIRED` in `test/check_skill_invocation_policy.sh`. Check 2a's own rule reserves implicit invocation for exactly this case — a verified model-initiated caller inside an already-active skill.
4. Update `docs/reference/skills.md`'s invocation-policy section: the implicit-required table gains `code-removal` with `/pipeline` named as its caller, and the explicit-only list drops it.
5. Verify `test/check_skill_invocation_policy.sh`, `test/test_skill_invocation_policy.sh`, and the full `test/test_harness_integrity.sh` all exit 0.

**Done when:**
- `skills/pipeline/SKILL.md` DISPATCH names `/code-removal` for removal-shaped tasks.
- `code-removal` declares `implicit_invocation: required`, carries no host disable, and appears in `EXPECTED_IMPLICIT_REQUIRED`; check 2a's implicit-required set does not drift.
- `docs/reference/skills.md` lists `code-removal` as implicit-required and no longer as explicit-only.
- The invocation-policy checker, its mutation test, and the integrity suite all exit 0.

**Files likely touched:**
- skills/pipeline/SKILL.md — DISPATCH routing line
- skills/code-removal/SKILL.md — frontmatter invocation classification
- skills/code-removal/agents/openai.yaml — deleted
- test/check_skill_invocation_policy.sh — allowlist entry
- docs/reference/skills.md — invocation-policy section

**Dependencies:** 4

## Task Dependency Graph
```
Task 1 ─┬─ Task 2
        ├─ Task 3
        ├─ Task 4 ─┬─ Task 7
        │           └─ Task 8
        ├─ Task 5
        └─ Task 6
```

## Integration Points
- After Task 6: full integrity suite green over the complete skill + routing + registration set
- After Task 7: the same suite goes red when the referenced skill directory is removed — the pointers are guarded, not merely present
- After Task 8: a removal-shaped task in a real build reaches `/code-removal` through `/pipeline`'s dispatch — the doctrine is reachable, not merely documented

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
