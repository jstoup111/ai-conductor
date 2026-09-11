# Implementation Plan: Name the directing text when remediation redirects a gap away from build

**Date:** 2026-09-06
**Stories:** .docs/stories/name-the-directing-text-when-remediation-redirects.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent adds optional reporting fields to one existing event member and annotates one existing evidence string, leaving the detector's vocabulary, the redirect's routing target, and the ungrantable-step policy exactly as the governing decide-owned-amendment contract requires.

## Summary

Four bounded tasks finish jstoup111/ai-conductor#1851 by making a sealed-artifact redirect report the exact text it read as directing an edit, through the redirect event, the daemon renderer, and the terminal halt body. Detection already shipped; changing what the detector matches, where a redirect routes, and how the halt may be cleared are outside this slice.

## Technical Approach

The private clause test already computes everything the diagnostic needs and then throws it away. It matches every protected artifact path in the prose, walks back to the nearest preceding sentence boundary, semicolon, or newline, and keeps the path only when a directing verb appears in that clause. Today it returns a bare path string, so the caller can say which artifact redirected the gap but never why. Change it to return the resolved path together with the clause that directed it, and export it so the clause selection can be proved at unit level rather than only through a remediation round.

Pairing matters and is the one subtlety. The helper may find several directed paths, and the shared plan scanner is what decides which of them is foreign — a path naming the feature's own artifact is exempt. Build an ordered list of path-and-clause pairs, synthesize the scanner's task scope from those paths in their original order, and then look the returned path back up in the list. Selecting the first directed clause instead would quote the wrong sentence whenever a title directs an own-feature edit before a foreign one.

The clause is prose written by a planner step, so it can span lines and run long, and it is about to travel in an append-only JSON-lines ledger whose reader discards a whole rollup on any malformed line. Normalize it once, at the point of capture: collapse every run of whitespace to a single space, trim, and truncate to 160 characters with a single-character ellipsis when it is longer. That normalization is the mechanism that keeps every downstream carrier — event, renderer, halt body — on one line without any of them re-implementing the bound.

Carry the result on the existing redirect event as two additional optional fields, the quoted clause and a source label distinguishing a task title from rationale prose. Optional is deliberate and is what keeps this additive: the union already has this variant, existing consumers read named fields, and the fixture payloads and renderer cases that exist today keep compiling and passing untouched. The renderer appends the quote and its source only when the quote is present. This is the sanctioned way to extend the spine; no sibling ledger, no second format, and no new channel is introduced.

The operator-facing surface is the evidence string the remediation round hands to the DECIDE-entry policy, which renders it into the halt body's evidence line and, on the branch that routes rather than halts, into the kickback event. Change the map that currently holds one artifact path per redirected gap to hold the artifact, quote, and source together, and annotate only those gaps' entries when the evidence string is composed. Entries for gaps that were never redirected keep their existing bare identifier-and-disposition form, so the change is visible exactly where a redirect happened and nowhere else. Annotate the shared string rather than the halt branch alone, because the routing branch is an alternate path that would otherwise silently lose the diagnostic.

Follow the existing sealed-artifact routing tests as the local pattern for anything that must observe a real remediation round: they drive the private remediation method directly with an injected step runner that writes a dispositions file, subscribe to the emitter for redirects, and assert on the returned outcome, with no conductor lifecycle and no external process. Pure clause selection and normalization belong at unit level against the newly exported helper instead. Search hints: the sealed-artifact routing describe block in the engine test directory for the round fixture, and the daemon render test's redirect case for the renderer assertion shape. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the event-field shape over a diagnostic sidecar, and both stories on 2026-09-06 (delegated).
- Verified: `directedProtectedTarget` in `src/conductor/src/engine/conductor.ts` matches protected paths, walks back to the nearest `.`, `;`, or newline, requires a directing verb in that clause, and returns `scanPlanProtectedTargets(...)[0]?.path` — the clause it tested is discarded.
- Verified: `remediationGapTargetsAnotherFeatureSealedArtifact` in the same file calls that helper for each task title first and then for the gap rationale, so both inputs already share one standard.
- Verified: `scanPlanProtectedTargets` in `src/conductor/src/engine/plan-protected-targets.ts` returns `{ taskId, path }` violations and exempts paths naming the active plan's own stem, which is why the returned path can differ from the first directed path.
- Verified: `planRemediation` in `src/conductor/src/engine/conductor.ts` holds `sealedArtifactsByGapId` as `Map<string, string>`, emits one redirect event per entry, rewrites `build` and `acceptance_specs` dispositions to `plan`, and composes `remediationEvidence` from `routedFixes` as bare `id→disposition` pairs in the same method scope.
- Verified: that evidence string is passed to `resolveDecideEntryDisposition` and rendered by `renderDecideEntryHalt` in `src/conductor/src/engine/decide-entry-policy.ts` as the halt body's `Evidence:` line, and the same string is carried as the kickback event's evidence on the routing branch.
- Verified: `plan` is the ungrantable step in `src/conductor/src/engine/decide-entry-policy.ts`, so this halt is terminal and its body is the operator's only diagnostic.
- Verified: the redirect variant in `src/conductor/src/types/events.ts` declares only `gapId` and `artifact`; `src/conductor/src/engine/event-sinks.ts` marks it render-and-persist with no audit record; `src/conductor/src/daemon-cli.ts` renders it; and the audit-trail completeness integration test and the daemon render test each carry a two-field sample payload that optional fields leave compiling.
- Verified: `src/conductor/test/engine/remediation-routing.test.ts` already drives the private remediation method with an injected runner and an emitter subscription, and asserts one redirect payload with an exact object comparison that this change updates.
- Event spine: no new channel; optional additive fields on an existing union member, emitted through the existing emitter.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. No catalog, model-table, or behavioral-rule registration follows.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree; no pending assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Return the directing clause alongside the resolved target
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/directed-protected-target.test.ts (new file)
**Dependencies:** none

