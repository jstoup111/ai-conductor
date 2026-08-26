# Coherence: coherence-rows-assert-story-task-coverage-that-not (#1799)

Tier L, technical track (no PRD — `fr` rows omitted). Outcomes are the five staged Desired-outcome
bullets from jstoup111/ai-conductor#1799. The ADR layer engages on four non-deleted
`.docs/decisions/adr-*` files in the change set: three authored here plus the additively amended
`adr-2026-08-09`. Every counterpart id was confirmed against the real stories and plan files. The
§4d cross-layer consistency pass found no contradiction; the two pairs that warranted grounding are
recorded in the Notes for `outcome-3` and `outcome-4`.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-2 | covered | An unsupported coverage claim is rejected naming criterion and task: Story 2's grounding criteria, delivered by tasks 11-15 with the #1799 exemplar as a regression fixture (15). |
| outcome | outcome-2 | story-1 | covered | Every accepted criterion owned before the plan lands: Story 1's one-to-one coverage, delivered by tasks 6-9 using the engine's own extractor (10 proves the shared call). |
| outcome | outcome-3 | story-3 | covered | Criteria pinned to state outside the diff are rejected: Story 3, tasks 16-17. Cross-layer check — the bullet says "when the plan is authored" while enforcement lands at `engineer land`; task 22 puts the question into the plan-authoring skill so the answer is authored at plan time and enforced at the end of DECIDE. Both precede BUILD, so the bullet's intent holds; recorded here because the wording and the mechanism differ. |
| outcome | outcome-4 | story-3, story-5 | covered | A clean plan still passes and a deferral stays recordable: task 24 proves a fully grounded, diff-local table yields zero gaps; Story 5's waiver path (task 18) keeps a deliberate deferral auditable. Cross-layer check — "no new ceremony" is satisfied as no added operator interaction on a clean spec, not as zero added fields; the two new per-row fields are the authoring cost the design accepts and do not contradict the bullet. |
| outcome | outcome-5 | story-6 | covered | A late-discovered gap names the plan-time check: Story 6, task 21, with task 23 keeping the pre-existing message for specs that predate the check. |
| story | story-1 | task-2, task-5, task-6, task-7, task-8, task-9, task-10 | covered | All nine criteria mapped: row parsing (2), structural engagement with the tier-S and legacy escapes (5), omitted/invented/duplicate/unparseable rejections (6-9), shared-extractor proof (10, verify-only). |
| story | story-2 | task-1, task-11, task-12, task-13, task-14, task-15 | covered | All nine criteria mapped: task-body extractor (1), grounding accept and multi-task citation (11), whitespace normalization and paraphrase rejection (12), absent-quote rejection naming criterion and task (13), unresolvable and empty citations (14), exemplar and stale-quote regressions (15). |
| story | story-3 | task-4, task-16, task-17, task-22, task-24 | covered | All seven criteria mapped: closed disposition union (4), presence and non-negativity with the no-keyword-heuristic assertion (16), census regression (17), skill contract (22), clean-spec happy path (24). |
| story | story-4 | task-19, task-20 | covered | All six criteria mapped: legacy artifact valid at discovery and no blocked item (19), discovery check provably unmodified (20, verify-only). |
| story | story-5 | task-3, task-18 | covered | All seven criteria mapped: unknown criterion verdict rejected rather than defaulted affirmative (3), gap ids registered with partial-coverage and freshness cases (18). |
| story | story-6 | task-21, task-23 | covered | All five criteria mapped: conditional message and predicate purity (21), byte-identical legacy message and invented/omitted distinction (23). |
| task | task-1 | story-2 | covered | Infrastructure task; supplies the task-body text that Story 2's quote grounding resolves against. |
| task | task-2 | story-1 | covered | Infrastructure task; parses the criterion row class every Story 1 check consumes. |
| task | task-3 | story-5 | covered | Rejects an unrecognized criterion verdict; asserts the legacy classes keep affirmative-by-default. |
| task | task-4 | story-3 | covered | Closes the diff-locality vocabulary with an explicit non-negative subset and no catch-all branch. |
| task | task-5 | story-1 | covered | Adds `criterion` to the structural layer set, inheriting both pre-existing escapes unchanged. |
| task | task-6 | story-1 | covered | One-to-one set difference against `extractAuthoritativeStoryCriteria`; omitted criterion named verbatim. |
| task | task-7 | story-1 | covered | Invented row rejected and reported distinctly from an omitted criterion. |
| task | task-8 | story-1 | covered | Duplicate criterion rows rejected before the set difference collapses them. |
| task | task-9 | story-1 | covered | Zero extracted criteria from a non-empty stories file is a rejection, not full coverage. |
| task | task-10 | story-1 | covered | Verify-only; proves the gate and `acceptance_specs` derive an identical criterion set. |
| task | task-11 | story-2 | covered | Quote grounding accepts a span present in a cited task; no file read beyond the loaded plan. |
| task | task-12 | story-2 | covered | Whitespace normalization accepted, one-word paraphrase rejected. |
| task | task-13 | story-2 | covered | Absent quote rejected with both the criterion and the attributed task id in the message. |
| task | task-14 | story-2 | covered | Unknown cited task id and empty quote rejected with distinct messages. |
| task | task-15 | story-2 | covered | Regression fixtures for the #1799 exemplar and the stale-quote case. |
| task | task-16 | story-3 | covered | Requires a present, non-negative disposition; asserts no code path inspects criterion prose for corpus keywords. |
| task | task-17 | story-3 | covered | Census criterion recovered verbatim from the pre-cancellation commit as a fixture. |
| task | task-18 | story-5 | covered | Every criterion rejection class emits a waivable stable id; partial-coverage and freshness cases covered. |
| task | task-19 | story-4 | covered | Legacy artifact valid under the discovery check and produces no blocked item. |
| task | task-20 | story-4 | covered | Verify-only; proves the diff leaves the discovery-side coherence branch untouched. |
| task | task-21 | story-6 | covered | Conditional halt message with the completion predicate left a pure read. |
| task | task-22 | story-3 | covered | Infrastructure task; specifies the criterion row contract and the diff-locality question in the two skill files. |
| task | task-23 | story-6 | covered | Legacy halt message asserted byte-identical against a captured fixture. |
| task | task-24 | story-3 | covered | A fully grounded, diff-local criterion table yields zero gaps through the real gate facade. |
| adr | adr-2026-08-23-criterion-layer-is-structural-at-land | story-1, story-4 | covered | Structural engagement is Story 1's criteria and task 5; the decision's binding backwards-compatibility clause is Story 4's criteria and tasks 19-20. |
| adr | adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote | story-2 | covered | The author-judges / engine-verifies split is Story 2's criteria; the exact-substring mechanism the ADR fixes is named in task 12's steps. |
| adr | adr-2026-08-23-diff-locality-is-an-authored-disposition | story-3 | covered | The authored-disposition decision and its explicit rejection of keyword heuristics are Story 3's criteria and task 16's third check. |
| adr | adr-2026-08-09-adr-layer-gated-by-committed-adr-signal | story-1, story-4 | covered | Amended additively on this branch to narrow signal-gating to variable-tracking row classes. Story 1 exercises the narrowed rule for `criterion`; Story 4 preserves the retroactivity guarantee the original decision protects. |
