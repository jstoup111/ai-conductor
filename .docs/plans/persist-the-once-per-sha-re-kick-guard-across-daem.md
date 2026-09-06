# Implementation Plan: Durable once-per-SHA re-kick guard

**Date:** 2026-09-06
**Stories:** .docs/stories/persist-the-once-per-sha-re-kick-guard-across-daem.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the governing halt-classification contract, which carries the once-per-feature-per-SHA bound forward unchanged and prescribes no storage for it, and to the operator-park contract, which already rejects in-memory daemon-process state for anything required to survive a restart.

## Summary

Three bounded tasks deliver #286 by giving the base-advance re-kick sweep's per-feature last-rekick SHA a durable home in the main checkout's daemon state directory, and by hydrating the existing in-run guard from it before the daemon's first sweep. Halt classification, park ordering, shipped-record dedup, the re-kick sentinel's own lifecycle, marker pruning, and any bus reporting of re-kick intent are outside this small slice.

## Technical Approach

Copy the marker shape this repository already uses for per-slug daemon state. Add a `.daemon/rekicked` subdirectory constant beside the existing processed and warned constants in `daemon-deps.ts`, plus two primitives: one that records a slug's triggering SHA as a single trimmed line in `<mainRoot>/.daemon/rekicked/<slug>`, creating the directory as needed, and one that reads the whole store back as a `Map<string, string>`. The reader tolerates an absent directory, an unreadable entry, and an empty or malformed body by omitting that slug rather than throwing, so a damaged store degrades to today's behaviour — at most one extra re-kick, never a re-kick that is silently withheld. A body is well formed when its trimmed content is a non-empty run of hexadecimal characters; anything else is treated as absent. Recording overwrites, so the store holds exactly one SHA per slug.

Keep the sweep's read path as it is. `rekickSweep` already consults an orchestrator-owned `Map` for the bound, so hydrating that same `Map` from disk before the daemon starts makes the bound durable without changing the sweep's guard expression, its ordering relative to the park, shipped, and halt-class guards, or the shape of the dependency the existing suites construct.

Add the write side as a new optional dependency on the sweep, mirroring the optional shipped-dedup and warn-once dependencies already on that interface: absent means unchanged behaviour, so every existing fixture that omits it keeps its current semantics. Call it immediately after the in-memory set, which is itself already after a successful clear — a failed rebase abort or a failed clear returns before that point, so a feature that was not actually re-kicked can never acquire a record. Wrap the call so a rejection is logged as a per-slug anomaly and the sweep continues with the remaining slugs; the in-run guard still holds the SHA, so the only consequence of a write failure is that the bound reverts to per-run for that feature.

Wire both sides at the daemon's single construction site in `daemon-cli.ts`: seed the guard `Map` from the store immediately where it is constructed, before the daemon and therefore before the startup sweep, and pass the recorder bound to the project root alongside the existing warn-once bindings. The startup sweep and the live sweep already share one `Map` within a run, so they inherit the durable bound together with no second read path.

Recovery semantics change and must be documented: bouncing the daemon no longer grants a halted feature a fresh re-kick at an unchanged base. The sanctioned levers remain clearing the halt marker by hand and unparking, both already documented. Update the daemon guide's re-kick sweep steps to name the durable record and state the new restart semantics.

Test design follows the repository's test-authoring rules. The marker primitives are filesystem behaviour, so they are proven at unit level against a temporary directory created and removed per case — the filesystem is the boundary under test, not a third party being faked. The write-through ordering and its failure modes are proven at the sweep's own boundary with injected fake primitives, extending the existing sweep suite rather than running a daemon. Restart continuity is proven in one acceptance fixture that runs the real sweep twice over a real temporary main checkout with the real marker primitives, discarding the guard between runs to stand in for the restart; no provider, network, or `gh` call is involved. The daemon construction site itself is proven by a source-assembly assertion, the pattern this repository already uses for daemon wiring that cannot be reached without starting a daemon.

## Preconditions and claim ledger

