**Status:** Accepted

# Stories: Stack-aware feature identity and per-child state foundation (#2940)

Technical track. The criteria come from the operator-confirmed scope boundary in
`.docs/track/engine-cannot-represent-more-than-one-branch-step-.md`, from
`adr-2026-10-03-stacked-child-plans-identity-and-state`, and from the conditions in the architecture
review.

Terms used throughout:
- **Leaf branch:** `feat/daemon-<slug>`.
- **Child branch:** `feat/c<k>/<slug>`.
- **Child id:** an integer from 1 to 9.
- **Child state:** files under `.pipeline/children/<k>/` in a feature worktree.
- **No child:** a feature has no child when it has no child state and no `--child` is given. That is
  every feature the engine builds today.
- **Region steps:** `acceptance_specs`, `build`, `test_suite` and `build_review`.
- **Whole-feature steps:** every other step.

## Story 1: Every operator-facing output is byte-for-byte unchanged for a feature with no child

**Traces to:** ADR decision 14; scope item (1)

As an operator, I want proof that this foundation changes nothing for today's single-PR features, so
that it can land before anything stacked exists.

### Acceptance Criteria

#### Happy Path
- Given golden fixture files recorded from the commit before this change, when the golden suite runs a feature with `stacked_prs.enabled` false through its state-producing entry points, then the bytes of these outputs equal the fixtures after normalizing only timestamps and the fixture root path, and with interval-timing fields left out of the comparison: `conduct-state.json`, `task-status.json`, `current-task`, the set of gate verdict file paths and each verdict file, `events.jsonl`, and `kickback-ledger.json`
- Given the same fixtures, when the golden suite runs with `stacked_prs.enabled` true and an unsliced plan, then every output listed in the first criterion equals the same fixtures
- Given the same fixtures, when the golden suite runs with `stacked_prs.enabled` false and a plan declaring three slices, then every output listed in the first criterion equals the same fixtures and no `.pipeline/children/` directory exists afterwards
- Given each of the three configurations, when the golden suite renders `rewind --to <step>` output and its `operator_rewind` record, `kickback-budget inspect` output, `daemon status` lines, the dashboard view, the PR body and the shipped-record Cost block, then each rendering equals its fixture

#### Negative Paths
- Given a change that alters any non-normalized byte of a golden-covered output (for example a reordered key in `conduct-state.json`), when the golden suite runs, then it fails and names the output file and the first differing line
- Given a change that adds a `"child"` key to any event when no child is present, when the golden suite runs, then the `events.jsonl` comparison fails
- Given a change that creates any entry under `.pipeline/children/` for a feature with no child, when the golden suite runs, then it fails naming the created path
- Given a change that renders a `daemon status` line, the dashboard, the PR body or the Cost block differently, when the golden suite runs, then it fails naming the rendering and the first differing line

### Done When
- [ ] Committed golden fixture files carry a header naming the commit they were recorded from, and the golden suite passes unchanged when run against that commit
- [ ] Interval-timing fields and the shipped-record Time block are not part of any golden comparison
- [ ] The suite runs every covered surface in the three cells: flag off, flag on with an unsliced plan, and flag off with a sliced plan
- [ ] No golden test file imports a module introduced by this change

## Story 2: A branch name resolves to exactly one feature identity

**Traces to:** ADR decisions 1, 5 and 6; scope item (2)

As the engine, I want one place that decides which feature a branch belongs to and in what role, so
that no consumer can derive a wrong or colliding slug from a child branch.

### Acceptance Criteria

