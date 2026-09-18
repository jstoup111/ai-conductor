**Status:** Accepted

# Stories: malformed-as-built-clause-forces-an-operator-decis

Technical track (no PRD). Source: issue jstoup111/ai-conductor#2424. Tier S. Scope boundary: the
as-built governing-clause resolver collapses a dotted decision cite to its whole decision, mirroring
the ADR parser's existing collapse of dotted headings; the architecture-review skill contract states
that whole-decision cites are preferred and that a dotted cite resolves to its whole decision. No new
halt class, no as-built mechanical-fault allowance, no change to DESIGN or unknown-ADR halts.

## Story 1: A dotted decision cite resolves to its whole ADR decision

As the SHIP as-built remediation route, I want a REMEDIABLE row whose governing clause cites a
decision subsection (`adr-x D5.2`, `adr-x decision 5.2`) to resolve to decision 5 so that a
reviewer output-format variance does not become a needs-human halt on work the approved ADR already
requires.

### Acceptance Criteria

#### Happy Path
- Given an APPROVED ADR `adr-x` whose `## Decision` section declares decision 5, when a REMEDIABLE row cites `adr-x D5.2`, then the resolver returns an ADR resolution for decision 5 and the finding enters the bounded remediation route
- Given the same ADR, when a REMEDIABLE row cites `adr-x decision 5.2` or `adr-x + 5.2`, then the resolver returns the same ADR resolution as for `adr-x decision 5`
- Given the same ADR, when a REMEDIABLE row cites `adr-x D5` or `adr-x decision 5`, then the resolver returns an ADR resolution for decision 5 exactly as before this change

#### Negative Paths
- Given an APPROVED ADR `adr-x` that declares decisions 1 through 4 only, when a REMEDIABLE row cites `adr-x D9.1`, then the resolver returns null and the SHIP route halts needs-human naming `adr-x D9.1` in the unresolvable-clause detail
- Given an APPROVED ADR `adr-x` that declares decision 5, when a REMEDIABLE row cites `adr-x D5.a` or `adr-x D5.`, then the resolver returns null and the route halts needs-human naming the clause verbatim
- Given an ADR `adr-x` whose status is DRAFT, when a REMEDIABLE row cites `adr-x D5.2`, then the resolver returns null exactly as it does for `adr-x D5`
- Given an active plan containing task `5.2`, when a REMEDIABLE row cites `Task 5.2`, then the resolver returns the plan-task resolution for task `5.2` and never an ADR resolution

### Done When
- [ ] `resolveAsBuiltGoverningClause` in `src/conductor/src/engine/conductor.ts` resolves `adr-x D5.2`, `adr-x decision 5.2`, and `adr-x + 5.2` to decision 5 when decision 5 is declared in the APPROVED ADR
- [ ] A unit test asserts that `adr-x D9.1` against an ADR without decision 9, `adr-x D5.a`, and a DRAFT ADR all return null, and that `Task 5.2` still resolves as a plan task
- [ ] The existing `adr-x D5` and `adr-x decision 5` resolver tests pass unchanged

## Story 2: The as-built review contract states the whole-decision cite rule

As the architecture-review skill, I want the as-built `## Blocking Findings` contract to say that a
governing clause cites a whole decision and that a dotted subsection cite resolves to its whole
decision so that reviewers write the resolvable form and know what a dotted cite means.

### Acceptance Criteria

#### Happy Path
- Given a reviewer reading the as-built section of `skills/architecture-review/SKILL.md`, when they reach the `Governing clause` rule, then the text states that the cite names a whole decision (`adr-x decision 3` or `adr-x D3`) and that a subsection form such as `adr-x D3.2` resolves to decision 3

#### Negative Paths
- Given the skill validation suite (`test/test_harness_integrity.sh` skill checks), when the amended SKILL.md is checked, then the suite passes with no new failure attributable to the amended section

### Done When
- [ ] `skills/architecture-review/SKILL.md`'s `Governing clause` paragraph carries the whole-decision preference and the dotted-cite collapse rule in bare prose
- [ ] `test/test_harness_integrity.sh` passes on the changed skill file
