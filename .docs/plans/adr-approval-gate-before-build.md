# Implementation Plan: ADR approval enforced before build

**Date:** 2026-08-08
**Stories:** .docs/stories/adr-approval-gate-before-build.md
**Conflict check:** Clean as of 2026-08-08

## Summary

Replace the never-firing `hasDraftAdr` scan with a single `adrApprovalStatus()` parser and read it
at two new enforcement rungs (engineer land, daemon discovery), leaving the as-built review as an
unchanged backstop. 12 tasks.

## Technical Approach

The defect is one signal with no working definition. `hasDraftAdr` (`artifacts.ts:3098`) matches
only the literal word *draft*, which the repo's ADR corpus never uses as a status — so the gate has
never fired. Meanwhile `templates/adr.md.template` instructs authors to write values that are not
recognized by any gate. The fix is therefore a parser plus a vocabulary correction, not just a
placement change.

**The parser** (`adrApprovalStatus`) lives beside `isStoriesApproved` in `artifacts.ts` and returns
both a verdict and the status text it found — the text is required so rung 1 and rung 2 can name
what they rejected. Three properties are non-negotiable and each has its own task: fenced code
blocks are stripped before matching (an ADR about this feature necessarily shows examples of
rejected statuses); matches are line-anchored (a mid-sentence mention is not a declaration); the
first declaration wins. A position/header-only rule was rejected at DECIDE because
`adr-2026-07-23-commit-movement-liveness-floor.md` declares at line 102, in the body.

**Rung 1** reuses the existing repo-wide `listAdrFiles()` helper already in `land-spec.ts:580`; only
the predicate and the error message change.

**Rung 2** is the larger piece. Daemon discovery reads the base-branch tree through
`BacklogTreeSource`, which today exposes no directory listing — so the interface gains a required
`listAdrFiles()`, mirroring `listShippedFiles`' `git ls-tree` implementation and its catch-to-`[]`
failure handling. Because `readFile` is one `git show` subprocess per file (238 files measured at
0.90s), the corpus scan is hoisted **above** the per-candidate loop; leaving it inside would make
discovery quadratic in backlog size. Results are reported per slug via a new `'adr-not-approved'`
member of the `BlockedSpecItem` reason union so each blocked feature keeps a dashboard row and a
remedy, while the warning logs once per pass.

**Sequencing rationale.** Tasks 1–4 build and prove the parser before anything depends on it.
Task 5 is the single cutover point (both callers migrate and the old export dies together, so the
build is never red between them). Task 7 likewise changes the interface and all 13 typed test
doubles in one task, for the same reason. Rung 2's behavior (9, 10) follows its plumbing (7, 8).

Documentation for the new gate is delivered by this repository's `maintain-documentation` custom
step, not by plan tasks.

## Prerequisites

- None outstanding. The three 2026-07-13 ADRs that previously carried an unapproved status were
  stamped APPROVED in this spec change, so the corpus is 240/240 conforming and the gate can go
  live without blocking existing work.

## Tasks

### Task 1: Parse allowlisted status declarations in every grammar the corpus uses
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests asserting `adrApprovalStatus` reports approved for each form: `Status: APPROVED`; `**Status:** SUPERSEDED by \`x\``; `- **Status:** APPROVED (operator-approved 2026-07-29)`; `Status: SUPERSEDED in part by \`y\``; `**Status:** **APPROVED**` with trailing whitespace.
2. Verify tests fail (RED).
3. Implement `adrApprovalStatus(content)` returning `{ approved: boolean, found: string | null }`, matching a line-anchored declaration with optional list marker and bold markers, allowlisting values whose first word is APPROVED or SUPERSEDED (case-insensitive prefix so trailing prose passes).
4. Verify tests pass (GREEN).
5. Commit: "feat(artifacts): add adrApprovalStatus parser for ADR approval signal"

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — new exported function beside `isStoriesApproved`
- src/conductor/test/engine/artifacts.test.ts — grammar fixture matrix