#### Happy Path
- Given `feat/daemon-x`, when the branch identity is resolved, then it is the leaf of feature `x`
- Given `feat/c2/x`, when the branch identity is resolved, then it is child 2 of feature `x`
- Given `feat/c9/engine-cannot-represent-more-than-one-branch-step-` (a slug ending in a hyphen), when the branch identity is resolved, then it is child 9 of that exact slug
- Given `feat/daemon-c1`, when the branch identity is resolved, then it is the leaf of feature `c1`, not a child
- Given `spec/x` and `feature/x`, when each branch identity is resolved, then they are the spec branch and the interactive branch of feature `x`
- Given slug `x` and child id 3, when the child branch name is constructed, then it is `feat/c3/x`
- Given slug `x`, when the leaf branch name is constructed, then it is `feat/daemon-x`
- Given `refs/heads/feat/c1/x` and `origin/feat/c1/x` listed by the intake-overlap enumeration, when each branch identity is resolved there, then both are child 1 of feature `x`

#### Negative Paths
- Given `feat/c0/x`, `feat/c10/x`, `feat/c01/x` or `feat/cool/x`, when the branch identity is resolved, then it is unrecognized, with a reason naming an invalid child id
- Given `feat/c1`, `feat/c1/` or `feat/c1/a/b`, when the branch identity is resolved, then it is unrecognized, with a reason naming a missing or multi-segment slug
- Given `feat/daemon-`, when the branch identity is resolved, then it is unrecognized with an empty-slug reason
- Given `refs/heads/feat/c1/x` or `origin/feat/c1/x` passed where a short branch name is expected, such as the current-branch check, when the branch identity is resolved, then it is unrecognized
- Given slug `x` and child id 0 or 10, when a child branch name is constructed, then construction is refused naming the invalid child id and no name is returned
- Given slug `a/b` or an empty slug, when a child branch name is constructed, then construction is refused naming the invalid slug and no name is returned
- Given a slug containing `/` or ending in a hyphen, when the leaf branch name is constructed, then it equals `feat/daemon-` followed by that slug unchanged, exactly as today's template produces

### Done When
- [ ] One module owns branch identity and returns leaf, child, spec, interactive or unrecognized results. A table test covers every example above
- [ ] A drift test fails if any migrated consumer tests `feat/daemon-`, `spec/` or `feature/` branch literals itself rather than calling the identity module
- [ ] The child-id ceiling is 9, and a test asserts the slice-count bound used at land is no greater than that ceiling

## Story 3: Every existing branch consumer behaves exactly as today for every non-child branch

**Traces to:** ADR decision 2; architecture-review condition 2

As an operator, I want the four slug parsers replaced without any change in what they accept, refuse
or print, so that no feature the daemon builds today is affected.

### Acceptance Criteria

#### Happy Path
- Given `conduct-state.json` whose `worktree_branch` is `spec/x`, `feature/x` or `feat/daemon-x`, when `finish-record --choice pr` runs, then it derives feature `x` and writes the same records as before
- Given an open PR whose head is `feat/daemon-x`, when the halt-PR reconciliation sweep and the daemon halt-PR operations run, then they act on feature `x`, probing exactly the refs they probe today
- Given current branch `feat/daemon-x` or `spec/x`, when a feature-scoped GitHub operation runs, then it resolves feature `x` and reaches the same owner check as today
- Given worktree creation, teardown, the shipped-record probe and CI-fix for feature `x`, when each runs, then each uses `feat/daemon-x`, identical to today's string

#### Negative Paths
- Given `conduct-state.json` whose `worktree_branch` is `feat/daemon-`, `spec/`, `feature/` or `main`, when `finish-record --choice pr` runs, then it refuses with today's message, exits 1 and writes nothing
- Given current branch `feature/x` and a GitHub operation whose context names feature `x`, when the operation runs, then it is refused `invalid-target` exactly as today
- Given current branch `feat/daemon-` and a GitHub operation whose context names feature `x`, when the operation runs, then it is refused `invalid-target` exactly as today
- Given an open PR whose head is `feat/daemon-a/b`, when the halt-PR consumers resolve it, then they resolve slug `a/b` exactly as today
- Given an open PR whose head is `main` or `hotfix/y`, when the halt-PR reconciliation sweep and the daemon halt-PR operations run, then they take no action on it, exactly as today
- Given feature slug `a/b` or a slug ending in a hyphen, when teardown, worktree creation, the shipped-record probe or CI-fix builds the leaf branch name, then the name equals today's `feat/daemon-` template output for that slug

