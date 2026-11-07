**Status:** Accepted

# Stories: build-review record-reduced-coverage refuses every stacked-feature child (#3498)

This is a technical-track change, so there is no PRD. The acceptance criteria come from the
desired outcomes of jstoup111/ai-conductor#3498 and from these existing decisions:
- `adr-2026-10-07-per-child-build-region` decisions 4, 9 and 10 put each child's `build_review`
  review state and kickback-ledger entry under `.pipeline/children/<k>/`. Decision 10 also says a
  cap halt names the child.
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D6 defines what
  `record-reduced-coverage` requires. D9 keeps the record feature-scoped with no expiry.
- `adr-2026-10-20-operator-acceptance-is-durable-case-state` D9 keeps the disposition store
  feature-scoped.

Terms used below:
- **A stacked feature** is a feature worktree with child state under `.pipeline/children/`.
- **Child 2's aggregate** is `.pipeline/children/2/build-review.json`.
- **The root aggregate** is `.pipeline/build-review.json`.
- **Child 2's ledger** is `.pipeline/children/2/kickback-ledger.json`.
- **The root ledger** is `.pipeline/kickback-ledger.json`.
- **The disposition store** is the feature-scoped `.pipeline/build-review-dispositions.json`.
- **An exhausted ledger** records `build_review` `mechanicalFaults` of 3, which equals
  `MAX_MECHANICAL_FAULTS_BUILD_REVIEW`.
- **The operator** is an interactive terminal session with a verified local operator identity,
  unless a criterion says otherwise.

## Story 1: record-reduced-coverage records a decision for a stacked child

**Requirement:** intake outcome 1, intake outcome 2

As an operator recovering a stacked feature halted on an exhausted `build_review` mechanical
fault in a child, I want `build-review record-reduced-coverage --child <k>` to record reduced
coverage against that child's current lap and allowance, so that the child's next review pass can
proceed without a hand edit of review state.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature with no root aggregate, child 2's aggregate on lap `lap-child-2` whose testQuality result is an infrastructure failure, and an exhausted child 2 ledger, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 2 --lap lap-child-2 --rubric testQuality --rationale "<why>"`, then it prints `build-review record-reduced-coverage: recorded testQuality for lap lap-child-2.`, exits 0, the disposition store holds one reduced-coverage record for testQuality with that failure's closed cause, and a `build_review_reduced_coverage_accepted` event carries `lapId` `lap-child-2`.
- Given that record, when the effective `build_review` verdict is resolved over child 2's aggregate, as child 2's next `build_review` pass resolves it, then the testQuality infrastructure failure no longer contributes to the blocking set and the verdict carries `hasRecordedReducedCoverage`.
- Given the root ledger records `build_review` `mechanicalFaults` of 0 and child 2's ledger is exhausted, when the operator records reduced coverage with `--child 2` for child 2's current lap and failed rubric, then the record succeeds, because the allowance is judged on child 2's ledger.
- Given child 2's testQuality failure has closed cause `projection-oversized` and child 2's ledger records no mechanical faults, when the operator records reduced coverage with `--child 2` for that rubric on child 2's current lap, then the record succeeds, as the same cause does today on a flat feature.
- Given the argument vector `build-review record-reduced-coverage --feature <slug> --child 2 --lap <lap> --rubric <rubric> --rationale <text>`, when the CLI detects the command, then it dispatches a record-reduced-coverage command carrying child `2`, and `build-review record-reduced-coverage --help` lists a `--child` option.

