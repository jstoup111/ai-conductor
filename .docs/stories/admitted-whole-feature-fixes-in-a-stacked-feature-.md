**Status:** Accepted

# Stories: Place admitted whole-feature fixes in the owning stacked child (#3210)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/admitted-whole-feature-fixes-in-a-stacked-feature-.md`
  (spec B of the four-spec split #2944, #3210, #3211, #3212);
- `adr-2026-10-12-routed-whole-feature-repair` (decisions 1–4 and 7, and the writers of decisions 6
  and 16);
- the findings and conditions of
  `architecture-review-2026-10-14-admitted-whole-feature-fixes-in-a-stacked-feature-`.

Scope outcomes (from jstoup111/ai-conductor#3210):
1. Classification first: findings are classified and admitted exactly as today.
2. Admitted work goes to its owning child.
3. Cannot host: a fix needing a later child's file is placed in the earliest child that has it.
4. Recorded first: the chosen child, reason and fallback are recorded durably and announced on the
   event spine before any change, and a crash recovers without duplicating or losing the round.
5. N=1 features route and remediate exactly as today.

Terms used below:
- **Routing on:** `stacked_prs.route_whole_feature_fixes` resolves to `true`, which is the default.
  A project that sets it `false` gets exactly the behavior from before this spec in every story below.
- **Stacked feature:** a feature whose cursor reports durable child state.
- **Three-child stack:** a stacked feature with slug `demo`, routing on, and positions `1`, `2`
  and `3`.
  - `feat/c1/demo` is closed at `refs/conductor/demo/closed/c1` and owns task `T1` and file
    `src/a.ts`.
  - `feat/c2/demo` is closed at `closed/c2`, owns task `T2` and adds file `src/b.ts`.
  - The leaf `feat/daemon-demo` (position 3) owns task `T3`, is checked out in the clean feature
    worktree, and the loop is on `prd_audit`.
  - The sealed envelope's `taskSlices` is `{T1: 1, T2: 2, T3: 3}`.
- **Routing refs:** the route record `refs/conductor/demo/routes/<roundId>`, the marker
  `refs/conductor/demo/repairing`, and the queue `refs/conductor/demo/revalidate`.
- **Admitted work:** what today's classification admits on the path that reaches remediation
  planning: FIXABLE and REMEDIABLE findings, refusal rework, merged `/remediate` gaps, and
  validation-group joins that carry gaps.

Delivered elsewhere: writing the routed blocks into a host's plan, the host's region, settlement,
the `Round:` stamp and `Child:`-line membership, FAIL-only and custom-step routing, and the verified
reroute are #3211. The routed exit, re-validation and the leaf return are #3212.

## Story 1: Classification runs first, and features without routing are untouched

**Requirement:** Scope outcomes 1 and 5; ADR decisions 1 and 17

As an operator, I want routing to start only after today's classification, and only where today's
path would send work into the build region of a stacked feature, so that no finding the existing
ADRs forbid becomes routed work and every other feature behaves exactly as before.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack, when `prd_audit` returns a FIXABLE finding owned by `T1`, then the finding is classified and admitted by today's rules before any routing ref is read or written, and a route record is then created for it.
- Given a three-child stack whose project sets `stacked_prs.enabled: false`, when `prd_audit` admits a FIXABLE finding owned by `T1`, then the work is still routed to a child, because the feature still has durable child state.
- Given an N=1 feature with routing on, when `prd_audit` admits a FIXABLE finding, then the remediation lap appends on the checked-out branch exactly as today and no routing ref is read or written.

#### Negative Paths
- Given the three-child stack with routing off, when `prd_audit` admits a FIXABLE finding owned by `T1`, then the rem task is appended on the leaf exactly as today and no routing ref is read or written.
- Given a three-child stack, when `prd_audit` returns a PLAN_GAP on a happy-path criterion that no task owns, then the feature halts exactly as `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` decision 7 requires, and no route record or marker is created.
- Given a three-child stack, when `prd_audit` returns an OVER_SCOPE finding against work in child 1 with no recorded refuse decision, then it is handled exactly as today and no route record is created.
- Given a three-child stack, when as-built returns a DESIGN finding citing a decision that `T2` implements, then the feature halts needs-human as today and no route record is created, even though an implementing child exists.
- Given a three-child stack, when `prd_audit` returns a FIXABLE finding with malformed evidence or no owning task, then it is refused with today's refusal reason and nothing is routed.
- Given a three-child stack, when a remediation work order contains an admitted fix together with a `halt` disposition, then the feature halts with today's halt detail and no route record or marker is created.
- Given a three-child stack, when a remediation work order names a disposition target that cannot be resolved, then the feature halts with today's unresolvable-disposition detail and no route record is created.
- Given a three-child stack, when a validation-group join's earliest target is `plan` or `coverage_binding`, then the kickback runs exactly as today and no route record is created.

### Done When
- [ ] The N=1 golden suite, with routing on, records through its `PATH`-shimmed `git` no command naming `refs/conductor/<slug>/routes`, `repairing` or `revalidate`.
- [ ] Parity tests compare each refusal and halt above in the three-child stack against the same verdict on an N=1 fixture: same halt class and reason, no routing ref in the recorded git argv, and no rem block added to any plan.
- [ ] A test with routing off asserts the three-child stack's plan gains the rem block on the leaf and no routing ref is touched.

## Story 2: Task-bound work goes to the child that owns the task, with no judgement

**Requirement:** Scope outcome 2; ADR decision 2

As a reviewer of a child PR, I want a fix to the work that child delivered to be placed in that
child, so that the PR I am reading receives its own fixes.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack, when `prd_audit` admits a FIXABLE finding owned by `T1`, then the route record names owner `1` and host `1` with reason `task-slice`, and no routing judgement call is made.
- Given a three-child stack whose plan holds a rem task `rem-prd-audit-T1` whose committed block carries `**Child:** 1`, when as-built admits a REMEDIABLE finding citing `task rem-prd-audit-T1`, then the owner is `1` with reason `rem-child-line`.
- Given a three-child stack whose rem task `rem-prd-audit-T1` has no `**Child:**` line and is recorded under child `1` in the engine's appended-remediation membership, when a finding cites it, then the owner is `1` with reason `rem-cache`.
- Given a three-child stack, when one `prd_audit` pass admits findings owned by `T1` and `T3`, then the route record names hosts `1` and `3`, in that order.
- Given a three-child stack, when as-built admits a REMEDIABLE finding citing `task T2,T3`, then the owner is `2` with reason `multi-task-earliest`, and no routing judgement call is made.
- Given a three-child stack, when a merged `/remediate` gap with an `existing-task` disposition binds `T2`, then the owner is `2` with no routing judgement call.

#### Negative Paths
- Given a three-child stack, when a finding is owned by `T2` and a stubbed routing judgement would have answered `1`, then the owner is still `2` and the judgement is never called.
- Given a three-child stack whose sealed envelope has no `taskSlices` entry for the owning task, when the finding is routed, then the feature halts needs-human naming the task, and no route record is created.
- Given a rem task whose committed `**Child:**` line names position `7` while positions `1`, `2` and `3` are declared, when a finding cites it, then the feature halts needs-human naming the task and position `7`, and no route record is created.
- Given a rem task with neither a `**Child:**` line nor an appended-remediation membership entry, when a finding cites it, then the feature halts needs-human naming the task, and no child is guessed.

### Done When
- [ ] Tests assert owner derivation from `taskSlices`, from a committed `**Child:**` line, from the membership fallback, and by the earliest-owner rule, each with its recorded reason.
- [ ] Tests assert that no judgement call occurs for any task-bound item, using a judge spy.
- [ ] Tests assert each halt above names the task, and that the recorded git argv holds no `refs/conductor/demo/routes/` write.

## Story 3: Residue work is placed by one validated routing call, and mixed rounds need no judgement

**Requirement:** Scope outcome 2; ADR decision 3

As an operator, I want findings that cite no task to be placed by one bounded judgement that
machinery checks, so that ambiguous work still lands in a sensible child and an invalid answer never
guesses.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack, when as-built admits a REMEDIABLE finding citing only `adr-x D2` and the routing call returns `{child: 2, candidates: [2], rationale: "implements D2"}`, then the owner is `2` with reason `residue-judged` and the rationale is recorded.
- Given a three-child stack, when the routing call returns `{child: 2, candidates: [1, 2], rationale: "ambiguous ownership"}` for a residue item, then the owner is `1` with reason `residue-default`.
- Given a three-child stack, when an operator-refused `prd_audit` decision produces refusal rework and the routing call answers `2`, then the rework's rem blocks are frozen under host `2` only.
- Given a three-child stack, when one round holds two residue items and a `T1`-bound finding, then exactly one routing call is made, its item list holds the two residue items, and the `T1`-bound finding is not in it.
- Given a three-child stack, when one validation-group join produces a FIXABLE gap owned by `T2` together with `manual_test` FAIL rows, then no routing call is made, the FAIL obligation is placed with host `2` with reason `mixed-round`, and the FAIL rows appear verbatim in host `2`'s retry hint.
- Given a three-child stack, when the routing call has run, then the `prd_audit` judgment contract version is still `v1`, the as-built verdict contract version is still `v2`, and both verdict schemas are unchanged.

#### Negative Paths
- Given a three-child stack, when the routing call returns child `7`, which is not declared, then it is asked once more, and when the second answer is also undeclared the feature halts needs-human naming the item, with no route record created.
- Given a three-child stack, when the routing call returns malformed output twice, then the feature halts needs-human naming the item, and the `prd_audit` and as-built lap counts in the kickback ledger are unchanged by the routing call.
- Given a three-child stack, when the routing call times out on both attempts, or the provider reports it is unavailable on both, then the feature halts needs-human naming the item, and no routing ref is written.
- Given a three-child stack whose step runner provides no residue routing judgement, when a round holds a residue item, then the feature halts needs-human naming the item before any routing ref is written.
- Given a mixed round whose task-bound gaps are owned by `T1` and `T3` and which carries FAIL rows, when the round is routed, then the FAIL obligation goes to host `1`, and the FAIL rows ride both host `1`'s and host `3`'s retry hints.
- Given a mixed round with FAIL rows and an `existing-task` gap bound to `T2`, when the round is routed, then the gap rides host `2`'s retry hint, its routed item is marked not to restage, and `T2` is not restaged.
- Given a three-child stack, when a validation-group join's only failure is `manual_test` FAIL rows, then this spec leaves it unchanged: the deterministic `manual_test` kickback runs exactly as today and no route record is created, because routing FAIL-only work is delivered by #3211.

### Done When
- [ ] Tests cover judged, defaulted, refusal-rework, mixed-round, invalid-twice, malformed-twice, timeout, unavailable and missing-judge outcomes.
- [ ] The routing call has its own schema, its own contract version and a two-attempt budget, all asserted by tests.
- [ ] A test compares SHA-256 digests of the serialized `prd_audit` and as-built verdict schemas with digests committed at the spec base.

## Story 4: A fix that needs a later child's files is hosted where those files exist

**Requirement:** Scope outcome 3; ADR decision 4

As an operator, I want a fix placed in the earliest child that can actually build it, so that a child
is never asked to fix code it does not contain.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack, when a work order owned by `T1` cites `src/b.ts`, which is present at the leaf tip, absent at `closed/c1` and present at `closed/c2`, then the host is `2` with reason `prerequisite-paths`, the owner stays `1`, and `taskSlices.T1` is still `1`.
- Given a three-child stack, when a work order owned by `T1` cites `src/new.ts`, which is absent at the leaf tip, then `src/new.ts` is treated as an output and the host stays `1`.
- Given a three-child stack, when one round hosts items on child `1` and on the leaf, then the route record's host order places child `1` first and the leaf last.

#### Negative Paths
- Given a three-child stack, when a work order owned by `T1` cites a path present at the leaf tip but absent from `closed/c1` and `closed/c2`, then the host is the leaf with reason `prerequisite-paths`, and the owner stays `1`.
- Given a work order owned by `T2` citing a path present at `closed/c1` and the leaf tip but absent at `closed/c2`, when the host is chosen, then child `1` is never chosen and the host is the leaf with reason `prerequisite-paths`.
- Given a work order owned by `T1` citing `src/b.ts` and a path that only the leaf adds, when the host is chosen, then child `2` is not chosen because it lacks one input, and the host is the leaf.
- Given the leaf tip cannot be read while cited paths are classified, when the host is chosen, then the feature halts needs-human naming the leaf branch, and no route record is created.
- Given a closure ref that cannot be read while hosts are compared, when the host is chosen, then the feature halts needs-human naming the child, and no route record is created.

### Done When
- [ ] Real-git tests assert input-versus-output classification by leaf-tip presence, and the earliest-above-owner host over every prerequisite input.
- [ ] Tests assert the host order of a multi-host round, with the leaf last.
- [ ] Tests assert host selection never reads or writes slice membership.

## Story 5: Admission records the round and the marker before anything else changes, and survives a crash

**Requirement:** Scope outcome 4; ADR decisions 6 and 7

As an operator, I want each routed round recorded before anything changes and recovered after any
crash, so that a round is never lost, duplicated or closed over.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack, when a FIXABLE finding owned by `T1` is admitted, then a route record is created in phase `prepared` with every host `pending` and a frozen allocation for every host, and no plan file on any branch is modified.
- Given that `prepared` record, when admission continues, then one transaction creates the marker `{host: 1, roundId}`, moves the round to `open` and marks host `1` `admitted`, and only then does remediation planning return a route to `build`.
- Given an admitted round, when the frozen allocation is read, then each rem block body carries its host's `**Child:**` line and the round's `**Round:**` line, and every rem id is unique across the leaf's plan and every host's plan.
- Given an admitted round with hosts `1` and `3`, when the route is followed, then exactly one `kickback` event and exactly one leaf `navigateBack` to `build` are recorded.
- Given an admitted round, when remediation planning returns its route, then no rem block is appended on the leaf and the route-into-no-op guard is not evaluated at the leaf.
- Given a feature resuming with no route record, when the next round is admitted, then its round id is `r1`, and later rounds take the next unused id.

#### Negative Paths
- Given a crash after the route record is `prepared` and before the marker exists, when the feature resumes, then the record is deleted, no marker exists, and the next leaf gate pass admits the work as a fresh round.
- Given a `prepared` round `r1` left after its marker transaction lost to a marker for round `r2`, when the feature resumes after the halt is cleared, then `r1` is deleted because no marker names it, and `r2` and its marker are unchanged.
- Given a crash after the marker transaction and before the leaf is navigated, when the feature resumes, then the leaf is navigated back to `build`, and there is still exactly one route record and one marker.
- Given the marker transaction, when another writer has already created a marker for round `r2`, then the transaction fails, the round stays `prepared`, and the feature halts needs-human naming both rounds.
- Given the marker transaction, when another writer has moved the route record since it was read, then the transaction fails, and neither the marker nor host `1` `admitted` is written.
- Given a restack journal that is not `applied` or `aborted`, when admission tries to create or update a route record, then the write is refused, the record keeps its prior value, and no marker is written.
- Given admission has read a terminal or absent restack journal, when a restack creates or advances the journal before admission's transaction commits, then the transaction fails and no routing ref is written.
- Given an `applied` restack journal that still carries a pending base-refresh follow-on, when admission tries to create a route record, then the write is refused and no routing ref is written, so no round can open while that follow-on is outstanding.
- Given route records `r1` through `r999` already exist, when a new round is admitted, then the feature halts needs-human naming the round limit, and no record is created.
- Given a host in state `pending`, when any writer tries to move it directly to `built`, then the transition is refused and the record is unchanged.

### Done When
- [ ] Real-git tests kill the process after the `prepared` write and after the marker transaction, and assert recovery converges with exactly one or zero records and markers and no rem block on any branch.
- [ ] A test asserts every routing ref write is an `update-ref --stdin` transaction carrying a `verify` line for the restack journal ref, including under an injected concurrent writer.
- [ ] A test asserts the ordered git argv of admission: the record create, then the single marker transaction, before the route is returned.

## Story 6: An open round holds back the automatic restack and every base refresh

**Requirement:** Scope outcome 4; ADR decision 7

As an operator, I want the stack left exactly where it is while a routed round is open, so that no
automatic restack or base refresh moves a closure over a half-built fix.

### Acceptance Criteria

#### Happy Path
- Given a feature resuming with a round open, when the stack preflight runs, then journal recovery runs first, then round reconciliation, then the cursor is resolved.
- Given host `1` `admitted` and two new commits on `feat/c1/demo` past `closed/c1`, when the stack preflight runs, then no `feature-repair` restack runs and `closed/c1` and `feat/c2/demo` are unchanged.
- Given no route record that is not `closed` and an empty queue, when a base refresh is due, then it runs exactly as today.

#### Negative Paths
- Given host `1` `admitted` and an unstamped operator commit on `feat/c2/demo` past `closed/c2`, when the stack preflight runs, then no automatic restack runs for child 2 and no restack journal is created.
- Given a round open and a daemon re-kick requesting a base refresh, when the stack preflight runs, then no ref moves, one `restack_refused` with reason `deferred-base-refresh` is emitted, and the re-kick request is kept.
- Given a round open, when the daemon re-kick resume reaches its base refresh, then it emits `restack_refused` with reason `deferred-base-refresh`, runs no base-refresh restack, leaves every branch and `refs/conductor/demo/` ref unchanged, keeps the re-kick request, and continues the resume instead of halting.
- Given a round open, when the FINISH rebase reaches its base refresh, then it emits `restack_refused` with reason `deferred-base-refresh`, runs no base-refresh restack, leaves every branch and `refs/conductor/demo/` ref unchanged, and the feature is not published.
- Given a route record that is not `closed` and no marker, when a base refresh is due, then it is still deferred, because the marker alone does not decide whether a round is open.

### Done When
- [ ] A test asserts the preflight call order of journal recovery, round reconciliation and cursor resolution, for both the conductor resume and the daemon re-kick callers.
- [ ] Tests at all three base-refresh sites (preflight follow-on, daemon re-kick resume, FINISH rebase) assert a `for-each-ref` snapshot of `refs/heads/` and `refs/conductor/demo/` is unchanged and one `deferred-base-refresh` refusal is emitted.
- [ ] A test asserts the first preflight after the last round closes, with an empty queue, runs the deferred base refresh.

## Story 7: Every routing decision and phase change is visible on the event spine, exactly once

**Requirement:** Scope outcome 4; ADR decision 16

As an operator watching the daemon, I want each routing decision and host phase change on the
existing event stream, so that every consumer sees it without a new reader.

### Acceptance Criteria

#### Happy Path
- Given a round is admitted with items owned by `T1` and `T2`, when `.pipeline/events.jsonl` is read, then it holds exactly one `remediation_routed` event naming the round, each item's owner, host and reason, and `child` `1`.
- Given host `1` moves from `pending` to `admitted`, when the event log is read, then it holds exactly one `routed_repair_phase` event for host `1` with phase `admitted`.

#### Negative Paths
- Given a round aborted on resume because it was `prepared` with no marker naming it, when the work is re-admitted as a fresh round with the same round id, then `events.jsonl` holds exactly one `remediation_routed` event for that round id, from the fresh round.
- Given a crash after an event is persisted and before it is removed from the route record's outbox, when the feature resumes and the outbox drains again, then `events.jsonl` still holds that event exactly once, with its original `eventId` and occurrence time.
- Given a transition refused as illegal, when the event log is read, then no `routed_repair_phase` event exists for it and the record's outbox is unchanged.
- Given code outside the routing event module that builds a `remediation_routed` or `routed_repair_phase` event literal, when the structural check runs, then it fails naming the file.

### Done When
- [ ] Drain-to-log tests through a real `EventPersister` assert the exact event counts and fields above.
- [ ] A test asserts each event is written into the outbox in the same transaction as the state it reports, and that `remediation_routed` is written by the marker transaction, never by the `prepared` create.
- [ ] A structural test fails on an in-memory fixture that builds either event type outside its constructor module.
