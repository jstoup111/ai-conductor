# Implementation Plan: Stories represent current behavior without amendment records

**Date:** 2026-08-11
**Stories:** .docs/stories/stories-represent-current-behavior-without-amendme.md
**Complexity:** .docs/complexity/stories-represent-current-behavior-without-amendme.md
**Conflict check:** Not run — Small tier skips conflict-check by contract.

## Summary

Invert the accepted-artifact amendment convention for story artifacts only: a DECIDE correction
replaces superseded story content in place and the story carries no amendment record. Seven tasks
across four agent-executed contract files and one acceptance suite.

## Technical Approach

The entire surface of this change is agent-executed contract prose plus the one acceptance suite
that asserts it. Verified by `grep` over `src/`, `bin/`, and `hooks/`: no runtime engine code path
reads or parses the `Amended` marker, so there is no production module to change, no schema, no CLI
flag, and no hook. The four contract files (`HARNESS.md`, `skills/stories/SKILL.md`,
`skills/conflict-check/SKILL.md`, `skills/architecture-review/SKILL.md`) are the behavioral contract
this change edits; `src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts`
is the machine check over them.

**No production code surface (load-bearing for the Wiring rubric).** Every task below edits Markdown
contract prose or the acceptance suite that reads it. The diff adds no module, export, symbol, CLI
flag, hook, or schema, so it creates no callable production surface and therefore no static path to
any configured entry point in `.ai-conductor/config.yml:49-54` exists or is expected. Wiring is not
applicable to this diff — not deferred, not scaffolded for a later feature. The acceptance suite is
the reachability check that a code surface would otherwise get.

**Sequencing.** The acceptance suite's `TS-1` block is currently an `it.each` parameterized over
`['conflict-check', 'architecture-review', 'stories']` (line ~175-188), all three rows asserting the
same additive contract. Task 1 splits `stories` out of that table into its own `it` with inverted
assertions — this is the RED that the contract rewrite in Task 2 turns GREEN. Tasks 3-5 then extend
the carve-out to the remaining contract files, and Task 6 pins the carve-out's scope so it cannot
silently generalize to non-story artifacts.

**Assertion-design constraint (load-bearing — do not skip).** The existing row asserts
`/original[\s\S]{0,160}(?:remain|preserv|never (?:rewrite|delete))/i`. A naive inverted contract that
says "do not preserve the original assertion" *still matches that regex*, so an inverted row written
as a bare negation of it would fail against correct prose. Task 1 therefore asserts:

- **positively** that the story instruction requires replacement in place, and
- **negatively** only on the specific additive template literal
  (`/Amended\s+YYYY-MM-DD\s+by\s+#NNN/`), which is unambiguous.

`skills/stories/SKILL.md` must not contain that literal anywhere after Task 2 — including in the
converge-on-touch prose of Task 3, which must describe legacy blocks without reproducing the
template.

**Documentation.** `docs/reference/artifacts.md` also documents this convention, but this repository
routes reader-facing documentation through its configured `maintain-documentation` SHIP step
(`.ai-conductor/config.yml:126`), so no plan task owns it and no acceptance criterion asserts it.
That step updates it in the same PR.

**Release metadata.** No `bin/conduct` CLI, hook wiring, skill symlink target, or `settings.json`
schema changes, so no migration block is owed. Task 7 verifies the release gate agrees rather than
assuming it; if the path-based classifier flags a surface anyway, the correct response is a waiver
under `.docs/release-waivers/`, never an invented migration block.

**Deliberately not built:** no codemod, script, or migration rewriting existing story files. The
amendment block's narrative prose does not identify which superseded sentence it replaced, so no
mechanical rule can perform the replacement correctly. Convergence is on touch (Task 3).

## Prerequisites

- None. No migration, dependency, or setup precedes Task 1.

## Tasks

### Task 1: Invert the acceptance suite's stories contract row