- Operator approved Small scope, the daemon-state marker store, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `daemon-cli.ts:1722` constructs `lastRekickSha` as a bare `Map<string, string>` inside the async daemon entry point, and passes it into the sweep dependencies at `:1740`; no other production site constructs it.
- Verified: `daemon-rekick.ts:220` reads the guard and `:257` writes it, the write sitting after the successful-clear path and after the failed-abort and failed-clear early returns.
- Verified: `daemon-deps.ts:126` declares the warned-marker subdirectory constant, and `hasWarned`/`markWarned` at `:348`/`:358` are the marker read/write pair this fix copies; that module already imports the filesystem primitives the new pair needs except for the directory listing.
- Verified: the same two warn-once primitives are already bound into this sweep's dependencies at `daemon-cli.ts:1742-1743`, so the new recorder binding sits beside an identical precedent.
- Verified: `.daemon/` is ignored by the repository's ignore file, so no marker can dirty the tree or trip the self-host live boundary.
- Verified: the governing halt-classification decision record carries forward "the once-per-feature-per-SHA bound" among the decisions it preserves, and prescribes no storage lifetime for it; the operator-park decision record rejects in-memory daemon-process state for state that must survive a restart. Neither needs an amendment, and no new decision record is required.
- Verified: the daemon guide's re-kick sweep list states the per-SHA skip at line 841 and the SHA recording at line 849; those are the two lines the documentation task edits.
- Verified: an existing source-assembly suite asserts that the park check precedes the guard read inside the sweep loop by matching the guard identifiers; the new recorder call sits after the clear and does not match that set, so that assertion is unaffected.
- Scope check: harness-repo-only daemon machinery; no new skill; provider-agnostic. Event spine: durable state, exception C, no new schema and no new reader path.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in this worktree; no pending product or scope assumption remains.

## Tasks

### Task 1: Add durable last-rekick marker primitives
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/daemon-deps.ts, src/conductor/test/engine/daemon-deps.test.ts
**Dependencies:** none

**Steps:**
1. Write unit cases over a temporary directory for: recording one slug and reading it back; reading a store whose directory does not exist; a store holding one well-formed entry and one empty-bodied entry; a store holding a non-hexadecimal body; and recording the same slug twice with different values.
2. Establish RED, then add the subdirectory constant beside the existing processed and warned constants, and implement the recorder as a directory-creating single-line write mirroring the warn-once writer.
3. Implement the reader as a directory listing plus a per-entry read, trimming each body, omitting any entry whose read fails or whose trimmed body is not a non-empty hexadecimal run, and returning an empty map when the directory is absent. Add the directory-listing import to the module's existing filesystem import.
4. Run the narrowest test invocation for the touched test file plus the typecheck target that covers test files, then commit the focused change.

**Done when:**
1. Recording a slug at a value and reading the store back yields exactly that slug mapped to that value.
2. Reading a store whose directory does not exist yields an empty map and does not throw.
3. A malformed or empty entry body yields no entry for that slug while a well-formed sibling entry in the same store is still returned.
4. Recording the same slug twice leaves only the later value in the store.

### Task 2: Record the triggering SHA through the sweep, only after a real clear
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/daemon-rekick.ts, src/conductor/test/engine/daemon-rekick.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the existing sweep fixture builder with an optional recorder spy and write RED cases for: a cleared slug; a slug whose abort rejects; a slug whose clear rejects; a recorder that rejects while a second slug in the same sweep still clears; and a sweep constructed with no recorder at all.
2. Establish RED, then add the optional recorder to the sweep dependency interface with a comment stating that absence preserves current behaviour, matching the wording convention of the neighbouring optional dependencies.
3. Invoke the recorder immediately after the existing in-memory guard write, inside a guard that logs a per-slug anomaly on rejection and continues the loop. Do not move, duplicate, or reorder the park, shipped, halt-class, or guard checks that precede it.
4. Update the module header comment's description of the per-feature step so it names the durable record rather than implying a run-scoped one.
5. Run the narrowest test invocation for the touched test file and the source-assembly suite that scans this module, plus the typecheck target that covers test files, then commit.

**Done when:**
1. A sweep fixture observes the recorder called exactly once for a cleared slug, with that sweep's SHA, and only after the clear resolved.
2. Failed-abort and failed-clear fixtures assert the recorder is never called for that slug and that the slug is reported as skipped.
3. A recorder that rejects leaves the cleared and skipped sets unchanged, emits an anomaly log line naming the slug, and does not prevent the remaining slugs from being swept.
4. A sweep constructed without the recorder produces the same cleared and skipped sets as the equivalent existing fixture.

### Task 3: Hydrate the guard at daemon start and document the new restart semantics
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/acceptance/rekick-sha-durability.acceptance.test.ts, docs/guides/running-the-daemon.md
**Dependencies:** 1, 2

