**Status:** Accepted

# Stories: Base-inherited protected-artifact deletion no longer deadlocks the seal (#1752, absorbs #1676)

**Track:** technical. There is no PRD; acceptance criteria are defined here.
**Design:** `.docs/architecture/base-inherited-artifact-deletion-deadlocks-both-se.md`
**Decision:** `adr-2026-10-07-prune-base-inherited-deletions-from-the-seal`
**Review:** `architecture-review-2026-10-07-base-inherited-artifact-deletion-deadlocks-both-se` (APPROVED)

Requirement tags reference the approved decision record: `ADR-N` is decision item N of
`adr-2026-10-07-prune-base-inherited-deletions-from-the-seal`.

Terms used throughout:
- **Sealed path:** a protected `.docs/` artifact recorded in the feature's
  `.pipeline/protected-artifact-seal.json`.
- **Base-inherited deletion:** the base branch committed the deletion, and the feature branch has not
  changed the path since its merge-base with the base branch.

Every scenario uses real git fixtures: a bare origin, a base branch, and a feature worktree. No story
involves a third-party boundary.

---

## Story 1: Verification passes a sealed path that the base branch deleted

**Requirement:** ADR-1, ADR-3

As the daemon, I want a feature to keep building when `main` deletes a sealed artifact the feature
never touched, so routine spec retirement on `main` does not halt in-flight features.

### Acceptance Criteria

#### Happy Path
- Given a feature whose seal includes `.docs/plans/<retired>.md`, and the base branch deleted it in
  commit `D` before the feature rebased onto it, when the BUILD/SHIP step guard verifies the seal,
  then the verdict is `ok` and the step dispatches with no HALT.
