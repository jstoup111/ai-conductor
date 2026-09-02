# Coherence Mapping: ADR Decision Citability Contract (issue #2054)

Technical track — no `fr` rows. Outcomes staged from jstoup111/ai-conductor#2054.

| Row class | Cited id(s) / Criterion | Counterpart / Task id(s) | Verdict | Notes / Quote | Disposition |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-4 | covered | Template-conforming ADR always citable |
| outcome | outcome-2 | story-3 | covered | Uncitable shape rejected at land naming the offender |
| outcome | outcome-3 | | gap | outcome-3 — legacy headingless ADRs deliberately out of scope per ADR decision 7 and the operator backwards-compat constraint; waiver at .docs/coherence-waivers/reaped-stale-claim-jstoup111-ai-conductor-2054.md |
| outcome | outcome-4 | story-1 | covered | Single parser authority; consumers never re-derive shapes |
| story | story-1 | task-1, task-2, task-3 | covered | Parser shapes, hygiene, amendments |
| story | story-2 | task-4, task-5 | covered | Corpus test and resolver rewire |
| story | story-3 | task-6, task-7 | covered | Gate rung and its negatives |
| story | story-4 | task-8 | covered | Template guidance |
| task | task-1 | story-1 | covered |  |
| task | task-2 | story-1 | covered |  |
| task | task-3 | story-1 | covered |  |
| task | task-4 | story-2 | covered |  |
| task | task-5 | story-2 | covered |  |
| task | task-6 | story-3 | covered |  |
| task | task-7 | story-3 | covered |  |
| task | task-8 | story-4 | covered |  |
| adr | adr-2026-09-02-adr-decision-citability-contract | story-1, story-2, story-3, story-4 | covered | Decisions 1-3 → stories 1-2; decision 4 → story 3; decision 5 → story 4 |
| criterion | Story 1 happy: Given an APPROVED ADR whose Decision section uses numbered list items (`4. **Termination.**`), when `parseAdrDecisions` runs, then the returned id set contains `4` | task-1 | covered | 4. **Termination.** | diff-local |
| criterion | Story 1 happy: Given an APPROVED ADR using bolded D-headings (`**D4 — Termination.**`), when `parseAdrDecisions` runs, then the returned id set contains `4` | task-1 | covered | **D4 — Termination.** | diff-local |
| criterion | Story 1 happy: Given an APPROVED ADR using ATX headings (`### D4 — Termination`, with optional emphasis such as `### **D4** — ...`), when `parseAdrDecisions` runs, then the returned id set contains `4` | task-1 | covered | ### D4 — Termination | diff-local |
| criterion | Story 1 happy: Given a Decision section where an additive amendment note introduces a further decision in an accepted shape, when `parseAdrDecisions` runs, then that decision's id appears in the id set | task-3 | covered | introduces decision 8 parses to a set containing `8` | diff-local |
| criterion | Story 1 negative: Given a Decision section whose only decision-shaped lines sit inside a fenced code block, when `parseAdrDecisions` runs, then those lines yield no ids and the result reports zero citable decisions | task-2 | covered | decision-shaped lines inside a fenced code block yield no ids | diff-local |
| criterion | Story 1 negative: Given an ADR with no `## Decision` heading, when `parseAdrDecisions` runs, then it returns a structural diagnostic naming the missing heading rather than an empty success | task-2 | covered | returns a diagnostic naming the missing heading | diff-local |
| criterion | Story 1 negative: Given a Decision section containing `D10` only, when decision `1` is looked up against the parsed id set, then it does not resolve (word-bounded ids, no prefix match) | task-2 | covered | a section with only `D10` does not contain id `1` | diff-local |
| criterion | Story 1 negative: Given unparseable content (for example an unreadable file), when `parseAdrDecisions` runs, then the result is a fail-closed diagnostic, never a silent empty id set | task-2 | covered | distinct from a parse failure | diff-local |
| criterion | Story 2 happy: Given a REMEDIABLE finding citing `<stem> decision 4` where the APPROVED ADR's Decision section contains decision 4 in any accepted shape, when `resolveAsBuiltGoverningClause` runs, then it returns an adr-kind resolution | task-5 | covered | resolve the cited decision number against `parseAdrDecisions`' id set | diff-local |
| criterion | Story 2 happy: Given the rewired resolver, when it resolves a decision reference, then the decision id set comes from `parseAdrDecisions` and the reference is matched through the shared reference-resolver contract of adr-2026-08-30 | task-5 | covered | delete the inline decision-shape regex and AB-R12 comment | diff-local |
| criterion | Story 2 negative: Given a citation naming a decision number absent from the parsed id set, when resolution runs, then it fails to resolve and the existing needs-human path reports the unresolvable clause | task-5 | covered | a decision number absent from the set does not resolve | diff-local |
| criterion | Story 2 negative: Given a citation into an ADR that is not APPROVED, when resolution runs, then it does not resolve (approval gate unchanged) | task-5 | covered | All pre-existing resolver tests pass without modification | diff-local |
| criterion | Story 2 negative: Given every ADR fixture the pre-change AB-R12 regex resolved, when the rewired resolver runs on it, then it still resolves (no regression) | task-4 | covered | asserts `parseAdrDecisions` also yields that id | diff-local |
| criterion | Story 3 happy: Given a spec diff adding an APPROVED ADR whose Decision section yields at least one citable decision, when `landSpec` runs, then the citability rung passes | task-6 | covered | a spec diff adding an APPROVED ADR with a numbered decision passes the rung | diff-local |
| criterion | Story 3 happy: Given a spec diff adding an APPROVED ADR with zero citable decisions, when `landSpec` runs, then land fails with an error naming that ADR file and stating no citable decision was found | task-6 | covered | fails land with an error naming the file | diff-local |
| criterion | Story 3 negative: Given a spec diff touching no `adr-*.md` files while legacy APPROVED ADRs with headingless Decision sections exist in the corpus, when `landSpec` runs, then the citability rung raises nothing (diff-scoped, backwards compatible) | task-7 | covered | a spec diff touching no ADR files lands cleanly | diff-local |
| criterion | Story 3 negative: Given a spec diff editing an existing ADR into an uncitable state, when `landSpec` runs, then land fails naming that file | task-6 | covered | editing an existing ADR into an uncitable state fails naming the file | diff-local |
| criterion | Story 3 negative: Given a citability failure, when the operator attempts to waive it, then no waiver path accepts it (evidentiary defect, non-waivable) | task-7 | covered | the failure path offers no waiver hook | diff-local |
| criterion | Story 3 negative: Given a citability failure, when land refuses, then no tasks are appended and no other artifact is mutated (refuse-only) | task-7 | covered | land mutates no artifacts and appends no tasks | diff-local |
| criterion | Story 4 happy: Given `templates/adr.md.template`, when an author reads the `## Decision` section, then it names the accepted citable forms with the numbered list recommended | task-8 | covered | name the accepted citable forms, recommending the numbered list | diff-local |
| criterion | Story 4 happy: Given an ADR authored exactly per the updated template guidance, when `parseAdrDecisions` runs on it, then it yields at least one citable decision | task-8 | covered | parses to a non-empty citable id set | diff-local |
| criterion | Story 4 negative: Given the updated template, when its status vocabulary lines are compared with the pre-change template, then they are unchanged (adr-2026-08-08 ownership respected) | task-8 | covered | byte-identical to the pre-change template | diff-local |
| criterion | Story 4 negative: Given the template's example decision-form text, when the harness integrity suite runs, then no gate misreads the examples as this template's own status or decisions (examples stay inert) | task-8 | covered | confirm no gate misreads the examples | diff-local |