**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: in `build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts`,
   remove `'stories'` from the `TS-1` `it.each` table (leaving `conflict-check` and
   `architecture-review` rows unchanged) and add a sibling `it` for
   `skills/stories/SKILL.md` asserting: the text matches a replacement instruction
   (`/replace[\s\S]{0,200}(?:in place|superseded)/i`), matches a no-amendment-record assertion
   (`/no[\s\S]{0,80}amendment record/i`), and does **not** match
   `/Amended\s+YYYY-MM-DD\s+by\s+#NNN/i`.
2. Verify test fails (RED) — the current `skills/stories/SKILL.md` still carries the additive
   template.
3. Implement: no production change in this task; the new `it` is the specification.
4. Verify the two retained `it.each` rows still pass unchanged.
5. Commit with message: "test(stories): invert TS-1 contract row for story artifacts"

**Files likely touched:**
- `src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts` — split the stories row out of TS-1 and invert it

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 2: Rewrite the story correction contract in `skills/stories/SKILL.md`

**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: already RED from Task 1.
2. Verify test fails (RED).
3. Implement: in section `### 5. Save Stories` (~lines 160-170), replace the additive amendment
   paragraph and its fenced `> **Amended YYYY-MM-DD by #NNN:**` template with an instruction that a
   DECIDE correction **replaces** the superseded story content in place, that the story carries no
   amendment record of any kind, and that provenance lives in git history and the spec PR. Keep the
   existing assertions that the correction happens during the DECIDE pass and is never deferred to
   BUILD. Ensure the word `original` does not appear within 160 characters of `remain`/`preserv` in
   the rewritten passage.
4. Verify test passes (GREEN) — the new stories `it` from Task 1 goes green.
5. Commit with message: "feat(stories): story corrections replace superseded content in place"

**Files likely touched:**
- `skills/stories/SKILL.md` — section 5 amendment paragraph rewritten to the replacement contract

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 3: Add the converge-on-touch rule for legacy amendment blocks

**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: extend the stories `it` from Task 1 with an assertion that the contract
   directs resolving pre-existing amendment blocks during the same DECIDE pass
   (`/(?:pre-existing|legacy|existing)[\s\S]{0,200}(?:resolve|fold)[\s\S]{0,120}same[\s\S]{0,40}pass/i`
   or equivalent grounded in the authored text).
2. Verify test fails (RED).
3. Implement: append the converge-on-touch rule to the rewritten section 5 — when amending a story
   that still carries amendment blocks from before this convention, resolve **every** such block in
   that file into its current behavioral text during the same pass; when a block's narrative does
   not make the current behavior determinable, raise it under the correctness-and-assumption gate
   rather than deleting it. Describe the legacy shape without reproducing the template literal.
4. Verify test passes (GREEN).
5. Commit with message: "feat(stories): converge legacy amendment blocks on touch"

**Files likely touched:**
- `skills/stories/SKILL.md` — converge-on-touch rule appended to section 5

**Wired-into:** same as Task 2

**Dependencies:** Task 2

### Task 4: Carve stories out of the `HARNESS.md` amendment rule

**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: add an assertion in the same acceptance file that `HARNESS.md` matches both
   the retained additive template (`/Amended\s+YYYY-MM-DD\s+by\s+#NNN/i`) and an explicit
   story-artifact exception naming replacement in place.
2. Verify test fails (RED).
3. Implement: in `### DECIDE Artifact Amendment Ownership` (~lines 82-98), keep the additive dated
   form as the rule for accepted DECIDE artifacts and add an explicit exception stating that story
   artifacts under `.docs/stories/` are replaced in place and carry no amendment record.
4. Verify test passes (GREEN).
5. Commit with message: "feat(harness): carve story artifacts out of the additive amendment rule"

**Files likely touched:**
- `HARNESS.md` — story exception added to the DECIDE artifact amendment section
- `src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts` — HARNESS.md carve-out assertion

**Wired-into:** none — `HARNESS.md` is agent-executed contract prose, not a callable production
surface, so this task adds no symbol that could reach a configured entry point. Its verification is
the acceptance assertion in step 1, not a wiring path. See the Technical Approach's "No production
code surface" paragraph.

**Dependencies:** Task 2

