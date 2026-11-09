**Status:** Accepted

# Stories: A whole-feature failure is routed to a child that can hold the fix, and a stranded round has a supported way out (#3605)

Technical track; no PRD. Acceptance criteria derive from #3605's desired outcomes, the
operator-confirmed scope in `.docs/track/manual-test-failure-routed-to-a-child-that-can-t-h.md`, and
`architecture-review-2026-11-07-manual-test-failure-routed-to-a-child-that-can-t-h`. The examples use
a five-child stack `demo`. Child 4 first adds `src/client/input/touch.ts` and `src/client/ui/hud.ts`,
and child 5 (the leaf, `feat/daemon-demo`) first adds `src/client/art/manifest.ts`. "Host n" is child
n's position in a routing round. A "taskless obligation" is a `manual_test` FAIL or a post-region
custom-step kickback, which appends no task.

## Story 1: A routed host whose only work is a taskless obligation runs BUILD with its retry hint

**Requirement:** Desired outcome 2; `adr-2026-10-12-routed-whole-feature-repair` decisions 1 and 7; `adr-2026-07-13-kickback-build-no-op-escalation` D1

As an operator, I want a routed `manual_test` FAIL to be built on its host even though every authored task there is already complete, so that the failure is repaired instead of halting as "already complete".

Scope: this story governs every `operator` and `revalidate` round, and `audit` rounds admitted with `stacked_prs.fold_routed_fixes` set to `false`. An `audit` round admitted with the setting on executes its hosts on the leaf and defers placement to the fold (`.docs/stories/late-gate-fixes-restack-the-whole-stack-every-repa.md` Stories 1 to 3 and 9).

### Acceptance Criteria

#### Happy Path
- Given an open audit round whose only item is `manual-test-fail` hosted on child 4 with no rem tasks and the FAIL rows as its retry hint, and every authored task on child 4 evidence-complete, when host 4's region is entered, then BUILD is dispatched on child 4 with a retry reason containing those FAIL rows, and host 4 becomes `repairing`.
- Given an open audit round whose only item is a post-region custom-step kickback hosted on child 2 with no rem tasks, when host 2's region is entered, then BUILD is dispatched on child 2 and host 2 becomes `repairing`.
- Given the taskless host 4's BUILD commits a fix, when its region exits, then host 4 leaves through the routed restack exit and the round continues to the leaf return.

#### Negative Paths
- Given an open audit round whose host 3 has one routed rem task that is already evidence-complete and no taskless obligation, when host 3's region is entered, then no BUILD is dispatched and the existing `derived-already-complete` outcome applies, settling when another host can advance and halting needs-human when none can.
- Given the taskless host 4's BUILD commits nothing, when its region exits, then host 4 takes the no-commit exit, and the leaf's next `manual_test` PASS with an unchanged leaf HEAD is refused by the anti-whitewash check.
- Given the taskless host 4's BUILD was interrupted after host 4 became `repairing`, when the feature resumes, then BUILD is dispatched on child 4 again with the same retry hint and no `derived-already-complete` halt is written.
- Given an open audit round with no taskless obligation whose host has zero routed tasks, when that host's region is entered, then the existing `derived-already-complete` outcome applies unchanged.

### Done When
- [ ] A host-region-entry test with a taskless `manual-test-fail` allocation and an evidence-complete child asserts the result is `entered`, not `derived-already-complete`.
- [ ] A conductor routing test asserts the dispatched BUILD's retry reason contains the FAIL rows stored in the route record's allocation.
- [ ] Existing `derived-already-complete` settle and halt tests for task-bound hosts pass unchanged.

## Story 2: A taskless obligation is placed on a child that contains the code the evidence names

**Requirement:** Desired outcome 1; `adr-2026-10-12-routed-whole-feature-repair` decisions 3 and 4

As an operator, I want a `manual_test` FAIL about controls that child 4 added to be routed to child 4 or above, never to a child below it, so that the routed host can hold the fix.

### Acceptance Criteria

#### Happy Path
- Given a `manual_test` FAIL on `demo` whose rows describe overlapping touch controls, when the taskless round is admitted, then exactly one residue routing call is made and its item carries those FAIL rows plus, for each position 1 to 5, the paths that position changed.
- Given the routing call answers child 4 with candidates `[4]` and implicated paths `["src/client/input/touch.ts"]`, when the round is admitted, then the item's owner and host are `4` with reason `residue-judged`.
- Given the routing call answers child 1 with candidates `[1]` and implicated paths `["src/client/ui/hud.ts"]`, when the round is admitted, then the item's owner is `1`, its host is `4`, and its reason is `prerequisite-paths`.
- Given the routing call answers child 4 with candidates `[4]` and implicated paths `["src/client/input/touch.ts", "src/client/art/manifest.ts"]`, when the round is admitted, then the item's host is `5`.

#### Negative Paths
- Given the routing call answers child 1 with candidates `[1, 2]` and no implicated paths, when the round is admitted, then the item's host is the leaf `5`, not `1`.
- Given the routing call answers child 2 with candidates `[2]` and implicated paths that are all absent from the leaf tip, when the round is admitted, then the item's host is the leaf `5`, the route record is created, and no halt is written.
- Given a post-region custom-step kickback with no retry evidence whose routing call names no implicated paths, when the round is admitted, then the item's host is the leaf `5`.
- Given the routing call returns an undeclared position on both attempts, when the round is admitted, then the feature halts needs-human naming the item and no route record is created.
- Given child 3's closure ref is unreadable while the changed-path manifest is built, when the round is admitted, then the feature halts needs-human naming child 3, no routing call is made, and no route record is created.
- Given a consolidated round carrying task-bound gaps on host 2 and FAIL rows, when the round is routed, then no routing call is made for the FAIL obligation and it is placed on host `2`, the lowest task-bound host.

