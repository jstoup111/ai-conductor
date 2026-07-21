**Status:** Accepted

# Stories: DECIDE-time unmerged-overlap scan (#523, Scope A)

Technical track — no PRD. Acceptance criteria derived from the intake's desired outcomes
(#523) and the approved ADR `adr-2026-07-21-decide-time-unmerged-overlap-scan`. Requirements
are labelled `TR-N` (technical requirement) and trace to the intake's desired-outcome bullets.

- **TR-1** — surface unmerged seam-overlap (intake desired outcome (b))
- **TR-2** — surface open blockers with unmerged specs/impls (intake desired outcome (a))
- **TR-3** — quiet negative path: no links + no overlap → zero ceremony
- **TR-4** — advisory, never blocks authoring; graceful degradation
- **TR-5** — file-accurate intersection (no insider knowledge; no false noise)
- **TR-6** — the scan is invoked from the DECIDE chain at both hook points

---

## Story: Seam overlap against an unmerged sibling branch is detected and named

**Requirement:** TR-1

As a spec author in a DECIDE session, I want the scan to name any unmerged sibling `spec/*` or
open-PR branch whose diff touches the files I am about to design against, so that I do not bake
a stale seam into an APPROVED plan.

### Acceptance Criteria

#### Happy Path
- Given an unmerged branch `spec/other` whose diff vs the base changes
  `src/conductor/src/engine/conductor.ts`, and a candidate-file set that includes
  `src/conductor/src/engine/conductor.ts`, when the scan runs, then its report lists the
  overlap naming both the branch (`spec/other`) and the overlapping file.
- Given two unmerged branches each overlapping a different candidate file, when the scan runs,
  then both overlaps are listed, each attributed to its branch.

#### Negative Paths
- Given an unmerged branch that changes only files NOT in the candidate set, when the scan runs,
  then that branch is not reported (no overlap).
- Given a branch that has already merged into the base, when the scan runs, then it is not
  enumerated as unmerged and produces no overlap entry.
- Given a candidate file that a sibling branch changes via a pure rename (old path not in the
  candidate set), when the scan runs, then the report notes renames are a known name-only-diff
  limit rather than silently claiming full coverage.

### Done When
- [ ] The scan command, given a candidate-file set and a repo with an overlapping unmerged
      branch, prints a report entry naming the branch and the overlapping file(s).
- [ ] Non-overlapping unmerged branches produce zero entries.
- [ ] Merged branches are excluded from enumeration.
- [ ] The rename limitation is stated in the scan's output/help, not left implicit.

---

## Story: Open blocker links with unmerged specs/impls are surfaced at DECIDE time

**Requirement:** TR-2

As a spec author, I want the scan to surface issue B's open `blocked_by` links (reusing the
existing blocker resolver) so I know a blocking issue's spec/impl is still unmerged before I
author against it.

> **Relationship to the shipped claim gate (`dependency-ordered-intake-and-dispatch`).**
> `claimUnblocked` already defers any *claim-sourced* idea that has an OPEN `blocked_by` blocker,
> so for a claimed idea this sweep normally finds none — and that is correct, not redundant.
> TR-2 exists to cover the paths the claim gate does **not**: (1) ideas that arrive by CLI-arg or
> chat (they bypass `claim` and were never blocker-gated), and (2) a blocker link *added after*
> the idea was claimed but before the plan locks (the claim-time verdict is stale by plan-lock).
> TR-2 never re-implements or overrides the claim gate; it is a plan-lock-time re-check. See
> `.docs/conflicts/2026-07-21-tr2-blocker-surface-vs-claim-gate.md`.

### Acceptance Criteria

#### Happy Path
- Given a CLI-arg/chat-sourced idea (never through `claim`) with `Source-Ref` `owner/repo#B`
  whose native `blocked_by` API returns one OPEN blocker `owner/repo#A`, when the scan runs, then
  the report lists `#A` as an open blocker of `#B`.
- Given an idea claimed while `#B` had no blockers, but a `blocked_by` link to an open `#A` is
  added before the plan locks, when the scan runs at the `/plan` hook, then `#A` is surfaced —
  the stale claim-time verdict does not suppress it.
