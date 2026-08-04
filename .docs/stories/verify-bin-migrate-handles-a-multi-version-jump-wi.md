**Status:** Accepted

# Stories: Safe multi-version harness migration

## Story 1: Never apply the same migration block twice

**Requirement:** FR-1
**Requirement:** FR-2
**Requirement:** FR-3

As an updating consumer, I want the runner to remember which migration blocks it has already
applied so that repeated or multi-hop updates never re-run work that is already done.

### Acceptance Criteria

#### Happy Path

- Given a consumer whose ledger records a block as applied, when migration runs again, then that
  block is neither previewed nor executed and is reported as already applied.
- Given a successful migration run, when it finishes, then every block it executed is recorded in
  the ledger under an identity derived from its release label and its body content.
- Given a consumer with no ledger yet, when migration runs, then the candidate set stays bounded by
  the installed-version range and the run's outcomes seed the ledger.

#### Negative Paths

- Given the installed-version identity cannot be parsed as a version, when candidates are selected,
  then the ledger still excludes applied blocks and the run does not offer the entire changelog
  history.
- Given the changelog is re-rendered without changing a block's body, when migration runs, then
  that block's recorded identity still matches and it is not offered again.
- Given the ledger file is missing, empty, or malformed, when migration runs, then the runner
  reports the condition and treats no block as applied rather than silently proceeding as if all
  were.

### Done When

- [ ] A fixture with a pre-seeded ledger records zero executions and reports every block as already
      applied.
- [ ] A `main@<sha>` installed-version fixture offers the same block set as the equivalent tagged
      fixture.
- [ ] A malformed-ledger fixture fails loudly and applies nothing.

## Story 2: Apply blocks in a deterministic order across a multi-version jump

**Requirement:** FR-4
**Requirement:** FR-11

As a consumer jumping many releases at once, I want blocks applied in a predictable order so that a
later block can rely on an earlier one having run.

### Acceptance Criteria

#### Happy Path

- Given pending blocks spanning several releases, when migration runs, then they execute in
  ascending release order, and in document order within each release.
- Given a release entry containing more than one `## Migration` section, when blocks are collected,
  then every section contributes its blocks.

#### Negative Paths

- Given a release entry whose label cannot be parsed as a version, when blocks are collected, then
  its blocks are excluded and the exclusion is reported rather than passed over in silence.
- Given two releases contain blocks with identical bodies, when they are recorded, then their
  identities remain distinct and applying one does not suppress the other.

### Done When

- [ ] An ordering fixture spanning three synthetic releases asserts the exact execution sequence.
- [ ] A two-`## Migration`-section fixture asserts every fence from both sections is collected.
- [ ] An unparsable-label fixture asserts exclusion plus an explicit report line.

## Story 3: Fail loudly and stop, never silently no-op

**Requirement:** FR-5
**Requirement:** FR-6

As a consumer, I want a failing migration command to fail its block and halt the sequence so that a
broken migration is never mistaken for an applied one.

### Acceptance Criteria

#### Happy Path

- Given a block whose commands all succeed, when it executes, then it is recorded as applied and
  the sequence continues to the next block.

#### Negative Paths

- Given a block whose first command fails but whose last command succeeds, when it executes, then
  the block fails rather than reporting success.
- Given a block that references an undefined variable or whose pipeline fails midway, when it
  executes, then the block fails rather than continuing past the error.
- Given a block fails, when the sequence halts, then blocks applied before it remain recorded as
  applied, the failing block and every block after it remain pending, and the report names the
  failing block's release and position.

### Done When

- [ ] A fail-early-succeed-late fixture asserts a non-zero block outcome.
- [ ] An unset-variable and a failing-pipeline fixture each assert block failure.
- [ ] A mid-sequence failure fixture asserts the applied-prefix and pending-suffix split in the
      ledger.

## Story 4: Approve or decline each block individually

**Requirement:** FR-7
**Requirement:** FR-8
**Requirement:** FR-12

As a cautious operator, I want to review and decide on each migration block separately so that one
questionable command does not force me to reject the whole set.

### Acceptance Criteria

#### Happy Path

- Given pending blocks and an interactive session, when migration runs, then each block is previewed
  with its release and position and the operator is offered accept, skip, accept-all, and stop.
- Given the operator chooses accept-all, when the remaining blocks execute, then no further prompt
  is issued and each outcome is recorded individually.
- Given a run finishes, when the summary is printed, then it distinguishes applied, skipped, failed,
  and already-applied blocks.

#### Negative Paths

- Given the operator skips a block, when the run finishes, then that block is recorded as pending
  and is offered again on the next run.
