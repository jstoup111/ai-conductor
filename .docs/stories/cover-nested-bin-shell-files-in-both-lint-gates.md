**Status:** Accepted

# Stories: Cover nested bin shell files in both lint gates (#2161)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the shell-script enumeration behind the syntax and shellcheck gates: recursion under `bin/`, a single shared enumeration for both gates, and a declared exclusion list. Raising the shellcheck severity floor and editing any newly covered script are outside this slice.

## Story 1: Gate every shell file under bin/, at any depth

As a harness maintainer, I want every shell file under `bin/` checked by the syntax and shellcheck gates so that the shared library behind install, update, and migrate cannot ship a syntax error or a shellcheck-error-severity bug.

### Acceptance Criteria

#### Happy Path

- Given the repository tree, when the shell-lint enumeration is listed, then it contains `bin/lib/harness-common.sh`.
- Given a fixture tree whose `bin/` holds a shell file nested two directories deep, when the enumeration is listed, then that nested file is present.
- Given a fixture tree whose `bin/` holds a symlink to a sibling shell file, when the enumeration is listed, then the symlink path is still present.

#### Negative Paths

- Given a fixture tree whose `bin/` holds a nested file with a Python shebang and a nested file with no shebang at all, when the enumeration is listed, then neither path is present.

### Done When

- [ ] Listing the enumeration against the real repository tree emits `bin/lib/harness-common.sh`.
- [ ] Fixture cases prove a two-deep nested shell file and a `bin/` symlink are enumerated, and that a Python-shebang file and a shebang-less file are not.
- [ ] Both gates report the widened set as clean, with no edit to any newly covered script.

## Story 2: Enumerate from one declared source with explicit exclusions

As a harness maintainer, I want both gates to read one enumeration whose exclusions are declared in a list so that neither gate can silently cover less than the other and no path drops out of coverage by falling through a glob.

### Acceptance Criteria

#### Happy Path

- Given the integrity suite's syntax check, when it selects the scripts to parse, then it takes them from the same enumeration the shellcheck gate uses rather than from its own directory globs.
- Given a fixture tree whose enumerator declares one repo-relative path as excluded, when the enumeration is listed, then that path is absent and every other shell file in the tree is still present.

#### Negative Paths

- Given a copy of the integrity suite whose syntax check enumerates `bin/` through its own glob instead of the shared source, when the drift guard runs, then it exits non-zero and names the syntax-check section.
- Given a fixture tree in which the enumeration yields no files at all, when the shellcheck gate runs, then it exits non-zero refusing to report success, and when the syntax check runs against that empty list, then it records a failure rather than reporting a clean parse of nothing.

### Done When

- [ ] The syntax check's script set is obtained by invoking the shellcheck gate's list mode, and no directory glob over `bin/`, `hooks/`, `test/`, or `.github/scripts/` remains in that section.
- [ ] A fixture case proves a declared exclusion removes exactly its own path and nothing else.
- [ ] The drift guard passes against the real integrity suite and fails against two mutated copies that reintroduce an independent enumeration.
- [ ] An empty enumeration is a non-zero exit for the shellcheck gate and a recorded failure for the syntax check.

## Negative-category review

Invalid input is covered by the non-shell and shebang-less fixture files and by the malformed-coverage mutations of the integrity suite. Resource-exhaustion, timeout, concurrency, auth, queue, datastore, and cascade-deletion categories are inapplicable: the enumerator is a synchronous read-only directory walk with no network, no external service, no shared mutable state, and no writes. Data integrity maps here to the silently-empty file set, which already has a refusal path and is retained and asserted rather than assumed. Partial failure maps to one gate covering less than the other, which the single-source requirement and its drift guard cover. Dependency unavailability is unchanged: the shellcheck binary's absence already degrades to a warning, and this slice does not alter that contract.