**Steps:**
1. Create the named acceptance test file. Build a temporary main checkout with one halted feature worktree, run the real sweep with the real marker primitives at one SHA, discard the guard map, hydrate a fresh one from the store, and run the sweep again at the same SHA; then run a third sweep at a different SHA with a guard hydrated from the store again.
2. Establish RED, then seed the guard map from the store where it is constructed in the daemon entry point, awaiting the read before the daemon is started so the startup sweep sees it, and bind the recorder into the sweep dependencies beside the existing warn-once bindings.
3. Extend the existing source-assembly wiring suite with an assertion that the construction site both hydrates the guard from the store and passes the recorder into the sweep dependencies.
4. Update the daemon guide's re-kick sweep list so the per-SHA skip step and the SHA-recording step name the durable per-slug record in the main checkout's daemon state directory, and add one sentence stating that restarting the daemon no longer grants a fresh re-kick at an unchanged base and that clearing the halt or unparking remains the sanctioned lever.
5. Run the narrowest test invocation for the new acceptance file and the wiring suite, plus the typecheck target that covers test files, then commit.

**Done when:**
1. The acceptance fixture proves a second sweep at the same SHA with a guard hydrated from the store skips the feature and leaves its halt marker, cleared marker, and sentinel exactly as the first sweep left them.
2. The same fixture proves a sweep at a different SHA clears the feature again and leaves that later SHA in the store for that slug.
3. A source-assembly assertion proves the daemon construction site hydrates the guard from the durable store before the daemon starts and passes the recorder into the sweep dependencies.
4. The daemon guide's re-kick sweep section names the durable per-slug record and states that a daemon restart no longer grants a fresh re-kick at an unchanged base.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a halted feature was re-kicked at base SHA X and the daemon then restarts with an empty in-memory guard, when a sweep runs again at X, then that feature is skipped and its halt marker, rebase state, and sentinel are left untouched. | 3 | "The acceptance fixture proves a second sweep at the same SHA with a guard hydrated from the store skips the feature and leaves its halt marker, cleared marker, and sentinel exactly as the first sweep left them." | diff-local |
| Story 1 happy: Given the durable record for a feature reads SHA X, when a sweep runs at a genuinely advanced SHA Y, then that feature is re-kicked and its durable record afterwards reads Y. | 3 | "The same fixture proves a sweep at a different SHA clears the feature again and leaves that later SHA in the store for that slug." | diff-local |
| Story 1 happy: Given a halted feature has no durable record at all, when a sweep runs, then it is re-kicked exactly as it is today. | 1, 3 | "Reading a store whose directory does not exist yields an empty map and does not throw." | diff-local |
| Story 1 negative: Given the durable store is missing, unreadable, or holds a malformed body for a slug, when the daemon hydrates the guard at startup, then that slug is treated as never re-kicked and the sweep proceeds rather than failing. | 1 | "A malformed or empty entry body yields no entry for that slug while a well-formed sibling entry in the same store is still returned." | diff-local |
| Story 2 happy: Given a sweep clears a feature's halt marker successfully, when it records the triggering SHA, then the durable write happens after the clear and the recorded value is that sweep's SHA. | 2 | "A sweep fixture observes the recorder called exactly once for a cleared slug, with that sweep's SHA, and only after the clear resolved." | diff-local |
| Story 2 negative: Given a feature's rebase abort or marker clear fails, when the sweep moves on, then no durable record is written for that feature and it stays eligible for the next sweep. | 2 | "Failed-abort and failed-clear fixtures assert the recorder is never called for that slug and that the slug is reported as skipped." | diff-local |
| Story 2 negative: Given the durable write itself fails, when the sweep continues, then the failure is logged as an anomaly, the in-run guard still holds the SHA, and no other feature in the sweep is affected. | 2 | "A recorder that rejects leaves the cleared and skipped sets unchanged, emits an anomaly log line naming the slug, and does not prevent the remaining slugs from being swept." | diff-local |
| Story 2 negative: Given a sweep is constructed without the durable recording dependency, when it runs, then its observable behavior is unchanged from today. | 2 | "A sweep constructed without the recorder produces the same cleared and skipped sets as the equivalent existing fixture." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the marker primitives' unit cases against a temporary directory, including every malformed-store permutation. Task 2 owns the sweep-boundary cases for recording order, the two abort/clear failure paths, recorder rejection, and the omitted-dependency compatibility case. Task 3 owns the single acceptance fixture that proves restart continuity across a discarded and rehydrated guard, and the source-assembly assertion for the daemon construction site. The existing sweep suites supply the unchanged park, shipped-dedup, and halt-classification permutations; no new aggregate, provider, or external-service test is required, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 2 -> Task 3
