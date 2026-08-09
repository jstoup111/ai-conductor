# Stories: ADR approval enforced before build

**Status:** Accepted

**Feature:** adr-approval-gate-before-build
**Issue:** jstoup111/ai-conductor#662
**Track:** technical (no PRD — acceptance criteria live here)
**Governing ADRs:** `adr-2026-08-08-single-adr-approval-parser-three-rungs`,
`adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition`

> Precondition already satisfied in this spec change: the three 2026-07-13 ADRs that previously
> carried an unapproved marker are stamped APPROVED, so the corpus is 240/240 conforming and the
> gate can go live without blocking existing work. No story covers that stamp.

---

## Story 1: The approval signal has one definition that reads declarations, not prose

**Requirement:** ADR-1 (parser contract)

As the harness, I want a single function that decides whether an ADR is approved, so that every
gate reaches the same verdict and no gate can be fooled by an ADR's own prose.

### Acceptance Criteria

#### Happy Path
- Given an ADR whose first line-anchored declaration is `Status: APPROVED`, when the parser reads
  it, then it reports approved.
- Given an ADR declaring `**Status:** SUPERSEDED by \`adr-2026-07-30-finish-only-mergeability-gate\``,
  when the parser reads it, then it reports approved — a resolved decision does not block.
- Given an ADR declaring `- **Status:** APPROVED (operator-approved 2026-07-29)`, when the parser
  reads it, then it reports approved — a list marker and trailing prose are both tolerated.
- Given an ADR declaring `Status: SUPERSEDED in part by \`adr-2026-07-29-deterministic-build-verification-fanout\``,
  when the parser reads it, then it reports approved.
- Given an ADR whose declaration carries trailing whitespace and bold-wrapped value
  (`**Status:** **APPROVED**   `), when the parser reads it, then it reports approved.
- Given an ADR whose only declaration appears at line 102 in the document body (as
  `adr-2026-07-23-commit-movement-liveness-floor.md` does), when the parser reads it, then it
  reports approved — position in the file is not a criterion.
- Given the repository's full 240-ADR corpus, when the parser is run over every file, then all 240
  report approved, with zero rejections and zero unparseable results.

#### Negative Paths
- Given an ADR whose declaration reads `Status: Proposed`, when the parser reads it, then it reports
  **not** approved and surfaces the value `Proposed`.
- Given an ADR containing **no** line-anchored status declaration at all, when the parser reads it,
  then it reports **not** approved (fail closed) — absence is never treated as approval.
- Given an approved ADR that contains a fenced code block whose body includes a status declaration
  whose value is `DRAFT`, shown as an illustrative example, when the parser reads it, then it
  reports approved — fenced content is excluded before matching, so an ADR documenting this feature
  is not judged by its own example.
- Given an approved ADR whose body contains the mid-sentence prose ``requires `Status: Accepted`, no
  DRAFT``, when the parser reads it, then it reports approved — a mention inside a sentence is not a
  declaration.
- Given an ADR with an approved declaration on line 3 and a later line-anchored status-shaped line
  reading `Status: Proposed` further down, when the parser reads it, then it reports approved — the
  first declaration wins.
- Given an ADR whose declaration value is an unrecognized word such as `Accepted` or `Draft`, when
  the parser reads it, then it reports **not** approved — only APPROVED and SUPERSEDED are allowed.
- Given a zero-byte ADR file, when the parser reads it, then it reports **not** approved without
  throwing.

### Done When
- [ ] `adrApprovalStatus(content)` is exported from `src/conductor/src/engine/artifacts.ts` and
      returns both the approved/not-approved verdict and the status text it actually found
      (or an explicit "no declaration" result).
- [ ] A test fixture exercises each tolerated grammar form: bare, bold, list-marker, bold-wrapped
      value, trailing prose, trailing whitespace.
- [ ] A test asserts a fenced example declaring the value `DRAFT`, inside an otherwise-approved
      ADR, does not change the verdict.
- [ ] A test asserts a mid-sentence status mention does not change the verdict.
- [ ] A test runs the parser over every `.docs/decisions/adr-*.md` in the repo and asserts zero
      rejections and zero unparseable results.

---

## Story 2: The old signal is gone and every caller reads the new one