### Done When
- [ ] A taskless-admission test asserts the routing call's prompt contains the FAIL rows and each position's changed paths derived from closure refs.
- [ ] Residue-routing-call tests parse a `v2` answer with and without `implicatedPaths` and reject a malformed `implicatedPaths` value after one re-ask.
- [ ] A taskless-admission test asserts each placement above, recording owner, host and reason in the created route record.

## Story 3: An operator can close a stranded sole audit round and land the fix on the leaf

**Requirement:** Desired outcomes 2 and 4; `adr-2026-10-12-routed-whole-feature-repair` decisions 6, 7 and 16

As an operator, I want a supported, recorded command that closes the only open audit round when none of its hosts has started repairing, so that I can commit the fix on the leaf and resume without editing routing refs by hand.

### Acceptance Criteria

#### Happy Path
- Given `demo` halted with sole open audit round r2, host 1 `admitted` and the repair marker naming r2, when the operator runs `ai-conductor stack rounds --slug demo --close r2 --reason "fix lands on leaf"`, then it exits 0, host 1 is `done`, r2 is `closed`, and the marker is deleted in one ref transaction.
- Given that close, when the command finishes, then its output names r2, the closed hosts, the reason, and that the HALT must be cleared with `ai-conductor halt clear` before the daemon resumes.
- Given that close, when the next dispatch drains the route-record outbox, then `.pipeline/events.jsonl` holds one `routing_round_superseded` event for r2 with `disposition` `leaf-return`, the reason, the operator identity, and no `supersededBy`.
- Given that close, when the operator commits a tracked file on `feat/daemon-demo`, then the stack-commit-guard allows the commit.
- Given that close, a leaf commit and a cleared HALT, when the daemon dispatches `demo`, then no routed host region is entered and `manual_test` runs on the leaf at the new leaf HEAD.
- Given an open audit round r4 superseded by a non-closed round r5, when the operator closes r4, then its `routing_round_superseded` event carries `disposition` `superseded` and `supersededBy` `r5`.

#### Negative Paths
- Given sole open audit round r2 whose host 1 is `repairing`, when the operator runs close on r2, then it prints `stack rounds: refused` naming host 1 and `repairing`, exits 1, and every route ref and the marker are unchanged.
- Given sole open audit round r2 with a host in `built`, `reroute-moved`, `abandoning` or `abandoned`, or an in-progress reroute, when the operator runs close on r2, then the refusal names that condition, exits 1, and nothing is written.
- Given sole open audit round r2 and the marker naming a different round, when the operator runs close on r2, then the refusal names the round the marker holds, exits 1, and nothing is written.
- Given an open audit round r4 with host 2 `admitted` while round r5 is also non-closed, when the operator runs close on r4, then the refusal names host 2 and `admitted`, exits 1, and nothing is written.
- Given a close of sole round r2 with an empty or whitespace `--reason`, when the command runs, then it is refused before the feature dispatch lease is acquired and nothing is written.
- Given a running dispatch that holds `demo`'s feature dispatch lease, when the operator runs close on r2, then the refusal names the held lease, exits 1, and nothing is written.
- Given the marker ref changes after the close's checks but before its write, when the transaction is applied, then the close is refused as a contested write and r2's record and the marker are unchanged.

### Done When
- [ ] A real-git `stack rounds` test asserts the sole-round close writes host `done`, round `closed` and marker deletion in one transaction, and that the stack-commit-guard then allows a leaf commit.
- [ ] A conductor test after a sole-round close asserts the next dispatch enters no routed host region and runs `manual_test` on the leaf.
- [ ] Each refusal above has a test asserting exit 1, the named condition, and unchanged route refs and marker.

## Story 4: The stack-commit-guard names only recovery commands that apply to the active round

**Requirement:** Desired outcome 3; `adr-2026-10-12-routed-whole-feature-repair` decision 7

As an operator, I want a refused commit to suggest only commands that can work for the round that blocked it, so that I am not sent to a command that will refuse me.

### Acceptance Criteria

#### Happy Path
- Given the marker names audit round r2 hosted on child 1 and executing on child 1's own branch, when the operator commits a tracked file on `feat/daemon-demo`, then the refusal names `feat/c1/demo` and `ai-conductor stack rounds --slug demo --close r2 --reason <text>`, and does not contain `stack land --abandon`.
- Given the marker names operator round r3 hosted on child 2, when the operator commits a tracked file on `feat/daemon-demo`, then the refusal names `feat/c2/demo` and `ai-conductor stack land --slug demo --abandon`, and does not contain `stack rounds --close`.

#### Negative Paths
- Given the marker names audit round r2 hosted on child 1 and executing on child 1's own branch, when the operator commits on `feat/c1/demo`, then the guard allows the commit.
- Given an unreadable repair marker, when the operator commits a tracked file on any stack branch, then the guard refuses with `routed repair marker is unreadable` and names no recovery command.
- Given the marker names an audit round whose route record is unreadable, when the operator commits on a non-host branch, then the guard refuses naming the unreadable record and names no recovery command.

### Done When
- [ ] Stack-commit-guard tests assert the refusal text for an `audit` and an `operator` round, each containing its own command and not the other's.
- [ ] Existing allow-on-host and unreadable-marker guard tests pass unchanged.
