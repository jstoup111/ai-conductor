# Phase 9.3 Engineer — Cleanup Follow-up

Tracked debt from the 2026-06-26 engineer-redesign retro (findings A-1, A-2, A-3).
All MINOR; none block 9.3 shipping. Pre-req note: A-2 should land before 9.3b adds intake adapters.

## Story: Tighten routing repo-untouched assertions and remove `gh!` assertion

**Requirement:** Retro A-1, A-3 (Phase 9.3 engineer-redesign)

As the harness maintainer, I want the engineer routing tests to assert the *specific*
no-side-effect invariant (not just that an offer was printed) and the loop's remote path to
express its `gh`-present invariant in the type, so that a regression that silently writes to a
declined/redirected repo is caught and the non-null assertion can't mask a missing `gh`.

### Acceptance Criteria

#### Happy Path
- Given a "decline create offer" routing test, when the loop runs, then the test asserts the
  proposed repo's directory listing AND the registry record count are byte-for-byte unchanged
  (not merely that a "create/no-match" string was printed) — `routing.test.ts` ~lines 516/643/666.
- Given the remote authoring path in `loop.ts:421`, when `gh` is absent, then the type system
  (not a runtime `gh!` assertion) prevents reaching that branch — narrow via an explicit guard
  or a `gh`-present sub-type.

#### Negative Paths
- Given a routing test asserting "repo untouched", when a deliberate mutation is injected into
  the proposed repo, then the strengthened assertion FAILS (proving it is falsifiable, not truthy-only).
- Given `gh` is `undefined` on a non-remote path, when `processIdea` runs, then it completes
  without throwing and without dereferencing `gh` (no `gh!`).

### Done When
- [ ] The three cited `routing.test.ts` assertions assert directory-listing + registry-count equality, each shown to fail under an injected mutation.
- [ ] `loop.ts` has no `gh!` non-null assertion; the remote branch is reached only via an explicit `gh`-present guard.
- [ ] Full conductor suite green; `tsc --noEmit` clean.

## Story: Extract the post-authoring handoff step from `processIdea`

**Requirement:** Retro A-2 (Phase 9.3 engineer-redesign)

As the harness maintainer, I want the post-authoring handoff (open spec PR → ensure-running →
record authored key) extracted from `processIdea` into a named step function, so that `loop.ts`
(currently 465 LOC with an inline god-chain) stays maintainable when 9.3b adds intake adapters
and additional branches.

### Acceptance Criteria

#### Happy Path
- Given an approved authoring result, when `processIdea` reaches handoff, then it delegates to a
  single named function (e.g. `runHandoff(target, result, deps)`) that owns PR + ensure-running + record.
- Given the extraction, when the engineer test suite runs, then all existing acceptance behavior
  (spec branch, PR opened, ensure-running spawned iff none/stale, authored-key recorded) is unchanged.

#### Negative Paths
- Given a failed sub-step during handoff (e.g. PR open fails), when `runHandoff` runs, then it
  preserves the current no-build / spec-only failure contract (no merge, no build, no partial record).
- Given `processIdea` after extraction, then its inline branch count is reduced (function is no
  longer the largest hand-written engineer module by a wide margin).

### Done When
- [ ] Post-authoring handoff lives in a named, separately-tested function; `processIdea` calls it.
- [ ] No behavior change: full engineer acceptance suite green, `tsc` clean.
- [ ] `loop.ts` LOC reduced; the handoff function has its own focused unit test.
