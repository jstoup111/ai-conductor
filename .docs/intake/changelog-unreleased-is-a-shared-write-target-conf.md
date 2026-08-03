# Intake origin: changelog-unreleased-is-a-shared-write-target-conf

Source-Ref: jstoup111/ai-conductor#1153
Owner: jstoup111

## Desired outcome

- Concurrent implementation branches never edit `CHANGELOG.md` or `VERSION`, eliminating the shared release-staging write target.
- Every merged implementation PR has a validated structured release note/category/semver disposition or an explicit no-note disposition.
- A serialized GitHub App-authored workflow maintains exactly one reviewable release PR from complete merged-PR evidence since the latest tag.
- Only the operator-approved release PR may update the release artifacts, create the version tag, and publish the GitHub Release.
- The current `[Unreleased]` backlog is automatically proposed as a culled and consolidated reader-facing set with exhaustive reasons, then approved by the operator once.
- Breaking migrations, fresh waivers, empty-release behavior, and existing released changelog history remain fail-closed and readable under the new representation.
- Implementation-PR attribution is rendered directly from candidate metadata, so feature-side `{{IMPLEMENTATION_PR}}` finalization and inherited-token logic become unnecessary.
- Tagged and main installation channels continue using Git sources without a package manager, and tagged update detection uses installed release identity rather than forward-looking `VERSION`.
