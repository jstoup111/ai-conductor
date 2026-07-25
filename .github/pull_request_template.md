<!--
This PR template applies only to PRs against the james-stoup-agents harness
repo. It does not affect how Claude opens PRs in consumer projects.

A changelog entry is required only when this PR contains a notable reader-visible implementation change. A non-notable implementation may ship without a changelog entry.
An empty [Unreleased] is a successful no-release path with no changelog rewrite, no VERSION bump, no tag, no release commit, and no GitHub Release.
Breaking changes still require a runnable bash migration block even when no ordinary changelog entry is required.
The README rule is a repository-local landing-page refinement of the global harness documentation convention.
Ordinary reader-visible changes update the canonical affected documentation. Leave README unchanged unless the README landing-page contract changes.
For consumer projects without this custom-step configuration, the global harness documentation and release conventions remain unchanged.
-->

## Summary

<!-- What and why, in 1-3 sentences. -->

## Changelog

<!--
Required only for a notable reader-visible implementation change. Pick one of:
Added / Changed / Fixed / Removed, then copy the entry into CHANGELOG.md under
## [Unreleased]. For a non-notable implementation, leave CHANGELOG.md unchanged
and keep "none" below.
-->

### Added / Changed / Fixed / Removed

none

## Migration

<!--
Required — even if the answer is "none".

If this PR changes settings.json schema, hook wiring, skill symlink targets,
or bin/conduct CLI, include a runnable bash block below. bin/migrate will
execute it for consumers when they update past this version.

```bash migration
# commands go here
```

Otherwise, write "none".
-->

none

## Documentation

<!--
Update the canonical affected documentation for ordinary reader-visible changes.
Update README only when its landing-page contract changes.
-->

- [ ] Canonical affected documentation updated, or not applicable
- [ ] README landing-page contract updated, or not affected

## Test plan

- [ ] `test/test_harness_integrity.sh` passes
- [ ] Manually verified affected skill/hook/CLI
