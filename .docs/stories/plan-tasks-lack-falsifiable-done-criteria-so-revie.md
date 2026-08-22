**Status:** Accepted

# Stories: Review is bound by each plan task's Done when: criteria

Source: intake jstoup111/ai-conductor#1763 (outcomes 2–5), absorbing the shrink-or-file outcome of
#1718. Technical track — no PRD; requirements are the decisions D1–D6 of
`.docs/decisions/adr-2026-08-21-review-bound-by-plan-done-when-criteria.md`.

Terms: a **criterion** is one line of a plan task's `**Done when:**` block; a finding is **bound**
when it names the criterion the diff fails, **beyond** when the rubric judges it outside every
criterion of the task it concerns, and **unbound** when it carries no binding at all; a **beyond
record** is the engine's bookkeeping that a beyond finding was (or could not yet be) filed as intake.

## Story 1: A plan task without falsifiable criteria cannot land

**Requirement:** D1

As the operator landing a spec, I want a plan whose task lacks a `Done when:` block to be rejected at
land naming the task, so that an unfinishable task is caught before any build lap is spent on it.

### Acceptance Criteria

#### Happy Path
- Given a plan in which every task carries a `**Done when:**` block of 2–5 non-empty lines, when the spec is landed, then the land succeeds and no criteria-related message is printed.
- Given a plan whose `Done when:` block for a task sits inside a fenced code block as an example, when the spec is landed, then the fenced text is ignored and the task is judged on its real block.
- Given a Small-tier spec, when the spec is landed, then the criteria rung runs exactly as for Medium and Large.

#### Negative Paths
- Given a plan in which Task 3 has no `**Done when:**` block, when the spec is landed, then the land is rejected with a message naming Task 3 and the worktree is left intact for inspection.
- Given a plan whose Task 2 `Done when:` block has one line, when the spec is landed, then the land is rejected naming Task 2 and the minimum of two lines.
- Given a plan whose Task 5 `Done when:` block has six lines, when the spec is landed, then the land is rejected naming Task 5 and the maximum of five lines.
- Given a plan whose `Done when:` block is present but every line is blank or whitespace, when the spec is landed, then the land is rejected as if the block were absent.
- Given the single plan already merged on main that carries a `Done when:` block, when its block is run through the same rung, then it passes unchanged.
- Given the 300 merged plans on main that carry no `Done when:` block, when the daemon discovers and dispatches them, then none is blocked or skipped by this rung — it is a land-time gate only.

### Done When
- [ ] `landSpec` rejects a plan with a missing, under-length, over-length, or blank `Done when:` block, naming the offending task id in the error
- [ ] The parser lives beside the existing plan-task-block parsers and excludes fenced code before matching
- [ ] Neither daemon discovery nor the conductor plan gate invokes the rung

## Story 2: A criterion-bearing task is visible to every rubric

**Requirement:** D2

As a rubric grader, I want each task's criteria presented to me as engine-parsed evidence in my
projection, so that I can bind a finding to the exact criterion the diff fails.

### Acceptance Criteria

#### Happy Path
- Given a plan whose Task 4 carries three criteria, when a build_review lap is dispatched, then each of the four rubric projections carries the criteria for Task 4 as engine-parsed evidence keyed by task id.
- Given the Tautology rubric, when a lap is dispatched, then its projection also carries the plan body, as the other three rubrics' projections already do.
- Given a lap dispatched before and after this change against the same snapshot, when the projection digests are compared, then they differ once and every rubric is re-judged exactly one lap.

#### Negative Paths
- Given a plan with no `Done when:` block on any task, when a lap is dispatched, then the criteria evidence is present and empty, and the projection still validates.
- Given a plan whose criteria text contains Markdown emphasis or trailing whitespace, when parsed, then the evidence carries the normalized text so equal criteria hash equally.
- Given two tasks whose criteria lines are textually identical, when parsed, then each is distinguishable by task id and an occurrence ordinal rather than collapsing into one entry.