### Done When
- [ ] Each of the four former parsers (finish-record, halt-PR reconciliation, daemon halt-PR operations, GitHub-operations scope) has a table-driven parity test. It covers every input form accepted or refused today and asserts identical slug, output, exit code and message

## Story 4: A child branch is attributed to its feature and never acted on as a separate feature

**Traces to:** ADR decisions 2 and 3; scope item (2)

As an operator, I want every consumer that meets a child branch to treat it as part of its parent
feature, so that a child is never recorded as a ship, counted as another in-flight feature, or
deleted by park.

### Acceptance Criteria

#### Happy Path
- Given an open PR whose head is `feat/c1/x`, when the halt-PR reconciliation sweep runs, then it attributes the PR to feature `x` and looks for `.docs/shipped/x.md` on `feat/daemon-x` and `origin/feat/daemon-x`
- Given an unmerged branch `feat/c2/x` alongside `feat/daemon-x`, when intake overlap enumerates in-flight work, then both rows name feature `x` and no row names `c2` or `x-c2` as a feature
- Given a parked feature whose worktree lists branch `feat/c1/x`, when the park sweep classifies the candidate, then it is attributed to feature `x` as a daemon-owned branch, never as a non-daemon branch that is reclaimable on its deletion proofs alone
- Given an open PR whose head is `feat/c1/x` and an existing `feat/daemon-x`, when the daemon halt-PR operations run, then they act for feature `x`

#### Negative Paths
- Given `conduct-state.json` whose `worktree_branch` is `feat/c1/x`, when `finish-record --choice pr` runs, then it refuses with a message naming the child branch form and stating that only the leaf records a ship. It exits 1 and writes no `pr_url`, no finish choice and no shipped record
- Given a parked feature whose worktree lists branch `feat/c1/x`, when the park sweep runs, then the candidate is refused with a refusal reason reserved for child branches before the shipped-record precondition is evaluated, it is counted as refused in the sweep summary and emitted as a `worktree_reclaim_failed` event naming feature `x` and branch `feat/c1/x`, and neither the worktree nor `feat/c1/x` is removed
- Given a parked feature listing `feat/c1/x`, a merged PR whose head is `feat/c1/x`, and no `.docs/shipped/x.md` on `origin/main`, when the park sweep runs, then no shipped-record repair is requested, and no merged-PR lookup uses a `feat/c1/` head
- Given a parked feature with no listed branch while both `feat/daemon-x` and `feat/c1/x` exist, when the park sweep runs, then no `git branch -d` runs for `feat/c1/x` and `feat/daemon-x` is handled exactly as it is today
- Given an open PR whose head is `feat/c1/x` while `feat/daemon-x` does not exist, when the daemon halt-PR operations run, then they take no action for that PR
- Given a leaf-existence check that fails with a git error, when the daemon halt-PR operations evaluate a child PR, then they take no action for that PR and continue with the next PR
- Given hand-made branches `feat/cool/x` and `feat/c1-x/baz`, when intake overlap enumerates, then neither appears in the report
- Given `feat/c1/x` while `.docs/shipped/x.md` is on the default branch, when intake overlap enumerates, then the child row is excluded exactly as a shipped `feat/daemon-x` row is excluded today
- Given branches `feat/c1/a/b` and `feat/c1/` returned by the child ref patterns, when intake overlap enumerates, then neither appears in the report, no further git command runs for either, and no skip note is written

### Done When
- [ ] Unit tests for halt-PR reconciliation, daemon halt-PR operations, intake overlap and park cover each criterion with child-branch fixtures
- [ ] A finish-record test asserts that a child `worktree_branch` exits 1 with the child-form message and leaves `conduct-state.json` byte-unchanged

## Story 5: GitHub feature writes from a child branch are authorized only for its own feature