#### Negative Paths
- Given child 2's ledger records `build_review` `mechanicalFaults` of 2 and the root ledger is exhausted, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 2 --lap lap-child-2 --rubric testQuality --rationale "<why>"`, then it prints `build-review record-reduced-coverage: refused because the mechanical-fault allowance remains (2 of 3 consumed in .pipeline/children/2/kickback-ledger.json).`, exits 1, and the disposition store is unchanged.
- Given child 1's aggregate is on lap `lap-child-1` and child 2's aggregate is on lap `lap-child-2`, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 1 --lap lap-child-2 --rubric testQuality --rationale "<why>"`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; lap 'lap-child-2' is not the current lap ('lap-child-1') in .pipeline/children/1/build-review.json.`, records reason `requested-lap-not-current`, exits 1, and the disposition store is unchanged.
- Given child 2's aggregate is replaced by a new lap after `record-reduced-coverage --child 2` has read it and before the record is written, when the decision is validated under the store lease, then it prints `build-review record-reduced-coverage: refused because the inspected review lap changed.`, exits 1, and the disposition store is unchanged.
- Given `build-review record-reduced-coverage --feature <slug> --child x --lap <lap> --rubric <rubric> --rationale "<why>"`, when it runs, then it prints `build-review record-reduced-coverage: refused for '<slug>'; invalid child id 'x'.`, records reason `invalid-child`, reads no aggregate or ledger, and exits 1.
- Given a non-interactive session, when `build-review record-reduced-coverage --feature <slug> --child 2 --lap <lap> --rubric <rubric> --rationale "<why>"` runs, then it refuses with the existing interactive-terminal message and reason `non-interactive-or-unidentified-operator` before reading any aggregate or ledger.
- Given the disposition store already holds a reduced-coverage record for testQuality with child 2's current closed cause, when the operator records it again with `--child 2`, then it prints `build-review record-reduced-coverage: refused because reduced coverage is already recorded for 'testQuality'.`, exits 1, and the store still holds exactly one such record.
- Given the argument vector places `--child 2` after `--lap`, or repeats `--child`, when the CLI detects `build-review record-reduced-coverage`, then the detector returns no command.

### Done When
- [ ] A dispatcher test against a real temporary worktree records child 2's reduced coverage through the real disposition store. The effective verdict resolved over child 2's aggregate then shows the rubric's infrastructure failure out of the blocking set.
- [ ] A dispatcher test with a path-aware reader shows that the `--child 2` success path reads `.pipeline/children/2/build-review.json` and `.pipeline/children/2/kickback-ledger.json`, and never the root aggregate or the root ledger.
- [ ] Dispatcher tests cover the remaining child allowance, the cross-child lap, the lap replaced under the lease, the invalid child id, the non-interactive session and the duplicate record, each leaving the disposition store unchanged.
- [ ] CLI grammar tests cover the accepted `--child` position and the rejected positions, and a help test shows the `--child` option on `record-reduced-coverage`.

## Story 2: A stacked child's exhausted-allowance halt prints a command that works for that child

**Requirement:** intake outcome 3

As an operator reading a child-tagged exhausted-allowance HALT, I want the printed recovery
command to address that child, so that running it as printed records the decision instead of
being refused.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature whose active child is 2, child 2's ledger is exhausted, and child 2's aggregate is on lap `lap-child-2` with a testQuality infrastructure failure, when the conductor halts on the exhausted `build_review` mechanical-fault allowance, then the HALT body contains `ai-conductor build-review record-reduced-coverage --feature <feature-slug> --child 2 --lap lap-child-2 --rubric testQuality --rationale "<rationale>"` and reports `3 of 3 shared faults consumed`.
- Given the recovery command from that HALT with the feature slug and rationale filled in, when the CLI detects it, then it dispatches a record-reduced-coverage command with child `2`, lap `lap-child-2` and rubric `testQuality`.
- Given a flat feature with no active child, an exhausted root ledger, and a root aggregate with an infrastructure failure, when the conductor halts on the exhausted allowance, then the HALT body is byte-identical to the pre-change text, with no `--child` in the command.

#### Negative Paths
- Given a stacked feature whose active child is 2 and whose child 2 aggregate has no infrastructure-failure result, when the exhausted-allowance halt is rendered, then it prints the existing `current-lap diagnostic is unavailable` form, which names no recovery command and no `--child`.
- Given a stacked feature whose active child is 3, when the exhausted-allowance halt is rendered, then the printed command carries `--child 3` and never another child id.