- Given a `blocked_by` set containing both an open and a closed blocker, when the scan runs,
  then only the open blocker is reported (closed blockers are filtered, matching
  `blocker-resolver`'s existing contract).

#### Negative Paths
- Given a `Source-Ref` with an empty `blocked_by` array, when the scan runs, then no blocker
  entries are reported (the expected result for a normally-claimed idea).
- Given the blocker API errors or returns unparseable output, when the scan runs, then the
  verdict is surfaced as `indeterminate` (with detail), not silently dropped and not treated as
  "unblocked".
- Given no `Source-Ref` is provided (a CLI-arg/chat idea with no origin ref), when the scan runs,
  then the blocker sweep is skipped entirely with no error.

### Done When
- [ ] The scan reuses `blocker-resolver.resolve(sourceRef)` (constructed with a `gh` runner) —
      no duplicate blocker-API logic is added, and the shipped claim gate is not modified.
- [ ] Open blockers are listed; closed blockers are omitted.
- [ ] A blocker link added between claim and plan-lock is surfaced at the `/plan` hook.
- [ ] An `indeterminate` verdict appears in the report as indeterminate, distinct from "no
      blockers".
- [ ] Absent `Source-Ref` skips the blocker sweep without failing the scan.

---

## Story: No links and no overlap produces zero ceremony

**Requirement:** TR-3

As a spec author working on an isolated change, I want the scan to stay silent when there is
nothing to warn about, so that the common case adds no prompts or noise.

### Acceptance Criteria

#### Happy Path
- Given a candidate-file set that no unmerged branch touches AND a `Source-Ref` with no open
  blockers (or no `Source-Ref` at all), when the scan runs, then it reports "no overlap, no open
  blockers" as a single clean line and requires no author action or confirmation.

#### Negative Paths
- Given the repo has unmerged branches, but none overlaps the candidate files, and no open
  blockers exist, when the scan runs, then it still reports the clean result — the mere
  existence of unrelated in-flight work does not raise a warning.

### Done When
- [ ] The clean path emits a single unambiguous "clean" result and no interactive prompt.
- [ ] The DECIDE chain proceeds without the author having to acknowledge anything on the clean
      path.

---

## Story: The scan is advisory and never blocks authoring

**Requirement:** TR-4

As a spec author, I want the scan to degrade gracefully on any internal failure, so that a git
or `gh` hiccup can never stop me from authoring the plan.

### Acceptance Criteria

#### Happy Path
- Given the scan finds overlaps and/or open blockers, when it finishes, then it reports them and
  exits without blocking — the author decides whether to reconcile the design and the plan can
  still be written.

#### Negative Paths
- Given branch enumeration fails (git error listing unmerged branches), when the scan runs, then
  it emits an advisory-skip note identifying what failed and completes without a non-zero
  authoring-blocking status.
- Given the blocker sweep errors while branch enumeration succeeds (or vice versa), when the
  scan runs, then the succeeding half is still reported and the failing half degrades to a note
  — a partial failure never discards the usable result.
- Given a diff against one branch fails, when the scan runs, then the other branches are still
  diffed and reported (one bad branch does not abort the whole sweep).

### Done When
- [ ] Any enumeration/resolver/diff failure yields an advisory note, never a blocking error, and
      the scan's exit status does not halt the DECIDE chain.
- [ ] A partial failure preserves and reports the half that succeeded.

---

## Story: Overlap intersection is file-accurate — no insider knowledge, no false noise

**Requirement:** TR-5

As an operator without repo-history knowledge, I want the overlap result to be exactly the
intersection of my declared files with each branch's changed paths, so that I get the same
protection an insider diff-read would give — without false positives.

### Acceptance Criteria

#### Happy Path
- Given a candidate file `a.ts` and an unmerged branch changing `a.ts` and `b.ts`, when the scan
  runs, then only `a.ts` is reported as the overlap (the intersection), not `b.ts`.
- Given candidate paths expressed as the plan's repo-relative `**Files:**` entries, when the
  scan runs, then matching is on normalized repo-relative paths (identical strings match; a
  sub-path of an unrelated file does not).

#### Negative Paths
- Given a branch changes `src/foo/helper.ts` and the candidate set contains
  `src/foo/helperx.ts`, when the scan runs, then no overlap is reported (no substring/prefix
  false match).
- Given the candidate set is empty (e.g. a plan task with `**Files:** none`), when the scan
  runs, then no seam-overlap entries are produced.

### Done When
- [ ] Reported overlaps are the exact set-intersection of declared files and changed paths.
- [ ] No substring/prefix false matches occur.
- [ ] An empty candidate set yields no seam-overlap entries.
- [ ] The result is derivable with zero prior knowledge of the unmerged diffs (the operator does
      not read any diff by hand).

---

## Story: The scan is wired into the DECIDE chain at both hook points

**Requirement:** TR-6

As the DECIDE flow, I want the scan invoked at `/architecture-review` (over the Wiring Surface
paths) and at `/plan` (over the authoritative `**Files:**` set), so the author is warned early
and again at the final lock.

### Acceptance Criteria

#### Happy Path
- Given a Medium/Large feature at `/architecture-review`, when the review step runs, then the
  scan is invoked over the `## Wiring Surface` candidate paths and its report is surfaced to the
  author before `/plan`.
- Given `/plan` produces a `**Files:**` set, when the plan step runs, then the scan is invoked
  over that authoritative set before the plan is committed, and its report is surfaced.

#### Negative Paths
- Given a Small feature (architecture-review skipped), when `/plan` runs, then the scan still
  runs at the `/plan` hook (the plan hook does not depend on the arch-review hook having run).
- Given the scan is invoked as a bare `conduct-ts` subcommand by an operator, when it runs, then
  it produces the same report independent of any skill — the primitive is not coupled to the
  skill wrapper.

### Done When
- [ ] `/architecture-review` (Medium/Large) and `/plan` SKILL.md each carry a step invoking the
      scan primitive over their respective candidate-path source.
- [ ] The `/plan` hook runs regardless of whether the arch-review hook ran.
- [ ] The scan is a standalone `conduct-ts` subcommand runnable outside any skill, dispatched via
      the `cli.ts` command table.
