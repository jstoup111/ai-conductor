# Plan: Idempotent `needs-remediation` Comment (Issue #159)

**Spec:** `.docs/specs/2026-06-30-remediation-comment-upsert.md`
**Stories:** `.docs/stories/remediation-comment-upsert.md`
**Tier:** Small → direct TDD (no system-tests/pipeline/code-review steps).

## Task 1 — `upsertComment()` in `pr-labels.ts` (Stories 1, 2, 3)

Add to `src/conductor/src/engine/pr-labels.ts`:

- Export const `NEEDS_REMEDIATION_MARKER = '<!-- conductor:needs-remediation -->'`.
- Module-private `parseCommentUrl(url)` → `{owner, repo, commentId} | null` via regex
  `github\.com\/([^/]+)\/([^/]+)\/(?:pull|issues)\/\d+#issuecomment-(\d+)`.
- Export `async function upsertComment(runGh, cwd, prUrl, marker, body, log?)`:
  1. `taggedBody = marker + '\n' + body`.
  2. try: `gh pr view <prUrl> --json comments` → parse `comments[]`, find first whose
     `body` includes `marker`. If found and its `url` parses → `gh api --method PATCH
     repos/<owner>/<repo>/issues/comments/<id> -f body=<taggedBody>`; return. If found but
     url unparseable → log, fall through to create. (catch → log, fall through to create.)
  3. Fallback: `await comment(runGh, cwd, prUrl, taggedBody, log)`.
  - Never throws (mirrors the seam; `comment()` already swallows its own errors).

**Covers AC:** S1 happy (create w/ marker) + S1 negative (empty comments → create);
S2 happy (PATCH, no create) + S2 negative (unparseable url → create); S3 negatives
(pr view throws → create; PATCH throws → no duplicate create, swallowed).

## Task 2 — Wire Step 6 in `build-failure-escalation.ts` (Story 4)

- Import `upsertComment` + `NEEDS_REMEDIATION_MARKER` from `./pr-labels.js`.
- Replace the `comment(runGh, cwd, prUrl, commentBody, log)` call with
  `upsertComment(runGh, cwd, prUrl, NEEDS_REMEDIATION_MARKER, commentBody, log)`.
- `commentBody` unchanged (`## Daemon halt` + reason + note).

**Covers AC:** S4 happy (calls upsert w/ marker) + S4 negative (two escalations → one
create + one PATCH, never two creates).

## Task 3 — Tests

- `test/engine/pr-labels.test.ts`: new `describe('upsertComment')` — create-when-absent,
  create-when-empty-comments, PATCH-when-present (assert no create call), unparseable-url
  → create, pr-view-throws → create, PATCH-throws → swallowed-no-create. Assert the PATCH
  argv shape and that the create body carries the marker.
- `test/engine/build-failure-escalation.test.ts`: update `standardGhResps` to include the
  extra `pr view --json comments` call in Step 6; add a two-escalation test asserting one
  create + one PATCH across runs.

## Docs / gates

- `CHANGELOG.md` → `[Unreleased] / Fixed`: idempotent needs-remediation comment (#159).
- `src/conductor/README.md` "PR labeling" → note the comment is upserted in place.
- No `settings.json`/CLI/schema change → no Migration block. Bug-fix → PATCH version (CI auto-bumps).
- Run `test/test_harness_integrity.sh` + conductor vitest before commit.