### Done When
- [ ] All four projections carry a criteria evidence field additively under the existing projection version; Tautology additionally carries the plan body
- [ ] A projection test proves the digest changes exactly once and pre-change stored verdicts still parse

## Story 3: A finding may bind to a criterion or declare itself beyond the task

**Requirement:** D2, D6

As a rubric grader, I want to state per finding either the criterion it fails or that it lies beyond
the task's criteria, so that the engine can tell a blocking finding from new substance.

### Acceptance Criteria

#### Happy Path
- Given a finding that names a criterion of the task it concerns as a content reference to that criterion's text, when the judged result is parsed, then the finding is accepted with that binding.
- Given a finding that declares itself beyond, when the judged result is parsed, then the finding is accepted as beyond.
- Given a finding with no binding at all, when the judged result is parsed, then the finding is accepted and treated as blocking exactly as before this change.
- Given two laps in which the same finding is bound on one and beyond on the other, when their identities are computed, then both laps produce the same finding id.

#### Negative Paths
- Given a finding whose binding names criterion text that does not exist in the lap's frozen plan snapshot, when the judged result is parsed, then the whole envelope is rejected, the lap is treated as absent and re-run, and no kickback or cap increment is recorded.
- Given a finding whose binding is a line number or hunk offset rather than a content reference, when parsed, then the envelope is rejected with a diagnosis listing the allowed forms.
- Given a finding whose binding references a criterion of a different task than the one the finding concerns, when parsed, then the envelope is rejected naming the mismatch.
- Given a judged result whose top-level fields are anything other than `findings`, when parsed, then it is rejected as today — the binding adds no top-level field.
- Given a rubric skill file whose result contract omits the binding grammar the parser enforces, when the rubric drift guard runs, then it fails naming that rubric.

### Done When
- [ ] The finding parser accepts a content-region binding or the beyond literal, rejects any other shape with a listing diagnosis, and keeps the binding out of the identity hash
- [ ] All four rubric SKILL.md result contracts state the grammar and the existing drift-guard test pins it
- [ ] The engine-rendered result shape shown to the provider includes the binding field

## Story 4: Beyond findings never block, and a lap of only beyond findings passes

**Requirement:** D3

As the build loop, I want a finding the rubric judged beyond the task's criteria to leave the blocking
set, so that a feature which satisfies its stated criteria converges instead of escalating.

### Acceptance Criteria

#### Happy Path
- Given a lap whose only findings are beyond, when the effective verdict is derived, then the verdict is PASS, the beyond findings are listed separately, no kickback is consumed, and no convergence counter advances.
- Given a lap with one bound finding and two beyond findings, when the effective verdict is derived, then only the bound finding is unresolved and the lap is FAIL.
- Given a later lap in which the previously bound finding is resolved and a new beyond finding appears, when the effective verdict is derived, then the lap is PASS — the blocking set shrank and the new substance did not grow it.

#### Negative Paths
- Given a finding with no binding, when the effective verdict is derived, then it is unresolved and blocks — absence is never read as beyond.
- Given an operator running the accept action against a beyond finding, when the action runs, then it is refused as it is today for anything that is not an unresolved finding.
- Given a lap graded against a stale base, when the fresh-base exit fires, then no beyond finding from that lap is recorded or filed.
- Given a rubric that could not be evaluated alongside another rubric whose findings are all beyond, when the effective verdict is derived, then the mechanical fault still blocks exactly as the mechanical lane decides — beyond never relaxes an infrastructure branch.
- Given a stored disposition written before this change, when the effective verdict is derived after it, then the disposition still binds — no contract version changed.

### Done When
- [ ] The effective verdict carries a separate list of beyond finding ids and PASS is derived from unresolved findings and uncovered infrastructure only
- [ ] Every engine exit that reads the effective verdict, re-derived by grep at implementation time, treats a beyond-only lap as a PASS lap
- [ ] The accept action's refusal for beyond findings is covered by a test

## Story 5: A beyond finding is recorded once and rendered where a reader will meet it

**Requirement:** D4

As an operator reading the lap evidence, I want each beyond finding recorded once under its finding
id with its filing state, so that new substance is visible, never silently dropped, and never filed twice.

