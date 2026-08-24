# ADR: A halt writes a committed, pushed `.docs/halted/<slug>.md` record at the `writeHaltMarker` seam

- **Status:** APPROVED
- **Approved by:** operator (James), 2026-08-23
- **Date:** 2026-08-23
- **Feature:** a-halt-leaves-no-committed-pushed-record-for-the-o (jstoup111/ai-conductor#1809)
- **Related:** adr-2026-07-04-operator-park-marker, `.agents/skills/event-spine/SKILL.md`,
  `src/conductor/src/engine/shipped-record-cli.ts`

## Context

When a feature halts, the entire halt state is untracked worktree state: `.pipeline/HALT`,
`.pipeline/HALT.class`, and lines in `.daemon/daemon.log`. Nothing is committed and nothing is
pushed. Three consequences follow:

1. Picking a halted feature up requires shell access to the daemon host.
2. Recreating a worktree — a documented recovery step, and the #497 failure class — destroys the
   halt context, including the reason and the class.
3. The finish path has the opposite property: a ship lands `.docs/shipped/<slug>.md`, so the merge
   records the outcome durably. Halts, which are precisely the outcomes that need a human, have no
   equivalent.

`adr-2026-07-04-operator-park-marker` already established that the HALT body is rewritten
wholesale by multiple writers, so annotating the marker in-band is not available: any record has
to be a separate artifact.

## Decision

1. **A halt produces `.docs/halted/<slug>.md`, a git-tracked artifact on the feature branch.** It
   is a sibling of `.docs/shipped/<slug>.md` and follows its discipline: rendered deterministically,
   staged path-scoped, committed with `--no-verify`, idempotent on identical bytes.

2. **The record is produced at the single `writeHaltMarker` seam** in
   `src/conductor/src/engine/halt-marker.ts`, after the markers are written. No halt call site is
   edited, so no existing or future halt path can omit the record.

3. **Only non-`mechanical` halt classes produce a record.** `mechanical` halts are re-kicked by
   the daemon with no operator involved, so a record for them is commit churn with no reader.
   `needs-human`, `plan-gap` and `protected-artifact` all terminate in operator action and all
   produce one.

4. **The record's content is what an operator needs to resume without the daemon host:** the slug,
   the halt class, the halting step and phase, the verbatim HALT body as the reason, the branch
   name and head SHA at halt time, the UTC timestamp, and a `Status:` line whose value is `halted`
   or `resolved`.

5. **Commit first, then push; the push is best-effort.** The commit is unconditional (subject to
   git succeeding); the push of the current branch follows. A push that fails for any reason —
   no remote, auth, non-fast-forward, offline — leaves the commit in place and emits
   `halt_record_push_failed` naming the reason. The halt record is never lost to a push failure.

6. **Nothing in this path may throw.** The seam's existing contract ("a failed write must not
   crash the finish flow") extends unchanged over the record. Every arm returns a result;
   failures are reported as events, never propagated.

7. **Resume supersedes the record in place.** At the existing `halt_cleared` emission points, the
   record is rewritten with `Status: resolved`, the resolution cause, and the resolution
   timestamp, and that rewrite is committed. The file is not deleted.

8. **The record is durable state, not a channel.** Per `.agents/skills/event-spine/SKILL.md` §4
   exception C, state artifacts are read by name and answer "what is true now". The occurrences
   the record generates ride the existing spine as additive `ConductorEvent` members:
   `halt_record_written`, `halt_record_write_failed`, `halt_record_push_failed`. No second
   telemetry channel, no timestamp stamped into an existing artifact.

## Alternatives rejected

- **Annotate `.pipeline/HALT` in-band and commit `.pipeline/`.** `.pipeline/` is untracked
  per-worktree state by design, and the HALT body is rewritten wholesale by multiple writers
  (`adr-2026-07-04-operator-park-marker`), so an in-band field is silently clobbered.
- **Delete the record on resume.** Less code, and satisfies the issue's "cleared" wording, but
  discards the halt history and makes "was this ever halted, and why?" unanswerable from the
  branch. Supersession costs one rewrite and keeps the audit trail this repository keeps
  everywhere else.
- **File a GitHub issue per halt.** Needs network and auth at halt time — inside a path that must
  not fail — duplicates the halt-monitor issue machinery whose subject is post-ship CI, and still
  does not satisfy "readable from the branch alone".
- **A new watcher that observes `.pipeline/HALT` and reports it.** Rejected by the event-spine
  decision procedure: it is a poller inferring an occurrence the bus already carries as
  `loop_halt`.
- **Record every halt class including `mechanical`.** Simpler predicate, but a mechanically
  re-kicked halt would add a commit per occurrence to a branch nobody is reading at that moment.

## Consequences

- A halted feature is pickup-ready from any clone of its branch; worktree loss no longer destroys
  halt context.
- The feature branch gains one commit per operator-actionable halt and one per resume. These are
  path-scoped to `.docs/halted/` and idempotent, so a re-halt with unchanged content adds nothing.
- `.docs/halted/` becomes a new committed artifact directory in every repository that runs the
  daemon. It is deliberately outside `PROTECTED_ARTIFACT_DIRECTORIES`, so it never participates in
  the protected-artifact seal.
- A record whose push failed is ahead of the remote. The record body says so, and the emitted
  event names the reason, so the divergence is diagnosable rather than silent.