**Traces to:** ADR decisions 2 and 3; `adr-2026-09-11-github-operation-ownership` D2 as amended

As an operator, I want a child branch to authorize GitHub writes for exactly its parent feature, so
that recognizing child branches never widens who may mutate a feature.

### Acceptance Criteria

#### Happy Path
- Given current branch `feat/c1/x`, an existing local `feat/daemon-x`, and an operation whose context names feature `x`, when the operation runs, then it proceeds to the unchanged committed-owner check for feature `x`
- Given current branch `feat/c1/x` and a `feat/daemon-x` that exists only on `origin`, when the operation runs for feature `x`, then it proceeds to the same owner check
- Given an authorized operation from `feat/c1/x`, when it pushes or binds a PR, then the push target is `feat/c1/x` itself and the PR is the one whose head is `feat/c1/x`

#### Negative Paths
- Given current branch `feat/c1/x` and no `feat/daemon-x` locally or on `origin`, when an operation for feature `x` runs, then it is refused `invalid-target` before any git or GitHub write
- Given current branch `feat/c1/x` and an operation whose context names feature `y`, when it runs, then it is refused `invalid-target` before any write
- Given current branch `feat/c1/x` whose feature `x` has a committed owner other than the machine's operator, when the operation runs, then it is refused by the owner check exactly as it would be from `feat/daemon-x`
- Given a leaf-existence check that fails with a git error, when an operation from `feat/c1/x` runs, then it is refused `invalid-target` and nothing is written
- Given an authorized push from `feat/c1/x`, when the push runs, then no ref other than `feat/c1/x` is updated, and in particular `feat/daemon-x` is untouched

### Done When
- [ ] GitHub-operations scope tests cover each criterion and assert that no transport call is made on any refusal

## Story 6: Child state is isolated per child and never written for a feature with no child

**Traces to:** ADR decision 8; scope item (3)

As the engine, I want each child's step status, gate verdicts and kickback-ledger entries in their
own files, so that no child overwrites another child's state or the feature's.

### Acceptance Criteria

#### Happy Path
- Given no child, when step status, a gate verdict or the kickback ledger is read or written, then the path is today's `.pipeline/` path
- Given child 2, when its step status, a region gate verdict or its kickback ledger is read or written, then the path is under `.pipeline/children/2/` with the same file name and schema as the flat file, and child 2's step-status file records region step statuses and a `last_step`
- Given child 2 and child 3 each with a `build_review` verdict, when child 2's verdict is rewritten, then child 3's verdict file and the flat `gates/build_review.json` are byte-unchanged
- Given a worktree containing `.pipeline/children/2/`, when the engine lists all gate verdicts or probes test-suite evidence, then entries under `children/` are not included and the result matches the result without that directory
- Given a fresh session starting in a worktree with `children/1/kickback-ledger.json` and `children/2/kickback-ledger.json`, when the kickback ledger is cleared, then the flat ledger and both child ledgers are removed and every other file under `children/` remains

#### Negative Paths
- Given a corrupt `children/2/kickback-ledger.json`, when child 2's ledger is read, then the read fails closed with the `kickback ledger is corrupt` reason a corrupt flat ledger produces, naming the child ledger's path, and is never treated as an empty ledger
- Given child 2 with no step-status file, when child 2's step status is read, then it reads as absent, the same as a missing flat file, and no file is created by the read
- Given directories `.pipeline/children/foo/` and `.pipeline/children/12/` each holding a `kickback-ledger.json`, when the fresh-session clear runs, then neither file is removed or read
- Given two writers that both read child 2's step status and then submit conflicting mutations to the same field, when both are applied, then the second writer receives a typed `conflict` result naming the field and the intent, and the file holds the first writer's value with no partial write
- Given a whole-feature step such as `prd_audit` or `manual_test`, when its status or verdict is written while child state exists, then it is written to the flat `.pipeline/` path and never under `children/`
- Given a child gate verdict path, when it is formed for a whole-feature step such as `prd_audit`, then it is refused naming the step as whole-feature, and no file is written

