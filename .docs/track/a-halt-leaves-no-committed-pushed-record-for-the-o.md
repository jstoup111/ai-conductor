# Track: A halt leaves no committed, pushed record for the operator to pick up from

Track: technical

## Rationale

Engine/daemon operator-surface correctness. When a feature halts, the halt state exists only as
untracked worktree files (`.pipeline/HALT`, `.pipeline/HALT.class`) plus the daemon log, so the
halt cannot be read from the branch and is lost when the worktree is recreated. The change adds a
committed sibling of the existing `.docs/shipped/<slug>.md` record and wires it to the single
`writeHaltMarker` seam; no new product capability, no new command, and acceptance criteria are
enumerable directly as stories. → **technical track** (skip `/prd`).

Source: jstoup111/ai-conductor#1809.

## Discovery findings

- Every halt in the engine funnels through one writer, `writeHaltMarker` in
  `src/conductor/src/engine/halt-marker.ts` (~30 call sites across `conductor.ts`, `rebase.ts`,
  `daemon-runner.ts`, `task-progress.ts`, `rewind.ts`, `provider-lifecycle.ts`, `task-cli.ts`,
  and the self-host gates). That single seam is where a record can be produced without touching
  any call site.
- `writeHaltMarker` is deliberately best-effort: mkdir/write failures are swallowed and reported
  as a `halt_marker_write_failed` event, because "a failed write must not crash the finish flow".
  Any record work added at that seam inherits the same obligation.
- `adr-2026-07-04-operator-park-marker` records that the HALT body is rewritten wholesale by
  multiple writers, so in-band annotation of `.pipeline/HALT` is silently clobbered. That rules
  out carrying the record inside the HALT marker itself.
- The finish path already has the exact precedent: `conduct shipped-record` writes and commits
  `.docs/shipped/<slug>.md` on the current branch with a path-scoped `git add`, an idempotent
  "only commit when the add staged something" guard, `--no-verify`, and warn-and-exit-0 on any
  fs or git error (`src/conductor/src/engine/shipped-record-cli.ts`).
- `.docs/halted/` is outside `PROTECTED_ARTIFACT_DIRECTORIES`
  (`src/conductor/src/engine/protected-artifact-seal.ts:17-25` lists only `.docs/architecture`,
  `.docs/decisions`, `.docs/plans`, `.docs/specs`, `.docs/stories`), so a record write cannot
  raise a protected-artifact halt of its own.
- Consumer repositories carry the same `.docs/` layout including `.docs/shipped/`, so this is a
  consumer-facing change, not a repository-local convention.

## Approaches considered

1. **Committed record at the `writeHaltMarker` seam, pushed best-effort** (chosen). One writer,
   one artifact, mirrors the shipped-record discipline the operator already knows.
2. **Annotate `.pipeline/HALT` in-band and commit that.** Rejected: `.pipeline/` is untracked
   worktree state and the HALT body is rewritten by multiple writers
   (`adr-2026-07-04-operator-park-marker`).
3. **File a GitHub issue per halt.** Rejected: requires network and auth at halt time, duplicates
   the existing halt-monitor issue machinery whose subject is post-ship CI, and does not satisfy
   "readable from the branch alone".

## Event spine

```
Channel?    yes                              — a committed `.docs/halted/<slug>.md` artifact
Concern:    durable state                    — answers "this feature is halted and why", read by
                                               name; the occurrence is already on the bus as
                                               `loop_halt` / `halt_marker_write_failed` /
                                               `halt_cleared`
Verdict:    exception C, plus additive union members for the record's own write/push failures
Exception:  C — durable state, not an occurrence (same shape as `.docs/shipped/<slug>.md`)
```

No parallel telemetry channel is introduced: the record is state, and every *occurrence* this
feature can produce (record written, record write failed, record push failed) is emitted as a
`ConductorEvent`.

## Scope check

- **Decision A — consumer-facing.** No repo-only signal fires: the halt machinery, the daemon,
  and the `.docs/` layout all exist in consumer repositories (verified: `ledger-demo/.docs/`
  carries `shipped/`). The mechanism exists outside this repository, so the deciding test in
  `AGENT_INSTRUCTIONS.md` returns consumer-facing.
- **Decision B — not reached.** No new skill.
- **Decision C — provider-agnostic.** The change is engine-internal (fs + git); it names no
  provider path, environment variable, or host-specific capability.