**Wired-into:** src/conductor/src/engine/engineer/land-spec.ts#landSpec, src/conductor/src/engine/engineer/authoring.ts#runAuthoring, src/conductor/src/engine/daemon-backlog.ts#discoverBacklog

**Dependencies:** none

### Task 2: Exclude fenced code blocks before matching
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test: an ADR whose header declares APPROVED and whose body contains a fenced block declaring the value `DRAFT` reports approved.
2. Add a second failing test: an ADR whose *only* declaration sits inside a fenced block reports not-approved (fenced content is never a declaration).
3. Verify tests fail (RED).
4. Implement fence stripping as the first step of the parser, before any matching.
5. Verify tests pass (GREEN).
6. Commit: "feat(artifacts): ignore fenced code blocks when reading ADR status"

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — fence-stripping pre-pass
- src/conductor/test/engine/artifacts.test.ts — fenced-example cases

**Wired-into:** src/conductor/src/engine/engineer/land-spec.ts#landSpec, src/conductor/src/engine/engineer/authoring.ts#runAuthoring, src/conductor/src/engine/daemon-backlog.ts#discoverBacklog

**Dependencies:** Task 1

### Task 3: Reject mentions, honor first declaration, fail closed
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: mid-sentence prose ``requires `Status: Accepted`, no DRAFT`` in an approved ADR still reports approved; an ADR with an approved declaration followed by a later line-anchored `Status: Proposed` reports approved (first wins); an ADR with no declaration reports not-approved; a zero-byte file reports not-approved without throwing; values `Accepted` and `Proposed` report not-approved and surface the found text.
2. Verify tests fail (RED).
3. Implement line-anchoring, first-match-wins, and the fail-closed no-declaration branch.
4. Verify tests pass (GREEN).
5. Commit: "feat(artifacts): anchor ADR status matching and fail closed on no declaration"

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — anchoring and fail-closed branch
- src/conductor/test/engine/artifacts.test.ts — mention/first-wins/empty cases

**Wired-into:** src/conductor/src/engine/engineer/land-spec.ts#landSpec, src/conductor/src/engine/engineer/authoring.ts#runAuthoring, src/conductor/src/engine/daemon-backlog.ts#discoverBacklog

**Dependencies:** Task 2

### Task 4: Prove the parser against the real ADR corpus
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test that reads every `.docs/decisions/adr-*.md` in the repository and asserts zero rejections and zero unparseable results.
2. Verify it fails or passes for the right reason (RED/GREEN judged against the real corpus).
3. Fix any grammar form the corpus exposes that the fixtures missed.
4. Verify the test passes (GREEN).
5. Commit: "test(artifacts): assert adrApprovalStatus accepts the entire ADR corpus"

**Files likely touched:**
- src/conductor/test/engine/artifacts.test.ts — corpus sweep test

**Wired-into:** none (no new production surface)

**Dependencies:** Task 3

### Task 5: Cut both callers over and delete the old signal
**Story:** 2
**Type:** refactor

**Steps:**
1. Write a failing test asserting an ADR that the old scan would have rejected only for prose (a body mention of the word) is accepted by both engineer paths.
2. Verify test fails (RED).
3. Replace the `hasDraftAdr` call in `land-spec.ts` and in `authoring.ts` with `adrApprovalStatus`, and delete the `hasDraftAdr` export in the same commit so the build is never red between steps.
4. Verify tests pass (GREEN) and `grep -rn "hasDraftAdr" src/` returns nothing.
5. Commit: "refactor(engineer): read ADR approval through adrApprovalStatus and drop hasDraftAdr"

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — remove `hasDraftAdr`
- src/conductor/src/engine/engineer/land-spec.ts — call the new parser
- src/conductor/src/engine/engineer/authoring.ts — call the new parser

**Wired-into:** src/conductor/src/engine/engineer/land-spec.ts#landSpec, src/conductor/src/engine/engineer/authoring.ts#runAuthoring

