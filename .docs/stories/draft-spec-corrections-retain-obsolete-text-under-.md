**Status:** Accepted

# Stories: Draft spec corrections retain obsolete text under amendment policy (#2499)

Track: technical

Tier: S

Accepted 2026-10-09 (delegated by the operator). "Base branch" is the target repository's default branch, normally `main`, compared at the spec branch's merge base. An artifact is a draft while it is absent from the base branch, even when this spec branch has already committed it. Story artifacts keep their existing in-place rule; the BUILD prohibition, protected-target scan, coverage binding, and reseal procedure are unchanged.

## Story 1: State the amendment rule by artifact lifecycle

As an agent correcting DECIDE artifacts after an operator changes scope, I want the harness rule to say which artifacts are revised in place and which take an amendment note, so that a draft ends up stating only the current approved scope without the operator having to intervene.

### Acceptance Criteria

#### Happy Path

- Given the `HARNESS.md` DECIDE Artifact Amendment Ownership section, when an agent reads how to correct an accepted DECIDE artifact absent from the base branch, then it is told to revise that artifact in place, removing the superseded text, and to add no amendment note.
- Given the `HARNESS.md` DECIDE Artifact Amendment Ownership section, when an agent reads how to correct a non-story accepted DECIDE artifact already on the base branch, then it is told to add the additive amendment note beside the original assertion and never to rewrite or delete the original text.
- Given the `conflict-check`, `architecture-review`, and `coherence-check` skills, when each instructs a DECIDE correction of an accepted artifact, then each restricts the amendment note to artifacts already on the base branch and directs in-place revision for artifacts absent from it.

#### Negative Paths

- Given the `HARNESS.md` DECIDE Artifact Amendment Ownership section, when an agent reads the in-place revision rule for draft artifacts, then that rule does not authorize rewriting or deleting the original text of a non-story artifact already on the base branch.
- Given the `HARNESS.md` DECIDE Artifact Amendment Ownership section, when an agent reads the story-artifact exception, then that exception sentence still names only story artifacts and no other artifact family.

### Done When

- [ ] Contract tests over `HARNESS.md` pass for the draft in-place rule, the on-base additive rule with its never-rewrite safeguard, and the unchanged story-only exception.
- [ ] Contract tests over the three named skills pass for the base-branch restriction on amendment notes and the in-place direction for drafts.

## Story 2: Refuse amendment notes in draft artifacts at land

As an operator landing a spec, I want `ai-conductor compose land` to refuse a draft artifact that carries an amendment note, so that obsolete obligations and correction history never reach a spec PR or a coverage-binding claim.

### Acceptance Criteria

#### Happy Path

- Given a spec worktree whose `.docs/` artifacts absent from the base branch contain no amendment note, when land runs, then it commits the spec as before.
- Given an artifact already on the base branch that gains an amendment note on the spec branch, when land runs, then the amendment note does not cause a refusal and the spec is committed.

#### Negative Paths

- Given an untracked `.docs/` artifact absent from the base branch that contains a line beginning with a bold "Amended" followed by a date, plain or block-quoted, when land runs, then land refuses with gate `draft-amendment-note`, names that artifact's path, and directs folding the correction into the artifact text.
- Given a `.docs/` artifact committed earlier on the spec branch but absent from the base branch that contains an amendment note, when land runs, then land refuses with gate `draft-amendment-note` and names that artifact's path.
- Given several draft artifacts containing amendment notes, when land runs, then a single refusal names every offending path.
- Given land refuses with gate `draft-amendment-note`, when the refusal is reported, then the spec branch HEAD is unchanged, no landing commit is created, and the land rejection is classified with gate `draft-amendment-note`.
- Given a draft artifact that shows the amendment format only with the `YYYY-MM-DD` placeholder, when land runs, then that text does not cause a refusal.

### Done When

- [ ] Real-git land tests cover the clean draft, the on-base amendment, the untracked and committed draft offenders, the multi-offender message, and the placeholder example.
- [ ] A refused land leaves HEAD unchanged and classifies as gate `draft-amendment-note`.

## Negative-category review

Invalid input is covered by the untracked, committed, multi-offender, and placeholder criteria — an amendment-note line in a draft is the only invalid input this gate judges. Partial failure is covered by the unchanged-HEAD criterion: the refusal happens before any landing write. Data integrity is covered by the on-base criterion, which keeps the existing additive safeguard for established artifacts, and by Story 1's negative paths, which keep the never-rewrite rule and the story-only exception intact. Auth, concurrency, idempotency, timeouts, and third-party dependency categories are inapplicable: the gate reads local git state and worktree files only, holds no state, and re-running land after the fix is the existing retry path. Renaming an on-base artifact to a new path makes the destination a draft under this rule; that follows the existing feature-file attribution in `resolveFeatureFiles` and is accepted.