**Requirement:** ADR-1 (single source of truth)

As a maintainer, I want `hasDraftAdr` removed and all its callers migrated, so that no code path can
still consult the old whole-file scan.

### Acceptance Criteria

#### Happy Path
- Given the codebase after this change, when `hasDraftAdr` is searched for, then it exists in
  neither `artifacts.ts` nor any caller.
- Given the engineer authoring path in `authoring.ts`, when it evaluates an architecture-review
  artifact, then it reaches its verdict via `adrApprovalStatus`.
- Given the land path in `land-spec.ts`, when it evaluates ADRs, then it reaches its verdict via
  `adrApprovalStatus`.

#### Negative Paths
- Given an ADR that the old scan would have rejected only because the word appeared in its prose,
  when either migrated caller evaluates it, then it is accepted — the migration must not preserve
  the old false-positive behavior.
- Given the existing `hasDraftAdr` test suite, when the change lands, then those tests have been
  migrated to cover `adrApprovalStatus` rather than deleted, so coverage does not silently drop.

  > **Amended 2026-08-08 by #662:** conflict-check verified that **no such test suite exists** —
  > across 733 test files, zero reference `hasDraftAdr`. The gate has always been untested, which
  > is part of why the vocabulary defect survived. This criterion therefore imposes no migration
  > obligation; Story 1's fixture matrix is *first-time* coverage for this signal, not a port.
  > The original assertion is retained above per the append-only convention.

### Done When
- [ ] `grep -rn "hasDraftAdr" src/` returns no matches outside deleted-test history.
- [ ] `authoring.ts` and `land-spec.ts` both call `adrApprovalStatus`.
- [ ] The full existing test suite passes with no reduction in ADR-gate assertions.

---

## Story 3: A spec cannot be landed while any ADR is unapproved

**Requirement:** ADR-1 rung 1 (pre-merge)

As an operator, I want the engineer's land to refuse an unapproved ADR corpus, so that a
non-conforming ADR never reaches the default branch.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose ADRs all declare an allowlisted status, when `land` runs, then the ADR gate
  passes and the land proceeds.

#### Negative Paths
- Given a worktree containing one ADR declaring `Status: Proposed`, when `land` runs, then the land
  is rejected, and the error names both the offending ADR's file path and the status text it
  actually found.
- Given a worktree containing an ADR with no parseable declaration, when `land` runs, then the land
  is rejected naming that file, and the message distinguishes "no status declaration" from a
  disallowed value.
- Given a worktree containing two non-conforming ADRs, when `land` runs, then the rejection names
  the offending files rather than stopping silently at the first.
- Given a rejected land, when the operator inspects the worktree, then it is still present
  (keep-on-failure) and the target's primary tree is unchanged.

### Done When
- [ ] `landSpec` rejects on any non-conforming ADR, with the file path and found status in the
      error message.
- [ ] A test asserts the rejection message contains both the path and the offending status text.
- [ ] A test asserts a fully conforming corpus lands successfully.

---

## Story 4: Daemon discovery can enumerate the ADR corpus from the base branch

**Requirement:** ADR-2 (interface extension)

As the daemon, I want to list ADR files on the base-branch tree, so that rung 2 can evaluate the
corpus without a working checkout.

### Acceptance Criteria

#### Happy Path
- Given a base branch containing `.docs/decisions/` with 240 ADR files, when `listAdrFiles()` is
  called, then it returns exactly the `adr-*.md` entries and excludes non-ADR files such as
  `architecture-review-*.md`.

#### Negative Paths
- Given a repository whose base branch has **no** `.docs/decisions/` directory, when
  `listAdrFiles()` is called, then it returns an empty array rather than throwing — matching
  `listShippedFiles`' existing failure handling.
- Given a git invocation that fails for any reason, when `listAdrFiles()` is called, then it returns
  an empty array and does not propagate the error.
- Given an empty ADR corpus, when rung 2 evaluates it, then **no** spec is blocked — a project that
  has authored no ADRs must remain buildable.

### Done When
- [ ] `BacklogTreeSource` declares `listAdrFiles(): Promise<string[]>` and every implementer
      satisfies it.
