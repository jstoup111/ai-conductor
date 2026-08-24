# Conflict Check: A halt leaves no committed, pushed record for the operator to pick up from

Status: Resolved — no blocking conflict remains
Date: 2026-08-23
Stories: .docs/stories/a-halt-leaves-no-committed-pushed-record-for-the-o.md

Five candidate conflicts were checked against machinery that already exists. Four are real and
carry a resolution that constrains the plan; one was checked and found not to apply.

## C1 — Committing on the live root checkout (self-host live boundary)

**Conflict.** `writeHaltMarker` is called with a `projectRoot` that is usually a feature worktree
but is the repository root in some paths (`rewind.ts:54`, and any halt raised outside a dispatch).
A record commit in the live root checkout would both change tracked content there — which the
self-host live boundary fingerprints and fails closed on — and violate the standing rule that the
root checkout stays on the default branch and is never committed to by the engine.

**Resolution.** The record is written only when the resolved root is on a non-default branch. On
the default branch the record path is a no-op that emits nothing and commits nothing; the halt
markers are written exactly as today. This is a precondition checked before any fs write, so the
live-boundary surface is never touched.

## C2 — The halt-clear seam is a watcher, and the event-spine skill forbids adding watchers

**Conflict, apparent.** Story 3 needs to act when a halt is cleared, and the mechanism that
observes clearing is a chokidar watcher on `.pipeline/HALT` removal (`daemon-deps.ts`, the
`appendHaltClearedRecord` call site at `daemon-deps.ts:399`). Designing a new observer here would
be exactly the pattern `.agents/skills/event-spine/SKILL.md` §2 step 1 rejects.

**Resolution.** No new observer. Supersession hangs off the existing call site, which already
distinguishes `cause: 'operator' | 'rekick'` and is already best-effort and non-throwing. The
existing cause value becomes the record's resolution cause verbatim.

## C3 — Engine commits versus the commit-msg hook's `Task:` trailer requirement

**Conflict.** The repository's commit-msg hook requires a `Task:` trailer on dispatched
implementation commits. A halt-record commit is bookkeeping and has no task.

**Resolution.** Use the established exemption, not a new one: commit with `--no-verify` and spawn
under `withEngineCommitEnv()` (`src/conductor/src/engine/engine-commit-env.ts`), whose module
comment already names shipped-record and engineer spec landing as the same class of engine
bookkeeping commit. No hook change, no new exemption path.

## C4 — A halt raised over a dirty worktree

**Conflict.** Halts frequently fire mid-build with uncommitted work present. A commit that staged
broadly would capture a partial implementation into the record commit and hand the operator a
branch whose tip is a half-finished build.

**Resolution.** Path-scoped `git add -- .docs/halted/<slug>.md` only, plus the shipped-record
idempotency guard (`git diff --cached --quiet -- <path>`) so an unchanged record produces no
commit. Story 4's third negative path asserts the uncommitted work stays uncommitted.

## C5 — Interaction with operator park (`.daemon/parked/<slug>`) — checked, does not apply

`adr-2026-07-04-operator-park-marker` gives park its own operator-owned marker outside git, and
park is explicitly independent of halt: a feature can be parked without being halted. Park places
and removes no HALT marker, so it never reaches `writeHaltMarker` and never triggers the
halt-clear watcher. The two mechanisms do not overlap, and this feature changes nothing about
park. No resolution needed.

## C6 — `.docs/halted/` versus the protected-artifact seal — checked, does not apply

`PROTECTED_ARTIFACT_DIRECTORIES` (`protected-artifact-seal.ts:17-25`) is exactly
`.docs/architecture`, `.docs/decisions`, `.docs/plans`, `.docs/specs`, `.docs/stories`.
`.docs/halted/` is not among them and must not be added to them, so a record write can never raise
a `protected-artifact` halt and can never require an operator reseal. No resolution needed.
