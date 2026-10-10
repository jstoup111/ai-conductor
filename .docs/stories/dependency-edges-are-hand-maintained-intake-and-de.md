**Status:** Accepted

# Stories: Machine-Authored and Machine-Verified Issue Dependency Edges (#536)

**PRD:** .docs/specs/2026-10-09-dependency-edges-are-hand-maintained-intake-and-de.md
**ADRs:** adr-2026-10-09-dependency-reconciler-and-edge-write-ownership, adr-2026-10-09-dependency-drift-sweep-on-intake-tick
**Source-Ref:** jstoup111/ai-conductor#536

---

## Story 1: A prose dependency declaration in a newly opened issue becomes a blocked-by link

**Requirement:** FR-1, FR-5

As an operator filing an issue, I want "blocked by #N" in the body to gate the issue, so that I don't have to link it by hand.

Scenarios in Stories 1–3 concern issues the harness is authorized to modify, meaning issues assigned exclusively to the operator. Story 4 covers refusal.

### Acceptance Criteria

#### Happy Path
- Given open issue #10 exists in the same repository, when a non-form issue #20 is opened with body "This is blocked by #10.", then #20's blocked-by list contains #10.
- Given issues #10 and #11 exist, when issue #20 is opened with body "Depends on: #10 / #11", then #20's blocked-by list contains both #10 and #11.
- Given issue #10 exists, when issue #20 is opened with body "Gated on #10", then #20's blocked-by list contains #10.
- Given issue #20 was filed through the structured intake form with "#10" in its Depends-on field and "blocked by #12" in its free-text section, when it is opened, then #20's blocked-by list contains both #10 and #12.

#### Negative Paths
- Given #20 is already blocked by #10, when the same opened event for #20 is processed a second time, then exactly one #10 link exists and the run reports #10 as already present, not as an error.
- Given a body that declares "blocked by #10" twice, when #20 is opened, then exactly one link to #10 is created.
- Given a body containing no recognized phrasing, when #20 is opened, then no link is created and the run completes successfully without reporting any failure.

### Done When
- [ ] Opening a fixture issue whose body says "blocked by #N" yields a GitHub blocked-by link to #N, verified by reading the issue's blocked-by dependencies.
- [ ] Prose linking runs for issues that are not issue-form submissions.
- [ ] Re-running on the same event leaves the link count unchanged and reports `already-present`.

---

## Story 2: Editing an issue adds newly declared links and never removes existing ones

**Requirement:** FR-2, FR-3

As an operator editing an issue, I want new prose declarations to link, and removed declarations to leave links alone, so that edits can never silently drop a gate.

### Acceptance Criteria

#### Happy Path
- Given issue #20 with no blocked-by links, when its body is edited to add "blocked by #10", then #20's blocked-by list contains #10.
- Given #20 is blocked by #10 and its body says "blocked by #10", when the body is edited to also say "depends on #11", then #20 is blocked by both #10 and #11.

#### Negative Paths
- Given #20 is blocked by #10, when its body is edited to remove "blocked by #10", then #20 is still blocked by #10.
- Given #20 is blocked by #10, when its body is edited to say "blocked by #12" instead, then #20 is blocked by both #10 and #12 and no link is removed.
- Given an edit that changes only the title and every target declared in #20's body is already linked, when the edited event is processed, then the existing links are unchanged and no link is created.
- Given #20's body still says "blocked by #10" and an operator has manually deleted the #20→#10 link, when #20's body is next edited, then the #20→#10 link exists again, because prose is the declaration of record.

### Done When
- [ ] The issue edited event triggers prose linking.
- [ ] No code path in prose linking removes or alters a blocked-by link; a test asserts that the remove operation is never reached.

---

## Story 3: Ambiguous, reverse, cross-repository and self references create no edge

**Requirement:** FR-4

As an operator, I want only unambiguous forward declarations to become links, so that a wrong edge never reorders the roadmap.

### Acceptance Criteria

#### Happy Path
- Given a body that says "blocked by #10" and also "related to #11", when #20 is opened, then #20 is blocked by #10 only.