- [ ] The git-backed implementation filters to `adr-*.md` and catches failure to `[]`.
- [ ] A test asserts the empty-corpus case results in zero blocked specs.

---

## Story 5: A merged spec is not dispatched while the ADR corpus is unapproved

**Requirement:** ADR-2 rung 2 (pre-dispatch)

As an operator, I want discovery to refuse to dispatch builds against a non-conforming ADR corpus,
so that no build is spent on a precondition failure that was knowable beforehand.

### Acceptance Criteria

#### Happy Path
- Given a conforming ADR corpus and an otherwise-eligible merged spec, when a discovery pass runs,
  then the spec is dispatched as normal and no blocked row is written.
- Given a discovery pass over a backlog of several candidate specs, when the ADR corpus is
  evaluated, then the corpus is read exactly **once** for the whole pass, not once per candidate.

#### Negative Paths
- Given a non-conforming ADR corpus and three eligible merged specs, when a discovery pass runs,
  then **no** spec is dispatched, and each of the three receives a blocked row with reason
  `adr-not-approved` whose remedy names the offending ADR file and its status.
- Given the same non-conforming corpus, when a discovery pass runs, then exactly **one** warning
  line is logged for the pass — not one per candidate.
- Given the same non-conforming corpus, when discovery runs on the very next poll, then the warning
  is not re-emitted (log-once discipline holds across passes) while the blocked rows remain current.
- Given a non-conforming corpus that the operator then fixes on the base branch, when the next
  discovery pass runs, then the blocked rows clear and dispatch resumes with no daemon restart.
- Given a blocked backlog, when the operator reads `.daemon/blocked.json`, then the offending ADR is
  identifiable without re-running the scan by hand.

### Done When
- [ ] `'adr-not-approved'` is a member of the `BlockedSpecItem` reason union.
- [ ] The corpus scan is evaluated above the per-candidate loop in `discoverBacklog`.
- [ ] A test asserts the scan is performed once for a multi-candidate pass.
- [ ] A test asserts every candidate gets a blocked row while only one warning is logged.
- [ ] A test asserts recovery: a corrected corpus produces dispatch on the following pass.

---

## Story 6: The ship-time backstop still works and now fires only as an exception

**Requirement:** ADR-1 rung 3 (unchanged backstop)

As the harness, I want the as-built review's ADR behavior left intact, so that the last line of
defense survives this refactor.

### Acceptance Criteria

#### Happy Path
- Given shipped code consistent with the approved ADRs, when the as-built review runs, then it
  reaches its existing clean verdict exactly as before this change.

#### Negative Paths
- Given shipped code that violates an approved ADR, when the as-built review runs, then it still
  produces a blocking verdict and routes a needs-human DECIDE halt — unchanged behavior.
- Given the refactor that removed `hasDraftAdr`, when the as-built review path executes, then its
  verdict parsing is unaffected, proving the two systems were never coupled.

### Done When
- [ ] No behavioral change is made to the as-built verdict logic in `artifacts.ts`.
- [ ] The existing as-built tests pass unmodified.

---

## Story 7: Authoring guidance names the same statuses the gate accepts

**Requirement:** Review condition 2 (vocabulary alignment)

As an ADR author, I want the template and the skill contract to name the statuses the gate actually
allows, so that following the guidance produces an ADR that passes.

### Acceptance Criteria

#### Happy Path
- Given `templates/adr.md.template`, when an author fills it in verbatim and reaches a terminal
  state, then the resulting declaration is one the parser accepts.
- Given `skills/architecture-review/SKILL.md` §7b, when it is read, then the terminal states it
  names match the parser's allowlist exactly.

#### Negative Paths
- Given the template before this change, when an author writes the `Accepted` value it currently
  offers, then the gate rejects the ADR — this is the regression the change must eliminate, and a
  check must assert the template no longer offers a value outside the allowlist.
- Given the skill contract and the template after this change, when they are compared, then they name
  the same terminal states, with no third vocabulary remaining.

### Done When
- [ ] `templates/adr.md.template` offers only allowlisted terminal states.
- [ ] `skills/architecture-review/SKILL.md` §7b names the same states as the template and parser.
- [ ] The repository validation suite (`test/test_harness_integrity.sh`) passes.
