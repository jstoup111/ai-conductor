**Status:** Accepted

# Stories: build-review accept and findings refuse every stacked-feature child (#3448)

This is a technical-track change, so there is no PRD. The acceptance criteria come from the
desired outcomes of jstoup111/ai-conductor#3448 and from existing decisions:
- `adr-2026-10-07-per-child-build-region` D4, D9 and D10 put each child's `build_review` review
  state under `.pipeline/children/<k>/`;
- `adr-2026-10-20-operator-acceptance-is-durable-case-state` D9 keeps the disposition store
  feature-scoped;
- `adr-2026-08-13-stable-build-review-finding-dispositions` D4 defines what `accept` requires.

Terms used below:
- **A stacked feature** is a feature worktree with child state under `.pipeline/children/`.
- **Child 2's aggregate** is `.pipeline/children/2/build-review.json`.
- **The root aggregate** is `.pipeline/build-review.json`.
- **Child 2's ledger** is `.pipeline/children/2/kickback-ledger.json`.
- **The disposition store** is the feature-scoped `.pipeline/build-review-dispositions.json`.
- **Child 2's case store** is the remediation case store opened with child scope 2.

## Story 1: findings lists a stacked child's own review state

**Requirement:** intake outcome 1

As an operator recovering a stacked feature halted in a child's `build_review`, I want
`build-review findings --child <k>` to show that child's current lap, findings and cases, so that
I can see what the halt is about without reading `.pipeline/children/<k>/` JSON by hand.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature whose child 2's aggregate has lap `lap-child-2` with one unresolved testQuality finding F2, and no root aggregate, when the operator runs `build-review findings --feature <slug> --child 2 --json`, then it exits 0 and the JSON reports `lapId` `lap-child-2` and lists F2 in `unresolvedFindingIds`.
- Given a stacked feature with both a root aggregate on lap `lap-root` and child 2's aggregate on lap `lap-child-2`, when the operator runs `build-review findings --feature <slug> --child 2 --json`, then the JSON reports `lapId` `lap-child-2` and none of the root aggregate's finding ids.
- Given child 2's case store holds case C2 and the root case store holds case C0, when the operator runs `build-review findings --feature <slug> --child 2`, then the output lists C2 and does not list C0.
- Given child 2's ledger records a `build_review` `lastMechanicalFault` on lap `lap-child-2` and the root ledger records none, when the operator runs `build-review findings --feature <slug> --child 2 --json`, then the JSON carries that `lastMechanicalFault`.
- Given the disposition store holds an acceptance of child 2's finding F2, when the operator runs `build-review findings --feature <slug> --child 2 --json`, then F2 is listed in `acceptedFindingIds` and in `acceptedDispositions` and is absent from `unresolvedFindingIds`.

#### Negative Paths
- Given a stacked feature with no `.pipeline/children/3/` directory, when the operator runs `build-review findings --feature <slug> --child 3`, then it prints `build-review findings: .pipeline/children/3/build-review.json is missing for '<slug>'.` and exits 1.
- Given `build-review findings --feature <slug> --child 0` or `--child x`, when it runs, then it prints `build-review findings: invalid child id '0'.` (or `'x'`), exits 1, and reads no aggregate.

### Done When
- [ ] A CLI dispatcher test with a path-aware file reader shows `findings --child 2` reading `.pipeline/children/2/build-review.json` and child 2's ledger, never `.pipeline/build-review.json`, and reporting child 2's lap, findings, cases, accepted dispositions and last mechanical fault.
- [ ] CLI dispatcher tests cover the missing child directory and the invalid child ids.

## Story 2: accept records an acceptance for a stacked child's finding

**Requirement:** intake outcome 2

As an operator who has judged a finding named in a child-scoped `build_review` halt to be
accepted risk, I want `build-review accept --child <k>` to accept it, so that the child's next
review lap treats it as accepted without a hand edit of review state.

### Acceptance Criteria

#### Happy Path
- Given an interactive verified operator and child 2's aggregate on lap `lap-child-2` with unresolved finding F2, when the operator runs `build-review accept --feature <slug> --child 2 --lap lap-child-2 --finding <F2> --rationale "<why>"`, then it prints `build-review accept: accepted <F2> for lap lap-child-2.`, exits 0, and the disposition store holds one record for F2 with `sourceLapId` `lap-child-2`.
- Given that acceptance, when the operator runs `build-review findings --feature <slug> --child 2 --json`, then F2 is listed in `acceptedFindingIds` and absent from `unresolvedFindingIds`, and child 2's aggregate bytes are unchanged by the acceptance.
- Given the argument vector `build-review accept --feature <slug> --child 2 --lap <lap> --finding <id> --rationale <text>`, when the CLI detects the command, then it dispatches an accept command carrying child `2`, and `build-review accept --help` lists a `--child` option.

