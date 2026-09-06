**Status:** Accepted

# Stories: Exclude patch-equivalent upstream commits from the graded build_review diff (#1654)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the build_review grader-input seam and the audit record of what it filtered. No rebase is performed, requested, or implied by any criterion below.

## Story 1: Patch-equivalent upstream work leaves the graded diff

### Acceptance Criteria

#### Happy Path

- Given a feature commit that Git identifies as patch-equivalent to a commit already on the freshly-resolved review base, when build_review assembles grader inputs, then the paths that commit alone changed appear in no hunk of the graded diff.
- Given such a commit was filtered, when the inputs derived from the graded diff are built, then its files appear in no changed-file reference, changed-test selector, changed-test title, or removal record.

#### Negative Paths

- Given a feature commit is a modified variant of an upstream commit and is therefore not patch-equivalent to it, when build_review assembles grader inputs, then every path that commit changed remains fully graded.
- Given a changed path was touched by both a patch-equivalent commit and a genuinely novel commit, when build_review assembles grader inputs, then that path remains fully graded.
- Given the patch-equivalence probe or the per-path attribution command fails or returns nothing, when build_review assembles grader inputs, then no path is excluded and the graded diff is exactly what it would have been without this mechanism.
- Given the exclusion is computed on a feature worktree, when build_review assembles grader inputs, then no Git invocation that rewrites refs, the index, or the working tree is issued.

### Done When

- [ ] A scripted-Git unit case proves a patch-equivalent commit's exclusive paths become exclude pathspecs on the graded-diff command.
- [ ] A real-local-Git integration case reproducing the stale-base window shows the upstream-equivalent file absent from the graded diff and from every input derived from it.
- [ ] Real-local-Git integration cases for a modified variant, for a path shared with novel work, and for a failing probe each leave the graded diff byte-identical to today's output.
- [ ] The recorded Git argv for an assembly run contains only read-only invocations.

## Story 2: The filtered set is auditable and never affects the outcome

### Acceptance Criteria

#### Happy Path

- Given one or more feature commits were filtered, when build_review finishes assembling grader inputs, then the base telemetry it carries names each filtered commit's sha and subject together with every excluded path.
- Given that telemetry reaches the daemon feature log, when the base line is rendered, then the operator sees how many commits were filtered alongside the existing base-freshness summary.

#### Negative Paths

- Given no feature commit is patch-equivalent to the review base, when build_review finishes assembling grader inputs, then the telemetry carries no filtered-commit record and the rendered base line is unchanged.
- Given the filtered-set provenance cannot be assembled, when build_review runs, then the step verdict and the graded diff are unaffected and grading proceeds.

### Done When

- [ ] A step-runner integration case observes the filtered commits and excluded paths on the same result field the conductor emits the base event from.
- [ ] A renderer unit case shows the filtered-commit count on the base line, and shows the line unchanged when nothing was filtered.
- [ ] An injected provenance failure leaves the build_review verdict and graded diff identical to the run without it.

## Negative-category review

Input integrity is covered by the modified-variant and shared-path cases, which are the two ways a genuinely novel change could be wrongly suppressed. Dependency and environment failure is covered by the failing-probe case, which fails closed to today's behaviour. Idempotency needs no case of its own: the computation is a pure function of the base ref and HEAD, and re-running assembly on unchanged inputs yields the same pathspecs. Concurrency, permission, queue, datastore, upload, and transaction categories are inapplicable — the mechanism issues only read-only Git plumbing and writes nothing. Deletion is inapplicable in the destructive sense; a deletion commit that is patch-equivalent upstream is covered by the first happy-path criterion, since exclusion is by path and change kind is irrelevant. Rollback is inapplicable because the mechanism has no persisted state; disabling it is a code revert. Existing merge-base, base-freshness, and test-suite-proof failure coverage in the grader-input suite remains authoritative for the surrounding assembly path.
