# Implementation Plan: Abandoned specs move to the issue tracker

**Date:** 2026-08-26
**Stories:** .docs/stories/abandoned-specs-are-kept-in-git-instead-of-the-iss.md
**Conflict check:** skipped (Tier S)

## Summary
Consolidate spec abandonment onto one documented path (delete DECIDE artifacts; the record is a
closed GitHub issue), migrate the nine registered retired plans to closed issues, and delete the
`.docs/retired/` register. Six tasks, no engine changes.

## Technical Approach
Pure docs + repository-state work. A new runbook `docs/runbooks/abandoning-a-spec.md` is the
canonical procedure; `skills/daemon-triage/SKILL.md` gains a pointer at its recommended-actions
decision point and `docs/reference/artifacts.md` drops its retired-directory row in favor of a
runbook link. Migration is issue-before-delete: for each of the nine register rows, a GitHub issue
is filed (or an existing dedicated one located) carrying the row's content, closed, and only then
is the file deleted. The deletion commit message carries the stem → issue mapping. Backlog
discovery and the shipment audit need no change — they enumerate the plans directory, which this
diff does not touch. Follow the existing runbook style (see `docs/runbooks/stalled-or-stuck-feature.md`
for tone and structure; `docs/runbooks/index.md` lists every runbook and must gain a row).
`test/test_harness_integrity.sh` must pass after every doc/skill edit.

## Prerequisites
- `gh` authenticated against jstoup111/ai-conductor with issue write access.

## Tasks

### Task 1: Author the abandonment runbook
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write `docs/runbooks/abandoning-a-spec.md` following the existing runbook voice. It must state: (a) when to abandon (operator decides the work will not be done); (b) the procedure — record the decision, rationale, and any delivery/abandonment evidence on a GitHub issue (file one if none exists), close the issue, then delete the spec's DECIDE artifacts from the repository in one commit whose message references the issue; (c) why this works — backlog discovery lists the plans directory non-recursively, so a deleted plan stops surfacing on the next scan, and a plan still present is by definition still wanted; (d) the counter-case — a blocked-but-wanted spec is NOT abandoned: fix its DECIDE artifact instead, and the runbook must say so explicitly; (e) shipped work is never abandoned — that is the shipped-record path.
2. Add a row for the new runbook to `docs/runbooks/index.md`.
3. Run `test/test_harness_integrity.sh`; fix any failures.
4. Commit.

**Done when:**
- docs/runbooks/abandoning-a-spec.md exists and contains all five elements enumerated in step 1 (procedure, rationale, blocked-but-wanted counter-case, shipped-work exclusion, issue-before-delete ordering)
- docs/runbooks/index.md lists it
- test/test_harness_integrity.sh exits 0

**Files likely touched:**
- docs/runbooks/abandoning-a-spec.md — new runbook
- docs/runbooks/index.md — new row

**Dependencies:** none

### Task 2: Point daemon-triage at the runbook
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. In `skills/daemon-triage/SKILL.md`, at the point where triage concludes a feature should stop permanently (the recommended-actions / escalation guidance around the triage report template), add a short paragraph: when the conclusion is "this work should not continue", follow `docs/runbooks/abandoning-a-spec.md` — delete the DECIDE artifacts and record the decision on a closed issue. Keep it to a pointer plus one sentence; the runbook owns the procedure.
2. Run `test/test_harness_integrity.sh` (SKILL.md frontmatter and cross-reference checks).
3. Commit.

**Done when:**
- skills/daemon-triage/SKILL.md references docs/runbooks/abandoning-a-spec.md exactly once, at the stop-work conclusion point
- test/test_harness_integrity.sh exits 0

**Files likely touched:**
- skills/daemon-triage/SKILL.md — pointer paragraph

**Dependencies:** 1

### Task 3: Rewrite the artifacts reference to the issue-tracker path
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. In `docs/reference/artifacts.md`, remove the `retired/` row from the `.docs` directory table (and decrement any entry count the page states above the table, if present) and remove the link to the retired README.
2. Where the page needs to explain what happens to abandoned work, add one sentence linking `docs/runbooks/abandoning-a-spec.md` (abandonment leaves no artifact; the record is a closed issue).
3. Run `test/test_harness_integrity.sh`.
4. Commit.

**Done when:**
- docs/reference/artifacts.md contains no `retired/` table row and no link into the retired directory
- The page links docs/runbooks/abandoning-a-spec.md for the abandonment path
- test/test_harness_integrity.sh exits 0

**Files likely touched:**
- docs/reference/artifacts.md — row removal + runbook link

**Dependencies:** 1

### Task 4: File and close one issue per retired plan
**Story:** Story 2
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Read the register README's two tables in the retired directory. For each of the nine rows (five Delivered, four Abandoned), search `gh issue list --search "<stem>"` for an existing dedicated tracker issue for that plan.
2. Where none exists, file one with `gh issue create` titled `Retired plan: <stem>` whose body carries the row verbatim: for Delivered rows the delivery evidence; for Abandoned rows the retired date, decider, and note. Reference issue #1574 in the body (plain reference, not a closing keyword).
3. Close each of the nine issues with `gh issue close <n> --comment` naming why (delivered-elsewhere or abandoned).
4. Record the complete stem → issue-number mapping in an empty commit: `git commit --allow-empty` whose message body lists all nine pairs, with trailers `Task: 4` and `Evidence: skipped issue-filing produces no diff; mapping in this message`.

