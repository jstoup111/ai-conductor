**Status:** Accepted

# Stories: A routed finding lands on the host that owns its task, and a no-op host does not stop the round (#3590)

Technical track; no PRD. Acceptance criteria derive from #3590's desired outcomes, the
operator-confirmed scope in `.docs/track/routed-residue-finding-lands-on-a-taskless-host-an.md`, and
`architecture-review-2026-11-05-routed-residue-finding-lands-on-a-taskless-host-an`. The examples use
a three-child stack `demo` with plan Task `T25` in slice 3 and Task `T4` in slice 1. "Host n" is
child n's position in a routing round. "Did work" means a host ended `restacked` or `rerouted`.

## Story 1: An ADR-citing finding bound to an existing task routes to that task's child

**Requirement:** Desired outcomes 1 and 4; `adr-2026-10-12-routed-whole-feature-repair` decisions 2 and 3

As an operator, I want an as-built finding that the remediation plan binds to an existing task to be
repaired on the child that owns that task, so that it is never placed on a child with nothing to fix.

### Acceptance Criteria

#### Happy Path
- Given an as-built REMEDIABLE finding citing only `adr-x D2` whose admitted disposition is existing-task bound to `T25`, when the round is routed, then its owner and host are `3`, its reason is not `residue-default` or `residue-judged`, and its route item carries `existingTask: true` and `taskIds: ["T25"]`.
- Given that `T25`-bound finding and one other residue item with no task binding in the same round, when the round is routed, then exactly one residue routing call is made and its item list holds only the unbound item.
- Given a residue item with no task binding for which the routing call returns `{child: 3, candidates: [3], rationale: "owns D2"}`, when the round is routed, then its owner is `3` with reason `residue-judged`.

#### Negative Paths
- Given a residue item with no existing-task binding for which the routing call returns `{child: 3, candidates: [1, 3], rationale: "alternate"}`, when the round is routed, then its owner is still `1` with reason `residue-default`.
- Given an as-built finding citing only `adr-x D2` whose existing-task disposition has no resolved owner-task binding, when the round is routed, then the feature halts needs-human naming the finding, and no route record is created.
- Given the `T25`-bound finding in a round that also carries `manual_test` FAIL rows, when the round is routed, then no routing call is made for it and the FAIL obligation is placed with host `3`, the lowest task-bound host.

### Done When
- [ ] A `round-router` test asserts the `T25`-bound ADR-citing finding routes to host `3` and never appears in the residue judge's prompt items.
- [ ] Existing `resolveResidueOwner` tests for single-candidate and multi-candidate answers pass unchanged.

## Story 2: A routed audit host with nothing to do settles, and the round moves on

**Requirement:** Desired outcome 2; `adr-2026-10-12-routed-whole-feature-repair` decision 7; `adr-2026-07-13-kickback-build-no-op-escalation` D1

As an operator, I want a routed host whose work is already complete to step aside, so that the real
repairs routed to the other hosts in the round still run.

### Acceptance Criteria

#### Happy Path
- Given audit round `r2` with hosts 1, 2 and 3 where host 1 is `admitted`, hosts 2 and 3 are `pending`, and every routed task for host 1 is already evidence-complete after region entry, when the conductor enters host 1, then no provider is dispatched for host 1, host 1 ends `done`, host 2 becomes `admitted`, and no HALT marker is written.
- Given that settle of host 1, when the events are read, then a `routed_repair_phase` event for host 1 with phase `repairing`, `credit: false` and `reason: "derived-already-complete"` precedes a `routed_repair_phase` event for host 1 with phase `done`.
- Given that settle of host 1, when the round receipt is read, then no routed repair credit was granted for host 1 in `r2`.
- Given audit round `r2` where host 1 ended `restacked` and the leaf host 3 is the last host and is already evidence-complete after region entry, when the conductor enters host 3, then host 3 ends `done`, the round closes, the worktree returns to the leaf branch, and the leaf's gates are pending again.

#### Negative Paths
- Given audit round `r2` whose only host is host 1, host 1 has at least one routed task and no taskless obligation, and host 1 is already evidence-complete after region entry, when the conductor enters host 1, then the feature halts needs-human with `Outcome: derived-already-complete` exactly as before.
- Given audit round `r2` where host 1 settled as a no-op (`done`), host 2 is the last host, host 2 has at least one routed task and no taskless obligation, and host 2 is already evidence-complete after region entry, when the conductor enters host 2, then the feature halts needs-human with `Outcome: derived-already-complete` and host 2 stays `admitted`.
- Given host 1 already evidence-complete but region entry committed a frozen block on child 1's branch, when host 1 settles, then host 1 leaves through `built` and `restacked`, so the committed block reaches every child above it.
- Given a crash after host 1 became `repairing` for the settle and before its exit, when the feature resumes, then host 1 is not entered as a new admission, and the round reaches host 2 with host 1 ended `done` or `restacked`.
- Given a revalidate or operator round whose host is entered, when region entry runs, then no no-op settle or no-op halt is applied, as before.

### Done When
- [ ] A conductor-level test drives a three-host audit round from host 1's no-op entry to host 2's admission and asserts no HALT marker and no provider dispatch for host 1.
- [ ] The `routed_repair_phase` event type accepts an optional `reason` whose only value is `derived-already-complete`, and events without it still parse.

## Story 3: Clearing the halt of a round stuck on a no-op host resumes the round

**Requirement:** Desired outcome 3

As an operator whose stacked feature halted because a routed host had nothing to do, I want clearing
that halt to let the round continue, so that I can recover without editing routing refs.

### Acceptance Criteria

#### Happy Path
- Given a feature halted needs-human with `Outcome: derived-already-complete` while round `r2` has host 1 `admitted` with the repair marker and hosts 2 and 3 `pending`, when the HALT is cleared and the feature is dispatched again, then host 1 settles `done` and host 2 is admitted.
- Given that recovery, when `ai-conductor stack rounds --slug demo` runs, then it reports `r2` with host 1 `done` and the repair marker on host 2.

#### Negative Paths
- Given a feature halted needs-human with `Outcome: derived-already-complete` on the last host of a round where no host did work and that host has at least one routed task and no taskless obligation, when the HALT is cleared and the feature is dispatched again, then it halts needs-human again with the same outcome and no host state changes.
- Given that halted feature, when the HALT is not cleared, then the daemon's re-kick retains it as needs-human and no routing ref changes.

### Done When
- [ ] A test starting from a persisted route record with host 1 `admitted`, the marker on host 1, and hosts 2 and 3 `pending` re-enters through reconciliation and asserts host 1 `done` and host 2 `admitted`.