**Steps:**
1. Write failing unit tests against a newly exported clause helper covering a title that directs a foreign amendment, a rationale sentence that directs one, a title that directs an own-feature edit before a foreign one, and prose whose only protected mention carries no directing verb.
2. Verify the tests fail (RED).
3. Export the helper and change its return from a bare path to the resolved path plus the clause that directed it, building an ordered list of path-and-clause pairs, synthesizing the scanner scope from those paths in order, and looking the scanner's resolved path back up in that list.
4. Update the two internal callers to consume the new shape without changing which gaps redirect.
5. Verify the tests pass (GREEN) and the pre-existing sealed-artifact routing tests still pass.
6. Commit the focused change.

**Done when:**
1. The exported helper returns the resolved foreign artifact path together with the clause text that directed it, for a task-title input and for a rationale input.
2. When a title directs an edit to the feature's own artifact before a foreign one, the returned clause is the clause of the artifact the scanner resolved rather than the first directing clause in the title.
3. Prose whose only protected mention has no directing verb in its own clause returns nothing, and every pre-existing sealed-artifact routing case still passes unchanged.

### Task 2: Carry the directing evidence on the redirect event and render it
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/conductor.ts, src/conductor/src/daemon-cli.ts, src/conductor/test/engine/remediation-routing.test.ts, src/conductor/test/engine/daemon-render.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing tests: a remediation round redirected on a directing task title asserting the emitted payload's quote and source label, a round redirected on directing rationale prose asserting the rationale source label, a citation-only round asserting no redirect and a routed build disposition, and two renderer cases covering a payload with the quote and one without.
2. Verify the tests fail (RED).
3. Add the quoted clause and the source label to the redirect variant as optional fields, widen the per-gap map to hold artifact, quote, and source together, and emit all three from the existing emit site.
4. Extend the renderer case to append the quote and its source only when the quote is present, leaving the existing line intact otherwise.
5. Update the pre-existing exact-object redirect assertion to the enriched payload.
6. Verify the tests pass (GREEN), then commit.

**Done when:**
1. A remediation round redirected on a directing task title emits one redirect event carrying the gap id, the artifact, the quoted directing clause, and a source label naming the task title.
2. A remediation round redirected on directing rationale prose emits a redirect event whose source label names the rationale and whose quote is the rationale clause.
3. A round whose task title and rationale only cite a protected artifact emits no redirect event and routes the gap on the build disposition its planner authored.
4. The renderer prints the quoted clause and its source label when the payload carries them and prints the pre-existing gap-and-artifact line unchanged when it does not.

### Task 3: Name the redirect evidence in the halt body and the kickback
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/remediation-routing.test.ts
**Dependencies:** 2

**Steps:**
1. Write failing tests: a daemon round mixing one redirected gap with two ordinary routed gaps, asserting the returned halt body's evidence line names the redirected gap's artifact and quoted clause while the other two entries stay bare, and a non-daemon round asserting the routed outcome's evidence carries the same annotation.
2. Verify the tests fail (RED).
3. Annotate the shared evidence string where it is composed, appending the artifact and quoted clause to a redirected gap's entry only, so both the halt render and the kickback carrier inherit it from one place.
4. Verify the tests pass (GREEN) and confirm the halt reason text and routing target are untouched.
5. Commit the focused change.

**Done when:**
1. A daemon round whose redirected gap halts DECIDE entry returns a halt body whose evidence line names that gap id, its resolved artifact, and its quoted directing clause.
2. Evidence entries for gaps that were not redirected in that same round remain the bare identifier-and-disposition form they had before this change.
3. A round that routes instead of halting records evidence carrying the same artifact and quoted directing clause the halt body would have carried.

### Task 4: Bound the quoted clause to one truncated line
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/directed-protected-target.test.ts, src/conductor/test/engine/remediation-routing.test.ts
**Dependencies:** 2

**Steps:**
1. Write failing tests: a unit case whose directing clause spans several lines and exceeds 160 characters, a unit case at or under 160 characters, and a remediation round built from the oversized clause that reads the persisted event ledger back and parses it.
2. Verify the tests fail (RED).
3. Normalize the clause once at capture — collapse whitespace runs to single spaces, trim, and truncate to 160 characters with a single-character ellipsis when longer — so no downstream carrier repeats the bound.
4. Verify the tests pass (GREEN), then commit.

