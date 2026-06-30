# Stories: Idempotent `needs-remediation` Comment

**Spec:** `.docs/specs/2026-06-30-remediation-comment-upsert.md`
**Status:** ACCEPTED

## Story 1 — First HALT creates a marked comment (FR-1, FR-3)

**As** the daemon escalating a first-time HALT
**I want** the failure comment tagged with a stable marker
**So that** a later HALT can find and edit it instead of duplicating.

- **Happy:** Given a PR with no marked comment, When `upsertComment` runs with the
  remediation marker and a body, Then it posts **one** comment whose body contains both
  the marker and the failure reason.
- **Negative (no comments field):** Given `gh pr view --json comments` returns
  `{"comments":[]}` (or omits the field), When `upsertComment` runs, Then it creates a
  new marked comment (no PATCH attempted) and does not throw.

## Story 2 — Repeat HALT edits the existing comment in place (FR-2, FR-5)

**As** the daemon escalating a repeat HALT on the same branch
**I want** the existing marked comment updated, not a second one posted
**So that** the PR carries exactly one remediation-status comment with the latest reason.

- **Happy:** Given a PR that already has a comment containing the marker (with a parseable
  `#issuecomment-<id>` url), When `upsertComment` runs with a new reason, Then it issues a
  `gh api --method PATCH …/issues/comments/<id>` with the new body, issues **no** `pr
  comment` create, and the resulting single comment shows the new reason.
- **Negative (unparseable comment url):** Given the matched comment's `url` does not match
  the `#issuecomment-<id>` shape, When `upsertComment` runs, Then it does **not** PATCH,
  falls back to creating a marked comment, and does not throw.

## Story 3 — Upsert is best-effort and never throws (FR-4)

**As** the conductor HALT path (which must never crash on escalation)
**I want** every upsert failure swallowed
**So that** a GitHub/API hiccup cannot turn a HALT into an unhandled exception.

- **Happy:** Given a successful find-and-PATCH, When `upsertComment` returns, Then no
  error propagates and the optional `log` callback is not invoked with an error.
- **Negative (pr view throws):** Given `gh pr view --json comments` rejects (transient
  network/API error), When `upsertComment` runs, Then it logs the error, falls back to
  creating a marked comment, and resolves without throwing.
- **Negative (PATCH throws):** Given the matched comment is found but `gh api PATCH`
  rejects, When `upsertComment` runs, Then it logs the error and resolves without throwing
  (no duplicate create — a found-but-unpatchable comment is left as-is).

## Story 4 — Escalation wires the upsert with the marker (FR-1, FR-2)

**As** `escalateBuildFailure`
**I want** Step 6 to call `upsertComment` with the remediation marker
**So that** real daemon HALTs benefit from in-place updates end to end.

- **Happy:** Given an escalation that reaches Step 6 with a valid `prUrl`, When the
  comment step runs, Then it calls `upsertComment` (not `comment`) with the marker, and a
  second escalation on the same PR results in a PATCH, not a new comment.
- **Negative (escalation still single-comment after repeated HALTs):** Given two
  successive `escalateBuildFailure` runs against a fake gh that records calls, When both
  complete, Then exactly one create and one PATCH are recorded (never two creates).