### Done When
- [ ] Store tests cover flat and child paths for step status, region gate verdicts and the kickback ledger, including isolation, the sweep, the clear, corrupt files and conflicts
- [ ] A test asserts that operations for a feature with no child create no `.pipeline/children/` entry

## Story 7: An operator rewinds one child and everything built on it

**Traces to:** ADR decision 13; `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` as amended; scope item (6)

As an operator, I want `rewind --to <step> --child <k>` to demote that child from the target onward
together with everything that depends on it, so that recovery on a stacked feature never leaves a
downstream step marked done.

### Acceptance Criteria

#### Happy Path
- Given children 1, 2 and 3 each with child state and every region step done, plus `manual_test` and `prd_audit` done, when `rewind --to build --child 2` runs, then child 2's `build`, `test_suite` and `build_review` are `stale` and its `acceptance_specs` is unchanged
- Given the same fixture, when that rewind runs, then every region step of child 3 is `stale` and every status of child 1 is unchanged
- Given the same fixture, when that rewind runs, then every non-skipped whole-feature step after `build_review`, including `manual_test` and `prd_audit`, is `stale`, and `coverage_binding` is unchanged
- Given the same fixture, when that rewind runs, then child 2's `last_step` names the region step before `build`, and the feature's `last_step` names the step before the first demoted whole-feature step
- Given the same fixture, when that rewind completes, then the gate verdicts of every demoted step are removed, `.pipeline/HALT` and its class file are cleared as a rewind clears them today, and one `operator_rewind` event names the target step, child 2 and the demoted set
- Given any `rewind --to <step>` invocation without `--child`, when it runs, then its output, state changes and event are byte-identical to today

#### Negative Paths
- Given `rewind --to prd_audit --child 2`, when it runs, then it is refused with a message stating that only `acceptance_specs`, `build`, `test_suite` and `build_review` can be rewound per child, and nothing is written
- Given `--child 4` where `.pipeline/children/4/` does not exist, when the rewind runs, then it is refused naming child 4 as having no child state, and nothing is written
- Given `--child 0`, `--child 10` or `--child two`, when the rewind runs, then it is refused naming the invalid child id and nothing is written
- Given `rewind --to build --child 2 --child 3`, or a `--child` with no value, when the CLI parses it, then it falls through to today's `unknown command` error and exit code
- Given `children/2/conduct-state.json` whose `last_step` is `build`, when `rewind --to test_suite --child 2` runs, then it is refused because a rewind only goes backward from the child's current position, and nothing is written
- Given a port mutation refused partway through a child rewind, after child 2's demotions were applied but before child 3's, when the rewind aborts, then child 2's and the feature's state are restored to their pre-rewind values, it reports the refused field with expected and current values, and it clears no verdict and no halt
- Given verdict clearing that fails after every state demotion was applied, when the rewind aborts, then every demoted state file is rolled back to its pre-rewind values and `.pipeline/HALT` is left in place, as today's rewind does for the feature state

### Done When
- [ ] Rewind tests cover each criterion against fixtures with three children of child state
- [ ] The `operator_rewind` record for a child rewind carries the `child` field. The record for a rewind without `--child` has no `child` key

## Story 8: An operator checks a task against the child that owns it

**Traces to:** ADR decision 13; `adr-2026-09-29-plan-slice-manifest` D6 as amended; scope item (6)

As an operator, I want `task --child <k>` to confirm that the task belongs to child k, so that I
cannot point a child's work at a task that another child owns.

### Acceptance Criteria

#### Happy Path
- Given a feature with child state for child 2 and task 7 recorded in the slice membership as belonging to slice position 2, when the operator runs `task start 7 --child 2`, then the command behaves exactly as `task start 7`, and `.pipeline/current-task` is written at its usual flat path
- Given the same feature, when the operator runs `task done 7 --child 2` with any `--done-when` evidence, then it behaves exactly as the same command without `--child`
- Given an engine-appended remediation task id that has no slice membership, when the operator runs `task start <id> --child 2`, then it is accepted
- Given any `task` invocation with no `--child` flag, including `task start <id>` followed by extra arguments that are not `--child`, when it runs, then its output and writes are byte-identical to today

