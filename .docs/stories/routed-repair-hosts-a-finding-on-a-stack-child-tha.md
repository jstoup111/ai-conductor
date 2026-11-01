**Status:** Accepted

# Stories: Routed repair hosts a finding on a stack child that lacks its target file

Source: jstoup111/ai-conductor#3550. Technical track; governed by
`adr-2026-10-12-routed-whole-feature-repair` decisions 4 and 5 as amended by #3550.

Fixtures below use a three-child stack `demo` (positions 1, 2, 3; child 3 is the leaf). Its leaf tip
holds `src/engine/a.ts`, `src/engine/register-artifact-cli.ts`, `src/engine/restack/restack-sync.ts`,
`src/engine/index.ts` and `src/cli/index.ts`. `closed/c1` and `closed/c2` hold only `src/engine/a.ts`,
`src/engine/index.ts` and `src/cli/index.ts`.

## Story 1: A routed finding is hosted where the files it cites by name exist

**Requirement:** Scope outcomes 1, 3 and 4; ADR decision 4

As an operator, I want a routed finding that names a file by its basename or a partial path to be
hosted on a child that holds that file, so that a child is never asked to repair code it does not
contain.

### Acceptance Criteria

#### Happy Path
- Given a finding owned by child 1 whose work order cites the bare name `register-artifact-cli.ts`, when the round is routed, then the item's host is `3` with reason `prerequisite-paths`, its owner stays `1`, and its `prerequisitePaths` lists `src/engine/register-artifact-cli.ts`.
- Given a finding owned by child 1 whose work order cites the partial path `restack/restack-sync.ts`, when the round is routed, then its `prerequisitePaths` lists `src/engine/restack/restack-sync.ts` and its host is `3` with reason `prerequisite-paths`.
- Given a finding owned by child 1 whose work order text reads `(register-artifact-cli.ts)`, when the round is routed, then its `prerequisitePaths` lists `src/engine/register-artifact-cli.ts` and no entry begins with `(`.
- Given a finding owned by child 1 whose work order cites the exact path `src/engine/a.ts`, when the round is routed, then its host is `1` with its ownership reason, exactly as before this change.

#### Negative Paths
- Given a finding owned by child 1 whose only citations are the directory `src/engine/` and the exact path `src/engine/a.ts`, when the round is routed, then its `prerequisitePaths` is exactly `src/engine/a.ts` and its host is `1`.
- Given a finding owned by child 1 whose work order cites the directory `src/engine/` and the bare name `register-artifact-cli.ts`, when the round is routed, then the directory does not keep the host on child 1, and the host is `3`.
- Given a finding owned by child 1 whose only path-shaped citation is a directory, when the round is routed, then the item records no `prerequisitePaths` and its host is `1` with its ownership reason.
- Given a finding owned by child 1 whose work order cites the bare name `index.ts`, which names two leaf files, when the round is routed, then neither `src/engine/index.ts` nor `src/cli/index.ts` appears in its `prerequisitePaths`, and its host is decided by its other citations alone.
- Given a finding owned by child 1 whose work order cites `brand-new.ts`, which names no leaf file, when the round is routed, then `brand-new.ts` is not a prerequisite input and the host stays `1`.
- Given the leaf tip's file listing cannot be read while citations are resolved, when the round is routed, then the feature halts needs-human naming the leaf branch, and no route record, marker or ref is written.

### Done When
- [ ] A real-git test over the three-child fixture routes a finding owned by child 1 that cites `register-artifact-cli.ts` to host `3` with reason `prerequisite-paths` and the resolved path in `prerequisitePaths`.
- [ ] Real-git tests assert the exact, basename, partial-path, wrapped-token, directory, ambiguous and no-match classifications listed above.
- [ ] A test asserts that a finding whose resolved inputs all exist at its owner's closure keeps the same host, reason and `prerequisitePaths` it gets before this change.

## Story 2: A builder's prerequisite claim is verified against resolved files