#### Negative Paths
- Given a body containing "related to #10" or "see #10", when #20 is opened, then no link is created.
- Given a body containing "blocks #10" or "blocker for #10", when #20 is opened, then no link is created in either direction.
- Given a body containing "blocked by other-owner/other-repo#10", when #20 is opened, then no link is created.
- Given issue #20's body says "blocked by #20", when it is opened, then no link is created and no tracker write is attempted.
- Given a body that says "blocked by" followed by no issue number, when #20 is opened, then no link is created.

### Done When
- [ ] Each negative-path phrasing above is covered by a test asserting zero edges and zero tracker writes.
- [ ] The structured-field path and the prose path produce identical edges for the same declared references.

---

## Story 4: An unlinkable target does not stop the rest of the issue's handling

**Requirement:** FR-6

As an operator, I want one bad reference to fail on its own, so that the other links and labels on the issue still land.

### Acceptance Criteria

#### Happy Path
- Given an operator-assigned, form-filed issue #20 that declares "blocked by #10 / #99999", where #99999 does not exist, when it is opened, then #20 is blocked by #10, its priority/size labels are applied, and the run output names #99999 as a failed link.

#### Negative Paths
- Given the tracker refuses the link write for #10 (for example, the cycle-rejection response), when #20 is opened, then no link to #10 exists, the run output names #10 with the refusal reason, and the workflow run still succeeds.
- Given the tracker is unreachable for every dependency call, when #20 is opened, then no link is created, every declared target is reported as failed, and label syncing is still attempted.
- Given issue #20 is not assigned exclusively to the operator (unassigned, or assigned to someone else) and declares "blocked by #10", when it is opened, then no link is created, the run output names #10 with reason `explicit-authorization-required`, and the workflow run still succeeds.

### Done When
- [ ] Run output lists each failed target with its reason.
- [ ] The workflow step exits successfully when only link writes fail.

---

## Story 5: Landing an intake spec shows every proposed blocked-by edge

**Requirement:** FR-7, FR-10

As an operator landing a spec, I want to see the prerequisites the issue declares and the in-flight work my plan overlaps, so that I decide on them while I have context.

### Acceptance Criteria

#### Happy Path
- Given intake issue #536's body says "depends on #520" and #536 is not linked to #520, when the spec is landed with source-ref `owner/repo#536`, then #520 is shown as a proposal sourced from the issue's declaration.
- Given an open issue #600 that cites a file listed in the plan's files-likely-touched, when the spec is landed, then #600 is shown as a proposal sourced from overlap.
- Given an unmerged branch for another feature that changes a file listed in the plan, when the spec is landed, then that branch's originating issue is shown as an overlap proposal.

#### Negative Paths
- Given #536 is already blocked by #520, when the spec is landed, then #520 is not shown as undecided and no write for #520 is attempted.
- Given the issue's body references #520 only as "related to #520", when the spec is landed, then #520 is not proposed from the declaration source.
- Given an overlap candidate that is the originating issue #536 itself, when the spec is landed, then it is not proposed.
- Given an overlap candidate that is a closed issue, when the spec is landed, then it is not proposed.
- Given an in-flight branch with no intake marker that changes a file listed in the plan, when the spec is landed, then the branch is printed as an advisory note, is not an undecided proposal, and does not cause land to refuse.

### Done When
- [ ] The land output lists each proposal with its source (`declared` or `overlap`).
- [ ] Already-linked targets appear as satisfied, not as undecided.

---

## Story 6: Land refuses while any proposal is undecided and applies only accepted edges

**Requirement:** FR-8, FR-9

As an operator, I want land to refuse until I decide every proposal, so that no implied dependency is silently applied or silently dropped.

### Acceptance Criteria

#### Happy Path
- Given proposals #520 and #600, when land runs with #520 accepted and #600 declined, then the spec commits, #536 becomes blocked by #520, and no link to #600 is created.
- Given proposals #520 and #600, when land runs with both declined, then the spec commits and no link is created.
- Given there are no proposals, when land runs with no dependency decisions, then the spec commits as it does today.

#### Negative Paths
- Given proposals #520 and #600, when land runs with only #520 decided, then land exits non-zero, nothing is committed, no link is written, and the output names #600 and states how to accept or decline it.
- Given proposal #520, when land runs with #520 both accepted and declined, then land exits non-zero naming the contradictory decision, and nothing is committed or linked.
- Given proposal #520, when land runs declining #777, which was never proposed, then land exits non-zero naming #777 as an invalid decline, and nothing is committed.
- Given #520 is accepted, when land runs and the spec commit then fails (for example, a land gate rejection), then no link to #520 is written.