#### Negative Paths
- Given task 3 whose recorded membership is slice position 1, when the operator runs `task start 3 --child 2`, then it is refused naming task 3, child 1 and child 2, and `.pipeline/current-task` is unchanged
- Given a feature with no `.pipeline/children/2/`, when `task start 7 --child 2` runs, then it is refused naming child 2 as having no child state, and nothing is written
- Given a worktree with `.pipeline/children/2/` but no coverage-binding envelope, when `task start 7 --child 2` runs, then it is refused with a message stating that no slice membership is recorded for the feature, and nothing is written
- Given `task done 7 --child 2 --child 2` or `task done 7 --child` with no value, when it is parsed, then the command prints today's task guidance and exits 2
- Given `task start 7 --child 2 --child 2` or `task start 7 --child` with no value, when it is parsed, then the command prints today's task guidance and exits 2, and `.pipeline/current-task` is unchanged

### Done When
- [ ] Task-command tests cover each criterion, including the remediation-task exemption and the missing-envelope refusal

## Story 9: An operator inspects one child's kickback budget

**Traces to:** ADR decision 13; `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` D4 as amended; scope item (6)

As an operator, I want `kickback-budget inspect --child <k>` to show that child's region gate
entries, so that a stalled child can be diagnosed without hand-reading files.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/children/2/kickback-ledger.json` with a `build_review` entry, when the operator runs `kickback-budget inspect --feature <slug> --child 2`, then the human output names child 2 once above that entry's gate block
- Given the same ledger, when the operator runs `kickback-budget inspect --feature <slug> --child 2 --format json`, then the JSON object carries `"child": 2` alongside today's fields
- Given any `kickback-budget` invocation without `--child`, when it runs, then its output is byte-identical to today

#### Negative Paths
- Given `kickback-budget raise` or `kickback-budget reset` with `--child 2`, when it runs, then it falls through exactly as an unrecognized flag does today, and no ledger is read or changed
- Given no `.pipeline/children/3/`, when `inspect --child 3` runs, then it is refused naming child 3 as having no child state
- Given a corrupt `children/2/kickback-ledger.json`, when `inspect --child 2` runs, then it prints today's `kickback-budget: ledger is unreadable.` error and exits 1
- Given `inspect --feature <slug> --child 2 --child 2`, when it is parsed, then it falls through exactly as a repeated flag does today

### Done When
- [ ] Kickback-budget CLI tests cover each criterion, and the human and JSON child forms are pinned

## Story 10: Events can name a child and are unchanged without one

**Traces to:** ADR decision 12; scope item (5)

As an operator, I want events to name the child they concern, so that per-child activity is visible on
the event spine without a second channel.

### Acceptance Criteria

#### Happy Path
- Given a child rewind of child 2, when its `operator_rewind` event is persisted, then the `events.jsonl` record contains `"child":2`
- Given events tagged with child 2 and events with no child, all for one feature, when cost and time are rolled up for the shipped record, then each step's totals equal the totals computed with the child tags removed, so Cost and Time are reported once per feature

#### Negative Paths
- Given an event emitted with no child, when it is persisted, then the record contains no `child` key at all, neither `null` nor an empty value
- Given an event built by spreading an existing event that had no child, when it is persisted, then the record still contains no `child` key
- Given events tagged with two different children for the same step, when cost and time are rolled up, then that step appears once in the Cost and Time blocks with the summed totals, never once per child

### Done When
- [ ] A persister test asserts the absence of the `"child"` substring for every no-child record and its presence for a child record
- [ ] A rollup test asserts identical per-step Cost and Time totals with and without child tags
- [ ] The event-sink registry's compile-time exhaustiveness check passes with no new event type added
