---
name: release-disposition
disable-model-invocation: true
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
3. Record exactly one `Surface-Verdict:` line in `.pipeline/release-disposition-review.md`. Its value
   is one of `none|migration|waiver|unclassifiable`. Classify breaking surfaces using the release
   gate's canonical names: `bin/conduct CLI`, `skill symlink targets`, `hook wiring`, and
   `settings.json schema`. Record `Surface-Verdict: none` when the diff has no classified breaking
   surface; it authors no waiver and no migration block. When the diff has a classified breaking
   surface and no waiver committed in the feature diff, and you cannot confidently judge whether the
   change is internal-only or consumer-facing, record `Surface-Verdict: unclassifiable`; do not
   guess `waiver` or `migration`.
4. Replace any existing `Release-Disposition`, `Release-Category`, `Release-Semver`,
   `Release-Note`, and `## Migration` metadata while preserving all unrelated PR-body content.
5. Write one of these valid forms directly to the retained draft PR body:

   ```text
   Release-Disposition: no-note
   ```

   ```text
   Release-Disposition: note
   Release-Category: Added|Changed|Deprecated|Removed|Fixed|Security
   Release-Semver: major|minor|patch
   Release-Note: One present-tense reader-outcome sentence.
   ```

6. Follow the recorded surface verdict before writing the pass marker:

   - `waiver` means every classified breaking-surface edit is internal-only. Write the waiver for
     the feature plan stem under `.docs/release-waivers/`, with a `Waives:` line listing every
     classified canonical surface and a non-empty `Rationale:`. If one waiver for that plan stem is
     already committed in the feature diff and lists every classified surface, reuse it: add no
     second waiver file, and nothing to commit is success. If that in-diff waiver omits a classified
     surface, amend and commit that same waiver so the feature diff contains exactly one waiver.
     A waiver that exists only on the base branch is not fresh: write and commit the waiver in this
     feature diff. Complete the waiver commit before writing `.pipeline/release-disposition-pass`.
     If the commit fails, report BLOCKED with the pass marker absent.
   - `migration` means consumers must act. Write a `note` disposition with a runnable migration
     section in the retained draft PR body, and add or modify no file under `.docs/release-waivers/`.
     A `bin/conduct` subcommand, flag, or behavior change, a hook contract change, or a
     `settings.json` schema change is never `waiver`: record `migration`, or `unclassifiable` when
     the consumer action cannot be determined.
   - `unclassifiable` authors neither a waiver nor a migration block; leave the release gate to halt
     exactly as it does today. A recorded surface verdict outside `none`, `migration`, `waiver`,
     `unclassifiable` is BLOCKED with the pass marker absent.
   - `none` authors neither a waiver nor a migration block.

7. For a `migration` verdict, include a runnable migration section for a `note` disposition:

   ````text
   ## Migration

   ```bash migration
   # runnable consumer migration commands
   ```
   ````

   A `Release-Note` is exactly one present-tense sentence led by the reader outcome; multiple
   sentences, future tense, or internal mechanics first is BLOCKED with the pass marker absent.
   Use `no-note` only for an evidence-backed non-notable or non-implementation change; it cannot
   carry category, semver, note, or migration fields.
8. Re-read the retained PR body and verify it parses as exactly one valid disposition. Record the
   diff evidence, PR identity, written metadata, and verification result in the review file.
9. Write `.pipeline/release-disposition-pass` only after the PR update and re-read both succeed,
   and after every required waiver commit or reuse check succeeds. For a `waiver` verdict, commit
   (or the successful nothing-to-commit reuse check) precedes this marker. For BLOCKED, keep the
   pass marker absent and record the blocker.