### Done When
- [ ] A renderer test shows the child form of the recovery command for child 2, and the flat form byte-identical to the pre-change text.
- [ ] A conductor halt test for a stacked feature with active child 2 asserts the HALT body's `--child 2` command. A CLI detector test parses that exact command line, with the placeholders filled, into a child-2 dispatch.
- [ ] A renderer test covers the unavailable-diagnostic form for a child, with no `--child` printed.

## Story 3: Refusals name the artifact and the reason, and flat features are unchanged

**Requirement:** intake outcome 4, intake outcome 5

As an operator whose `record-reduced-coverage` command fails, I want the refusal to name the
artifact and why it failed, so that I know whether to pass `--child`, wait for a review lap, or
repair a file.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature with child aggregates for children 1 and 2 and no root aggregate, when the operator runs `build-review record-reduced-coverage --feature <slug> --lap <lap> --rubric testQuality --rationale "<why>"` without `--child`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/build-review.json is missing. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).`, records reason `aggregate-unreadable`, and exits 1.
- Given a flat feature with no `.pipeline/children/`, a root aggregate on lap `lap-root` with a testQuality infrastructure failure, and an exhausted root ledger, when the operator runs `build-review record-reduced-coverage` without `--child` for that lap and rubric, then it prints `build-review record-reduced-coverage: recorded testQuality for lap lap-root.`, exits 0, and the only aggregate and ledger it read are `.pipeline/build-review.json` and `.pipeline/kickback-ledger.json`.
- Given a flat feature whose root ledger records `build_review` `mechanicalFaults` of 1, when the operator runs `build-review record-reduced-coverage` without `--child` on the current lap and failed rubric, then it prints `build-review record-reduced-coverage: refused because the mechanical-fault allowance remains (1 of 3 consumed in .pipeline/kickback-ledger.json).` and exits 1.

#### Negative Paths
- Given child 2's aggregate contains `{bad json`, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 2 --lap <lap> --rubric testQuality --rationale "<why>"`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/children/2/build-review.json is malformed (invalid JSON).`, records reason `aggregate-unreadable`, and exits 1.
- Given child 2's aggregate is valid JSON that does not match the aggregate schema, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 2 ...`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/children/2/build-review.json is malformed (does not match the build-review aggregate schema).` and exits 1.
- Given a stacked feature with no `.pipeline/children/3/` directory, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 3 ...`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/children/3/build-review.json is missing.` with no stacked hint, and exits 1.
- Given a flat feature with no root aggregate and no `.pipeline/children/`, when the operator runs `build-review record-reduced-coverage --feature <slug> ...` without `--child`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/build-review.json is missing.` with no stacked hint, and exits 1.
- Given child 2's ledger has an unreadable `build_review` gate entry, when the operator records reduced coverage with `--child 2` on child 2's current lap and failed rubric, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/children/2/kickback-ledger.json gate 'build_review' is unreadable.`, records reason `kickback-ledger-unreadable`, exits 1, and the disposition store is unchanged.
- Given the disposition store rejects the write with failure kind `invalid` and message `<message>`, when the operator records reduced coverage with `--child 2`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/build-review-dispositions.json rejected the decision (invalid): <message>.`, records reason `disposition-store-invalid`, and exits 1.
- Given `--feature` names no resolvable feature worktree, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 2 ...`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; the feature worktree could not be resolved.` and exits 1.

### Done When
- [ ] Dispatcher tests assert each message above verbatim, with and without `--child`, and with and without other child aggregates present.
- [ ] Dispatcher tests assert the refusal event reason for every refusal above that records one.
- [ ] The existing flat-feature `record-reduced-coverage` tests pass with only their failure-message assertions updated, and the flat success-path read list is unchanged.
