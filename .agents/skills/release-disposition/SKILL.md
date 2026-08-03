---
name: release-disposition
description: Judge this repository's implementation diff and write its authoritative structured release disposition to the retained SHIP draft PR before finish.
---

# Release Disposition

Write the authoritative release disposition for this repository's retained SHIP draft PR.

## Shared outcome

This repository-local pre-finish gate judges the implementation diff, not the draft placeholder.
It writes exactly one valid structured release disposition directly into the retained draft PR body.
The PR body is authoritative; `.pipeline/release-disposition-pass` is evidence only. The later
`finish` step writes reader-facing PR content while preserving this metadata block.

The selected host uses its authenticated repository PR interface to read and update the retained
draft PR. Claude Code invokes this skill as `/release-disposition`; Codex invokes it as
`$release-disposition`. If the retained draft cannot be resolved or updated, return BLOCKED.

## Procedure

1. Remove `.pipeline/release-disposition-pass` before judging the diff. Overwrite
   `.pipeline/release-disposition-review.md` at the start; never append prior evidence.
2. Read the retained SHIP draft PR body and the feature diff against its base. Inspect code, tests,
   configuration, hook wiring, skill symlinks, and CLI changes as applicable. The diff is authority;
   the placeholder and prior metadata are not a disposition decision.
3. Replace any existing `Release-Disposition`, `Release-Category`, `Release-Semver`,
   `Release-Note`, and `## Migration` metadata while preserving all unrelated PR-body content.
4. Write one of these valid forms directly to the retained draft PR body:

   ```text
   Release-Disposition: no-note
   ```

   ```text
   Release-Disposition: note
   Release-Category: Added|Changed|Deprecated|Removed|Fixed|Security
   Release-Semver: major|minor|patch
   Release-Note: One present-tense reader-outcome sentence.
   ```

5. When the feature changes `bin/conduct` CLI, hook wiring, `settings.json` schema, or skill
   symlink targets, include a runnable migration section for a `note` disposition:

   ````text
   ## Migration

   ```bash migration
   # runnable consumer migration commands
   ```
   ````

   Use `no-note` only for an evidence-backed non-notable or non-implementation change; it cannot
   carry category, semver, note, or migration fields. An internal-only breaking-surface classifier
   result requires the repository's fresh release waiver instead of an invented migration.
6. Re-read the retained PR body and verify it parses as exactly one valid disposition. Record the
   diff evidence, PR identity, written metadata, and verification result in the review file.
7. Write `.pipeline/release-disposition-pass` only after the PR update and re-read both succeed.
   For BLOCKED, keep the pass marker absent and record the blocker.
