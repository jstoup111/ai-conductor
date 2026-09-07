**Status:** Accepted

# Stories: On-demand regeneration of the bot-owned release PR (#1274)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the manual trigger for the release-PR maintenance workflow, the ref restriction that manual trigger needs, and proof that the manual path keeps the serialization and App-provenance contract the merge-triggered path already has. Candidate collection, rendering, completeness policy, and publication are unchanged and outside this slice.

## Story 1: Regenerate the release PR without merging anything

As a release operator, I want to start release-PR maintenance by hand so that a corrected repository state produces a fresh release PR immediately instead of waiting for unrelated work to merge.

### Acceptance Criteria

#### Happy Path

- Given the release-PR maintenance workflow, when its declared triggers are read, then it offers a manual trigger in addition to the closed-pull-request trigger.
- Given a manual trigger, when the maintenance job's run condition is evaluated, then the job runs even though the event carries no merged pull request.
- Given a manual trigger, when the job resolves the commit to check out, then it checks out the commit the run was requested at rather than an absent merge commit.

#### Negative Paths

- Given a pull request that closes without merging, when the workflow receives that event, then the maintenance job does not run.
- Given a merged pull request whose head branch is the bot-owned release branch, when the workflow receives that event, then the maintenance job does not run.

### Done When

- [ ] The parsed workflow declares both a manual trigger and the closed-pull-request trigger with its existing type list.
- [ ] The parsed job condition admits a manual run and still requires a merged, non-release-branch pull request on the event-driven path.
- [ ] The parsed checkout reference falls back to the requested commit when no merge commit is present.

## Story 2: A manual run carries the same serialization and provenance as a merged one

As a release operator, I want a hand-started run to be indistinguishable from a merge-triggered one so that regenerating on demand cannot race the automatic path or produce a release PR the publisher will not trust.

### Acceptance Criteria

#### Happy Path

- Given a manual run and a merge-triggered run of the same workflow, when both are queued, then both belong to the one release-PR maintenance concurrency group that does not cancel a run already in progress.
- Given a manual run, when it updates the release branch and publishes candidate audit evidence, then it does so through the same GitHub App installation token and write grants the merge-triggered run uses, with no trigger-specific credential path.

#### Negative Paths

- Given a manual run requested at a ref other than the repository's default branch, when the workflow evaluates the requested ref, then the run fails with a message naming both the default branch and the requested ref, before any checkout or release-branch mutation.

### Done When

- [ ] The concurrency group and its no-cancel setting are declared once on the job, unconditioned by event, so both trigger paths share them.
- [ ] The App token step and its write grants carry no event-specific condition, and the maintenance script is reached only through that token.
- [ ] Executing the guard's own script rejects a non-default requested ref with a nonzero status and a message naming both refs, and accepts the default branch.

## Negative-category review

Invalid input is covered by the non-default requested ref, the only operator-supplied value the manual path introduces; the trigger takes no other inputs. Auth and permission failures are unchanged — the manual path reuses the same App installation token and the same read-only workflow permissions, and Story 2 pins that no trigger-specific credential path is added. Concurrent access is covered by the shared concurrency group criterion; the existing stale-render rejection and lease-protected push remain the mutation-level guard and need no new scenario. Partial failure and rollback are inapplicable because the job performs no new multi-step mutation. Timeouts, dependency unavailability, resource exhaustion, data integrity, cascade deletion, and idempotency-key analysis are inapplicable: this slice adds no external call, no datastore, no deletion, and no dedup key. Invariant side-effect on alternate branches is addressed by requiring the guard to run before checkout, so the new early-exit branch cannot skip a mutation the happy path performs.
