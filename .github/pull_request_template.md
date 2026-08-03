<!--
This PR template applies only to PRs against the james-stoup-agents harness
repo. It does not affect how Claude opens PRs in consumer projects.

The README rule is a repository-local landing-page refinement of the global harness documentation convention.
Ordinary reader-visible changes update the canonical affected documentation. Leave README unchanged unless the README landing-page contract changes.
For consumer projects without this custom-step configuration, the global harness documentation and release conventions remain unchanged.
-->

## Summary

<!-- What and why, in 1-3 sentences. -->

## Release metadata

<!--
Every PR must declare exactly one disposition. Leave the default for non-notable,
specification-only, documentation-only, or no-implementation work.

For a reader-visible implementation change, replace the default line with exactly:
Release-Disposition: note
Release-Category: Added
Release-Semver: patch
Release-Note: Reader-facing summary of the delivered change.

Category is one of Added, Changed, Deprecated, Removed, Fixed, or Security.
Semver is one of major, minor, or patch.
-->

Release-Disposition: no-note

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