**Requirement:** Scope outcome 3; ADR decision 5

As an operator, I want a routed builder's `blocked-by-prerequisite` claim to be checked file against
file, so that a directory cited elsewhere in the work order cannot make every claim fail.

### Acceptance Criteria

#### Happy Path
- Given an open round whose host-1 item stores `prerequisitePaths` `["src/engine/"]`, as route records written before this change do, when host 1's builder claims `src/engine/register-artifact-cli.ts` is missing and names child 3, then the claim is verified and the round reroutes to child 3.
- Given host 1's builder claims the bare name `register-artifact-cli.ts` is missing and names child 3, when the claim is verified, then it resolves to `src/engine/register-artifact-cli.ts`, is verified, and the round reroutes to child 3.
- Given a host-1 item storing `prerequisitePaths` `["src/engine/a.ts"]`, when a claim naming child 3 is verified, then `src/engine/a.ts` is still required at child 3's tree, as before this change.

#### Negative Paths
- Given host 1's builder claims `src/engine/a.ts` is missing, when the claim is verified, then it is rejected because the file is present at `closed/c1`, the attempt counts against child 1's region caps, and the host stays 1.
- Given host 1's builder claims only the directory `src/engine/` is missing, when the claim is verified, then it is rejected as naming no prerequisite file, counts as a failed attempt, and no ref moves.
- Given host 1's builder claims only the bare name `index.ts`, which names two leaf files, when the claim is verified, then it is rejected as naming no prerequisite file, counts as a failed attempt, and no ref moves.
- Given a host-1 item storing a resolved input that child 2's closure lacks, when the builder's claim names child 2, then the claim is rejected and counts as a failed attempt.

### Done When
- [ ] A real-git test replays the #3550 shape: a stored directory input plus a claim for a leaf-only file verifies and reroutes host 1 to child 3.
- [ ] Tests assert the directory-only and ambiguous-only claims are rejected as failed attempts with no ref moved.
- [ ] A test asserts that a stored resolved input absent at the destination still rejects the claim.

## Story 3: A host always holds every file its repair blocks cite, without a new halt

**Requirement:** Scope outcome 2; ADR decision 4

As an operator, I want the files a routed repair block names to steer which child hosts it, so that
a build is never dispatched on a host that cannot do the work, and routing does not stop for a human
to place it.

### Acceptance Criteria

#### Happy Path
- Given a finding owned by child 1 whose work order cites only `src/engine/a.ts` and whose governing clause, rendered into its rem block, cites `register-artifact-cli.ts`, when the round is routed, then its host is `3` with reason `prerequisite-paths`, and its `prerequisitePaths` lists `src/engine/register-artifact-cli.ts`.
- Given every file cited by each item's rem block text is present at its owner's closure, when the round is routed and admitted, then each host is its owner and the route record and marker are written as before this change.
- Given an item whose block text cites only files the repair creates, which are absent at the leaf, when the round is routed, then those citations do not move its host.

#### Negative Paths
- Given a finding owned by child 1 whose rem block cites a file only the leaf holds, when the round is routed, then the feature does not halt, and the item is hosted on the leaf.
- Given an open audit round still holding a `pending` host and a new round whose item cites a leaf-only file, when the whole-feature audit would route new fixes, then the run ends with the admission fence's `mechanical` HALT naming the open round, not a `needs-human` halt.
- Given a closure ref that cannot be read while block-text inputs are compared, when the host is chosen, then the feature halts needs-human naming that child, and no route record is created, as before this change.
- Given an existing-task item that allocates no rem block, when the round is routed, then only its work-order citations decide its host.

### Done When
- [ ] A real-git test routes a finding whose only leaf-only citation is in its governing clause to host `3` with reason `prerequisite-paths`.
- [ ] A test asserts that routing over the three-child fixture raises no halt for a finding whose block cites a leaf-only file.
- [ ] A test with an open audit round holding a pending host asserts the run ends with the `mechanical` fence HALT when the new round's item cites a leaf-only file.