- Given the operator chooses stop partway, when the run ends, then the blocks already applied stay
  applied and every remaining block stays pending.
- Given the operator supplies an unrecognized response, when it is evaluated, then the block is not
  executed and the operator is asked again.

### Done When

- [ ] A scripted-TTY fixture exercises accept, skip, accept-all, and stop and asserts the resulting
      ledger for each.
- [ ] A skip-then-rerun fixture asserts exactly the skipped block is re-offered.
- [ ] An unrecognized-response fixture asserts no execution and a re-prompt.

## Story 5: Keep pending blocks reachable without an approval channel

**Requirement:** FR-9

As an unattended consumer, I want a non-interactive update to leave migrations reachable rather
than silently discarding them so that no migration is lost forever.

### Acceptance Criteria

#### Happy Path

- Given no terminal and no automatic-approval flag, when migration runs, then it executes nothing,
  reports the pending blocks, and explains how to run them later.
- Given the automatic-approval flag is supplied without a terminal, when migration runs, then blocks
  execute under the same ordering, fail-fast, and recording rules as an interactive run.

#### Negative Paths

- Given a non-interactive run left blocks pending and the caller then advanced the recorded
  installed version, when migration is run again later, then those pending blocks are still offered.
- Given a preview-only run is requested, when it completes, then nothing executes and nothing is
  recorded as applied.

### Done When

- [ ] A no-TTY fixture asserts zero executions plus explicit recovery guidance.
- [ ] A version-advanced-then-rerun fixture asserts the pending blocks are still offered.
- [ ] A preview-only fixture asserts an unchanged ledger.

## Story 6: Make the queued v1.0 blocks safe to run in a real consumer

**Requirement:** FR-10
**Requirement:** FR-13

As a consumer jumping from the 0.99.17 era to the cutover release, I want the queued blocks to
complete against my project without damaging it so that the update actually succeeds.

### Acceptance Criteria

#### Happy Path

- Given a scratch consumer project pinned at the pre-jump release, when the full queued set is
  applied, then every block completes, the ledger records them all applied, and the run exits zero.
- Given the same consumer, when migration is run a second time immediately, then nothing executes
  and every block is reported as already applied.

#### Negative Paths

- Given a block needs a harness-owned file, when it executes, then it resolves that file through the
  exported harness location and not through a working-directory-relative path.
- Given the queued set runs to completion, when the consumer's repository is inspected, then no Git
  worktree or branch was removed and no daemon was stopped or restarted.
- Given a block appends to consumer configuration, when it runs a second time, then the
  configuration is byte-for-byte unchanged from after the first run.

### Done When

- [ ] An end-to-end scratch-consumer run applies the whole corrected queued set and exits zero.
- [ ] An immediate re-run applies nothing and changes no consumer file.
- [ ] Worktree, branch, and daemon state are asserted unchanged across the run.

## Story 7: Stop the next bad block at authoring time

**Requirement:** FR-14

As a harness maintainer, I want the repository to reject a migration block that breaks the authoring
contract so that a consumer never discovers it instead.

### Acceptance Criteria

#### Happy Path

- Given a migration block that satisfies the contract, when the integrity suite runs, then the check
  passes.
- Given the corrected queued set, when the integrity suite runs, then every block in it passes.

#### Negative Paths

- Given a block that invokes a harness binary through a working-directory-relative path, when the
  check runs, then it fails and names the offending line and the contract clause.
- Given a block that force-removes a worktree or branch, or restarts a daemon without operator
  action, when the check runs, then it fails and names the offending line.
- Given a block appears inside a release entry the check cannot attribute, when the check runs, then
  it fails rather than skipping the block.

### Done When

- [ ] Each rejected shape has a fixture asserting failure plus the offending line in the message.
- [ ] A conforming-block fixture asserts a pass.
- [ ] The check is wired into `test/test_harness_integrity.sh` and documented in the validation
      reference.

## Verify-Claims Ledger

### Claims

- [verified] Every scenario traces to FR-1 through FR-14 and to a defect observed directly in the
  current `bin/migrate`, `bin/update`, or `CHANGELOG.md`.
- [verified] Negative coverage spans idempotency, ordering, partial failure, approval refusal,
  non-interactive operation, destructive side effects, and malformed input.
- [verified] The scratch-consumer fixtures these stories require are already established by
  `test/test_bin_update.sh`, so no new test substrate is assumed.

### Assumptions

- None pending. The ledger location and identity scheme are settled in the approved ADR, and the
  changelog-correction exemption is bounded there and granted by merging the spec.

Verdict: CLEAR