### Done When
- [ ] A refused land leaves the worktree's committed state and the issue's links unchanged.
- [ ] Links are written only after a successful spec commit.
- [ ] The composer skill instructions describe how the driving session answers the dependency gate.

---

## Story 7: Landing a non-intake idea is unchanged

**Requirement:** FR-11

As an operator landing a chat-sourced idea, I want no dependency ceremony, so that ideas without an originating issue land as before.

### Acceptance Criteria

#### Happy Path
- Given land is invoked without a source-ref, when it runs, then no proposals are computed, no tracker dependency reads occur, and the spec commits as before.

#### Negative Paths
- Given land is invoked without a source-ref but with a dependency accept or decline decision, when it runs, then land exits non-zero stating that dependency decisions require an intake source-ref, and nothing is committed.
- Given the tracker is unreachable and there is no source-ref, when land runs, then land succeeds; the dependency check is not attempted.

### Done When
- [ ] The existing land tests for non-intake ideas pass unchanged.

---

## Story 8: Land fails closed when proposals cannot be computed, unless the operator explicitly skips

**Requirement:** FR-12

As an operator, I want land to refuse rather than pretend there are no proposals when the tracker is unavailable, and to let me proceed deliberately, so that an outage cannot hide a dependency.

### Acceptance Criteria

#### Happy Path
- Given the tracker is unreachable, when land runs with an explicit skip acknowledgement carrying the reason "GitHub outage", then the spec commits, no link is written, and the skip and its reason are recorded.

#### Negative Paths
- Given the tracker is unreachable, when land runs without a skip acknowledgement, then land exits non-zero, nothing is committed, and the output names the cause and how to acknowledge a skip.
- Given the tracker returns a rate-limit response while proposals are being computed, when land runs without a skip, then land refuses, naming the rate limit.
- Given a skip acknowledgement with an empty reason, when land runs, then land exits non-zero requiring a reason, and nothing is committed.
- Given proposals were computed successfully and a skip acknowledgement is also given, when land runs, then the skip is ignored for gating, undecided proposals still refuse, and the output notes that the skip was unused.

### Done When
- [ ] No code path treats a failed proposal computation as "zero proposals".
- [ ] A successful skip appears in the land decision record with its reason.

---

## Story 9: Every land-time dependency decision is recorded on the observability stream

**Requirement:** FR-13

As an operator auditing the roadmap, I want each land decision recorded where every other harness event goes, so that I can later see why an edge exists or doesn't.

### Acceptance Criteria

#### Happy Path
- Given proposals #520 (accepted) and #600 (declined), when land completes, then exactly one dependency-decision event is persisted to the composer event ledger, listing proposals [#520, #600], accepted [#520], declined [#600], and the write result for #520.
- Given a skip acknowledgement with a reason, when land completes, then the event records the skip and its reason, with empty proposal lists.

#### Negative Paths
- Given an accepted edge whose link write fails after commit, when land completes, then the spec stays committed, land reports the failed write, and the event records the failure for #520.
- Given undecided proposals, when land refuses, then exactly one land-gate-rejection event with gate `dependency-proposals-undecided` is persisted, naming the undecided proposals, no dependency-decision event is emitted, and no link is written.
- Given the tracker is unreachable and no skip was given, when land refuses, then exactly one land-gate-rejection event with gate `dependency-check-unavailable` is persisted, and no dependency-decision event is emitted.
- Given a non-intake idea, when land runs, then no dependency-decision event is emitted.

### Done When
- [ ] The new event variant is part of the `ConductorEvent` union and registered for persistence.
- [ ] The three new land-gate identifiers (`dependency-proposals-undecided`, `dependency-check-unavailable`, `dependency-decisions-invalid`) are part of the land-gate rejection identifier set.
- [ ] Each invalid-decision refusal in Stories 6, 7 and 8 (contradictory decision, never-proposed decline, decision without source-ref, empty skip reason) persists one land-gate-rejection event under `dependency-decisions-invalid`.
- [ ] No sidecar file or separate log is written for land decisions.

---

## Story 10: The on-demand drift report lists every drift category

**Requirement:** FR-14, FR-18