**Done when:**
- Nine closed issues exist on jstoup111/ai-conductor, one per retired plan stem, each carrying its register row's content
- An empty commit on the branch lists all nine stem → issue pairs in its message body
- No repository file changed in this task's diff

**Files likely touched:**
- none

**Dependencies:** none

### Task 5: Delete the retired register
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. `git rm -r .docs/retired/` — this is the explicit, enumerated scope: the nine plan files plus README.md, nothing else. Print the ten paths before removing.
2. Commit with a message body that repeats the stem → issue mapping from Task 4 so the deletion commit itself references each file's closed-issue record.
3. Grep the remaining tree (`docs/`, `skills/`, `HARNESS.md`, the shared instruction file) for references to a retired-plans directory or register procedure; remove any stragglers found (expected: none after Tasks 1–3).
4. Run `test/test_harness_integrity.sh`.

**Done when:**
- `git ls-files .docs/retired/` returns nothing on the branch
- The deletion commit message maps each deleted stem to its closed issue number
- A repo-wide grep for the retired-register procedure returns no surviving instruction to move plans into a retired directory or maintain a register row
- test/test_harness_integrity.sh exits 0

**Files likely touched:**
- .docs/retired/README.md — deleted
- .docs/retired/2026-03-30-technical-assessment.md — deleted
- .docs/retired/daemon-self-host-guardrails.md — deleted
- .docs/retired/expose-daemon-pause-resume-verbs.md — deleted
- .docs/retired/intake-issues-get-contradictory-duplicate-priority.md — deleted
- .docs/retired/remediate-aggregate-test-suite-gate.md — deleted
- .docs/retired/remediation-comment-upsert.md — deleted
- .docs/retired/satisfied-by-forged-citation-validation.md — deleted
- .docs/retired/the-engine-cannot-detect-its-own-spinning-operator.md — deleted
- .docs/retired/trim-skill-frontmatter-descriptions-and-de-accrete.md — deleted

**Dependencies:** 4

### Task 6: Prove backlog discovery and the shipment audit are unaffected
**Story:** Story 3
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Run the backlog scan's enumeration on the branch (`git ls-tree --name-only HEAD:.docs/plans` filtered to `*.md`, the same non-recursive listing `daemon-backlog.ts` performs) and on the merge-base; diff the two lists.
2. Assert none of the nine retired stems appear in either list, and that the two lists are identical except for this feature's own plan file.
3. Run the shipment audit's ACTUAL historical enumeration -- `git log --pretty=format: --name-only <ref> -- .docs/plans .docs/specs`, the source `src/conductor/src/engine/shipment-audit.ts:138-142` uses -- for `<ref>` = HEAD and `<ref>` = the merge-base, and assert the two source sets are identical. The nine retired stems are already historical sources at the merge-base (they lived under `.docs/plans/` before an earlier change moved them to `.docs/retired/`), so this migration neither adds nor removes an audit source; the engine surfacing them at all is issue #1964, out of scope here.
4. Confirm `git diff --stat <merge-base>...HEAD -- src/` is empty (no engine change).
5. Record the four observations in an empty commit with trailers `Task: 6` and `Evidence: skipped verification produced no diff; observations in this message`.

**Done when:**
- The branch's plans listing contains no retired stem and differs from the merge-base only by this feature's own artifacts
- The shipment audit's historical source set is byte-identical between HEAD and the merge-base (zero added, zero removed)
- The diff against the merge-base touches no path under src/
- An empty commit records these observations

**Files likely touched:**
- none

**Dependencies:** 5

### Task 7: Delete the four abandoned specs' associated DECIDE artifacts
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Enumerate what survives: `git ls-files '.docs/*/<stem>.md'` for each of the four stems whose plans Task 5 removed and whose issues Task 4 closed — `satisfied-by-forged-citation-validation`, `intake-issues-get-contradictory-duplicate-priority`, `trim-skill-frontmatter-descriptions-and-de-accrete`, `the-engine-cannot-detect-its-own-spinning-operator`. Print the list before deleting; re-derive it rather than trusting the enumeration below.
2. Delete the DECIDE artifacts the runbook's end state removes — `.docs/architecture/`, `.docs/coherence/`, `.docs/complexity/`, `.docs/conflicts/`, `.docs/stories/`, and `.docs/track/` entries for those stems (16 files at the reviewed HEAD). Name every path explicitly on the `git rm` command line; per `docs/runbooks/abandoning-a-spec.md:48`, no recursive or globbed deletion.
3. Keep each stem's `.docs/intake/` artifact: it records why the work was raised, which the closed issue references, and the runbook's end state removes the decision records, not the origin.
4. Commit the removals together in one commit whose message maps each stem to its closed issue number, per `docs/runbooks/abandoning-a-spec.md:45-57`.
5. Verify no orphan survives: for each stem, `git ls-files '.docs/*/<stem>.md'` returns only the `.docs/intake/` path.
6. Run `test/test_harness_integrity.sh`.