**Done when:**
1. A directing clause containing newlines and more than 160 characters becomes one whitespace-collapsed line of at most 160 characters ending in a single-character ellipsis, and the redirect built from it appends exactly one parseable record to the persisted event ledger.
2. A directing clause of 160 characters or fewer is carried whitespace-collapsed with no ellipsis appended.
3. The truncated clause reaches the halt evidence line in that same normalized single-line form.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a remediation gap whose task title directs an edit to another feature's sealed DECIDE artifact, when the sealed-artifact redirect fires, then the emitted redirect event carries the gap id, the resolved artifact, the quoted directing text, and the task title as the input it was read from. | 1, 2 | "A remediation round redirected on a directing task title emits one redirect event carrying the gap id, the artifact, the quoted directing clause, and a source label naming the task title." | diff-local |
| Story 1 happy: Given a remediation gap redirected because its rationale prose directs the edit, when the redirect fires, then the emitted redirect event carries the quoted rationale clause and the rationale as the input it was read from. | 2 | "A remediation round redirected on directing rationale prose emits a redirect event whose source label names the rationale and whose quote is the rationale clause." | diff-local |
| Story 1 happy: Given a redirect event carrying a quoted directing text reaches the daemon event renderer, when the line is rendered, then it shows that quoted text and its source input alongside the gap id and artifact it already showed. | 2 | "The renderer prints the quoted clause and its source label when the payload carries them and prints the pre-existing gap-and-artifact line unchanged when it does not." | diff-local |
| Story 1 negative: Given a task title directs an edit to the feature's own artifact before directing one to another feature's sealed artifact, when the redirect fires, then the quoted text is the clause of the redirected foreign artifact rather than the first directing clause in the title. | 1 | "When a title directs an edit to the feature's own artifact before a foreign one, the returned clause is the clause of the artifact the scanner resolved rather than the first directing clause in the title." | diff-local |
| Story 1 negative: Given the directing clause spans multiple lines and exceeds the quote budget, when the redirect event is emitted, then the quoted text is a single whitespace-collapsed line truncated to the budget with a trailing ellipsis and the persisted event ledger record remains one parseable JSON line. | 4 | "A directing clause containing newlines and more than 160 characters becomes one whitespace-collapsed line of at most 160 characters ending in a single-character ellipsis, and the redirect built from it appends exactly one parseable record to the persisted event ledger." | diff-local |
| Story 1 negative: Given a remediation gap whose task title and rationale only cite a protected artifact as evidence without directing an edit, when remediation routes the gap, then no redirect event is emitted and the gap keeps the disposition its planner authored. | 2 | "A round whose task title and rationale only cite a protected artifact emits no redirect event and routes the gap on the build disposition its planner authored." | diff-local |
| Story 1 negative: Given a redirect event that carries no quoted directing text, when the daemon event renderer renders it, then it emits the existing gap-and-artifact line without an empty quote fragment. | 2 | "The renderer prints the quoted clause and its source label when the payload carries them and prints the pre-existing gap-and-artifact line unchanged when it does not." | diff-local |
| Story 2 happy: Given a remediation round redirects one gap and the daemon refuses DECIDE entry, when the halt body is rendered, then its evidence line names that gap with its resolved artifact and its quoted directing text. | 3 | "A daemon round whose redirected gap halts DECIDE entry returns a halt body whose evidence line names that gap id, its resolved artifact, and its quoted directing clause." | diff-local |
| Story 2 negative: Given the same halted round also routed gaps that were never redirected, when the halt body is rendered, then each of those gaps keeps its bare identifier-and-disposition evidence entry with no artifact and no quote appended. | 3 | "Evidence entries for gaps that were not redirected in that same round remain the bare identifier-and-disposition form they had before this change." | diff-local |
| Story 2 negative: Given a redirected gap whose round routes onward instead of halting, when the remediation kickback evidence is recorded, then it carries the same artifact and quoted directing text the halt body would have carried. | 3 | "A round that routes instead of halting records evidence carrying the same artifact and quoted directing clause the halt body would have carried." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled fixtures; nothing here depends on a commit outside this feature's diff. Task 1 owns unit-level clause selection and pairing against the newly exported helper. Task 4 owns unit-level normalization plus the one ledger-integrity assertion that proves the normalized quote survives persistence. Task 2 owns the event boundary end to end: the real remediation round through the real emitter and persister for the payload, and the daemon renderer for the operator-visible line. Task 3 owns the halt boundary — the remediation round's returned halt body and its routing-branch evidence — which is the observable surface an operator reads and therefore the integration proof for Story 2. No test reaches a real provider, network, or external process; the step runner is injected and writes its dispositions file directly. No terminal validation task is added, and the pre-existing sealed-artifact routing and audit-trail payload coverage remains authoritative for everything this change leaves alone.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3
Task 2 -> Task 4