**Dependencies:** Task 4

### Task 6: Land rejection names the offending file and the status found
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: landing a worktree containing an ADR declaring `Status: Proposed` is rejected with an error containing both the file path and the text `Proposed`; an ADR with no declaration is rejected with a message distinguishing "no status declaration" from a disallowed value; with two non-conforming ADRs, both file names appear.
2. Verify tests fail (RED).
3. Implement the message construction in `land-spec.ts`, collecting all offenders rather than stopping at the first.
4. Verify tests pass (GREEN).
5. Commit: "feat(engineer): name the offending ADR and its status when a land is rejected"

**Files likely touched:**
- src/conductor/src/engine/engineer/land-spec.ts — ADR gate message
- src/conductor/test/engine/land-spec.test.ts — rejection message assertions

**Wired-into:** same as Task 5

**Dependencies:** Task 5

### Task 7: Extend BacklogTreeSource with listAdrFiles and update every test double
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting the git-backed tree source returns only `adr-*.md` entries from `.docs/decisions` on the base branch, excluding `architecture-review-*.md`.
2. Verify test fails (RED).
3. Add required `listAdrFiles(): Promise<string[]>` to the interface; implement it in the git-backed source mirroring `listShippedFiles`; update all 13 typed fake literals in the same commit — `daemon-backlog.test.ts` (8), `blocked-specs-daemon-status.acceptance.test.ts` (2), `shipped-record.test.ts` (1), `dependency-ordered-intake-and-dispatch.test.ts` (1), `daemon-issue-priority-scheduling.test.ts` (1) — so the build is never red between tasks.
4. Verify the full suite compiles and passes (GREEN).
5. Commit: "feat(daemon): let the backlog tree source enumerate ADR files"

**Files likely touched:**
- src/conductor/src/engine/backlog-tree-source.ts — interface member
- src/conductor/src/engine/daemon-backlog.ts — git-backed implementation
- src/conductor/test/engine/daemon-backlog.test.ts — fake literals
- src/conductor/test/engine/shipped-record.test.ts — fake literal
- src/conductor/test/acceptance/blocked-specs-daemon-status.acceptance.test.ts — fake literals
- src/conductor/test/acceptance/dependency-ordered-intake-and-dispatch.test.ts — fake literal
- src/conductor/test/acceptance/daemon-issue-priority-scheduling.test.ts — fake literal

**Wired-into:** src/conductor/src/engine/daemon-backlog.ts#discoverBacklog

**Dependencies:** Task 4

### Task 8: Absent directory, git failure, and empty corpus all degrade safely
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: a base branch with no `.docs/decisions/` yields `[]` rather than throwing; a failing git invocation yields `[]` and does not propagate; an empty ADR corpus blocks zero specs.
2. Verify tests fail (RED).
3. Implement the catch-to-`[]` path and assert the empty-corpus-passes rule at the call site.
4. Verify tests pass (GREEN).
5. Commit: "fix(daemon): treat an absent or unreadable ADR directory as an empty corpus"

**Files likely touched:**
- src/conductor/src/engine/daemon-backlog.ts — failure handling
- src/conductor/test/engine/daemon-backlog.test.ts — degradation cases

**Wired-into:** same as Task 7

**Dependencies:** Task 7

### Task 9: Block dispatch on a non-conforming corpus, reported per slug
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: with a non-conforming corpus and three eligible merged specs, none is dispatched and each receives a blocked row with reason `adr-not-approved` whose remedy names the offending file and its status; with a conforming corpus, dispatch proceeds and no blocked row is written.
2. Verify tests fail (RED).
3. Add `'adr-not-approved'` to the `BlockedSpecItem` reason union and implement the eligibility block, modeled on the adjacent `stories-not-approved` check.
4. Verify tests pass (GREEN).
5. Commit: "feat(daemon): refuse dispatch while any ADR is unapproved"

