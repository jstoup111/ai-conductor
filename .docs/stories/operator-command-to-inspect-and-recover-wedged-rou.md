# Stories: Operator command to inspect and recover wedged routed rounds

**Status:** Accepted

Source: intake jstoup111/ai-conductor#3459, outcome 3 only (outcomes 1, 2 and 4 belong to spec #3462 for
#3445). Technical track, no PRD. Governing design: `adr-2026-10-12-routed-whole-feature-repair` decisions 6,
7 and 16 as amended by #3459, and
`.docs/decisions/architecture-review-2026-10-29-operator-command-to-inspect-and-recover-wedged-rou.md`.
"Non-closed" means a round in phase `prepared` or `open`. "Active host" means a host in `admitted`,
`repairing`, `built`, `reroute-moved`, `abandoning` or `abandoned`.

## Story 1: An operator can inspect a feature's routed rounds without changing anything

**Requirement:** #3459 desired outcome 3; adr-2026-10-12 decision 7 (amended by #3459)

As the operator of a wedged stacked feature, I want one command that shows every routed round, the repair marker and each round's receipt state, so that I can diagnose a wedge without reading `refs/conductor/*` by hand.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature with routing on whose refs hold round r4 (audit, open, hosts 1 `restacked` and 2 `pending`, current host 1, receipt settled) and round r5 (audit, open, host 1 `repairing`, receipt unsettled) and a repair marker naming host 1 of r5, when the operator runs `ai-conductor stack rounds --slug <slug>`, then it exits 0 and prints one line per round in ascending round order showing its id, kind, phase, every host with its state, current host, whether its receipt is settled, and its outbox length, followed by a line naming the marker's host and round.
- Given the same r4/r5 state, when the operator runs the inspect command, then the output contains a line stating that r4 is wedged behind r5's marker with pending host 2 unadmitted, and naming the command `ai-conductor stack rounds --slug <slug> --close r4 --reason <text>`.
- Given a stacked feature with routing on and no route refs, when the operator runs the inspect command, then it exits 0 and prints that the feature has no routed rounds and no repair marker.
- Given any feature state, when the inspect command completes, then every `refs/conductor/<slug>/*` ref resolves to the same object as before, no file under the feature worktree's `.pipeline/` is created or changed, and the feature dispatch lease was never acquired.

#### Negative Paths
- Given a stacked feature whose round r3 ref holds a blob that does not parse as a route record, when the operator runs the inspect command, then it still prints every readable round, prints r3 as unreadable with its blob id, and exits 1.
- Given a stacked feature whose repair marker blob does not parse, when the operator runs the inspect command, then it prints every round, reports the marker as unreadable, and exits 1.
- Given a feature with `stacked_prs.route_whole_feature_fixes: false`, when the operator runs the inspect command, then it prints `stack rounds: refused` with a reason naming the disabled routing setting, exits 1, and reads no route ref.
- Given a slug with no feature worktree, or a feature that is not stacked, when the operator runs the inspect command, then it prints `stack rounds: refused` naming the slug and exits 1.
- Given an argument vector with an unknown flag, a repeated `--slug`, `--close` without `--reason`, or a slug containing `/` or equal to `.` or `..`, when the CLI parses it, then the `stack rounds` command is not dispatched and nothing is read or written.

### Done When
- [ ] `ai-conductor stack rounds --slug <slug>` is dispatched before the pipeline starts and appears in the CLI pre-dispatch command table under `stack rounds`.
- [ ] Inspect output for an r4/r5 wedge names both rounds, the marker, each receipt's settlement state and the exact close command for r4.
- [ ] A ref snapshot and `.pipeline/` listing taken before and after an inspect run are identical.

## Story 2: An operator can close a superseded open round

**Requirement:** #3459 desired outcome 3; adr-2026-10-12 decisions 6 and 16 (amended by #3459)

As the operator of a wedged stacked feature, I want to close a stale open round that another round has superseded, through the engine's own transaction, so that the feature can resume without my hand-editing route refs or changing its budget accounting.

### Acceptance Criteria

#### Happy Path
- Given the r4/r5 wedge (r4 open with host 1 `restacked` and host 2 `pending`, r5 open and named by the marker), no dispatch lease held, and an approved operator identity, when the operator runs `ai-conductor stack rounds --slug <slug> --close r4 --reason "superseded by r5"`, then r4's record reads phase `closed` with host 1 `restacked` and host 2 `done`, r5's record and the repair marker are byte-identical to before, and the command exits 0.
- Given that successful close, when r4's record is read, then its outbox holds exactly one new `routing_round_superseded` event with `roundId` r4, `supersededBy` r5, `droppedHosts` [2], `findingIds` equal to r4's items routed to host 2, the trimmed reason, the operator identity, and a non-empty `eventId` and `occurredAt`, written in the same ref update as the phase change.
- Given that successful close, when the engine next drains routing outboxes, then `.pipeline/events.jsonl` gains exactly one `routing_round_superseded` line for r4, and a second drain of the same event id appends nothing.
- Given that successful close, when the kickback ledger is rebuilt from route receipts, then its lap charges, growth and taskless counts equal those rebuilt before the close.
- Given that successful close, when the command prints its result, then the output names the closed round, the dropped hosts and finding ids, and tells the operator to clear any HALT with `ai-conductor halt clear` before the daemon resumes.
- Given that successful close and a feature HALT present before it, when the command completes, then `.pipeline/HALT` and `.pipeline/HALT.class` are byte-identical to before.

