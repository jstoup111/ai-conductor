# Spec: Idempotent `needs-remediation` Escalation Comment

**Issue:** #159 (follow-up from retro `.docs/retros/2026-06-29-daemon-pr-labels.md`, parent PR #145)
**Date:** 2026-06-30
**Complexity:** Small

## Problem

When the daemon irrecoverably HALTs a feature in auto mode, `escalateBuildFailure`
posts a **new** failure comment on the branch's `needs-remediation` PR every time it
runs. The label is idempotent (reused), but the comment is **additive** — a feature
that HALTs repeatedly (re-dispatched, re-failing) piles up duplicate `## Daemon halt`
comments on the same PR. Observed: 3 identical comments accumulated on PR #145 during
testing before manual cleanup.

## Goal

Maintain a **single** harness-authored remediation-status comment per PR and **edit it
in place** on subsequent HALTs, rather than appending a new one each time.

## Approach

1. Tag the comment with a stable hidden marker: `<!-- conductor:needs-remediation -->`.
2. Add an `upsertComment()` sibling to `comment()` in `pr-labels.ts`:
   - `gh pr view <pr> --json comments` → find the comment whose body contains the marker.
   - If found, derive `{owner, repo, commentId}` from its `url`
     (`…/pull/<n>#issuecomment-<id>`) and `gh api --method PATCH
     repos/<owner>/<repo>/issues/comments/<id> -f body=<new body>`.
   - If not found (or any find/parse/update error), **fall back to creating** a new
     comment that carries the marker — so the next HALT can find and edit it.
3. `build-failure-escalation.ts` Step 6 calls `upsertComment()` with the marker instead
   of `comment()`.

## Functional Requirements

- **FR-1:** The escalation comment body carries a stable hidden marker so it can be
  located on subsequent runs.
- **FR-2:** When a marked comment already exists on the PR, the escalation **edits that
  comment in place** (HTTP PATCH) rather than posting a new one. After N HALTs there is
  exactly **one** marked comment on the PR.
- **FR-3:** When no marked comment exists, the escalation **creates** one carrying the
  marker.
- **FR-4:** The upsert is **best-effort / non-throwing**: any failure to find, parse, or
  PATCH an existing comment falls back to creating a comment, and never throws to the
  caller (consistent with the rest of the `pr-labels` seam).
- **FR-5:** The edited comment reflects the **current** failure reason (the latest HALT's
  reason replaces the prior one).

## Non-Goals

- Bot identity for the comment author (issue #158 — separate).
- Threading/history of prior failure reasons (we overwrite, not accumulate).
- Changing label semantics, PR creation, push, or commit-count gating.

## Affected

- `src/conductor/src/engine/pr-labels.ts` — add `upsertComment()` + marker const + url parse helper.
- `src/conductor/src/engine/build-failure-escalation.ts` — Step 6 uses `upsertComment()`.
- `src/conductor/test/engine/pr-labels.test.ts`, `build-failure-escalation.test.ts` — tests.