**Files likely touched:**
- src/conductor/src/engine/daemon-backlog.ts — reason union and eligibility block
- src/conductor/test/engine/daemon-backlog.test.ts — blocked-row assertions

**Wired-into:** same as Task 7

**Dependencies:** Task 8

### Task 10: Scan once per pass, log once per pass, recover on the next pass
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: over a multi-candidate pass the corpus is read exactly once (assert via a counting tree-source double); exactly one warning is logged for the pass rather than one per candidate; a corrected corpus clears the blocked rows and resumes dispatch on the following pass with no restart.
2. Verify tests fail (RED).
3. Hoist the corpus evaluation above the per-candidate loop and key the `warnOnce` call per pass.
4. Verify tests pass (GREEN).
5. Commit: "perf(daemon): evaluate the ADR corpus once per discovery pass"

**Files likely touched:**
- src/conductor/src/engine/daemon-backlog.ts — hoisted scan and warn keying
- src/conductor/test/engine/daemon-backlog.test.ts — call-count and recovery assertions

**Wired-into:** same as Task 7

**Dependencies:** Task 9

### Task 11: Confirm the as-built backstop is untouched
**Story:** 6
**Type:** refactor
**Verify-only:** yes

**Steps:**
1. Confirm by inspection and test run that the as-built verdict logic in `artifacts.ts` is unchanged by this feature and that its existing tests pass unmodified.
2. Confirm the as-built path never referenced `hasDraftAdr`, proving the two systems were already decoupled.
3. Commit an empty commit carrying the task trailer and an `Evidence: skipped` trailer.

**Files likely touched:**
- none

**Wired-into:** none (no new production surface)

**Dependencies:** Task 5

### Task 12: Align the authoring vocabulary with the allowlist
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write a failing check asserting `templates/adr.md.template` offers no status value outside the allowlist.
2. Verify it fails (RED) — the template currently offers values the parser rejects.
3. Update `templates/adr.md.template` and `skills/architecture-review/SKILL.md` §7b so both name the same terminal states the parser accepts.
4. Run `test/test_harness_integrity.sh` and verify it passes (GREEN).
5. Commit: "docs(skills): align ADR status vocabulary with the approval allowlist"

**Files likely touched:**
- templates/adr.md.template — terminal status values
- skills/architecture-review/SKILL.md — §7b lifecycle vocabulary

**Wired-into:** none (no new production surface)

**Dependencies:** Task 5

## Task Dependency Graph

```
Task 1 (parser: allowlist grammars)
  └─ Task 2 (fence exclusion)
       └─ Task 3 (anchoring, first-wins, fail-closed)
            └─ Task 4 (corpus-wide proof)
                 ├─ Task 5 (cut over both callers, delete hasDraftAdr)
                 │    ├─ Task 6 (land message names file + status)
                 │    ├─ Task 11 (as-built backstop unchanged, verify-only)
                 │    └─ Task 12 (template + SKILL.md vocabulary)
                 └─ Task 7 (BacklogTreeSource.listAdrFiles + 13 fakes)
                      └─ Task 8 (absent dir / git failure / empty corpus)
                           └─ Task 9 (block dispatch, per-slug rows)
                                └─ Task 10 (once-per-pass scan, log, recovery)
```

Acyclic. Tasks 5 and 7 both depend only on Task 4 and may proceed in parallel.

## Integration Points

- **After Task 4:** the approval signal is fully specified and proven against the real corpus, but
  nothing consumes it yet.
- **After Task 6:** rung 1 is live end-to-end — a spec carrying a non-conforming ADR cannot be
  landed.
- **After Task 10:** rung 2 is live end-to-end — a merged spec cannot be dispatched while the corpus
  is non-conforming, and the operator can recover without a restart.
- **After Task 12:** authoring guidance and machinery agree, so a newly authored ADR passes.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Every task introducing a production surface carries a `Wired-into:` line