### Acceptance Criteria

#### Happy Path
- Given a lap producing a beyond finding with no existing record, when the lap completes, then a beyond record for that finding id is appended in the feature's disposition store with status unfiled.
- Given a later lap re-raising the same beyond finding, when the lap completes, then no second record is appended.
- Given a feature reaching SHIP with two beyond records, when the retained PR body and shipped record are rendered, then both list each record with its finding summary and its issue URL or unfiled state.

#### Negative Paths
- Given a beyond record exists, when the reduced-coverage records for the feature are listed, then the beyond record is not among them.
- Given a beyond record that cannot be rendered, when the shipped record is produced, then completion blocks rather than omitting the record.
- Given the disposition store lease is held by another process, when the lap tries to append a beyond record, then the append fails closed with the lease message and the lap's verdict is unaffected.
- Given a beyond record hand-edited to an unknown status, when the store is read, then the store is reported malformed rather than the record being treated as filed.

### Done When
- [ ] A `beyond` record kind exists in the existing store with closed statuses, keyed by finding id, written by the engine after the lap
- [ ] `listReducedCoverage` returns only reduced-coverage records
- [ ] The PR-body and shipped-record renderers include beyond records fail-closed

## Story 6: The daemon files each unfiled beyond record as intake

**Requirement:** D5, D6

As the operator, I want beyond substance to arrive as a complete intake issue without my intervention,
so that it re-enters DECIDE through the normal route and never becomes a lap on this feature.

### Acceptance Criteria

#### Happy Path
- Given an unfiled beyond record, when the daemon's reconciliation runs, then one intake issue is created non-interactively with default size and priority, the record becomes filed with the issue URL, and a `build_review_beyond_filed` event with the feature, lap, rubric, finding id, and URL is persisted on the event spine.
- Given two unfiled records with different finding ids, when reconciliation runs, then two issues are created.
- Given a record already filed, when reconciliation runs again, then no issue is created and no event is emitted.

#### Negative Paths
- Given the intake ledger refuses the mutation, when reconciliation runs, then the record stays unfiled, the refusal is logged, and no issue is created.
- Given the tracker is unreachable, when reconciliation runs, then the record stays unfiled and the daemon's other reconciliations still run this cycle.
- Given an unfiled record whose source reference already exists in the intake ledger, when reconciliation runs, then the ledger's own dedup refuses a second issue and the record is marked filed with the existing issue.
- Given an unfiled record, when `conduct-ts build-review findings` is run for the feature, then the record is shown as unfiled with the finding summary so the operator has a lever.
- Given a filing that succeeds but the record stamp fails, when reconciliation next runs, then the ledger dedup prevents a duplicate issue and the stamp is retried.
- Given the conductor build loop, when it is inspected, then it holds no tracker dependency — filing never runs inside a lap.

### Done When
- [ ] A daemon reconciliation files unfiled beyond records through the existing intake filer with `interactive: false`, stamps the URL, and emits the new event with a persisted, audited sink row
- [ ] Ledger refusals and tracker errors leave the record unfiled and never block a lap
- [ ] `build-review findings` renders unfiled beyond records

## Story 7: A rubric judges delivery against the stated criteria and no further

**Requirement:** D6

As the operator, I want each rubric's contract to bind its findings to the task's criteria, so that a
concern beyond them is filed rather than raised as a blocking finding.

### Acceptance Criteria

#### Happy Path
- Given a task whose criteria are all satisfied by the diff and a rubric that notices a deeper concern, when the rubric judges, then the concern is emitted as a beyond finding, not a bound one.
- Given a task with a criterion the diff fails, when the rubric judges, then the finding is bound to that criterion.

#### Negative Paths
- Given a task with no `Done when:` block, when the rubric judges, then it emits findings without a binding and they block as before.
- Given a rubric contract edited to drop the binding instruction, when the drift guard runs, then it fails.

### Done When
- [ ] All four rubric SKILL.md files carry the binding instruction and grammar in their result contract section, with the existing calibration sections unchanged
