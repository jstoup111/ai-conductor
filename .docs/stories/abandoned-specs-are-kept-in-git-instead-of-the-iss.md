**Status:** Accepted

# Stories: abandoned specs move to the issue tracker (#1574)

Technical track — acceptance criteria derive from the confirmed intent in
jstoup111/ai-conductor#1574 and the approved approach (runbook + triage pointer, full
migration, no engine changes).

## Story 1: One canonical abandonment procedure, surfaced at the stop-work decision point

As an operator or triage agent concluding that a spec's work should stop, I want a single
documented abandonment procedure so that I never have to adjudicate between contradictory
conventions.

### Acceptance Criteria

#### Happy Path
- Given the repository on the feature branch, when a reader opens the runbook page for abandoning a spec under docs/runbooks/, then it states the complete procedure: delete the spec's DECIDE artifacts from the repository, record the decision and rationale on a GitHub issue, and close that issue as the durable record
- Given skills/daemon-triage/SKILL.md, when triage reaches a conclusion that a feature's work should stop permanently, then the skill text directs the reader to the abandonment runbook at that decision point
- Given docs/reference/artifacts.md, when a reader looks up how retirement/abandonment is recorded, then the page describes only the issue-tracker path and links the runbook

#### Negative Paths
- Given the full repository tree after the change, when a reader greps docs/, skills/, and HARNESS.md for an abandonment or retirement procedure, then no surviving text instructs moving a plan into a retired directory or maintaining a register row
- Given the runbook describes a spec that is blocked but still wanted, when the reader follows its guidance, then the runbook explicitly says NOT to abandon it and points at fixing the DECIDE artifact instead

### Done When
- [ ] docs/runbooks/ contains the abandonment runbook with the delete-artifacts + closed-issue procedure and the blocked-but-wanted counter-case
- [ ] skills/daemon-triage/SKILL.md contains a link to that runbook at its stop-work conclusion
- [ ] docs/reference/artifacts.md no longer documents a retired-directory mechanism and links the runbook
- [ ] test/test_harness_integrity.sh passes on the branch

## Story 2: The nine retired plans migrate to closed issues and the register is gone

As the repository operator, I want the existing .docs/retired/ contents to reach the same end
state as any future abandonment so that no grandfathered register remains to drift.

### Acceptance Criteria

#### Happy Path
- Given a register row for one of the four abandoned plans, when migration completes, then a closed GitHub issue exists carrying that row's plan stem, decision date, decider, and note verbatim or equivalently
- Given a register row for one of the five delivered plans, when migration completes, then a closed GitHub issue exists carrying that row's plan stem and its delivery evidence
- Given migration is complete, when the base branch tree is listed, then .docs/retired/ is absent (no plan files, no README.md)

#### Negative Paths
- Given a retired plan with no pre-existing tracker issue, when migration reaches it, then a new issue is filed with the register row's content and immediately closed — the plan is never deleted without a closed-issue record existing first
- Given the deletion commit, when it removes .docs/retired/, then each deleted file's commit or PR body references the closed issue that carries its record, so the trail is followable from git history

### Done When
- [ ] 9 closed issues exist on jstoup111/ai-conductor, one per retired plan, each carrying its register row's content and labeled or titled so the plan stem is searchable
- [ ] git ls-tree of the branch shows no .docs/retired/ path
- [ ] The PR body lists the plan-stem → issue-number mapping

## Story 3: Backlog discovery behavior is unchanged by the migration

As the daemon operator, I want abandonment-by-deletion to keep the backlog clean so that an
abandoned slug never resurfaces and real blocked work stays visible.

### Acceptance Criteria

#### Happy Path
- Given the branch after migration, when the backlog scan enumerates .docs/plans on it, then none of the nine retired plan stems appear in its output
- Given a plan that is blocked but still wanted remains under .docs/plans/, when the backlog scan runs, then it is still reported (as blocked or pending) — presence in .docs/plans remains the wanted/abandoned discriminator

#### Negative Paths
- Given the shipment audit's historical plan enumeration, when it runs on the branch after migration, then its source set and exit status are identical to the base branch's (all nine retired stems already appear as historical sources there, and the engine surfacing them is tracked by #1964, out of scope for this docs-only migration)

### Done When
- [ ] Backlog scan output on the branch contains none of the 9 retired stems and is otherwise identical to the base branch's
- [ ] No engine source file changed in the diff
