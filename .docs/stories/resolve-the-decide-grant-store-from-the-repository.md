**Status:** Accepted

# Stories: Resolve the decide-grant store from the repository root (#1621)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is where `decide-grant` writes its grant, what it reports, and what it does when no repository can be resolved. Grant format, grant scoping, single-use consumption, and the ungrantable plan rule are unchanged and outside this slice.

## Story 1: A recorded grant lands where the engine looks for it

**Requirement:** Issue #1621 desired outcome — a grant is honored regardless of the invocation directory, an invocation outside a repository fails loudly, and the success message names the absolute store path.

As an operator recovering a halted feature, I want a grant I record from whatever directory I happen to be standing in to authorize the next dispatch, so that a natural working directory does not silently produce an authorization that authorizes nothing.

### Acceptance Criteria

#### Happy Path
- Given the invocation directory is the main repository checkout root, when the operator records a grant for a feature slug, then the grant file exists at that checkout's daemon grant store path for that slug.
- Given the invocation directory is inside the feature's linked worktree or a nested subdirectory of the checkout, when the operator records a grant, then the grant file is written to the main checkout's grant store and no grant file appears beneath the worktree.
- Given the command reports success, when the operator reads its output, then the message names the absolute path of the grant file it wrote.

#### Negative Paths
- Given the invocation directory is outside any repository, when the operator records a grant, then the command exits non-zero with a diagnostic naming the unresolved repository and writes no grant file or store directory.
- Given the requested step is the ungrantable planning step, when the operator records a grant from any invocation directory, then the command exits non-zero and writes no grant file, without depending on repository resolution.

### Done When
- [ ] A grant recorded from a linked worktree directory is readable by the entry policy for that feature at the main checkout store path.
- [ ] A grant recorded from a directory outside any repository does not exist: the command exits non-zero and that directory gains no daemon grant directory.
- [ ] The success output contains the absolute grant file path, character for character equal to the path that was written.

## Story 2: The writer and the reader agree on one store path

**Requirement:** Issue #1621 observed cause — the recording command and the entry policy compose the same store subpath independently, so the two can drift apart without any check noticing.

As a maintainer of the grant boundary, I want the path the command writes and the path the engine reads to come from one derivation, so that the two cannot diverge again silently.

### Acceptance Criteria

#### Happy Path
- Given a main checkout root and a feature slug, when the recording command derives the path it writes and the entry policy derives the path it reads, then both produce the identical absolute path.

#### Negative Paths
- Given a project root that is not a linked feature worktree, when the entry policy resolves the grant path for that root, then it resolves no path and consults no grant, exactly as it does today.

### Done When
- [ ] A test asserts the written path and the read path are identical for the same checkout root and slug.
- [ ] The entry policy still resolves no grant path for a main-checkout root and for an unrelated nested directory.

## Negative-category review

Invalid input is covered by the unresolvable-repository and ungrantable-step criteria, the two ways this command can be asked to do something it must refuse. Data integrity is covered by the writer/reader path-agreement criterion, which is the integrity property the defect broke. Partial failure is covered by requiring that a refused invocation leave no store directory behind, so a failed run cannot seed an orphan the operator later mistakes for a real grant. Auth and permission failures are the subject the grant itself implements and are unchanged here. Timeouts, dependency unavailability, concurrent access, resource exhaustion, and cascade deletion are inapplicable: the command performs one local write of one small file, contacts no service, holds no shared mutable state, and deletes nothing.
