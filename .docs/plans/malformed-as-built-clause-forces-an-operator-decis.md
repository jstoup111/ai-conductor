# Implementation Plan: malformed-as-built-clause-forces-an-operator-decis

**Date:** 2026-09-18
**Stories:** .docs/stories/malformed-as-built-clause-forces-an-operator-decis.md
**Conflict check:** Not required (Tier S)

## Summary
Make the SHIP as-built governing-clause resolver accept dotted decision cites (`adr-x D5.2`) as their whole decision and state that rule in the architecture-review contract. 3 tasks. Source: jstoup111/ai-conductor#2424.

## Technical Approach
- `resolveAsBuiltGoverningClause` (`src/conductor/src/engine/conductor.ts`) anchors the ADR form on `(\d+)$`, so `D5.2` fails before any ADR lookup and every such REMEDIABLE finding becomes a `needs-human` halt at the unresolvable-clause site. `parseAdrDecisions` (`src/conductor/src/engine/artifacts.ts`) already collapses a `D5.2` heading to id `5`; the resolver adopts the same collapse by allowing an optional `(?:\.\d+)*` tail. Nothing else in the route changes: an undeclared decision, a non-numeric tail, a DRAFT ADR, and a DESIGN row keep their current outcome.
- The task-id branch runs first and is untouched, so `Task 5.2` still resolves as a plan task.
- Tests live next to the existing governing-clause cases in `src/conductor/test/prd-audit-kickback.test.ts` (search `resolves a governing clause against`); reuse their APPROVED-ADR fixture shape, varying only the cited clause.
- The skill contract sentence lands in `skills/architecture-review/SKILL.md`; `test/test_harness_integrity.sh` validates the file.

## Prerequisites
- none

## Tasks

### Task 1: Dotted decision cites resolve to the whole ADR decision
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/prd-audit-kickback.test.ts` next to `resolves a governing clause against a D-heading ADR decision`: an APPROVED ADR fixture declaring `### D5` resolves `<stem> D5.2`, `<stem> decision 5.2`, and `<stem> + 5.2` to `{ kind: 'adr' }`, and the existing `<stem> D5` / `<stem> decision 5` cases still resolve
2. Verify test fails (RED): the three dotted cites return null
3. Implement: in `resolveAsBuiltGoverningClause` (`src/conductor/src/engine/conductor.ts`) change the ADR regex tail from `(\d+)$` to `(\d+)(?:\.\d+)*$` so a dotted subsection collapses to its integer decision id, matching `parseAdrDecisions`'s collapse of `D5.2` headings; extend the regex comment with the #2424 rationale
4. Verify test passes (GREEN)
5. Commit: "fix(as-built): resolve dotted decision cites to the whole ADR decision (#2424)"

**Done when:**
- `resolveAsBuiltGoverningClause` returns `{ kind: 'adr' }` for `<stem> D5.2`, `<stem> decision 5.2`, and `<stem> + 5.2` against an APPROVED ADR declaring decision 5, asserted by the new dotted-cite test in `src/conductor/test/prd-audit-kickback.test.ts`
- the same test asserts `<stem> D5` and `<stem> decision 5` return the identical `{ kind: 'adr' }` resolution, and the four existing governing-clause tests at `resolves a governing clause against…` pass unchanged

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — dotted-subsection tail on the ADR clause regex
- src/conductor/test/prd-audit-kickback.test.ts — dotted-cite resolution test

**Dependencies:** none

### Task 2: Undeclared, non-numeric, DRAFT, and task-shaped dotted cites keep their current outcome
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test in `src/conductor/test/prd-audit-kickback.test.ts`: against an APPROVED ADR declaring D1–D4, `<stem> D9.1` returns null; against an ADR declaring D5, `<stem> D5.a` and `<stem> D5.` return null; against a DRAFT-status ADR declaring D5, `<stem> D5.2` returns null; with a plan containing `### Task 5.2`, `Task 5.2` returns `{ kind: 'plan-task', parentTask: '5.2' }`
2. Add a conductor-level assertion (reuse the fixture shape of `constructs clause-bound as-built gaps and projects every remediated lap`) that a BLOCKED report citing `<stem> D9.1` halts `needs-human` with detail containing `AB-1: <stem> D9.1`
3. Verify which assertions fail (RED) — with Task 1 landed the null cases may already pass; record that in the commit body
4. Implement: no production change expected beyond Task 1's regex; if `D5.` or `D5.a` resolves, tighten the tail to `(\d+)(?:\.\d+)*$` with no trailing `.`
5. Verify test passes (GREEN)
6. Commit: "test(as-built): dotted cites outside the declared decision set stay unresolvable (#2424)"

**Done when:**
- `resolveAsBuiltGoverningClause` returns null for `<stem> D9.1` against an APPROVED ADR declaring only D1–D4, for `<stem> D5.a` and `<stem> D5.`, and for `<stem> D5.2` against a DRAFT-status ADR, asserted by the new negative dotted-cite test in `src/conductor/test/prd-audit-kickback.test.ts`
- the remediation route halts `needs-human` with detail containing `AB-1: <stem> D9.1` for a BLOCKED report citing an undeclared dotted decision, asserted by the conductor-level test
- `resolveAsBuiltGoverningClause` returns `{ kind: 'plan-task', parentTask: '5.2' }` for `Task 5.2` when the active plan declares task `5.2`, asserted by the same test

**Files likely touched:**
- src/conductor/test/prd-audit-kickback.test.ts — negative dotted-cite tests
- src/conductor/src/engine/conductor.ts — only if the tail needs tightening

**Dependencies:** Task 1

### Task 3: As-built review contract states the whole-decision cite rule
**Story:** 2
**Type:** happy-path