#### Negative Paths
- Given child 2's aggregate is on lap `lap-child-2` and child 1's aggregate is on lap `lap-child-1`, when the operator runs `build-review accept --feature <slug> --child 1 --lap lap-child-2 --finding <F2> --rationale "<why>"`, then it refuses with `lap 'lap-child-2' is not the current lap ('lap-child-1')`, exits 1, and the disposition store is unchanged.
- Given child 1's aggregate does not contain F2, when the operator runs `build-review accept --feature <slug> --child 1 --lap lap-child-1 --finding <F2> --rationale "<why>"`, then it refuses with `'<F2>' is not a current judged finding on lap 'lap-child-1'`, exits 1, and the disposition store is unchanged.
- Given child 2's aggregate is replaced by a new lap after `accept --child 2` has read it and before the disposition is written, when the acceptance is validated under the store lease, then it refuses through the disposition store rejection, exits 1, and the disposition store is unchanged.
- Given `build-review accept --feature <slug> --child x --lap <lap> --finding <id> --rationale "<why>"` from an interactive verified operator, when it runs, then it refuses with `invalid child id 'x'`, records a `build_review_disposition_refused` event with reason `invalid-child`, reads no aggregate, and exits 1.
- Given a non-interactive session, when `build-review accept --feature <slug> --child 2 --lap <lap> --finding <id> --rationale "<why>"` runs, then it refuses with the existing interactive-terminal message and reason `non-interactive-or-unidentified-operator` before reading any aggregate.
- Given the argument vector places `--child 2` after `--lap`, or repeats `--child`, when the CLI detects `build-review accept`, then the detector returns no accept command.

### Done When
- [ ] A dispatcher test against a real temporary worktree accepts child 2's F2 through the real disposition store and then reads it back through `findings --child 2`.
- [ ] Dispatcher tests cover the cross-child lap, the cross-child finding, the lap replaced under the lease, the invalid child id and the non-interactive session, each leaving the disposition store unchanged.
- [ ] CLI grammar tests cover the accepted `--child` position and the rejected positions, and a help test shows the `--child` option on `accept`.

## Story 3: Refusals name the artifact and the reason, and flat features are unchanged

**Requirement:** intake outcome 3, intake outcome 4

As an operator whose `findings` or `accept` command fails, I want the refusal to name the
artifact and why it failed, so that I know whether to pass `--child`, wait for a review lap, or
repair a file.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature with child aggregates for children 1 and 2 and no root aggregate, when the operator runs `build-review findings --feature <slug>` without `--child`, then it prints `build-review findings: .pipeline/build-review.json is missing for '<slug>'. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).` and exits 1.
- Given the same stacked feature, when an interactive verified operator runs `build-review accept --feature <slug> --lap <lap> --finding <id> --rationale "<why>"` without `--child`, then it refuses with `.pipeline/build-review.json is missing. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).`, records reason `aggregate-unreadable`, and exits 1.
- Given a flat feature with a valid root aggregate and no `.pipeline/children/`, when the operator runs `build-review findings --feature <slug>` in human and in JSON form, then the output is identical to the pre-change output and the only aggregate read is `.pipeline/build-review.json`.
- Given a flat feature with a valid root aggregate, when an interactive verified operator runs `build-review accept` without `--child` on a current unresolved finding, then it accepts exactly as before and prints `build-review accept: accepted <id> for lap <lap>.`.

#### Negative Paths
- Given child 2's aggregate contains `{bad json`, when the operator runs `build-review findings --feature <slug> --child 2`, then it prints `build-review findings: .pipeline/children/2/build-review.json is malformed for '<slug>' (invalid JSON).` and exits 1.
- Given child 2's aggregate is valid JSON that does not match the aggregate schema, when the operator runs `build-review accept --feature <slug> --child 2 --lap <lap> --finding <id> --rationale "<why>"` interactively, then it refuses with `.pipeline/children/2/build-review.json is malformed (does not match the build-review aggregate schema).`, records reason `aggregate-unreadable`, and exits 1.
- Given a flat feature with no root aggregate and no `.pipeline/children/`, when the operator runs `build-review findings --feature <slug>`, then it prints `build-review findings: .pipeline/build-review.json is missing for '<slug>'.` with no stacked hint and exits 1.
- Given the disposition store is unreadable, when the operator runs `build-review findings --feature <slug> --child 2`, then it prints a message naming `.pipeline/build-review-dispositions.json` and the store's failure kind, and exits 1.
- Given child 2's ledger has an unreadable `build_review` gate entry, when the operator runs `build-review findings --feature <slug> --child 2`, then it prints a message naming `.pipeline/children/2/kickback-ledger.json` and gate `build_review` as unreadable, and exits 1.
- Given the project config fails to load with error message `config is broken`, when the operator runs `build-review findings --feature <slug> --child 2`, then it prints `build-review findings: current feature state is invalid or unavailable for '<slug>' (config is broken).` and exits 1.

### Done When
- [ ] Dispatcher tests assert each message above verbatim for findings and accept, with and without `--child`, and with and without other child aggregates present.
- [ ] The existing flat-feature findings and accept tests pass with only their failure-message assertions updated, and the flat success-path read list is unchanged.