**Done when:**
- [ ] For each of the four stems, no `.docs/architecture/`, `.docs/coherence/`, `.docs/complexity/`, `.docs/conflicts/`, `.docs/stories/`, or `.docs/track/` artifact remains on the branch.
- [ ] Each stem's `.docs/intake/` artifact is untouched.
- [ ] One commit carries every removal and names each stem's closed issue number.
- [ ] Every deleted path was named explicitly — the commit contains no recursive or globbed removal.
- [ ] test/test_harness_integrity.sh exits 0.

**Files likely touched:**
- .docs/complexity/satisfied-by-forged-citation-validation.md, .docs/conflicts/satisfied-by-forged-citation-validation.md, .docs/stories/satisfied-by-forged-citation-validation.md, .docs/track/satisfied-by-forged-citation-validation.md — deleted
- .docs/architecture/intake-issues-get-contradictory-duplicate-priority.md, .docs/complexity/intake-issues-get-contradictory-duplicate-priority.md, .docs/stories/intake-issues-get-contradictory-duplicate-priority.md, .docs/track/intake-issues-get-contradictory-duplicate-priority.md — deleted
- .docs/complexity/trim-skill-frontmatter-descriptions-and-de-accrete.md, .docs/stories/trim-skill-frontmatter-descriptions-and-de-accrete.md, .docs/track/trim-skill-frontmatter-descriptions-and-de-accrete.md — deleted
- .docs/architecture/the-engine-cannot-detect-its-own-spinning-operator.md, .docs/coherence/the-engine-cannot-detect-its-own-spinning-operator.md, .docs/complexity/the-engine-cannot-detect-its-own-spinning-operator.md, .docs/stories/the-engine-cannot-detect-its-own-spinning-operator.md, .docs/track/the-engine-cannot-detect-its-own-spinning-operator.md — deleted

**Dependencies:** 4; 5

## Task Dependency Graph
```
Task 1 ──> Task 2
   └─────> Task 3
Task 4 ──> Task 5 ──> Task 6
```

## Integration Points
- After Task 3: the documented surface is fully consistent (one path, no contradictions) even before migration.
- After Task 5: the repository end-state matches the desired outcome; Task 6 proves the no-regression story.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (Story 1 negatives → Tasks 1/5; Story 2 negatives → Tasks 4/5; Story 3 negative → Task 6)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a Done when block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-s13-1: docs/reference/artifacts.md:40 — correct the `.docs/` inventory sentence so it matches the table at :44-63 it describes: change "Nineteen entries" to "Twenty entries" (the table has exactly 20 rows) and "the five with no code reference" to "the four with no code reference" (only `audit/`, `manual-test-results.md`, `observation/`, and `phase7-daemon-validation.md` still carry the **no code reference** marker after the `retired/` row removal). Edit both halves of that one sentence together — they are the matched counterpart of the same table — change no table row and no other line, then re-run test/test_harness_integrity.sh and confirm it still exits 0.
**Gate:** prd-audit
**Rationale:** docs/reference/artifacts.md:40 reads "Nineteen entries. Alphabetized; the five with no code reference are marked." while the `.docs/` table it describes at :44-63 holds 20 rows of which only 4 carry the **no code reference** marker (:45 `audit/`, :55 `manual-test-results.md`, :56 `observation/`, :57 `phase7-daemon-validation.md`) — removing the `retired/` row in this diff dropped the fifth marked row and left the page's own inventory sentence false; this is conforming documentation drift that preserves the approved architecture, not a planning miss, and approved plan Task 3 step 1 already admits the repair ("decrement any entry count the page states above the table, if present"), so no new plan task is needed and no architectural decision is at stake. Sibling sweep: line 40 is the only inventory sentence governing this table — the two other cardinal-number sentences in the file (:85 "Exactly two entries get a relaxed second lookup", :495 "Two constants named `HALT_MARKER`") describe unrelated mechanisms and are correct, so they are found-and-excluded; no other page states a `.docs/` entry count (verified by grep across the file). The count sentence and the table are the matched pair, so both halves of the sentence are corrected together against the table as it now stands, including the pre-existing off-by-one in the entry count (21 rows under "Twenty" at the merge-base, now 20 rows under "Nineteen"), which sits in the same sentence inside the same admitted step and would otherwise be the next audit lap's finding. The task removes, replaces, or relaxes no code, test, or assertion — it is a two-word prose correction inside the artifact plan Task 3 itself delivers, and Task 3's Done-when conditions (no `retired/` row, no link into the retired directory, the runbook link present at :67, integrity suite exits 0) all remain satisfied afterwards.
**Criterion:** S1.3
**Parent task:** 3
**Done when:**
- S1.3 is satisfied by this task.
