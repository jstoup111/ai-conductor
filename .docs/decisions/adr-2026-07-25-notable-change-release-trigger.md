# ADR: Notable changelog content triggers a release

**Date:** 2026-07-25
**Status:** SUPERSEDED
**Superseded by:** `adr-2026-08-01-bot-owned-release-pr`
**Deciders:** Project operator and maintain-documentation conflict resolution
**Supersedes in part:** `adr-2026-06-30-halt-based-release-gates` — ReleaseArtifactGate's
non-empty `[Unreleased]` requirement only

## Context

This repository currently requires every PR to add a changelog entry and runs the release workflow
after every merge. The approved documentation policy admits changelog entries only for notable
implementation changes; specification-only, documentation-only, and non-notable implementation
changes produce no entry.

An empty `[Unreleased]` section must therefore represent “no release pending,” not a failed merge.
The integrity and migration gates remain necessary and must not be weakened.

## Options Considered

### Option A: Treat every implementation change as notable

- **Pros:** Preserves release-on-every-implementation-PR behavior.
- **Cons:** Removes the approved significance threshold and fills the changelog with internal work.

### Option B: Release only when notable content is pending

- **Pros:** Makes the changelog the release trigger; allows non-notable work to merge cleanly;
  preserves meaningful release notes.
- **Cons:** Some merged commits do not immediately create a tag or GitHub Release.

### Option C: Block non-notable implementations until a later feature

- **Pros:** Avoids changing release machinery now.
- **Cons:** Ships a known non-convergent documentation gate.

## Decision

Choose Option B.

1. A present but substantively empty `## [Unreleased]` section is valid and means no release is
   pending. A missing header remains invalid under the integrity suite.
2. On a push to `main`, the release workflow determines whether `[Unreleased]` contains notable
   content before mutation. Empty content exits successfully without changing `CHANGELOG.md` or
   `VERSION`, creating a tag, pushing a release commit, or creating a GitHub Release.
3. Non-empty content preserves the existing release sequence and failure behavior.
4. The self-host `ReleaseArtifactGate` no longer requires a non-empty section. It still requires the
   full integrity suite and a runnable migration block or valid waiver for every classified breaking
   surface. Missing or malformed changelog structure continues to fail through integrity checks.
5. In this repository, the configured `maintain-documentation` gate owns the judgment that an
   implementation is notable. A PASS with no entry permits finish; a required but missing entry
   blocks before finish.
6. The repository instruction and pull-request template describe changelog entries as conditional
   on notable implementation change. Consumer-project behavior is unchanged.

## Consequences

### Positive

- Specifications, documentation-only changes, and non-notable implementations merge without fake
  release notes or failed release jobs.
- Changelog content remains the single observable trigger for release creation.
- Breaking-change migration enforcement and repository integrity remain fail-closed.

### Negative

- Tags no longer map one-to-one with merges to `main`.
- A bad documentation judgment can defer a release until the next notable entry; human PR review
  remains the backstop until deterministic documentation linting is implemented.

### Follow-up Actions

- [ ] Add release-workflow empty-content detection and successful no-op behavior.
- [ ] Remove only the non-empty-content sub-gate from the composed self-host release gate.
- [ ] Preserve changelog header integrity and breaking-surface migration enforcement tests.
- [ ] Reconcile the repository instruction and pull-request template.
