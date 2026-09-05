**Status:** Accepted

# Stories: Rebase diff hunk header isolation

Source-Ref: jstoup111/ai-conductor#2180

Accepted under the operator's authorization for complete unambiguous S spec PRs; any newly discovered policy ambiguity returns to DECIDE.

## Story 1: Source text cannot become a dropped commit's file path

As an operator, I want header-shaped source lines evaluated as source content so a correctly preserved rebase is accepted.

### Acceptance Criteria

#### Happy Path
- Given a vanished feature commit removes a `-- comment` line and another ordinary line, and HEAD already carries both removals, when preservation is checked, then the guard returns true using the original file path and its parent content.
- Given a vanished commit adds a `++ value` line and HEAD contains that addition, when preservation is checked, then the guard returns true and checks the original destination file, never a path extracted from that source line.
- Given several hunks and several files including these line prefixes, when the guard checks the commit, then source content stays associated with its own file and every file's intended change is checked.

#### Negative Paths
- Given a vanished commit's added `++ value` line is absent from HEAD, when preservation is checked, then the guard returns false even if a path named `value` is missing.
- Given one of several edited files has lost its intended change, when preservation is checked, then satisfied changes in other files cannot produce a true result.

### Done When
- [ ] Public guard tests prove correct outcomes and exact original-path Git queries for both source prefixes.
- [ ] Multi-hunk and multi-file cases prove independent file-header interpretation and content accounting.

## Story 2: Comment-only deletion intent must actually survive

As an operator, I want a skipped deletion-only commit rejected when its removed content remains.

### Acceptance Criteria

#### Happy Path
- Given a vanished commit only removes a `-- comment` source line and HEAD no longer contains that occurrence, when preservation is checked, then the guard returns true.
- Given a genuine whole-file deletion is already realized in HEAD, when preservation is checked, then existing whole-file deletion behavior remains accepted.

#### Negative Paths
- Given the comment-only deletion was skipped and HEAD still contains the removed occurrence, when preservation is checked, then the guard returns false rather than treating the empty parsed edit as preserved.
- Given the diff is binary, empty, or its required parent content cannot be obtained, when preservation is checked, then the existing fail-closed result remains false.
- Given a text file has no trailing newline, when its hunk includes Git's no-newline marker, then that marker is not interpreted as source content or a path and cannot hide a lost change.

### Done When
- [ ] A real local Git fixture drives the public guard and distinguishes an absorbed comment deletion from a skipped deletion.
- [ ] Existing binary/empty/parent-failure protections and whole-file deletion semantics have concrete focused coverage.

Negative categories considered: parsing ambiguity and data integrity are directly covered; Git dependency failure uses the existing fail-closed contract. The pure parsing change introduces no network, permission model, concurrent state, timeout, queue, rollback transaction or deletion cascade. All acceptance criteria are diff-local behavior of the changed guard input.

Status: Accepted
