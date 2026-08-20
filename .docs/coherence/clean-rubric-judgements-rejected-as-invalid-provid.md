# Coherence Mapping: Clean rubric judgements rejected as invalid-provider-result

**Date:** 2026-08-19
**Issue:** #1683
**Tier:** M
**Track:** technical — the `fr` row class is omitted because there is no PRD and no enumerated
`FR-N` to tie out. On this track the stories carry acceptance criteria directly, and their
`**Requirement:**` lines cite the approved ADR decision each story derives from.
**Outcome source:** `.pipeline/intake-outcomes.md`, staged verbatim from the `## Desired outcome`
section of `jstoup111/ai-conductor#1683` — four bullets, indexed `outcome-1` … `outcome-4`.
**ADR change set:** two non-deleted `.docs/decisions/adr-*.md` files — the new
`adr-2026-08-19-engine-stamped-rubric-judged-result-envelope`, and
`adr-2026-08-13-engine-managed-build-review-rubric-branches`, whose §2 this spec amends additively.

Every `covered` verdict below was confirmed by reading the counterpart id in its own artifact file.
The consistency pass found no contradiction and no oscillation across the outcome/story/task/ADR
layers; the one cross-layer pair that could have oscillated — story 3's version override against
story 5's at-rest version preservation — is satisfiable by a single implementation and is bound by
the placement constraint recorded in `.docs/conflicts/2026-08-19-clean-rubric-judgements.md` and
restated in plan tasks 16 and 20.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-3 | covered | Story 1 accepts a findings-only payload via tasks 15, 16 and 18; story 2 stamps lap and snapshot identity via task 16.1; story 3 makes a provider-supplied envelope field non-load-bearing via task 17. |
| outcome | outcome-2 | story-2, story-4, story-5 | covered | Story 2's negatives keep at-rest staleness rejection and cache-hit restamping; story 4 adds an engine-side rubric invariant in place of the dropped echo; story 5 keeps cache identity and the provenance-key exclusion unchanged. |
| outcome | outcome-3 | story-6, story-7, story-8, story-1 | covered | The bullet names five candidate requirements. Under the approved design three of them — rubric, lap, snapshot — become structurally impossible rather than differently reported, so the surviving classes are parse and findings, and both are named. Per conflict-check Conflict 2 the failed requirement travels in the diagnostic detail; no member is added to the closed reason vocabulary owned by review-infrastructure-failures-are-operator-unreco. |
| outcome | outcome-4 | story-1, story-3, story-10 | covered | The envelope is engine-constructed, so it cannot vary between attempts; story 3 pins the recorded drifted shapes as accepted and story 10 removes the echo instruction from both prompts. |
| story | story-1 | task-15, task-16, task-18 | covered | Task 15 lands the RED assertion, task 16 the narrowed parse and stamp, task 18 the malformed-findings negatives and the reason-vocabulary pin. |
| story | story-2 | task-16.1 | covered | Task 16.1 stamps lap and snapshot identity from the projection and removes the two equality checks. Task 20 independently proves the stamp never reaches the at-rest parse, but it serves story 5 and is not counted here. |
| story | story-3 | task-17 | covered | Task 17 carries one assertion per recorded drift shape, including the status and type discriminators and the omitted-identity case. |
| story | story-4 | task-19 | covered | Task 19 implements the settlement invariant over two engine-held values and the concurrent four-rubric isolation assertion. |
| story | story-5 | task-20 | covered | Task 20 pins the version constant, pre-change cache hits, at-rest v1 and v2 parsing, and the unchanged projection digest. |
| story | story-6 | task-5, task-6, task-7 | covered | Task 5 replays the recorded halt payload, task 6 replaces the asserted cause with an honest unexplained report, task 7 is the regression net discharging architecture-review Condition 1. |
| story | story-7 | task-8, task-9 | covered | Task 8 proves each reference-membership class is undiagnosable today; task 9 binds the diagnosis to the projection's reference context and preserves the existing throw guard. |
| story | story-8 | task-10 | covered | Task 10 splits the anchor field check into absent, wrong-type and non-canonical, bounds the quoted value, and explicitly excludes the titled form that story 9 accepts. |
| story | story-9 | task-1, task-2, task-3, task-4 | covered | Task 1 pins identical identity, task 2 normalizes ahead of the existing reference kind, task 3 covers unrecoverable prose and membership, task 4 preserves duplicate collision. |
| story | story-10 | task-21 | covered | Task 21 updates all four rubric contracts and the rendered template and removes the echo instruction from the dispatch and repair prompts. |
| story | story-11 | task-11, task-12 | covered | Task 11 adds the byte-identical guard over the existing step retry budget; task 12 pins that the recorded diagnosis always describes the last payload validated. |
| story | story-12 | task-13, task-14 | covered | Task 13 reproduces the unstated-grammar gap as a failing fixture; task 14 extends the drift guard in both directions and fails closed on an unreadable source. |
| task | task-1 | story-9 | covered | RED assertion that titled and bare plan-task references share one identity. |
| task | task-2 | story-9 | covered | Normalization ahead of the existing plan-task reference kind. |
| task | task-3 | story-9 | covered | Unrecoverable prose rejected; a normalized-but-absent id fails on membership. |
| task | task-4 | story-9 | covered | Duplicate-identity rejection preserved under normalization. |
| task | task-5 | story-6 | covered | RED replay of the recorded 2026-08-19 completeness payload. |
| task | task-6 | story-6 | covered | An unexplained rejection reports itself as unexplained. |
| task | task-7 | story-6 | covered | Regression net over every previously enumerated cause, including the genuine verdict contradiction. |
| task | task-8 | story-7 | covered | RED assertions for each reference-membership failure class. |
| task | task-9 | story-7 | covered | The diagnosis receives the projection's reference context. |
| task | task-10 | story-8 | covered | Anchor failures distinguished by kind and named with the required form. |
| task | task-11 | story-11 | covered | A byte-identical repair settles without consuming step retries. |
| task | task-12 | story-11 | covered | The recorded diagnosis describes the payload actually rejected. |
| task | task-13 | story-12 | covered | Failing fixture reproducing the unstated-grammar gap. |
| task | task-14 | story-12 | covered | Drift guard extended to reference grammars, both directions, fail-closed. |
| task | task-15 | story-1 | covered | RED assertions that a findings-only payload must settle. |
| task | task-16 | story-1 | covered | Narrowed wire parse and the kind, rubric and contractVersion stamp, applied on the dispatch path only. |
| task | task-16.1 | story-2 | covered | Lap and snapshot identity stamped from the projection; the identity equality checks removed. |
| task | task-17 | story-3 | covered | Each recorded drifted envelope settles as judged. |
| task | task-18 | story-1 | covered | Malformed findings still reject the whole result; the closed reason vocabulary is pinned unchanged. |
| task | task-19 | story-4 | covered | The settlement rubric invariant and its concurrency assertion. |
| task | task-20 | story-5 | covered | The version constant, cache hits, at-rest parsing and stamp placement. |
| task | task-21 | story-10 | covered | Rubric contracts and rendered template declare a findings-only payload. |
| adr | adr-2026-08-19-engine-stamped-rubric-judged-result-envelope | story-1, story-2, story-3, story-4, story-5, story-6, story-7, story-8, story-9, story-10, story-11, story-12 | covered | D1 and D2 are implemented by stories 1 and 2, D3 by story 5, D4 by story 3, D5 by story 4, D6 by stories 6 through 8, D7 by story 11, D9 by story 9, and D10 by stories 10 and 12. D8 is a conformance ruling that constrains story 1 rather than adding behavior, and is honoured by the reason-vocabulary pin in task 18. |
| adr | adr-2026-08-13-engine-managed-build-review-rubric-branches | story-1, story-2, story-3 | covered | Its §2 echo requirement is amended additively by the new ADR and the amendment is already committed on this branch. The property that ADR protected — every branch result carries the lap and snapshot it was judged under — is preserved by story 2; only the writer changes. Its closed-projection principle, lap-ID binding and §7 cache identity are untouched. |