#### Negative Paths
- Given a close whose compare-and-swap loses to a concurrent change of r4's record, when the write is attempted, then r4 keeps its concurrently written content, no `routing_round_superseded` event exists for r4, and the command prints `stack rounds: refused` naming the contested write and exits 1.
- Given a close whose route ref update fails because git is unavailable, when the write is attempted, then r4's ref resolves to its previous blob and the command exits 1 naming the failed write.
- Given a successful close of r4 followed by the same command again, when the second run executes, then it refuses because r4 is not open, exits 1, and r4's record including its outbox is unchanged.
- Given a successful close whose surviving round r5 later settles with no other non-closed round, when reconciliation advances r5, then r5 performs its leaf return and re-pends `prd_audit`, `architecture_review_as_built` and `manual_test`.
- Given a close in which the event persister is unavailable at the next drain, when the engine resumes, then the event stays in r4's outbox and is persisted on a later drain rather than being lost.

### Done When
- [ ] After closing r4 in the r4/r5 fixture, r4's record parses as `closed` with hosts {1: `restacked`, 2: `done`}, and r5 plus `repairing` are unchanged.
- [ ] `routing_round_superseded` is a member of the `ConductorEvent` union and is in the persister's routing dedup-by-`eventId` list.
- [ ] Ledger rebuilt from receipts before and after the close compares equal.

## Story 3: A close that could strand or corrupt routing state is refused with nothing written

**Requirement:** #3459 desired outcome 3; adr-2026-10-12 decision 6 (amended by #3459)

As the operator, I want the close to refuse every round it cannot safely supersede, so that recovery can never skip whole-feature revalidation, interrupt live repair work, or re-wedge reconciliation.

### Acceptance Criteria

#### Happy Path
- Given an open audit round whose hosts are all `restacked` or `pending`, which the marker does not name, and which is not the only non-closed round, when the operator closes it with a reason, then the close succeeds.
- Given an open audit round whose current host is `restacked` and whose later hosts are all `pending`, when the operator closes it with a reason, then every pending host is written `done` and the current host stays `restacked`.

#### Negative Paths
- Given an open round that is the only non-closed round of the feature, when the operator runs close on it, then the command prints `stack rounds: refused` stating that closing the sole non-closed round would skip the leaf return, exits 1, and every route ref and the marker are unchanged.
- Given an open round of kind `revalidate` or `operator`, when the operator runs close on it, then the refusal names the round's kind, states that only `audit` rounds can be superseded (and, for `operator`, names `ai-conductor stack land --slug <slug> --abandon`), exits 1, and nothing is written.
- Given an open round that has a host in any of `admitted`, `repairing`, `built`, `reroute-moved`, `abandoning` or `abandoned`, when the operator runs close on it, then the refusal names that host and its state, exits 1, and nothing is written.
- Given an open round whose record carries an in-progress reroute, when the operator runs close on it, then the refusal names the in-progress reroute, exits 1, and nothing is written.
- Given an open round named by the repair marker, when the operator runs close on it, then the refusal states that the marker holds the round, exits 1, and nothing is written.
- Given an unreadable repair marker, when the operator runs close on any round, then the refusal names the unreadable marker, exits 1, and nothing is written.
- Given a round id that has no ref, does not match `r<N>`, names a round in phase `prepared` or `closed`, or holds an unparseable blob, when the operator runs close on it, then the refusal names the round and its condition, exits 1, and nothing is written.
- Given another round whose blob is unreadable, when the operator runs close on a round that otherwise qualifies, then the refusal names the unreadable round, because the surviving-round condition cannot be proven, exits 1, and nothing is written.

### Done When
- [ ] Each refusal condition above has a test asserting exit code 1, the named condition in the output, and unchanged route refs and marker.
- [ ] The host-state check is an exhaustive switch over `HostState`, so adding a state fails compilation until it is classified.

## Story 4: Only an authorized operator can close a round while no build is running

**Requirement:** #3459 desired outcome 3; adr-2026-10-12 decision 7 (amended by #3459)

As the operator, I want the close guarded by the same authority and concurrency checks as `stack land`, so that a recovery never races a daemon dispatch or runs without an accountable operator and reason.

### Acceptance Criteria

#### Happy Path
- Given a qualifying round, routing on, an approved operator identity, a non-empty reason and no lease held, when the operator closes it, then the command acquires the feature dispatch lease before writing and releases it before exiting.
- Given a qualifying round and a reason with leading and trailing whitespace, when the operator closes it, then the event and output carry the trimmed reason.

#### Negative Paths
- Given a feature whose dispatch lease is held by a running dispatch, when the operator runs close, then the command prints the lease refusal naming the holder, exits 1, and every route ref is unchanged.
- Given no approved operator identity on the machine, when the operator runs close, then the command refuses naming the missing identity, exits 1, acquires no lease, and writes nothing.
- Given `--reason` that is empty or only whitespace, when the operator runs close, then the command refuses requiring a non-empty reason, exits 1, acquires no lease, and writes nothing.
- Given routing turned off or a feature with no durable child state, when the operator runs close, then the command refuses naming the condition before reading the repair marker, exits 1, and acquires no lease.
- Given a process carrying `CONDUCT_DAEMON_SESSION=1`, when it runs `ai-conductor stack rounds --slug <slug> --close r4 --reason x`, then the entry guard refuses the command as not session-sanctioned, and every route ref and the lease are unchanged.
- Given any refusal from the round-state checks in Story 3, when the command exits, then the feature dispatch lease was never acquired and no park marker was created.
- Given a close whose write throws after the lease was acquired, when the command exits, then the lease is released and the command exits 1 naming the error.

### Done When
- [ ] Tests with an injected lease, operator identity and store prove the refusal order: eligibility, then identity and reason, then round state, then lease, then write.
- [ ] A test with a held lease proves no route ref changes.
