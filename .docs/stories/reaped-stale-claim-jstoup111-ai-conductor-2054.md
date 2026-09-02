**Status:** Accepted

# Stories: ADR Decision Citability Contract (issue #2054)

## Story 1: Shared parser is the single authority for citable decisions

As the engine, I want one `parseAdrDecisions` function to interpret an ADR's `## Decision` section so that every consumer agrees on which decisions are citable.

### Acceptance Criteria

#### Happy Path
- Given an APPROVED ADR whose Decision section uses numbered list items (`4. **Termination.**`), when `parseAdrDecisions` runs, then the returned id set contains `4`
- Given an APPROVED ADR using bolded D-headings (`**D4 — Termination.**`), when `parseAdrDecisions` runs, then the returned id set contains `4`
- Given an APPROVED ADR using ATX headings (`### D4 — Termination`, with optional emphasis such as `### **D4** — ...`), when `parseAdrDecisions` runs, then the returned id set contains `4`
- Given a Decision section where an additive amendment note introduces a further decision in an accepted shape, when `parseAdrDecisions` runs, then that decision's id appears in the id set

#### Negative Paths
- Given a Decision section whose only decision-shaped lines sit inside a fenced code block, when `parseAdrDecisions` runs, then those lines yield no ids and the result reports zero citable decisions
- Given an ADR with no `## Decision` heading, when `parseAdrDecisions` runs, then it returns a structural diagnostic naming the missing heading rather than an empty success
- Given a Decision section containing `D10` only, when decision `1` is looked up against the parsed id set, then it does not resolve (word-bounded ids, no prefix match)
- Given unparseable content (for example an unreadable file), when `parseAdrDecisions` runs, then the result is a fail-closed diagnostic, never a silent empty id set

### Done When
- [ ] `parseAdrDecisions` is exported from `src/conductor/src/engine/artifacts.ts` and returns a typed result: citable decision id set or structural diagnostic
- [ ] Unit tests cover all AB-R12 shapes, fence exclusion, word-bounded ids, headingless, and amendment-note fixtures drawn from real corpus files
- [ ] No other module in `src/conductor/src` matches decision shapes with its own regex

## Story 2: As-built resolver adopts the shared parser

As the as-built validation group, I want governing-clause resolution to use the shared parser and resolver contract so that a valid citation never halts needs-human because of parser shape gaps.

### Acceptance Criteria

#### Happy Path
- Given a REMEDIABLE finding citing `<stem> decision 4` where the APPROVED ADR's Decision section contains decision 4 in any accepted shape, when `resolveAsBuiltGoverningClause` runs, then it returns an adr-kind resolution
- Given the rewired resolver, when it resolves a decision reference, then the decision id set comes from `parseAdrDecisions` and the reference is matched through the shared reference-resolver contract of adr-2026-08-30

#### Negative Paths
- Given a citation naming a decision number absent from the parsed id set, when resolution runs, then it fails to resolve and the existing needs-human path reports the unresolvable clause
- Given a citation into an ADR that is not APPROVED, when resolution runs, then it does not resolve (approval gate unchanged)
- Given every ADR fixture the pre-change AB-R12 regex resolved, when the rewired resolver runs on it, then it still resolves (no regression)

### Done When
- [ ] The inline decision-shape regex in `resolveAsBuiltGoverningClause` is deleted; resolution goes through `parseAdrDecisions`
- [ ] Existing resolver tests (three AB-R12 shapes, emphasis stripping) pass unchanged
- [ ] A corpus no-silent-loss test runs the old regex and the new parser over every file in `.docs/decisions/` and proves nothing formerly resolvable became unresolvable

## Story 3: Land gate rejects new or edited APPROVED ADRs with no citable decision

As an operator, I want an uncitable ADR rejected at spec land so that the defect surfaces instantly instead of burning a validation lap later.

### Acceptance Criteria

#### Happy Path
- Given a spec diff adding an APPROVED ADR whose Decision section yields at least one citable decision, when `landSpec` runs, then the citability rung passes
- Given a spec diff adding an APPROVED ADR with zero citable decisions, when `landSpec` runs, then land fails with an error naming that ADR file and stating no citable decision was found

#### Negative Paths
- Given a spec diff touching no `adr-*.md` files while legacy APPROVED ADRs with headingless Decision sections exist in the corpus, when `landSpec` runs, then the citability rung raises nothing (diff-scoped, backwards compatible)
- Given a spec diff editing an existing ADR into an uncitable state, when `landSpec` runs, then land fails naming that file
- Given a citability failure, when the operator attempts to waive it, then no waiver path accepts it (evidentiary defect, non-waivable)
- Given a citability failure, when land refuses, then no tasks are appended and no other artifact is mutated (refuse-only)

### Done When
- [ ] A citability rung in `landSpec`'s existing ADR gate chain checks only `adr-*.md` files added or modified in the spec's own diff
- [ ] Unit tests cover pass, add-uncitable, edit-uncitable, and untouched-legacy-corpus cases
- [ ] The rejection message names the offending file and the missing-decision defect

## Story 4: Template names the accepted decision forms

As an ADR author, I want the template's Decision section to state the citable forms so that authoring per template can never produce an uncitable decision.

### Acceptance Criteria

#### Happy Path
- Given `templates/adr.md.template`, when an author reads the `## Decision` section, then it names the accepted citable forms with the numbered list recommended
- Given an ADR authored exactly per the updated template guidance, when `parseAdrDecisions` runs on it, then it yields at least one citable decision

#### Negative Paths
- Given the updated template, when its status vocabulary lines are compared with the pre-change template, then they are unchanged (adr-2026-08-08 ownership respected)
- Given the template's example decision-form text, when the harness integrity suite runs, then no gate misreads the examples as this template's own status or decisions (examples stay inert)

### Done When
- [ ] `templates/adr.md.template` `## Decision` section documents the accepted forms
- [ ] A test asserts a template-conforming sample ADR parses to a non-empty citable id set
