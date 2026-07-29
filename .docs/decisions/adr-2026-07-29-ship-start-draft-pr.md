# ADR: The implementation PR opens as a draft at SHIP-phase start

**Date:** 2026-07-29
**Status:** APPROVED
**Deciders:** James Stoup (operator — directed hotfix), engineer session
**Supersedes (narrows):** adr-2026-07-03-pr-timing-self-host-precedence
**Related:** adr-2026-07-03-pr-timing-config-key (spec-only, unimplemented),
adr-2026-07-03-halt-pr-rehabilitation-at-finish, adr-2026-07-06-daemon-false-ship-guard

## Context

The implementation PR was created inside the auto-mode `/finish` turn — the last step of
the run. Every ship-tail concern that needs a PR *number* therefore had to fit inside that
one turn. The visible casualty is the `{{IMPLEMENTATION_PR}}` CHANGELOG token that
`maintain-documentation` writes and `conduct-ts finalize-changelog-pr --pr-url` substitutes:
with no PR until finish, substitution can only happen at finish, and when the agent misses
it the finish completion predicate (`artifacts.ts`, adr-2026-07-06-daemon-false-ship-guard)
refuses to converge and the feature cycles back through SHIP. Two such placeholders were
finalized by hand in the days before this ADR.

`adr-2026-07-03-pr-timing-config-key` specified a `pr_timing: finish | early-draft` config
key covering *both* publish flows (daemon build and engineer spec authoring) plus
build-start pushes, step-boundary refreshes, and a post-rebase force-with-lease site — 22
tasks. It was never implemented; no `pr_timing` key, resolver, or `pushBranch` primitive
exists in the engine.

## Options Considered

### Option A: Implement the `pr_timing` config key as specified
- **Pros:** Honors the existing spec; per-project opt-in.
- **Cons:** 22 tasks across two flows for a hotfix. Implementing only the ship-phase slice
  under the name `early-draft` would misrepresent that value's specified semantics (which
  include build-start publishing, refresh pushes, and the engineer spec flow), leaving a
  half-meaning config key that the full feature would then have to reinterpret.

### Option B: Hardcode the timing — draft at SHIP start, ready at finish
- **Pros:** Smallest change that removes the cycling. No new config surface, no schema
  validation, no resolver, no docs for a key whose only sane value is the new default.
  Leaves `pr_timing` free to mean exactly what its ADR says if the full feature is ever
  built (its BUILD-phase publishing and engineer-flow halves are untouched by this).
- **Cons:** No per-project opt-out.

### Option C: Publish at BUILD start (the spec's `early-draft` timing)
- **Cons:** A PR open for the entire build maximizes the window in which the branch is
  remotely visible but incomplete, and the operator's problem is specifically the ship
  tail. Also the largest change to the self-host guardrail surface.

## Decision

Option B. The engine opens one **draft** PR for the feature branch at the start of the SHIP
phase — at the first SHIP step that will actually execute, after every skip has been
evaluated — and `finish` flips it ready for review. The operator explicitly accepted either
config or hardcoding; hardcoding is chosen for the reasons in Option B.

- **New module `src/engine/ship-draft-pr.ts`** (`openShipDraftPr`), behind the existing
  injected `GhRunner`/`GitRunner` seam from `pr-labels.ts`. It plain-pushes
  (`git push -u origin <branch>`) and calls the existing `findOrCreatePr({ draft: true })`.
  No raw `execFile`, no second gh implementation.
- **Never force-pushes.** A non-fast-forward rejection is reported, not forced — forcing
  here would race the build's own pushes and the finish-time rebase.
- **Lazy:** `git rev-list --count <base>..HEAD` (falling back to `origin/<base>`) must be
  non-zero. `gh pr create` fails with "no commits between" on an empty branch.
- **Advisory:** every failure logs one loud `[ship-draft-pr]` line and returns an outcome.
  Nothing here throws into the conductor loop; only the finish-time publish is load-bearing.
- **Idempotent:** `findOrCreatePr` returns an already-OPEN PR untouched, so a kickback,
  resume, or rework never opens a second PR and never re-drafts a PR finish already marked
  ready. A per-run latch keeps the SHIP phase to a single push + lookup.
- **No new flip mechanic.** `ensureShipReady` (adr-2026-07-03-halt-pr-rehabilitation-at-finish,
  Task 7) already performs an unconditional, verified, non-throwing draft→ready flip and is
  already wired through `repairFinishPr` in `conductor.ts`, ahead of the finish predicate's
  ship-readiness draft check. A PR that is already ready costs zero `gh pr ready` calls.
- **The placeholder body carries `PR_BODY_FLOOR_MARKER`.** It *is* an engine-generated
  placeholder, so labelling it as one recruits the existing finish-gate kickback: if
  `/finish` fails to author a real templated body, the gate demands one rather than
  shipping the placeholder. The body carries no halt banner and the title no
  `needs-remediation:` prefix, so the PR is not a halt PR by any of the three stateless
  halt signals.

### Self-host precedence — narrowed

adr-2026-07-03-pr-timing-self-host-precedence made self-host builds ignore early publishing
outright, because the harness self-host guardrails (TR-7…TR-10) require a HALT for the
operator's semver approval **before any PR is opened**. That ADR's underlying concern is
that the daemon must never present a mergeable PR carrying an unapproved bump or failing
release artifacts. This ADR narrows the rule to exactly that concern:

> No self-host PR reaches **ready-for-review** before the VERSION-approval and
> release-artifact gates pass.

That invariant holds unchanged: `runSelfHostFinishGates` runs before the `finish` step is
dispatched, and the ready-flip happens at finish. A draft PR cannot be merged, is excluded
from the mergeable sweep's autoresolve/CI-fix candidates, and carries no `mergeable` label.
Self-host builds are therefore **not** exempt from ship-start drafting — which matters,
because the changelog-token cycling this ADR fixes is a self-host problem.

## Consequences

### Positive
- The PR number exists for the whole ship tail; `finalize-changelog-pr` no longer has to
  race the finish turn, and stale `{{IMPLEMENTATION_PR}}` tokens stop cycling features.
- In-flight ship phases are watchable, and CI runs on the draft before finish.
- No new config surface, no schema/migration change.

### Negative
- Draft PRs consume CI minutes during the ship tail (accepted).
- No per-project opt-out. If one is ever needed, the `pr_timing` key from
  adr-2026-07-03-pr-timing-config-key remains available and unimplemented.
- A feature that HALTs mid-SHIP leaves an open draft PR behind. This is the same PR
  `build-failure-escalation` would have opened for the halt anyway (`findOrCreatePr` reuses
  it and adds the halt banner/label), so it produces one PR per feature, not two.