**Steps:**
1. Edit the `Governing clause` paragraph in the as-built `## Blocking Findings` contract of `skills/architecture-review/SKILL.md`: after the existing `adr-x decision 3` / `adr-x D3` sentence add, in bare prose, that a clause cites a whole decision, and that a subsection form such as `adr-x D3.2` resolves to decision 3 (the resolver collapses the dotted tail the same way the ADR parser collapses a `D3.2` heading)
2. Run `test/test_harness_integrity.sh` from the repository root and confirm section 2 (SKILL.md frontmatter) and the reference checks pass
3. Commit: "docs(architecture-review): dotted decision cites resolve to the whole decision (#2424)"

**Done when:**
- the `Governing clause` paragraph of `skills/architecture-review/SKILL.md` contains the whole-decision rule and the sentence that `adr-x D3.2` resolves to decision 3, verifiable by `grep -n 'D3.2' skills/architecture-review/SKILL.md` returning one line inside the Blocking Findings contract
- `test/test_harness_integrity.sh` exits 0 on the amended skill file

**Files likely touched:**
- skills/architecture-review/SKILL.md — Governing clause paragraph

**Dependencies:** none

## Task Dependency Graph
Task 1 → Task 2
Task 3 (independent)

## Integration Points
- After Task 1: a BLOCKED as-built report citing `<stem> D5.2` against an APPROVED ADR enters the bounded remediation route instead of halting needs-human.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an APPROVED ADR `adr-x` whose `## Decision` section declares decision 5, when a REMEDIABLE row cites `adr-x D5.2`, then the resolver returns an ADR resolution for decision 5 and the finding enters the bounded remediation route | 1 | "`resolveAsBuiltGoverningClause` returns `{ kind: 'adr' }` for `<stem> D5.2`, `<stem> decision 5.2`, and `<stem> + 5.2` against an APPROVED ADR declaring decision 5, asserted by the new dotted-cite test in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 happy: Given the same ADR, when a REMEDIABLE row cites `adr-x decision 5.2` or `adr-x + 5.2`, then the resolver returns the same ADR resolution as for `adr-x decision 5` | 1 | "`resolveAsBuiltGoverningClause` returns `{ kind: 'adr' }` for `<stem> D5.2`, `<stem> decision 5.2`, and `<stem> + 5.2` against an APPROVED ADR declaring decision 5, asserted by the new dotted-cite test in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 happy: Given the same ADR, when a REMEDIABLE row cites `adr-x D5` or `adr-x decision 5`, then the resolver returns an ADR resolution for decision 5 exactly as before this change | 1 | "`resolveAsBuiltGoverningClause` returns `{ kind: 'adr' }` for `<stem> D5.2`, `<stem> decision 5.2`, and `<stem> + 5.2` against an APPROVED ADR declaring decision 5, asserted by the new dotted-cite test in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 negative: Given an APPROVED ADR `adr-x` that declares decisions 1 through 4 only, when a REMEDIABLE row cites `adr-x D9.1`, then the resolver returns null and the SHIP route halts needs-human naming `adr-x D9.1` in the unresolvable-clause detail | 2 | "the remediation route halts `needs-human` with detail containing `AB-1: <stem> D9.1` for a BLOCKED report citing an undeclared dotted decision, asserted by the conductor-level test" | diff-local |
| Story 1 negative: Given an APPROVED ADR `adr-x` that declares decision 5, when a REMEDIABLE row cites `adr-x D5.a` or `adr-x D5.`, then the resolver returns null and the route halts needs-human naming the clause verbatim | 2 | "`resolveAsBuiltGoverningClause` returns null for `<stem> D9.1` against an APPROVED ADR declaring only D1–D4, for `<stem> D5.a` and `<stem> D5.`, and for `<stem> D5.2` against a DRAFT-status ADR, asserted by the new negative dotted-cite test in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 negative: Given an ADR `adr-x` whose status is DRAFT, when a REMEDIABLE row cites `adr-x D5.2`, then the resolver returns null exactly as it does for `adr-x D5` | 2 | "`resolveAsBuiltGoverningClause` returns null for `<stem> D9.1` against an APPROVED ADR declaring only D1–D4, for `<stem> D5.a` and `<stem> D5.`, and for `<stem> D5.2` against a DRAFT-status ADR, asserted by the new negative dotted-cite test in `src/conductor/test/prd-audit-kickback.test.ts`" | diff-local |
| Story 1 negative: Given an active plan containing task `5.2`, when a REMEDIABLE row cites `Task 5.2`, then the resolver returns the plan-task resolution for task `5.2` and never an ADR resolution | 2 | "`resolveAsBuiltGoverningClause` returns `{ kind: 'plan-task', parentTask: '5.2' }` for `Task 5.2` when the active plan declares task `5.2`, asserted by the same test" | diff-local |
| Story 2 happy: Given a reviewer reading the as-built section of `skills/architecture-review/SKILL.md`, when they reach the `Governing clause` rule, then the text states that the cite names a whole decision (`adr-x decision 3` or `adr-x D3`) and that a subsection form such as `adr-x D3.2` resolves to decision 3 | 3 | "the `Governing clause` paragraph of `skills/architecture-review/SKILL.md` contains the whole-decision rule and the sentence that `adr-x D3.2` resolves to decision 3, verifiable by `grep -n 'D3.2' skills/architecture-review/SKILL.md` returning one line inside the Blocking Findings contract" | diff-local |
| Story 2 negative: Given the skill validation suite (`test/test_harness_integrity.sh` skill checks), when the amended SKILL.md is checked, then the suite passes with no new failure attributable to the amended section | 3 | "`test/test_harness_integrity.sh` exits 0 on the amended skill file" | diff-local |


## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
