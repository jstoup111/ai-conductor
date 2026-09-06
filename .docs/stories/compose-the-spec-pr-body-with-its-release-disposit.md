**Status:** Accepted

# Stories: Compose the spec PR body with its release disposition (#1869)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the spec-PR create call, the body it carries, and the degraded paths around it. The required check's own payload contract, rerun replay semantics, and the implementation-PR disposition path remain outside this slice.

## Story 1: Declare the disposition in the create call, not after it

As an operator reading a spec PR's checks, I want the release disposition present from the moment the PR opens so that the checks list carries no routine red entry I must diagnose.

### Acceptance Criteria

#### Happy Path

- Given the target repository's pull request template declares a release disposition, when the spec PR is opened, then the arguments of the create invocation itself carry a body that the release-metadata parser accepts as a no-note disposition.
- Given the create invocation already supplied that body, when the post-create release-metadata step runs, then it issues no body edit and the opened body is left byte-identical.

#### Negative Paths

- Given the target repository has no pull request template declaring a disposition, when the spec PR is opened, then the create invocation carries neither a composed title nor a composed body and no PR body is read or edited.

### Done When

- [ ] A create-boundary fixture captures the create argument list and the real parser accepts the body carried in it as a no-note disposition.
- [ ] The same fixture records zero body-editing invocations after the create call.
- [ ] An opted-out fixture records a create argument list with no composed body argument and zero body read or edit invocations.

## Story 2: Preserve an author's declaration and survive a degraded read

As a maintainer, I want composition to defer to a declaration the branch already carries and to fail soft when the commit message cannot be read so that no spec PR is lost or silently re-declared.

### Acceptance Criteria

#### Happy Path

- Given the spec branch's tip commit message already declares a valid disposition, when the create body is composed, then that declaration is carried through unchanged and no default disposition block is added.
- Given a composed create body, when the non-closing issue reference line is appended to it after the PR opens, then the release-metadata parser still accepts the resulting body.

#### Negative Paths

- Given reading the spec branch's tip commit message fails, when the spec PR is opened, then the PR is still opened with the autofilled body, the existing post-create repair supplies the disposition, and the opened PR result is returned rather than discarded.

### Done When

- [ ] A composition unit case whose input already declares a disposition returns that input unchanged and contains exactly one release-metadata heading.
- [ ] A unit case appends the non-closing issue reference line to the composed body and the real parser still returns a no-note disposition.
- [ ] A fixture whose commit-message read rejects still returns an opened-PR result, and the real parser accepts the body the post-create repair leaves behind.

## Negative-category review

Invalid and unexpected input is covered by the opted-out repository case and by the already-declared commit message case. Dependency unavailability and partial failure are covered by the rejecting commit-message read, which must neither discard the delivered PR nor leave the body without a disposition. Idempotency is covered by the no-second-edit criterion, which is the load-bearing property for this defect: a second body edit fires another required-check run. Concurrency, resource exhaustion, cascade deletion, immutability, and authorization categories are inapplicable — the change adds no shared mutable state, no datastore, no deletion, and no new credential path, and every external call reuses the existing injected runners with their existing non-fatal contract.
