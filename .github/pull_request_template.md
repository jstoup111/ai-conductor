<!--
This PR template applies only to PRs against the james-stoup-agents harness
repo. It does not affect how Claude opens PRs in consumer projects.

CI (.github/workflows/release.yml) will FAIL if the [Unreleased] section of
CHANGELOG.md is empty after this PR merges. Add your entry below AND paste
the same entry into CHANGELOG.md under ## [Unreleased].
-->

## Summary

<!-- What and why, in 1-3 sentences. -->

## Changelog

<!--
Required. Pick one of: Added / Changed / Fixed / Removed.
Copy this entry into CHANGELOG.md under ## [Unreleased] as part of this PR.
-->

### Added / Changed / Fixed / Removed

- …

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

## Test plan

- [ ] `test/test_harness_integrity.sh` passes
- [ ] Manually verified affected skill/hook/CLI