### Task 5: Scope the `skills/conflict-check/SKILL.md` amendment instruction to non-story artifacts

**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: add an assertion that `skills/conflict-check/SKILL.md` retains the additive
   template **and** names a story-artifact exception directing in-place replacement.
2. Verify test fails (RED).
3. Implement: in the post-resolution steps and `**Accepted-artifact amendment:**` paragraph
   (~lines 204-218), remove the direction to "note what changed and why in the story file", and
   scope the additive instruction so it applies to accepted DECIDE artifacts other than stories,
   with stories replaced in place. Leave the additive template and its original-preserved language
   intact for every other artifact type.
4. Verify test passes (GREEN), and confirm the retained `conflict-check` row of the TS-1 `it.each`
   still passes.
5. Commit with message: "feat(conflict-check): scope additive amendment to non-story artifacts"

**Files likely touched:**
- `skills/conflict-check/SKILL.md` — story exception; story-file note instruction removed
- `src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts` — conflict-check carve-out assertion

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

### Task 6: Scope the `skills/architecture-review/SKILL.md` amendment instruction to non-story artifacts

**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: add an assertion that `skills/architecture-review/SKILL.md` retains the
   additive template and original-preserved language **and** names a story-artifact exception.
2. Verify test fails (RED).
3. Implement: in the `**Accepted-artifact amendment:**` paragraph (~lines 48-58), add the
   story-artifact exception directing in-place replacement, leaving the additive form authoritative
   for every other artifact type.
4. Verify test passes (GREEN), and confirm the retained `architecture-review` row of the TS-1
   `it.each` still passes.
5. Commit with message: "feat(architecture-review): scope additive amendment to non-story artifacts"

**Files likely touched:**
- `skills/architecture-review/SKILL.md` — story exception added
- `src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts` — architecture-review carve-out assertion

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

### Task 7: Confirm the release gate owes no migration block for this change set

**Story:** 3
**Type:** infrastructure

**Steps:**
1. Determine the release gate's classification of the touched paths by reading
   `CANONICAL_BREAKING_SURFACES` and the path classifier in
   `src/conductor/src/engine/release-gate.ts`.
2. Confirm none of `HARNESS.md`, `skills/*/SKILL.md`, or the acceptance test maps to a canonical
   breaking surface — no `bin/conduct` CLI, hook wiring, skill symlink target, or `settings.json`
   schema change is present in this diff.
3. If and only if the classifier does flag a surface, add
   `.docs/release-waivers/stories-represent-current-behavior-without-amendme.md` with a `Waives:`
   line listing every flagged canonical surface verbatim and a non-empty `Rationale:` explaining
   that the change is contract prose with no consumer-visible CLI, hook, or schema behavior. Do not
   author an empty migration block.
4. Confirm no codemod, script, or migration touching `.docs/stories/` exists anywhere in the diff,
   and that no story file outside this feature's own artifacts appears in `git diff --name-only`.
5. Commit with message: "chore(release): confirm no migration block owed for the amendment carve-out"

**Files likely touched:**
- none

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** Task 6

## Task Dependency Graph

```
Task 1 (invert TS-1 stories row)
  └─▶ Task 2 (stories SKILL.md replacement contract)
        ├─▶ Task 3 (converge-on-touch rule)
        ├─▶ Task 4 (HARNESS.md carve-out)
        ├─▶ Task 5 (conflict-check carve-out)
        └─▶ Task 6 (architecture-review carve-out)
              └─▶ Task 7 (release-gate confirmation, verify-only)
```

Tasks 3, 4, 5, and 6 are independent of one another and may run in any order once Task 2 lands.

## Integration Points

- **After Task 2:** the inverted stories contract row is green — the story-artifact convention is
  authoritative end to end for anyone reading `skills/stories/SKILL.md`.
- **After Task 6:** all four contract files agree; the additive form is proven still in force for
  non-story artifacts by the two retained TS-1 rows.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No plan task targets another feature's sealed artifact
- [ ] No plan task writes reader-facing documentation under `docs/`
- [ ] No terminal catch-all validation task