As an operator maintaining the roadmap, I want one report of what in the graph looks wrong, so that I can trust the graph without auditing each issue.

### Acceptance Criteria

#### Happy Path
- Given open issue #30 whose body says "blocked by #31" with no link, when the drift report runs, then #30→#31 is listed as an unlinked declaration.
- Given open issue #32 blocked by #33, which was closed as not planned, when the report runs, then #32→#33 is listed as a stale link.
- Given open issues #34 and #35 blocked by each other, when the report runs, then the cycle {#34, #35} is listed as a contradiction.
- Given open issue #36 whose body says "blocks #37" while #36 is blocked by #37, when the report runs, then #36/#37 is listed as a direction contradiction.
- Given a repository with no drift, when the report runs, then it states that zero findings were found in each category and exits successfully.

#### Negative Paths
- Given open issue #38 blocked by #39, which was closed as completed, when the report runs, then #38→#39 is not listed in any category.
- Given closed issue #40 whose body says "blocked by #41" with no link, when the report runs, then #40 is not listed; only open issues are swept.
- Given open issue #42 whose body says "related to #43" with no link, when the report runs, then nothing is listed for #42.
- Given a project name that is not registered, when the drift report is requested for it, then it exits non-zero naming the unknown project and makes no tracker calls.

### Done When
- [ ] A fixture repository with one example per category yields exactly those four findings.
- [ ] The report is reachable as a registered compose subcommand.

---

## Story 11: The drift report never mutates the graph

**Requirement:** FR-15

As an operator, I want drift reported and never repaired, so that deliberate graph states are never undone by the harness.

### Acceptance Criteria

#### Happy Path
- Given a repository with findings in every category, when the drift report runs (on demand or automatically), then the tracker receives only read requests.

#### Negative Paths
- Given an unlinked declaration #30→#31, when the report runs, then no link from #30 to #31 is created.
- Given a stale link #32→#33, when the report runs, then the link still exists afterwards.
- Given a cycle {#34, #35}, when the report runs, then both links still exist and no label or comment is added to either issue.

### Done When
- [ ] A test with a recording tracker double asserts that zero write operations are issued during a sweep that has findings in all categories.

---

## Story 12: Drift detection runs automatically during polling, bounded, with one summary record per run

**Requirement:** FR-16

As an operator, I want drift surfaced without having to remember to look, and without exhausting the API budget, so that the graph stays trustworthy over time.

### Acceptance Criteria

#### Happy Path
- Given the intake loop is running and no sweep has run for a repository this hour, when an intake tick fires, then one sweep runs and exactly one drift summary event is published for that repository, listing the issues in each category.
- Given a sweep that finds no drift, when it completes, then one drift summary event is published with empty lists in every category.

#### Negative Paths
- Given a sweep ran for a repository 10 minutes ago, when the next intake tick fires, then no sweep runs and no drift event is published for that repository.
- Given the sweep throws unexpectedly, when an intake tick fires, then the tick's polling, enqueue and closed-issue reconciliation still complete, and the failure is logged.
- Given two registered repositories, when a due tick fires, then exactly one summary event is published for each repository.

### Done When
- [ ] The drift summary event variant is part of the `ConductorEvent` union and registered for persistence.
- [ ] The sweep is composed into the existing intake tick, and no new loop or timer process exists.

---

## Story 13: Undeterminable dependency state is reported as indeterminate, never clean

**Requirement:** FR-17

As an operator, I want unreadable issues called out, so that a tracker outage never looks like a clean graph.

### Acceptance Criteria

#### Happy Path
- Given the blocked-by read for issue #44 fails with a server error, when a sweep runs, then #44 is listed as indeterminate, other issues are still classified, and the summary's indeterminate list contains #44.

#### Negative Paths
- Given a rate-limit response on the blocked-by read for #45, when a sweep runs, then #45 is indeterminate, the sweep does not retry #45, and it does not retry in a loop.
- Given the issue listing itself fails, when a sweep runs, then the report or summary states that the repository is indeterminate and lists zero findings in the other categories (not "clean").
- Given a cycle check that cannot complete because a blocker's read fails, when a sweep runs, then the affected issue is indeterminate rather than reported as cycle-free.

### Done When
- [ ] The on-demand report output distinguishes "0 findings" from "indeterminate".
- [ ] A test asserts that a failed read never yields an issue counted as clean.