- Given the same feature on its re-kick path, where the base was merged in and the seal baseline is
  still an ancestor of HEAD (the #1676 shape), when the seal is verified, then the verdict is `ok`.
- Given the deletion was pruned by an earlier verification, when the seal is verified again, then the
  verdict is `ok` and `.docs/plans/<retired>.md` is no longer among the seal's `protectedArtifacts`.

#### Negative Paths
- Given the base branch deleted `.docs/plans/<retired>.md` but the feature has not yet rebased or merged
  the base (HEAD still contains the file and it is still on disk), when the seal is verified, then the
  verdict is `ok` and the seal is unchanged, because nothing is missing.
- Given the feature's base branch cannot be resolved (`origin/<base>` and `<base>` are both missing)
  and a sealed path is missing from the workspace, when the seal is verified, then it refuses with
  `Protected artifact provenance undeterminable: <path>`, names the missing base ref, and leaves the
  seal file byte-for-byte unchanged.
- Given HEAD and the base branch have no merge-base and a sealed path is missing, when the seal is
  verified, then it refuses with `Protected artifact provenance undeterminable: <path>`, naming the
  absent merge-base, and the seal is unchanged.

### Done When
- [ ] A real-git fixture of the #1752 rebase shape verifies `ok` through `verifyProtectedArtifactSeal`.
- [ ] A real-git fixture of the #1676 merge/re-kick shape verifies `ok`.
- [ ] Both fail-closed fixtures (missing base ref, no merge-base) refuse with the stated reasons, and
      the seal file's bytes are identical before and after.

---

## Story 2: A pruned deletion leaves a durable, attributed audit record

**Requirement:** ADR-3, ADR-5

As an operator, I want each automatic prune recorded with the paths removed and the base commit that
removed them, so I can audit every change to the protected set.

### Acceptance Criteria

#### Happy Path
- Given a base-inherited deletion of `.docs/plans/<retired>.md` by base commit `D`, when verification
  prunes it, then the persisted seal has a new last `rebaselines` entry with `trigger:
  "inherited-base-deletion"`, `paths: [".docs/plans/<retired>.md"]`, `deletedBy:
  {".docs/plans/<retired>.md": "<D>"}`, and `fromCommit` and `toCommit` both equal to the unchanged
  `baselineCommit`.
- Given the same prune, when it completes, then exactly one `protected_artifact_rebaseline` event is
  emitted with `trigger: "inherited-base-deletion"`, the pruned paths, and the same `deletedBy` map.
  The daemon log line and the `daemon-cli` rendering name each pruned path with its deleting commit.
- Given two sealed paths deleted by two different base commits, when verification prunes both, then
  one `rebaselines` entry lists both paths and `deletedBy` maps each one to its own deleting commit.
- Given a seal file that contains an `inherited-base-deletion` entry with `deletedBy`, when the seal
  is read back, then it parses as a valid `version: 2` seal. A seal written before this change, with
  no `deletedBy`, also still parses.

#### Negative Paths
- Given a base-inherited deletion whose deleting commit cannot be found on the base ref (for
  example, base history was truncated), when the seal is verified, then it refuses with `Protected
  artifact provenance undeterminable: <path>` and the line `Deleting base commit not found.`, and
  writes no prune.
- Given a seal file whose rebaseline entry has a `deletedBy` value that is not an object of string
  commits, when the seal is read, then reading fails with `Protected artifact seal is invalid`.
- Given the rebaseline observer throws while the prune event is emitted, when verification prunes,
  then the seal write still persists and the verdict is still `ok`, because telemetry is
  best-effort.

### Done When
- [ ] After a prune, the persisted seal JSON shows the `inherited-base-deletion` entry with the exact
      `deletedBy` commits from the fixture's `git log`.
- [ ] A captured `protected_artifact_rebaseline` event carries `trigger` and `deletedBy` equal to the
      persisted entry.
- [ ] The seal reader round-trips both new-format and pre-change seal files, and rejects a malformed
      `deletedBy`.

---

## Story 3: A deletion the feature authored still halts, naming the artifact

**Requirement:** ADR-1, ADR-6

As the daemon, I want deletions the feature made itself to keep halting, so pruning can never be
used to silently drop a DECIDE artifact.

### Acceptance Criteria

#### Happy Path
- Given a feature branch with a commit that deletes sealed `.docs/stories/<own>.md` after its
  merge-base, when the seal is verified, then it refuses with `Protected artifact deleted:
  .docs/stories/<own>.md` followed by `Attribution: feature-authored (committed on this branch since
  merge-base <sha>)`, and the seal is unchanged.
- Given sealed `.docs/plans/<x>.md` is removed from disk but still present in HEAD, when the seal is
  verified, then it refuses with `Protected artifact deleted: .docs/plans/<x>.md` followed by
  `Attribution: uncommitted workspace change`, and the seal is unchanged.

#### Negative Paths
- Given the feature committed a deletion of sealed `.docs/plans/<retired>.md` after its merge-base
  and the base branch later deleted the same path too, but the feature has not yet rebased onto it,
  when the seal is verified, then it refuses as feature-authored for that path and prunes nothing.
- Given the base branch never contained a deletion of sealed `.docs/plans/<kept>.md` (it still
  exists on the base tip), and the feature's branch commit deleted it, when the seal is verified,
  then it refuses as feature-authored and no `git log` deleting-commit lookup is attempted for it.

### Done When
- [ ] The committed-deletion and uncommitted-deletion fixtures each refuse with the exact two-line
      reason above.
- [ ] In every refusal fixture, the seal file bytes are identical before and after verification.

---

## Story 4: No prune is persisted when any other path refuses

**Requirement:** ADR-4

As an operator, I want the protected set never to shrink while the workspace is in violation, so a
partial prune cannot mask or accompany a real mutation.

### Acceptance Criteria

#### Happy Path
- Given a base-inherited deletion and no other drift, when the seal is verified, then the prune is
  persisted and the verdict is `ok`.
- Given a base-inherited deletion on a rewritten history where rotation is permitted, when the seal
  is verified, then one atomic write persists the `inherited-base-deletion` entry immediately
  followed by the rotation's own `rebaselines` entry.

#### Negative Paths
- Given a base-inherited deletion of `.docs/plans/<retired>.md` together with an uncommitted edit to a
  different sealed artifact, when the seal is verified, then it refuses for the edited artifact,
  persists no prune, and `.docs/plans/<retired>.md` is still in the seal.
- Given a base-inherited deletion together with a feature-authored deletion of another path, when
  the seal is verified, then it refuses naming the feature-authored path, and neither path is pruned.
- Given a base-inherited deletion, an inspection that otherwise passes, and a rotation refused as
  `head-differs-from-base` for a feature-authored path (the #1752 shape), when the seal is verified,
  then it halts naming the feature-authored path, persists no prune, and the seal file is
  byte-identical.
- Given the atomic seal write fails (the rename throws), when verification attempts the prune, then
  the original seal file is unchanged, no temporary file is left in `.pipeline/`, no
  `protected_artifact_rebaseline` event is emitted, and the error surfaces to the caller.

### Done When
- [ ] The mixed-drift fixtures refuse, and the seal JSON is byte-identical before and after.
- [ ] An injected rename failure leaves the original seal and no `.protected-artifact-seal.json.*.tmp`
      file behind.

---

## Story 5: `conduct reseal` recovers a feature after a rebase across a base deletion

**Requirement:** ADR-8, ADR-9

As an operator, I want `conduct reseal` to work after my feature inherits a base deletion, so I
never have to hand-run engine internals to unblock it.

### Acceptance Criteria

#### Happy Path
- Given the #1752 shape: a base-inherited deletion of `.docs/plans/<retired>.md`, plus the feature's
  own plan carrying a committed non-append amendment that rotation refuses as `head-differs-from-base`.
  When the operator runs `conduct reseal` naming the feature's own plan with a reason, then the
  reseal succeeds. The persisted seal carries an `inherited-base-deletion` entry followed by an
  `operator-reseal` entry. The next seal verification returns `ok`.
- Given a reseal that names `.docs/plans/<retired>.md` itself, where that deletion is base-inherited,
  when the operator runs `conduct reseal` on it, then the target is pruned (recorded under
  `inherited-base-deletion` with its deleting commit) and the reseal succeeds, not refusing with
  "reseal target is deleted".

#### Negative Paths
- Given a reseal that names a sealed path the feature itself deleted in a branch commit, when the
  operator runs `conduct reseal` on it, then it refuses with the target named and `Attribution:
  feature-authored`, emits `reseal_refused` with that reason as its `condition`, and leaves the seal
  unchanged.
- Given a base-inherited deletion elsewhere and an uncommitted edit on a sealed path outside the
  reseal scope, when the operator runs `conduct reseal`, then it refuses for the out-of-scope edit,
  with attribution `uncommitted workspace change`, and prunes nothing.
- Given the feature's own plan differs from base only by a non-append line, and no reseal has been
  run, when the BUILD step guard verifies the seal on a rotated (non-ancestor) baseline, then the
  existing rotation refusal for that plan still halts exactly as before this change (ADR-9 keeps it
  out of scope).

### Done When
- [ ] A real-git fixture reproducing #1752 is recovered by one `conduct reseal` invocation, and the
      next `verifyProtectedArtifactSeal` returns `ok`.
- [ ] A reseal naming a base-inherited deleted target exits 0 and records its prune entry.
- [ ] Refused reseals emit `reseal_refused` whose `condition` contains the path and its attribution.

---

## Story 6: Every seal refusal states which artifact and who caused it

**Requirement:** ADR-7

As an operator reading a HALT, I want each seal refusal to name the artifact and say whether the
feature or the base branch caused the change, so I can choose the right recovery without forensics.

### Acceptance Criteria

#### Happy Path
- Given a committed feature amendment to another feature's sealed artifact, when the seal is
  verified, then the refusal reads `Protected artifact changed: <path>` followed by `Attribution:
  feature-authored (committed on this branch since merge-base <sha>)`.
- Given an uncommitted edit to a sealed artifact, when the seal is verified, then the refusal names
  the path with `Attribution: uncommitted workspace change`.
- Given a rotation refusal of `head-differs-from-base` for a feature-authored path, when it
  escalates, then the HALT reason names the path with `Attribution: feature-authored`.

#### Negative Paths
- Given any refusal whose provenance probe could not run (missing base ref, no merge-base, or a
  failed git probe), when the seal is verified, then the reason names the path with `Attribution:
  provenance undeterminable` and never with `feature-authored` or `base-inherited`.
- Given a base-inherited change or deletion, when the seal is verified with no other drift, then no
  refusal is produced at all. A base-inherited path never appears in a refusal for its own drift.

### Done When
- [ ] Every refusal reason produced by `inspectSeal` and `rotationRefusalVerdict` in the fixtures
      contains the path and exactly one attribution from the closed set {feature-authored,
      uncommitted workspace change, base-inherited, provenance undeterminable}.
- [ ] The `reseal_refused` audit event's `condition` carries the same attributed reason verbatim.
