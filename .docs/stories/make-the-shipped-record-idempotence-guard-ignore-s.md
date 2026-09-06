**Status:** Accepted

# Stories: Shipped-record idempotence over non-telemetry substance (#1648)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the commit decision made by the shipped-record subcommand and the projection it compares. The rollup computation, the KPI reader, the post-finish refresh caller, and the sibling finish-publication existence check remain outside this slice.

## Story 1: Stop committing a record whose only movement is its own telemetry

### Acceptance Criteria

#### Happy Path

- Given a shipped record is already committed and the freshly rendered body differs only inside its Cost and Time blocks, when the shipped-record write runs, then it creates no new commit and reports the record as already committed.
- Given that skip occurs, when the write returns, then the record file and the git index byte-match the committed record so no tracked or staged change is left behind.

#### Negative Paths

- Given the commit at HEAD carries no record at the resolved record path, when the shipped-record write runs, then it commits the record exactly once rather than treating the absent record as a match.
- Given the branch has no commit at all so the committed record cannot be read, when the shipped-record write runs, then it commits the record exactly once and still exits zero.

### Done When

- [ ] A real-git integration fixture whose rollup input grows between runs proves the second write adds no commit.
- [ ] The same fixture proves the working tree and index are clean after the skipped write.
- [ ] An absent-record fixture and an unborn-branch fixture each produce exactly one shipped-record commit carrying a Cost block and a Time block.

## Story 2: Keep committing every substantive difference

### Acceptance Criteria

#### Happy Path

- Given a shipped record is already committed and the freshly rendered body differs in its frontmatter PR value or spec hash, when the shipped-record write runs, then it commits the freshly rendered body including its current Cost and Time blocks.

#### Negative Paths

- Given a shipped record is already committed and the freshly rendered body differs only in its accepted build-review risk evidence, when the shipped-record write runs, then it commits rather than discarding that evidence as telemetry.

### Done When

- [ ] A real-git integration fixture proves a changed PR value commits and the newly committed body carries the newer telemetry values.
- [ ] A fixture whose injected disposition store yields a new accepted-risk record commits a second time.
- [ ] Unit cases pin exactly which blocks the substantive projection removes and which blocks and frontmatter it preserves.

## Negative-category review

Input integrity is covered by the absent-record, unborn-branch, and evidence-difference cases, which are the three ways the comparison can be handed something other than a clean committed counterpart. Dependency failure is covered by the unborn-branch case, where the git read of the committed record fails and the command must fall through to its existing commit path rather than skip. Idempotency is the subject of Story 1 and is asserted directly by re-running the write. Permission, network, and third-party failure categories are inapplicable: the command reaches only the local repository and its own worktree files, and its existing degrade-never-block wrapper already owns every other failure with published coverage. No deletion, queue, datastore, upload, transaction, or concurrency surface is introduced; the command writes one file and makes at most one commit, exactly as before.
