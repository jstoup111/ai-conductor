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
3. Run the shipment audit's recursive enumeration (`git ls-tree -r --name-only HEAD -- .docs/plans`) and assert no retired stem appears.
4. Confirm `git diff --stat <merge-base>...HEAD -- src/` is empty (no engine change).
5. Record the four observations in an empty commit with trailers `Task: 6` and `Evidence: skipped verification produced no diff; observations in this message`.

**Done when:**
- The branch's plans listing contains no retired stem and differs from the merge-base only by this feature's own artifacts
- The recursive audit enumeration contains no retired stem
- The diff against the merge-base touches no path under src/
- An empty commit records these observations

**Files likely touched:**
- none

**Dependencies:** 5

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
