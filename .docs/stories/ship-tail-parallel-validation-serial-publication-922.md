**Status:** Accepted

# Stories: Parallel validation with serial, fenced publication (#922)

Technical track — acceptance derives from the APPROVED
`adr-2026-07-26-rebase-tail-current-branch-before-publication`.

> **Amended 2026-07-30** by
> `adr-2026-07-30-mergeability-first-integration-gate`: the serial integration step remains between
> validation and finish, but it may satisfy via mergeable-skip without making the branch current.

## Story ST-922-1: Publish only after validation and automatic integration

**Requirement:** adr-2026-07-26-rebase-tail-current-branch-before-publication

As a daemon operator, I want concurrent SHIP validation to join before the serial publication tail
and a current-HEAD fence to guard finish so that a PR is never published or updated from failed,
stale, or incomplete validation evidence, while mergeable history remains stable.

### Acceptance Criteria

#### Happy Path
- Given two or more applicable validation members need work, when the validation group runs, then
  they dispatch concurrently under `validation_concurrency` and join before the tail advances.
- Given every applicable validation member has joined green, when the SHIP tail advances, then
  retro completes or is validly skipped before rebase becomes eligible.
- Given automatic integration returns already-current or mergeable-skip without changing the
  branch, when the SHIP tail advances, then finish recomputes each applicable member's current-HEAD
  completion, passes the fence, and records its publication outcome after integration.
- Given a validation member is validly skipped by the existing tier, track, upstream, bootstrap, or
  configuration policy, when the finish fence resolves membership, then that member is excluded
  and the remaining applicable members determine the result.

#### Negative Paths
- Given `rebase` is already `done` while `prd_audit` is failed or
  `architecture_review_as_built` is stale, when finish is reached, then finish is not marked
  `in_progress` or dispatched; fresh verdicts are recorded and execution redirects to the earliest
  non-green validation member.
- Given several validation members are non-green at the finish fence, when execution redirects,
  then only those members are marked stale and the existing validation group may rerun them in
  parallel while preserving green siblings.
- Given the operator invokes explicit `--from finish` with a non-green applicable member, when the
  targeted step reaches its boundary, then the resume clamp remains bypassed but the publication
  fence redirects to validation and no PR is published or updated.
- Given a changed rebase invalidates an affected validation result, when the conductor resumes the
  SHIP tail, then it returns through the affected validation path and finish remains undispatched
  until the current-HEAD fence is green again.
- Given rebase halts because of a conflict, when the SHIP tail evaluates finish, then finish remains
  undispatched and no new PR publication outcome is recorded.

### Done When
- [ ] Acceptance coverage proves validation members remain a capped concurrent group.
- [ ] Registry/gate tests prove automatic integration waits for the validation join and serial retro tail.
- [ ] Acceptance coverage proves normal, resume, and explicit-finish entry paths all cross the
      current-HEAD fence before any finish dispatch.
- [ ] Integration coverage proves a changed rebase revalidates affected gates before finish can run.
- [ ] Existing rebase-conflict behavior continues to prevent finish and PR publication.
