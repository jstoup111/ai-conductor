# A halt leaves no committed, pushed record for the operator to pick up from

Status: Accepted

Source: jstoup111/ai-conductor#1809
Track: technical
Tier: M
Decisions: adr-2026-08-23-committed-halt-record

## Context

Halt state today lives only in the feature worktree's untracked `.pipeline/HALT` and
`.pipeline/HALT.class` plus `.daemon/daemon.log`. Picking a halted feature up therefore requires
the daemon host, and recreating a worktree destroys the halt context entirely. The finish path
already has the durable equivalent — `.docs/shipped/<slug>.md` — and this feature gives halts the
same property, produced at the single `writeHaltMarker` seam.

## Story 1 — An operator-actionable halt commits a halt record on the feature branch

As an operator picking up a halted feature from any checkout of its branch, when the engine raises
a halt that only I can resolve, the engine must commit a record of that halt on the feature branch
so the halt is readable without shell access to the daemon host.

### Happy Path

- **Given** a feature worktree on branch `feat/<slug>` with a clean or dirty working tree, **when** the engine raises a `needs-human` halt through `writeHaltMarker`, **then** `.docs/halted/<slug>.md` exists on the branch as a committed file carrying the slug, the halt class, the halting step, the phase, the verbatim HALT body as the reason, the branch name, the head SHA at halt time, the UTC timestamp, and `Status: halted`.
- **Given** a halt raised with class `plan-gap` or `protected-artifact`, **when** `writeHaltMarker` completes, **then** a halt record is committed for that halt exactly as for `needs-human`, because all three classes terminate in operator action.
- **Given** a committed halt record and a fresh clone of the feature branch on a different machine with no access to the daemon host, **when** the operator reads `.docs/halted/<slug>.md`, **then** the reason, class, halting step and head SHA are all present in that file alone, with no `.pipeline/` or `.daemon/` state required.

### Negative Paths

- **Given** a halt raised with class `mechanical`, which the daemon re-kicks without an operator, **when** `writeHaltMarker` completes, **then** no halt record is written and no commit is created, so mechanically re-kicked halts add no churn to the branch.
- **Given** a feature that halts twice in a row with byte-identical record content, **when** the second halt is recorded, **then** the staged diff is empty and no second commit is created, so a repeated halt never accumulates duplicate commits.

## Story 2 — The record is pushed, and a push failure never loses the halt

As an operator on a machine that is not the daemon host, when a feature halts, the record must
reach the remote whenever one exists, and a failure to reach it must leave the halt recorded
locally and diagnosable rather than silently dropped.

### Happy Path

- **Given** a feature worktree whose branch has an upstream remote that accepts the push, **when** the halt record is committed, **then** the engine pushes the current branch and the record is present on the remote branch, and a `halt_record_written` event names the record path and the halt class.

### Negative Paths

- **Given** a repository with no remote configured, **when** the halt record is committed and the push is attempted, **then** the commit is retained on the local branch and a `halt_record_push_failed` event names the reason, so the record is never lost to the absence of a remote.
- **Given** a push that is rejected as non-fast-forward or fails authentication, **when** the engine handles that failure, **then** the local commit is left in place, a `halt_record_push_failed` event names the failing reason verbatim, and no exception escapes the halt path.
- **Given** a halt record whose push failed, **when** the operator reads the record, **then** the record states that it may be ahead of the remote, so the divergence is visible from the file rather than only from the daemon log.

## Story 3 — Resuming a feature supersedes its record so a stale halt never misleads a later run

As an operator resuming a previously halted feature, when the halt is cleared, the committed
record must stop asserting that the feature is halted, while the halt history stays on the branch.

### Happy Path

- **Given** a feature carrying a committed record with `Status: halted`, **when** the halt is cleared at the existing halt-clear seam and `halt_cleared` is emitted, **then** the record is rewritten in place with `Status: resolved`, the resolution cause and the resolution UTC timestamp, and that rewrite is committed on the feature branch.
- **Given** a resumed feature whose record was superseded, **when** the operator or a later reader inspects the branch, **then** the original halt reason, class and halting step are still present in the record, so the halt history is preserved rather than deleted.

### Negative Paths

- **Given** a feature that has never halted and therefore has no record, **when** a halt is cleared or a resume runs, **then** no record is created and no commit is made, so the resume path never manufactures a record for a halt that did not happen.
- **Given** a record already carrying `Status: resolved`, **when** the halt-clear seam runs again for the same feature, **then** the record content is unchanged and no duplicate commit is created, so repeated resumes are idempotent.

## Story 4 — Recording a halt is best-effort and never becomes a failure of its own

As the engine's halt path, which is contractually forbidden from crashing the flow that raised the
halt, when any part of recording the halt fails, the failure must be reported on the event spine
and the halt itself must proceed unchanged.

### Happy Path

- **Given** a halt raised in a worktree where the record path is writable and git is healthy, **when** `writeHaltMarker` returns, **then** the `.pipeline/HALT` and `.pipeline/HALT.class` markers carry exactly the same content and semantics they carried before this feature existed, so no existing halt behavior changes.

### Negative Paths

- **Given** a worktree where writing `.docs/halted/<slug>.md` fails with an fs error, **when** the record path handles that failure, **then** a `halt_record_write_failed` event names the path and reason, `writeHaltMarker` still returns its existing result, and no exception propagates to the halt call site.
- **Given** a worktree where `git add` or `git commit` fails, **when** the record path handles that failure, **then** a `halt_record_write_failed` event names the reason, the halt markers remain written, and the halting step's own outcome is unchanged.
- **Given** a halt raised while the working tree carries uncommitted build work, **when** the record is committed, **then** the commit contains only `.docs/halted/<slug>.md` and the uncommitted build work remains uncommitted, so no partial work is swept into the record commit.
