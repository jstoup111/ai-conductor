**Status:** Accepted

# Stories: idea-scoped land artifact resolution

Technical track (no PRD). Source: intake jstoup111/ai-conductor#488; approach B
per `.memory/decisions/2026-07-22-idea-scoped-land-artifact-resolution.md`.
Requirements are tagged TS-N (technical story) against the technical intent:
`landSpec` must resolve artifacts attributable to the current idea — the union
of `git diff --name-only <base>...HEAD` and untracked files — never a
corpus-wide newest-by-mtime pick.

## Story: Technical-track land ignores legacy specs entirely

**Requirement:** TS-1

As the engineer landing a technical-track spec, I want landSpec to never
resolve or validate a spec artifact the idea did not author, so that legacy
`.docs/specs/` content on main can never false-reject my land.

### Acceptance Criteria

#### Happy Path
- Given a per-idea worktree on the technical track (idea-authored track marker
  says `Track: technical`) whose `.docs/specs/` contains only legacy files
  from main — including one whose body carries a DRAFT status line — and
  idea-authored stories (`Status: Accepted`), plan, and complexity artifacts,
  when `landSpec` runs, then it succeeds: no spec file is resolved, read, or
  content-validated, and the commit contains only the idea's artifacts.

#### Negative Paths
- Given the same worktree but with the legacy DRAFT-matching spec being the
  newest file by mtime in `.docs/specs/` (fresh-checkout mtime tie), when
  `landSpec` runs, then it still succeeds — mtime has no effect on the outcome
  (regression guard for the #488 coin-flip).
- Given a technical-track worktree whose idea-authored stories file carries a
  DRAFT status marker, when `landSpec` runs, then it is rejected with the existing
  stories-not-approved error — idea-scoping loosens artifact *selection*, not
  content *validation* of the idea's own artifacts.

### Done When
- [ ] A test lands a technical-track worktree whose `.docs/specs/` holds a
      committed legacy file carrying a DRAFT status line (touched to be newest
      by mtime) and asserts `landSpec` resolves without error.
- [ ] A test asserts the resulting commit's tree does not modify any legacy
      `.docs/specs/` file.
- [ ] The 2026-07-10 operator workaround (`touch` a clean legacy spec) is no
      longer needed: no code path in `landSpec` stats mtimes in `.docs/specs/`
      on the technical track.

## Story: All artifact pickers resolve from the idea-attributable set

**Requirement:** TS-2

As the engineer, I want every landSpec picker (spec, stories, plan,
complexity, conflicts, architecture, decisions, track) to consider only files
attributable to the current idea, so that validation and the landed commit
always concern this idea's artifacts, not the corpus.

### Acceptance Criteria

#### Happy Path
- Given a worktree where the idea's artifacts are untracked files under
  `.docs/`, when `landSpec` resolves artifacts, then each picker returns the
  idea's file even when a legacy file in the same directory has a newer mtime.
- Given a worktree where some idea artifacts were already committed on the
  `spec/<slug>` branch (e.g. operator-committed annotations) and the rest are
  untracked, when `landSpec` resolves artifacts, then both committed-on-branch
  and untracked files are attributable and resolvable.
- Given the idea authored exactly one file in a directory, when that picker
  runs, then that file is returned regardless of any mtime relationship to
  legacy files.

#### Negative Paths
- Given a directory (e.g. `.docs/plans/`) containing only legacy files from
  the base commit and nothing idea-attributable, when `landSpec` resolves that
  artifact, then the picker returns "absent" and the existing missing-artifact
  error fires (naming the missing artifact) — a legacy plan can no longer
  satisfy the plan requirement.
- Given a file that exists on the base commit and is modified but uncommitted
  in the worktree, when `landSpec` runs, then the existing dirty-worktree
  guard still rejects before any resolution (unchanged behavior; attribution
  never bypasses the cleanliness gate).

### Done When
- [ ] `findNewestFile` (corpus mtime scan) has no remaining callers in
      `land-spec.ts`; the replacement resolver takes the attributable set as
      its universe.
- [ ] Tests cover both attribution sources: committed on `spec/<slug>` after
      the base commit, and untracked in the worktree.
- [ ] A decoy test per required picker (stories, plan, complexity) proves a
      newer-mtime legacy file is never selected.

## Story: Product-track spec requirement is enforced against the idea's set

**Requirement:** TS-3

As the engineer landing a product-track spec, I want the PRD requirement
checked against idea-attributable files only, so that a legacy spec can never
silently stand in for the PRD this idea was supposed to author.

### Acceptance Criteria

#### Happy Path
- Given a product-track worktree with an idea-authored PRD in `.docs/specs/`
  (plus stories/plan/complexity), when `landSpec` runs, then the idea's PRD —
  not any legacy spec — is the file that is content-validated and landed.

#### Negative Paths
- Given a product-track worktree whose `.docs/specs/` contains only legacy
  specs (the idea authored no PRD), when `landSpec` runs, then it is rejected
  with the missing-artifact error naming `spec (product track)` — even though
  `.docs/specs/` is non-empty.

### Done When
- [ ] A test with a legacy-only `.docs/specs/` on the product track asserts
      the missing-spec rejection.
- [ ] A test with both a legacy spec (newer mtime) and an idea-authored PRD
      asserts the PRD is the validated file.

## Story: Track resolution cannot be flipped by legacy markers

**Requirement:** TS-4

As the engineer, I want the track read from the idea's own track marker, so
that a stale `.docs/track/` file from an earlier feature can never change
which artifacts this land requires.

### Acceptance Criteria

#### Happy Path
- Given the idea authored `.docs/track/<slug>.md` with `Track: technical` and
  a legacy track file with `Track: product` exists from the base commit (any
  mtime), when `landSpec` resolves the track, then the track is `technical`.

#### Negative Paths
- Given the idea authored no track marker (attributable set has no
  `.docs/track/` file), when `landSpec` resolves the track, then it defaults
  to `product` (back-compat preserved) and therefore requires an
  idea-authored spec — a legacy `Track: technical` marker cannot loosen the
  gate.

### Done When
- [ ] A test with conflicting idea vs legacy track markers asserts the idea's
      marker wins irrespective of mtime.
- [ ] A test with no idea-authored track marker asserts the product default
      applies even when a legacy `Track: technical` file exists.
- [ ] The intake marker's slug derives from the idea-attributable plan file's
      stem (`planStem`), proven by a test where a legacy plan has a newer
      mtime than the idea's plan.
