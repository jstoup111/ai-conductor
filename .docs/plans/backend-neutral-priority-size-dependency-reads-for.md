# Implementation Plan: Backend-neutral priority/size/dependency reads for daemon backlog ordering (#851)

**Date:** 2026-10-10
**Stories:** .docs/stories/backend-neutral-priority-size-dependency-reads-for.md
**Conflict check:** Clean as of 2026-10-10 (one degrading wording conflict resolved; see `.docs/conflicts/2026-10-10-backend-neutral-priority-size-dependency-reads-for.md`)

## Summary

A new backend-neutral `OrderingSource` module becomes the only path to priority, size, and dependency facts. Its GitHub implementation moves today's reads verbatim, and Jira keys resolve to `unavailable` with one deduplicated `tracker_backend_unavailable` event. The three policy modules and all six construction sites switch to it. The plan has 12 tasks.

## Technical Approach

- **Port (Tasks 1 to 3).** `src/conductor/src/engine/ordering-source.ts` exports closed outcome unions (`FactsOutcome`, `BlockersOutcome`), the `OrderingSource` interface, and `createOrderingSource({ run, cwd, events? })`. It dispatches each reference on its `parseWorkRef` kind with an exhaustive switch. GitHub references take the code moved verbatim from `ghIssueLabelReader` and `resolveUncached`: the same argv through `runTrackerRepositoryRead`, the same 404 rule, and the same detail strings. Jira keys return `unavailable` with no runner call, and emit one event per reference per source instance (adr-2026-10-10-backend-neutral-ordering-source D1 to D4). The module imports `GhRunner` and declares no runner type (#846 stray-declaration scan).
- **Policy (Tasks 4 to 6).** `createPriorityResolver`, `createBlockerResolver` and `resolveClaimBands` take the source instead of a reader or runner. Their cache, outage, warn-once, memo and cycle logic stays line-for-line. `unavailable` bands `unlabeled` without counting as an outage, and resolves blockers as `indeterminate` (D5). `BlockerVerdict` and `IssueRef` are unchanged (D7). GitHub parity is proven by the existing behavioral tests, whose expected outcomes are not edited; only their construction lines change (architecture-review condition 2).
- **Audit (Task 7).** The production GitHub invocation audit in `github-invocation-audit.ts` only exempts runner-forwarding callbacks passed to `createBlockerResolver`. Without `createOrderingSource` registered as a read-only factory, the rewired construction sites would fail that audit.
- **Wiring (Tasks 8 to 11).** A small `daemon-ordering-readers.ts` helper builds one source per daemon run and shares it between the priority resolver and every per-scan blocker resolver, so a Jira item emits once per run. That keeps the `daemon-cli.ts` edit to two construction lines, which matters because the unmerged `spec/self-host-phase6-wiring` branch also edits that file. `compose claim`, `overlap-scan`, the coherence-validator advisory scan, and the guided monitor queue each build a source the same way. `gh-blocker-runner.ts` loses its only caller and is deleted (D6).
- **Local pattern basis.** The Jira emission follows `intake-backend-composite.ts` `report()`, which emits `tracker_backend_unavailable` with `project` set to the reference for a Jira key. Its traits: an existing event variant, an optional emitter, and no network call. Allowed variation: deduplication here is per source instance rather than per poll episode. Search `tracker_backend_unavailable` in `src/conductor/src/engine/intake-backend-composite.ts`. The integration fixture follows `test/acceptance/dependency-ordered-intake-and-dispatch.test.ts`: a seeded plan, stories, and a `.docs/intake/<slug>.md` `Source-Ref:` marker driven through the real `discoverBacklog`.
- **Sequencing.** The port runs 1 → 2 → 3. Policy tasks 4, 5 and 6 depend on 3, and 7 depends on 1. Each wiring task depends on the policy it consumes plus 7. Task 12 deletes `ghIssueLabelReader`, `IssueLabelReader` and `BlockerRunner` after every importer has migrated.

## Prerequisites

- None. #846 (`tracker-client.ts`) and #847 (`parseWorkRef`) are on main; adr-2026-10-10-backend-neutral-ordering-source is APPROVED.

## Tasks

### Task 1: Ordering-source contract and GitHub fact reads
**Story:** 1
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in a new `src/conductor/test/engine/ordering-source.test.ts` against `createOrderingSource({ run, cwd })` with a fake canonical `GhRunner` that records argv and returns canned `repos/<owner>/<repo>/issues/<n>` JSON: label sets `["priority: high", "size: M"]`, `["priority: low", "priority: critical", "size: S", "size: L"]`, `["Priority: High", "priority:high", "size: XL", "Size: M"]`; a runner rejection carrying `status: 404`; a runner rejection with a non-404 error; and the unparseable non-Jira ref `not-a-ref`.
2. Verify RED (the module does not exist).
3. Implement `src/conductor/src/engine/ordering-source.ts`. Export the closed outcome types `OrderingFacts = { priority: Exclude<PriorityBand, 'no-issue' | 'unlabeled'> | undefined; size: 'S' | 'M' | 'L' | undefined }`, `FactsOutcome = OrderingFacts | 'not-found' | 'unavailable'`, and `BlockersOutcome` (Task 2), the `OrderingSource` interface `{ readFacts(refs: string[]): Promise<Map<string, FactsOutcome>>; readBlockers(ref: string): Promise<BlockersOutcome> }`, and `createOrderingSource(deps: { run: GhRunner; cwd?: string; events?: <emitter> })`. Import `GhRunner` and `runTrackerRepositoryRead` from `./tracker-client.js`; declare no runner-shaped type (the #846 stray-declaration scan in `test/tracker-client-canonical-gate.test.ts` forbids it). Move the body of `ghIssueLabelReader` from `backlog-priority.ts` into the GitHub `readFacts` path verbatim (same `parseSourceRef` + `splitOwnerRepo` guard, same `runTrackerRepositoryRead(run, cwd, 'issue.read', ...)` argv, same 404 test `status === 404 || message.includes('404')`, same rethrow of any other error), then map labels with the existing `parsePriorityLabels` and `parseSizeLabel` (keep both exported from `backlog-priority.ts`; `backfill.ts` and `file-issue.ts` still import them).
4. Verify GREEN and commit.

**Done when:**
- [test] `createOrderingSource(...).readFacts` for an issue labeled `priority: high` and `size: M` returns `{ priority: 'high', size: 'M' }` and the fake runner received exactly `['api', 'repos/<owner>/<repo>/issues/<n>']`, the argv `ghIssueLabelReader` sends today.
- [test] `readFacts` for an issue labeled `priority: low`, `priority: critical`, `size: S` and `size: L` returns priority `critical` (highest band wins) and size `L` (largest wins), both computed by the existing `parsePriorityLabels` and `parseSizeLabel`.
- [test] `readFacts` for an issue whose only labels are `Priority: High`, `priority:high`, `size: XL` and `Size: M` returns `{ priority: undefined, size: undefined }`, so size is absent while the priority outcome is still reported in the same facts record.
- [test] `readFacts` maps a runner rejection carrying `status: 404` to `'not-found'`, maps the unparseable ref `not-a-ref` to `'not-found'` without calling the runner, and rethrows a non-404 runner rejection unchanged so the caller sees the outage.
- `src/conductor/src/engine/ordering-source.ts` imports `GhRunner` from `./tracker-client.js` and declares no runner-shaped type, and `test/tracker-client-canonical-gate.test.ts` passes unchanged.

**Files:** src/conductor/src/engine/ordering-source.ts; src/conductor/test/engine/ordering-source.test.ts

**Dependencies:** none

### Task 2: GitHub blocker reads through the ordering source
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/ordering-source.test.ts` for `readBlockers` with the fake runner: a `blocked_by` body with one open issue (`repository_url` ending `repos/acme/app`, number 7); an empty array; an array whose entries are all `state: 'closed'` with `state_reason` `completed` and `not_planned`; a runner rejection `boom`; a non-JSON body; and the unparseable ref `not-a-ref`.
2. Verify RED.
3. Implement GitHub `readBlockers` in `ordering-source.ts` by moving `resolveUncached`'s read-and-parse body from `blocker-resolver.ts` verbatim: same `parseSourceRef` guard and detail text `unparseable sourceRef: <ref>`, same `.../dependencies/blocked_by` argv through `runTrackerRepositoryRead`, same caught-error detail (`err.message`), same `unparseable blocked_by response: <detail>` text, same closed-entry filter and `repository_url` to `owner/repo` mapping. Return the open blockers as canonical `owner/repo#n` strings, `{ indeterminate: detail }` for the three failure shapes, and an empty list for no open blockers.
4. Verify GREEN and commit.

**Done when:**
- [test] `readBlockers` returns `['acme/app#7']` for a `blocked_by` body holding one open issue whose `repository_url` ends `repos/acme/app`, after sending exactly the `['api', 'repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by']` argv.
- [test] `readBlockers` returns an empty list both for an empty `blocked_by` array and for an array whose entries are all `state: 'closed'` with close reasons `completed` and `not_planned`.
- [test] `readBlockers` returns `{ indeterminate: 'boom' }` when the runner rejects with `boom`, and `{ indeterminate }` whose detail starts `unparseable blocked_by response:` when the body is not JSON.
- [test] `readBlockers('not-a-ref')` returns `{ indeterminate: 'unparseable sourceRef: not-a-ref' }` without calling the runner and without emitting any event.

**Files:** src/conductor/src/engine/ordering-source.ts; src/conductor/test/engine/ordering-source.test.ts

**Dependencies:** Task 1

### Task 3: Jira references resolve as unavailable with one deduplicated event
**Story:** 3
**Story:** 4
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/ordering-source.test.ts` with a recording emitter and a runner that fails the test if called: `readFacts(['PROJ-123'])`, `readBlockers('PROJ-123')`, repeated calls for `PROJ-123`, keys `PROJ-1` and `PROJ-2`, and a source built with no `events` dependency.
2. Verify RED.
3. Implement the per-reference dispatch in `createOrderingSource`: classify each ref with `parseWorkRef` (`engine/engineer/source-ref.ts`); kind `github` goes to Tasks 1 and 2; kind `jira` returns `'unavailable'` from `readFacts` and `'unavailable'` from `readBlockers`, never touching `run`; anything unparseable keeps Tasks 1 and 2 behavior. Use an exhaustive `switch` on the `WorkRef` kind with no `default` branch. On the first unavailable outcome for a ref, emit `{ type: 'tracker_backend_unavailable', project: <ref>, backend: 'jira', reason: 'no-adapter' }` through the optional emitter (type it as the existing `IntakeEventEmitter` from `intake-backend-composite.ts`, which that module already uses for this event); keep a per-instance `Set` of emitted refs so each ref emits at most once for the source's lifetime. Precedent: `intake-backend-composite.ts` `report()` emits the same event with `project: sourceRef` for a Jira ref.
4. Verify GREEN and commit.

**Done when:**
- [test] `readFacts(['PROJ-123'])` returns `'unavailable'` for `PROJ-123` and `readBlockers('PROJ-123')` returns `'unavailable'`, carrying no priority or size, and the runner that fails the test when called is never called.
- [test] The first unavailable outcome for `PROJ-123` emits exactly one event `{ type: 'tracker_backend_unavailable', project: 'PROJ-123', backend: 'jira', reason: 'no-adapter' }`, and further `readFacts` and `readBlockers` calls for `PROJ-123` on the same source instance emit no further events.
- [test] Reading `PROJ-1` and `PROJ-2` from one source emits one `tracker_backend_unavailable` event for each key, and neither key's event suppresses the other's.
- [test] A source created without an `events` dependency returns `'unavailable'` for `PROJ-123` from both `readFacts` and `readBlockers` without throwing.
- `createOrderingSource` dispatches on the parsed `WorkRef` kind with an exhaustive `switch` that has no `default` branch.

**Files:** src/conductor/src/engine/ordering-source.ts; src/conductor/test/engine/ordering-source.test.ts

**Dependencies:** Tasks 1, 2

### Task 4: Priority resolver consumes the ordering source
**Story:** 1
**Story:** 3
**Story:** 6
**Type:** refactor

**Steps:**
1. Change the construction in `src/conductor/test/backlog-priority.test.ts`, `src/conductor/test/engine/daemon-cli-priority-wiring.test.ts`, `src/conductor/test/acceptance/daemon-issue-priority-scheduling.test.ts`, `src/conductor/test/engine/monitor/ordering.test.ts`, and `src/conductor/test/backlog-priority.smoke.test.ts` from `createPriorityResolver(<IssueLabelReader>, log)` to `createPriorityResolver(<OrderingSource>, log)` built over the same canned GitHub responses; do not edit any expected band, order, warning count, or read count. Add failing cases: a Jira-keyed item next to GitHub items, the same with a throwing GitHub read in the pass, and a backlog ordered with and without `size:` labels.
2. Verify RED (constructor type mismatch and the new cases).
3. Implement in `src/conductor/src/engine/backlog-priority.ts`: `createPriorityResolver(source: OrderingSource, log)` calls `source.readFacts(refsToRead)` where it called `reader(refsToRead)`; cache the resolved band per ref (facts → `priority ?? 'unlabeled'`; `'not-found'` and `'unavailable'` → no cache entry, recorded in `attemptedRefs`, so they band `unlabeled` and are never re-read on local scans); keep the outage branch (throw → clear cache and attempted refs, warn once, fallback) and every other line unchanged. Switch over `FactsOutcome` exhaustively with no `default`. Leave `ghIssueLabelReader` and `IssueLabelReader` in place for now; Task 12 removes them after their last importers migrate.
4. Verify GREEN and commit.

**Done when:**
- [test] The existing `backlog-priority.test.ts`, `daemon-cli-priority-wiring.test.ts`, `daemon-issue-priority-scheduling.test.ts`, `monitor/ordering.test.ts` and `backlog-priority.smoke.test.ts` cases pass with only their resolver construction changed, proving `createPriorityResolver` still bands a `priority: high` GitHub item `high` between `critical` and `medium`, reuses its cached band on a later `refresh: false` scan with no new read, gives an item with no sourceRef the `no-issue` band with no read, bands a 404 ref `unlabeled` with the pass still banded and zero outage warnings, and bands a GitHub issue whose only labels are `Priority: High` and `priority:high` `unlabeled`.
- [test] The existing outage cases pass unchanged: a non-404 read failure makes `createPriorityResolver` return `{ mode: 'fallback' }` with cleared cache and exactly one warning, a later local scan during the outage returns fallback with no further reads, and after a successful refresh the next failure logs one new warning.
- [test] A pass mixing a `PROJ-123` item with GitHub items returns `{ mode: 'banded' }`, bands `PROJ-123` `unlabeled`, keeps every GitHub item's band, logs no outage warning, and a second local scan does not re-read `PROJ-123`.
- [test] A pass mixing a `PROJ-123` item with a GitHub read that throws returns `{ mode: 'fallback' }` with exactly one warning, the same as an all-GitHub outage, while a pass with only `PROJ-123` and no throw stays banded with zero warnings.
- [test] `orderBacklog` over `createPriorityResolver` results gives the identical item order for a backlog whose issues carry `size: S` and `size: L` labels and for the same backlog without size labels.

**Files:** src/conductor/src/engine/backlog-priority.ts; src/conductor/test/backlog-priority.test.ts; src/conductor/test/engine/daemon-cli-priority-wiring.test.ts; src/conductor/test/acceptance/daemon-issue-priority-scheduling.test.ts; src/conductor/test/engine/monitor/ordering.test.ts; src/conductor/test/backlog-priority.smoke.test.ts

**Dependencies:** Task 3

### Task 5: Blocker resolver consumes the ordering source
**Story:** 2
**Story:** 4
**Type:** refactor

**Steps:**
1. Change the construction in `src/conductor/test/engine/blocker-resolver.test.ts`, `src/conductor/test/acceptance/dependency-ordered-intake-and-dispatch.test.ts` and `src/conductor/test/acceptance/overlap-scan.acceptance.test.ts` from `createBlockerResolver({ run, cwd })` to `createBlockerResolver({ source: createOrderingSource({ run, cwd }) })` over the same fake `blocked_by` responses; do not edit any expected verdict. In `dependency-ordered-intake-and-dispatch.test.ts`, replace the `BlockerRunner` type import and annotations with the canonical `GhRunner` type from `tracker-client.ts`. Add failing cases for `PROJ-123` and for a GitHub blocker whose own lookup is indeterminate.
2. Verify RED.
3. Implement in `src/conductor/src/engine/blocker-resolver.ts`: `BlockerResolverDeps` becomes `{ source: OrderingSource }`; `resolveUncached` calls `source.readBlockers(sourceRef)` and switches exhaustively (no `default`) over the outcome: list → `unblocked` when empty, else `blocked` with each canonical ref mapped back through `parseSourceRef` to `IssueRef { repo, number }`; `{ indeterminate }` → `indeterminate` with the same detail; `'unavailable'` → `{ kind: 'indeterminate', detail: 'no ordering adapter for jira reference <ref>' }`; `'not-found'` → `indeterminate` with detail `issue not found: <ref>`. Keep the per-instance memo, `findCycleMembers`, `memoizeCycle`, the four-kind `BlockerVerdict` union and the `IssueRef` shape unchanged. Leave the `BlockerRunner` alias in place; Task 12 removes it.
4. Verify GREEN and commit.

**Done when:**
- [test] The existing `blocker-resolver.test.ts` cases pass with only construction changed, proving `createBlockerResolver` returns `blocked` naming `acme/app` number `7` for one open blocker, `unblocked` for an empty or all-closed `blocked_by` list, and `indeterminate` carrying the error detail for a read failure and the `unparseable blocked_by response` detail for a non-JSON body.
- [test] The existing cycle cases pass unchanged: two GitHub issues blocking each other resolve `cycle` naming both members, resolving the other member in the same resolver returns the same cycle verdict, and resolving one ref twice in a resolver makes one `readBlockers` call.
- [test] `resolve('PROJ-123')` returns `{ kind: 'indeterminate' }` whose detail is `no ordering adapter for jira reference PROJ-123`, and `resolve('not-a-ref')` returns `indeterminate` with no event emitted by its source.
- [test] A GitHub issue whose single open blocker's own `readBlockers` returns `{ indeterminate }` resolves `blocked` naming that blocker, and the cycle walk completes without throwing.
- `BlockerVerdict` in `blocker-resolver.ts` keeps exactly the kinds `unblocked`, `blocked`, `indeterminate` and `cycle` with `IssueRef { repo, number }` elements, and `resolveUncached` switches over the `readBlockers` outcome with no `default` branch.

**Files:** src/conductor/src/engine/blocker-resolver.ts; src/conductor/test/engine/blocker-resolver.test.ts; src/conductor/test/acceptance/dependency-ordered-intake-and-dispatch.test.ts; src/conductor/test/acceptance/overlap-scan.acceptance.test.ts

**Dependencies:** Task 3

### Task 6: Claim banding consumes the ordering source
**Story:** 5
**Type:** refactor

**Steps:**
1. Change the construction in `src/conductor/test/engine/engineer/intake/dependency-claim.test.ts` from an `IssueLabelReader` fake to an `OrderingSource` built over the same canned label responses; do not edit any expected band or order. Add a failing case with a `PROJ-9` entry and an unlabeled GitHub entry.
2. Verify RED.
3. Implement in `src/conductor/src/engine/engineer/intake/dependency-claim.ts`: `resolveClaimBands(source: OrderingSource, refs)` calls `source.readFacts(uniqueRefs)` and maps facts → `priority ?? 'unlabeled'`, `'not-found'` and `'unavailable'` → `'unlabeled'`, exhaustively with no `default`; a throw still propagates untouched to `claimUnblocked`, which keeps its warn-once FIFO fallback.
4. Verify GREEN and commit.

**Done when:**
- [test] The existing `dependency-claim.test.ts` cases pass with only construction changed, proving `claimUnblocked` with `resolveClaimBands` claims a `priority: critical` entry before a `priority: low` one and, when the source's `readFacts` throws, logs exactly one warning and claims in received-time FIFO order without failing or returning empty.
- [test] `resolveClaimBands` bands a `PROJ-9` entry and an unlabeled GitHub entry both `unlabeled`, and with a fake dependency resolver returning `unblocked` for both, `claimUnblocked` claims whichever has the earlier `receivedAt`.

**Files:** src/conductor/src/engine/engineer/intake/dependency-claim.ts; src/conductor/test/engine/engineer/intake/dependency-claim.test.ts

**Dependencies:** Task 3

### Task 7: Production invocation audit admits the ordering-source factory
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write a failing case in `src/conductor/test/engine/github-ownership/24-enforce-the-production-invocation-boundary-mechanically.test.ts`, next to the existing `readOnlyForwarding` fixture: source text importing `createOrderingSource` from `./ordering-source.js` and returning `createOrderingSource({ run: (args) => run(args, { cwd: '/tmp' }) })` must audit clean, and the same callback passed to an arbitrary local function must still report `unresolvable mutable GitHub command forwarding outside guarded adapter`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/github-invocation-audit.ts`: where named imports from a module ending `/blocker-resolver.js` add `createBlockerResolver` to `readOnlyFactories`, also add `createOrderingSource` imported from a module ending `/ordering-source.js`. Justify it in the adjacent doc comment: every GitHub read in `ordering-source.ts` goes through `runTrackerRepositoryRead` with operation `issue.read`, which `assertTrackerReadArgs` restricts to reads. Do not widen any other rule.
4. Verify GREEN and commit.

**Done when:**
- [test] `auditGithubInvocationSource` returns no findings for a file that passes `(args) => run(args, { cwd })` to `createOrderingSource` imported from `./ordering-source.js`, and still returns `unresolvable mutable GitHub command forwarding outside guarded adapter` for the same callback passed to a non-factory function.
- The existing assertions in `24-enforce-the-production-invocation-boundary-mechanically.test.ts` pass unchanged, including the `createBlockerResolver` read-only forwarding case.

**Files:** src/conductor/src/engine/github-invocation-audit.ts; src/conductor/test/engine/github-ownership/24-enforce-the-production-invocation-boundary-mechanically.test.ts

**Dependencies:** Task 1

### Task 8: Daemon builds one ordering source per run
**Story:** 3
**Story:** 4
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing integration test `src/conductor/test/engine/daemon-ordering-readers.test.ts`. Seed a fixture repo the way `test/acceptance/dependency-ordered-intake-and-dispatch.test.ts` does (search `seedPlan` / `Source-Ref:` there): one eligible spec with intake marker `Source-Ref: PROJ-123`, one with a GitHub ref labeled `priority: high`, one with a GitHub ref and no labels, and one with a GitHub ref whose `blocked_by` read the fake runner rejects with `boom`. Build the readers with `createDaemonOrderingReaders({ run, cwd, events, log })` over a fake runner that records argv, a real `ConductorEventEmitter` and an `EventPersister` writing `<tmp>/.pipeline/events.jsonl`, and drive three `localWorkSource(...).discover()` passes using the returned `priorityResolver` and `makeResolver`, with the real `discoverBacklog`.
2. Verify RED (the helper does not exist).
3. Implement `src/conductor/src/engine/daemon-ordering-readers.ts` exporting `createDaemonOrderingReaders({ run, cwd, events, log })`: build ONE `createOrderingSource({ run, cwd, events })` and return `{ priorityResolver: createPriorityResolver(source, log), makeResolver: () => createBlockerResolver({ source }) }`, so every scan gets a fresh memo over the shared, event-deduplicating source. In `src/conductor/src/daemon-cli.ts`, replace only the `createPriorityResolver(ghIssueLabelReader(ownerGh, projectRoot), log)` construction and the `makeResolver: () => createBlockerResolver({ run: createGhBlockerRunner(), cwd: projectRoot })` entry with the helper's two results built from `ownerGh` (already `makeProductionGh()`, the same production runner `createGhBlockerRunner` wraps), `projectRoot` and `events`, and drop the two now-unused imports; keep this edit to those lines (an unmerged `spec/self-host-phase6-wiring` branch also edits `daemon-cli.ts`). Delete `src/conductor/src/engine/gh-blocker-runner.ts`, whose only production caller this was, following `/code-removal`; retarget the `createGhBlockerRunner (real gh binary smoke)` block in `src/conductor/test/engine/blocker-resolver.test.ts` to `createOrderingSource({ run: makeProductionGh() }).readBlockers`, keeping its existing assertions.
4. Verify GREEN and commit.

**Done when:**
- [test] Across three `discover()` passes built from `createDaemonOrderingReaders`, the `priority: high` spec is ordered before the unlabeled GitHub spec, every pass's priority resolution stays `banded`, and the `PROJ-123` spec is absent from the ordered eligible items.
- [test] After the three passes, `<tmp>/.pipeline/events.jsonl` written by `EventPersister` holds exactly one `tracker_backend_unavailable` record with `project: 'PROJ-123'`, `backend: 'jira'` and `reason: 'no-adapter'`, counting both priority and blocker resolution, and the fake runner recorded no argv naming `PROJ-123`.
- [test] The `PROJ-123` spec is reported in the pass's WAITING list with an `indeterminate` reason naming the missing Jira adapter and the `boom` spec is reported WAITING with an `indeterminate` reason carrying `boom`; neither is returned as a dispatchable item, while the other two specs are still discovered and ordered in that same pass, the same handling today's `dependency-ordered-intake-and-dispatch` acceptance tests assert for an indeterminate verdict.
- [test] Each `makeResolver()` call returns a distinct resolver whose memo is empty, so a verdict cached in one pass is not returned by the next pass's resolver.
- `daemon-cli.ts` builds its priority resolver and per-scan blocker resolver only through `createDaemonOrderingReaders`, `gh-blocker-runner.ts` no longer exists, the real-gh smoke block in `blocker-resolver.test.ts` drives `createOrderingSource` with its assertions unchanged, and the existing `daemon-render.test.ts` case rendering `tracker_backend_unavailable` into the daemon log passes unchanged.

**Files:** src/conductor/src/engine/daemon-ordering-readers.ts; src/conductor/test/engine/daemon-ordering-readers.test.ts; src/conductor/src/daemon-cli.ts; src/conductor/src/engine/gh-blocker-runner.ts; src/conductor/test/engine/blocker-resolver.test.ts

**Dependencies:** Tasks 4, 5, 7

### Task 9: Compose claim reads through the ordering source
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing cases in `src/conductor/test/engine/engineer/engineer-cli-intake.test.ts`, alongside the existing claim test that serves the blocker endpoint and the label endpoint from one injected `gh` (search `ghIssueLabelReader` in that file): pending ideas linked to GitHub issues labeled `priority: critical` and `priority: low`; a pending idea linked to `PROJ-9` received before an unlabeled GitHub idea; and a `PROJ-9` idea whose dependency verdict is evaluated.
2. Verify RED.
3. Implement in `src/conductor/src/engine/engineer-cli.ts`: in the claim path replace `createBlockerResolver({ run: ... })` and `ghIssueLabelReader(...)` with one `const source = createOrderingSource({ run: (args) => gh(args, { cwd: process.cwd() }), cwd: process.cwd(), events: opts.events })`, then `createBlockerResolver({ source })` and `resolveBands: (refs) => resolveClaimBands(source, refs)`. Keep the fresh-per-claim construction and comments. Drop the `ghIssueLabelReader` import.
4. Verify GREEN and commit.

**Done when:**
- [test] Running the claim command with pending ideas linked to `priority: critical` and `priority: low` GitHub issues claims the `critical` idea first, as the unchanged existing claim tests also assert.
- [test] Running the claim command with a `PROJ-9` idea received before an unlabeled GitHub idea bands both `unlabeled` through `resolveClaimBands` and claims the GitHub idea, because the blocker resolver returns `indeterminate` for `PROJ-9` and `claimUnblocked` defers it.
- [test] Running the claim command with a `PROJ-9` idea and an unblocked GitHub idea claims the GitHub idea and defers the `PROJ-9` idea, which `claimUnblocked` receives as an `indeterminate` verdict, exactly as existing claim tests treat an indeterminate verdict.
- The claim path in `engineer-cli.ts` constructs its priority and blocker readers through `createOrderingSource`, and `engineer-cli.ts` no longer imports `ghIssueLabelReader`.

**Files:** src/conductor/src/engine/engineer-cli.ts; src/conductor/test/engine/engineer/engineer-cli-intake.test.ts

**Dependencies:** Tasks 5, 6, 7

### Task 10: Overlap scan and coherence advisory read through the ordering source
**Story:** 5
**Type:** happy-path

**Steps:**
1. Change the construction in `src/conductor/test/engine/overlap-scan-cli.test.ts` and the `advisoryDuplicateClaimWarn` cases in `src/conductor/test/engine/engineer/coherence-validator.test.ts` only where they build `createBlockerResolver` directly; do not edit any expected report. Add a failing coherence case with no `gh` runner injected.
2. Verify RED.
3. Implement: in `src/conductor/src/index.ts` `overlapScanCommand`, replace `createBlockerResolver({ run: (args) => gh(args, { cwd }) })` with `createBlockerResolver({ source: createOrderingSource({ run: (args) => gh(args, { cwd }), cwd }) })`. In `src/conductor/src/engine/engineer/coherence-validator.ts`, inside the existing `if (gh)` guard, do the same with `cwd: worktreePath`. Keep the guard so a missing runner still skips the advisory check.
4. Verify GREEN and commit.

**Done when:**
- [test] The existing `overlap-scan-cli.test.ts` real-dispatch case and the `advisoryDuplicateClaimWarn` cases in `coherence-validator.test.ts` produce byte-identical reports with the resolver now built through `createOrderingSource`.
- [test] Coherence validation with no `gh` runner injected skips the advisory overlap check, makes no `readBlockers` call, and the land validation result does not fail because of the skipped check.
- `overlapScanCommand` in `index.ts` and the advisory overlap block in `coherence-validator.ts` construct their blocker resolvers through `createOrderingSource`.

**Files:** src/conductor/src/index.ts; src/conductor/src/engine/engineer/coherence-validator.ts; src/conductor/test/engine/overlap-scan-cli.test.ts; src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** Tasks 5, 7

### Task 11: Guided monitor queue reads priority through the ordering source
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write a failing case in the monitor-cli test that covers the default `priorityResolver` construction (`src/conductor/test/engine/monitor-cli.test.ts`): with no injected `priorityResolver`, the default resolver bands a `PROJ-7` queue entry `unlabeled` and emits one `tracker_backend_unavailable` on the operator event spine.
2. Verify RED.
3. Implement in `src/conductor/src/engine/monitor-cli.ts`: replace `createPriorityResolver(ghIssueLabelReader(makeProductionGh(), projectRoot), print)` with `createPriorityResolver(createOrderingSource({ run: makeProductionGh(), cwd: projectRoot, events: spine.events }), print)`. `spine` is created on the line above, so the event lands in the operator spine's `events.jsonl`. Keep the `deps.priorityResolver` override. Drop the `ghIssueLabelReader` import.
4. Verify GREEN and commit.

**Done when:**
- [test] With no injected `priorityResolver`, the monitor-cli default resolver bands a `PROJ-7` entry `unlabeled` and emits exactly one `tracker_backend_unavailable` event for `PROJ-7` on the spine created by `startOperatorEventSpine`.
- `monitor-cli.ts` constructs its default priority resolver through `createOrderingSource` and no longer imports `ghIssueLabelReader`.

**Files:** src/conductor/src/engine/monitor-cli.ts; src/conductor/test/engine/monitor-cli.test.ts

**Dependencies:** Tasks 4, 7

### Task 12: Remove the retired GitHub-only ordering readers
**Story:** 5
**Type:** refactor

**Steps:**
1. Follow `/code-removal`. Confirm with a repository search that no production or test module still imports `ghIssueLabelReader` or `IssueLabelReader` from `backlog-priority.ts` or `BlockerRunner` from `blocker-resolver.ts`; Tasks 4 to 11 migrated every importer.
2. Retarget the tests that exercise `ghIssueLabelReader` directly onto `createOrderingSource(...).readFacts`, keeping each one's argv, 404, cross-repo-parsing and real-`gh` assertions and mapping expected label lists to the equivalent facts: the `ghIssueLabelReader — GitHub issue label fetcher via gh REST API` describe block in `src/conductor/test/backlog-priority.test.ts`, `src/conductor/test/backlog-priority.smoke.test.ts`, and Flow F in `src/conductor/test/acceptance/daemon-issue-priority-scheduling.test.ts`. Replace the `IssueLabelReader` type import in `src/conductor/test/engine/monitor/ordering.test.ts` with `OrderingSource`.
3. Delete `ghIssueLabelReader` and the `IssueLabelReader` type from `src/conductor/src/engine/backlog-priority.ts`, keeping `parsePriorityLabels`, `parseSizeLabel`, `orderBacklog`, `PRIORITY_BAND_RANK` and `createPriorityResolver`. Delete the `BlockerRunner` alias from `src/conductor/src/engine/blocker-resolver.ts`. Update stale comments that name them (for example in `daemon-backlog.ts`).
4. Run the conductor typecheck and the scoped tests named below; commit.

**Done when:**
- `backlog-priority.ts` exports `parsePriorityLabels`, `parseSizeLabel`, `orderBacklog`, `PRIORITY_BAND_RANK` and `createPriorityResolver`, and no longer declares `ghIssueLabelReader` or `IssueLabelReader`; `blocker-resolver.ts` no longer declares `BlockerRunner`.
- The conductor TypeScript typecheck passes, the retargeted `ghIssueLabelReader` cases in `backlog-priority.test.ts`, `backlog-priority.smoke.test.ts` and Flow F of `daemon-issue-priority-scheduling.test.ts` assert the same argv, 404 and cross-repo outcomes through `createOrderingSource`, and `blocker-resolver.test.ts`, `dependency-claim.test.ts`, `ordering-source.test.ts` and `daemon-ordering-readers.test.ts` pass after the removal.

**Files:** src/conductor/src/engine/backlog-priority.ts; src/conductor/src/engine/blocker-resolver.ts; src/conductor/src/engine/daemon-backlog.ts; src/conductor/test/backlog-priority.test.ts; src/conductor/test/backlog-priority.smoke.test.ts; src/conductor/test/acceptance/daemon-issue-priority-scheduling.test.ts; src/conductor/test/engine/monitor/ordering.test.ts

**Dependencies:** Tasks 6, 8, 9, 10, 11

## Task Dependency Graph

```text
1 → 2 → 3 → {4, 5, 6}
1 → 7
{4, 5, 7} → 8
{5, 6, 7} → 9
{5, 7} → 10
{4, 7} → 11
{6, 8, 9, 10, 11} → 12
```

## Integration Points

- After Task 3: the port can be exercised end to end for GitHub and Jira references with a fake runner.
- After Task 8: a daemon discovery pass orders, gates, and reports Jira-linked specs through the shared source, and the event reaches `events.jsonl`.
- After Tasks 9 to 11: every production ordering consumer reads through the source.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-backend-neutral-ordering-source#D1 | task | task-1, task-7 | `src/conductor/src/engine/ordering-source.ts` imports `GhRunner` from `./tracker-client.js` and declares no runner-shaped type, and `test/tracker-client-canonical-gate.test.ts` passes unchanged. |
| adr-2026-10-10-backend-neutral-ordering-source#D2 | task | task-1, task-2, task-3 | [test] `readFacts(['PROJ-123'])` returns `'unavailable'` for `PROJ-123` and `readBlockers('PROJ-123')` returns `'unavailable'`, carrying no priority or size, and the runner that fails the test when called is never called. |
| adr-2026-10-10-backend-neutral-ordering-source#D3 | task | task-1, task-2 | [test] `createOrderingSource(...).readFacts` for an issue labeled `priority: high` and `size: M` returns `{ priority: 'high', size: 'M' }` and the fake runner received exactly `['api', 'repos/<owner>/<repo>/issues/<n>']`, the argv `ghIssueLabelReader` sends today. |
| adr-2026-10-10-backend-neutral-ordering-source#D4 | task | task-3, task-8 | [test] The first unavailable outcome for `PROJ-123` emits exactly one event `{ type: 'tracker_backend_unavailable', project: 'PROJ-123', backend: 'jira', reason: 'no-adapter' }`, and further `readFacts` and `readBlockers` calls for `PROJ-123` on the same source instance emit no further events. |
| adr-2026-10-10-backend-neutral-ordering-source#D5 | task | task-4, task-5 | [test] A pass mixing a `PROJ-123` item with GitHub items returns `{ mode: 'banded' }`, bands `PROJ-123` `unlabeled`, keeps every GitHub item's band, logs no outage warning, and a second local scan does not re-read `PROJ-123`. |
| adr-2026-10-10-backend-neutral-ordering-source#D6 | task | task-8, task-9, task-10, task-11 | `daemon-cli.ts` builds its priority resolver and per-scan blocker resolver only through `createDaemonOrderingReaders`, `gh-blocker-runner.ts` no longer exists, the real-gh smoke block in `blocker-resolver.test.ts` drives `createOrderingSource` with its assertions unchanged, and the existing `daemon-render.test.ts` case rendering `tracker_backend_unavailable` into the daemon log passes unchanged. |
| adr-2026-10-10-backend-neutral-ordering-source#D7 | task | task-5 | `BlockerVerdict` in `blocker-resolver.ts` keeps exactly the kinds `unblocked`, `blocked`, `indeterminate` and `cycle` with `IssueRef { repo, number }` elements, and `resolveUncached` switches over the `readBlockers` outcome with no `default` branch. |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon backlog item whose sourceRef is a GitHub issue labeled `priority: high`, when a discovery pass resolves priorities, then the item is banded `high` and is ordered after `critical` items and before `medium` items, exactly as before this change. | 4, 8 | "[test] The existing `backlog-priority.test.ts`, `daemon-cli-priority-wiring.test.ts`, `daemon-issue-priority-scheduling.test.ts`, `monitor/ordering.test.ts` and `backlog-priority.smoke.test.ts` cases pass with only their resolver construction changed, proving `createPriorityResolver` still bands a `priority: high` GitHub item `high` between `critical` and `medium`, reuses its cached band on a later `refresh: false` scan with no new read, gives an item with no sourceRef the `no-issue` band with no read, bands a 404 ref `unlabeled` with the pass still banded and zero outage warnings, and bands a GitHub issue whose only labels are `Priority: High` and `priority:high` `unlabeled`." | diff-local |
| Story 1 happy: Given a GitHub issue that carries both `priority: low` and `priority: critical`, when its priority is resolved, then the highest band, `critical`, is used. | 1 | "[test] `readFacts` for an issue labeled `priority: low`, `priority: critical`, `size: S` and `size: L` returns priority `critical` (highest band wins) and size `L` (largest wins), both computed by the existing `parsePriorityLabels` and `parseSizeLabel`." | diff-local |
| Story 1 happy: Given a GitHub issue already read on an earlier local scan in the same daemon run, when a later local (`refresh: false`) scan resolves priorities, then no new GitHub read is made for that issue and its cached band is reused. | 4 | "[test] The existing `backlog-priority.test.ts`, `daemon-cli-priority-wiring.test.ts`, `daemon-issue-priority-scheduling.test.ts`, `monitor/ordering.test.ts` and `backlog-priority.smoke.test.ts` cases pass with only their resolver construction changed, proving `createPriorityResolver` still bands a `priority: high` GitHub item `high` between `critical` and `medium`, reuses its cached band on a later `refresh: false` scan with no new read, gives an item with no sourceRef the `no-issue` band with no read, bands a 404 ref `unlabeled` with the pass still banded and zero outage warnings, and bands a GitHub issue whose only labels are `Priority: High` and `priority:high` `unlabeled`." | diff-local |
| Story 1 happy: Given an item with no sourceRef, when priorities are resolved, then the item takes the `no-issue` band with no tracker read. | 4 | "[test] The existing `backlog-priority.test.ts`, `daemon-cli-priority-wiring.test.ts`, `daemon-issue-priority-scheduling.test.ts`, `monitor/ordering.test.ts` and `backlog-priority.smoke.test.ts` cases pass with only their resolver construction changed, proving `createPriorityResolver` still bands a `priority: high` GitHub item `high` between `critical` and `medium`, reuses its cached band on a later `refresh: false` scan with no new read, gives an item with no sourceRef the `no-issue` band with no read, bands a 404 ref `unlabeled` with the pass still banded and zero outage warnings, and bands a GitHub issue whose only labels are `Priority: High` and `priority:high` `unlabeled`." | diff-local |
| Story 1 negative: Given a GitHub sourceRef whose issue returns HTTP 404, when priorities are resolved, then that item bands `unlabeled`, the pass stays banded rather than falling back, and no outage warning is logged. | 4, 1 | "[test] The existing `backlog-priority.test.ts`, `daemon-cli-priority-wiring.test.ts`, `daemon-issue-priority-scheduling.test.ts`, `monitor/ordering.test.ts` and `backlog-priority.smoke.test.ts` cases pass with only their resolver construction changed, proving `createPriorityResolver` still bands a `priority: high` GitHub item `high` between `critical` and `medium`, reuses its cached band on a later `refresh: false` scan with no new read, gives an item with no sourceRef the `no-issue` band with no read, bands a 404 ref `unlabeled` with the pass still banded and zero outage warnings, and bands a GitHub issue whose only labels are `Priority: High` and `priority:high` `unlabeled`." | diff-local |
| Story 1 negative: Given a GitHub issue with no label matching `priority: critical`, `priority: high`, `priority: medium`, or `priority: low` (for example `Priority: High` or `priority:high`), when its priority is resolved, then the item bands `unlabeled`. | 1, 4 | "[test] The existing `backlog-priority.test.ts`, `daemon-cli-priority-wiring.test.ts`, `daemon-issue-priority-scheduling.test.ts`, `monitor/ordering.test.ts` and `backlog-priority.smoke.test.ts` cases pass with only their resolver construction changed, proving `createPriorityResolver` still bands a `priority: high` GitHub item `high` between `critical` and `medium`, reuses its cached band on a later `refresh: false` scan with no new read, gives an item with no sourceRef the `no-issue` band with no read, bands a 404 ref `unlabeled` with the pass still banded and zero outage warnings, and bands a GitHub issue whose only labels are `Priority: High` and `priority:high` `unlabeled`." | diff-local |
| Story 1 negative: Given the GitHub label read fails with a non-404 transport or auth error during a pass, when priorities are resolved, then the whole pass returns fallback (date) ordering, the cache is cleared, and exactly one outage warning is logged for that outage episode. | 4, 1 | "[test] The existing outage cases pass unchanged: a non-404 read failure makes `createPriorityResolver` return `{ mode: 'fallback' }` with cleared cache and exactly one warning, a later local scan during the outage returns fallback with no further reads, and after a successful refresh the next failure logs one new warning." | diff-local |
| Story 1 negative: Given an outage is in progress, when a later local scan runs before any successful refresh, then that scan also returns fallback ordering and makes no further GitHub label reads. | 4 | "[test] The existing outage cases pass unchanged: a non-404 read failure makes `createPriorityResolver` return `{ mode: 'fallback' }` with cleared cache and exactly one warning, a later local scan during the outage returns fallback with no further reads, and after a successful refresh the next failure logs one new warning." | diff-local |
| Story 1 negative: Given an outage was followed by a successful refresh scan, when the next GitHub read fails again, then a new outage warning is logged once. | 4 | "[test] The existing outage cases pass unchanged: a non-404 read failure makes `createPriorityResolver` return `{ mode: 'fallback' }` with cleared cache and exactly one warning, a later local scan during the outage returns fallback with no further reads, and after a successful refresh the next failure logs one new warning." | diff-local |
| Story 2 happy: Given a GitHub issue whose blocked_by list contains one open issue, when its blocker verdict is resolved, then the verdict is `blocked` and names that issue as `owner/repo` plus number. | 5, 2 | "[test] The existing `blocker-resolver.test.ts` cases pass with only construction changed, proving `createBlockerResolver` returns `blocked` naming `acme/app` number `7` for one open blocker, `unblocked` for an empty or all-closed `blocked_by` list, and `indeterminate` carrying the error detail for a read failure and the `unparseable blocked_by response` detail for a non-JSON body." | diff-local |
| Story 2 happy: Given a GitHub issue whose blocked_by list is empty, or contains only closed issues of any close reason, when its blocker verdict is resolved, then the verdict is `unblocked`. | 5, 2 | "[test] The existing `blocker-resolver.test.ts` cases pass with only construction changed, proving `createBlockerResolver` returns `blocked` naming `acme/app` number `7` for one open blocker, `unblocked` for an empty or all-closed `blocked_by` list, and `indeterminate` carrying the error detail for a read failure and the `unparseable blocked_by response` detail for a non-JSON body." | diff-local |
| Story 2 happy: Given two GitHub issues that each list the other as an open blocker, when either is resolved, then the verdict is `cycle` naming both members, and resolving the other member in the same pass returns the same cycle verdict. | 5 | "[test] The existing cycle cases pass unchanged: two GitHub issues blocking each other resolve `cycle` naming both members, resolving the other member in the same resolver returns the same cycle verdict, and resolving one ref twice in a resolver makes one `readBlockers` call." | diff-local |
| Story 2 happy: Given the same GitHub issue is resolved twice within one pass, when the second resolution runs, then it returns the memoized verdict without a second tracker read. | 5 | "[test] The existing cycle cases pass unchanged: two GitHub issues blocking each other resolve `cycle` naming both members, resolving the other member in the same resolver returns the same cycle verdict, and resolving one ref twice in a resolver makes one `readBlockers` call." | diff-local |
| Story 2 negative: Given the blocked_by read fails with a network or API error, when the verdict is resolved, then the verdict is `indeterminate` carrying the error detail, and the scan continues with the other items. | 5, 2, 8 | "[test] The `PROJ-123` spec is reported in the pass's WAITING list with an `indeterminate` reason naming the missing Jira adapter and the `boom` spec is reported WAITING with an `indeterminate` reason carrying `boom`; neither is returned as a dispatchable item, while the other two specs are still discovered and ordered in that same pass, the same handling today's `dependency-ordered-intake-and-dispatch` acceptance tests assert for an indeterminate verdict." | diff-local |
| Story 2 negative: Given the blocked_by read returns a body that is not valid JSON, when the verdict is resolved, then the verdict is `indeterminate` with an `unparseable blocked_by response` detail. | 5, 2 | "[test] The existing `blocker-resolver.test.ts` cases pass with only construction changed, proving `createBlockerResolver` returns `blocked` naming `acme/app` number `7` for one open blocker, `unblocked` for an empty or all-closed `blocked_by` list, and `indeterminate` carrying the error detail for a read failure and the `unparseable blocked_by response` detail for a non-JSON body." | diff-local |
| Story 2 negative: Given a sourceRef that is neither a GitHub reference nor a Jira key (for example `not-a-ref`), when its verdict is resolved, then the verdict is `indeterminate` and no tracker read or backend-unavailable event occurs. | 2, 5 | "[test] `readBlockers('not-a-ref')` returns `{ indeterminate: 'unparseable sourceRef: not-a-ref' }` without calling the runner and without emitting any event." | diff-local |
| Story 2 negative: Given a blocker resolver from a previous daemon scan, when a new scan begins, then that scan uses a fresh memo and never returns an earlier scan's verdict. | 8 | "[test] Each `makeResolver()` call returns a distinct resolver whose memo is empty, so a verdict cached in one pass is not returned by the next pass's resolver." | diff-local |
| Story 3 happy: Given items being priority-ordered that include one whose sourceRef is the Jira key `PROJ-123` and no Jira ordering backend is registered, when priorities are resolved, then the `PROJ-123` item bands `unlabeled`, the other items keep their bands, and the resolution stays banded. | 4 | "[test] A pass mixing a `PROJ-123` item with GitHub items returns `{ mode: 'banded' }`, bands `PROJ-123` `unlabeled`, keeps every GitHub item's band, logs no outage warning, and a second local scan does not re-read `PROJ-123`." | diff-local |
| Story 3 happy: Given a daemon backlog spec linked to the Jira key `PROJ-123`, when a discovery pass resolves its ordering facts, then one `tracker_backend_unavailable` event is emitted with `backend: jira`, `reason: no-adapter`, and `project: PROJ-123`, and it is persisted to `.pipeline/events.jsonl` and rendered in the daemon log. | 8, 3 | "[test] After the three passes, `<tmp>/.pipeline/events.jsonl` written by `EventPersister` holds exactly one `tracker_backend_unavailable` record with `project: 'PROJ-123'`, `backend: 'jira'` and `reason: 'no-adapter'`, counting both priority and blocker resolution, and the fake runner recorded no argv naming `PROJ-123`." | diff-local |
| Story 3 happy: Given a Jira-linked item, when its priority is resolved, then no GitHub or other tracker network read is made for it. | 3, 8 | "[test] `readFacts(['PROJ-123'])` returns `'unavailable'` for `PROJ-123` and `readBlockers('PROJ-123')` returns `'unavailable'`, carrying no priority or size, and the runner that fails the test when called is never called." | diff-local |
| Story 3 negative: Given the same Jira-linked spec stays in the daemon backlog across many discovery passes in one daemon run, when each pass resolves its ordering facts, then `tracker_backend_unavailable` for `PROJ-123` is emitted at most once in that daemon run. | 8 | "[test] After the three passes, `<tmp>/.pipeline/events.jsonl` written by `EventPersister` holds exactly one `tracker_backend_unavailable` record with `project: 'PROJ-123'`, `backend: 'jira'` and `reason: 'no-adapter'`, counting both priority and blocker resolution, and the fake runner recorded no argv naming `PROJ-123`." | diff-local |
| Story 3 negative: Given two different Jira-linked items `PROJ-1` and `PROJ-2`, when priorities are resolved, then one event is emitted for each key, and neither suppresses the other. | 3 | "[test] Reading `PROJ-1` and `PROJ-2` from one source emits one `tracker_backend_unavailable` event for each key, and neither key's event suppresses the other's." | diff-local |
| Story 3 negative: Given a Jira-linked item and a GitHub label outage in the same pass, when priorities are resolved, then the pass falls back exactly as an all-GitHub outage would, and the Jira item alone never causes a fallback or an outage warning. | 4 | "[test] A pass mixing a `PROJ-123` item with a GitHub read that throws returns `{ mode: 'fallback' }` with exactly one warning, the same as an all-GitHub outage, while a pass with only `PROJ-123` and no throw stays banded with zero warnings." | diff-local |
| Story 3 negative: Given a consumer that runs without an event emitter, when a Jira-linked reference is resolved, then the reference still resolves as unavailable (`unlabeled` band) and the consumer does not throw. | 3 | "[test] A source created without an `events` dependency returns `'unavailable'` for `PROJ-123` from both `readFacts` and `readBlockers` without throwing." | diff-local |
| Story 4 happy: Given a backlog item whose sourceRef is `PROJ-123` and no Jira backend is registered, when its blocker verdict is resolved, then the verdict is `indeterminate` and its detail names the missing Jira adapter. | 5 | "[test] `resolve('PROJ-123')` returns `{ kind: 'indeterminate' }` whose detail is `no ordering adapter for jira reference PROJ-123`, and `resolve('not-a-ref')` returns `indeterminate` with no event emitted by its source." | diff-local |
| Story 4 happy: Given the daemon rebuilds its blocker resolver every scan, when `PROJ-123` is resolved on several scans of one daemon run, then at most one `tracker_backend_unavailable` event for `PROJ-123` is emitted across priority and blocker resolution combined. | 8 | "[test] After the three passes, `<tmp>/.pipeline/events.jsonl` written by `EventPersister` holds exactly one `tracker_backend_unavailable` record with `project: 'PROJ-123'`, `backend: 'jira'` and `reason: 'no-adapter'`, counting both priority and blocker resolution, and the fake runner recorded no argv naming `PROJ-123`." | diff-local |
| Story 4 negative: Given a GitHub issue whose open blocker's own blocker lookup resolves `indeterminate`, when the cycle walk runs, then the walk stops at that blocker without error and the start issue's verdict is `blocked`, as today. | 5 | "[test] A GitHub issue whose single open blocker's own `readBlockers` returns `{ indeterminate }` resolves `blocked` naming that blocker, and the cycle walk completes without throwing." | diff-local |
| Story 4 negative: Given a Jira-linked item resolves `indeterminate`, when the daemon decides eligibility, then the item is handled exactly as any other `indeterminate` verdict is handled today, with no new state or retry loop. | 8 | "[test] The `PROJ-123` spec is reported in the pass's WAITING list with an `indeterminate` reason naming the missing Jira adapter and the `boom` spec is reported WAITING with an `indeterminate` reason carrying `boom`; neither is returned as a dispatchable item, while the other two specs are still discovered and ordered in that same pass, the same handling today's `dependency-ordered-intake-and-dispatch` acceptance tests assert for an indeterminate verdict." | diff-local |
| Story 5 happy: Given pending intake ideas linked to GitHub issues labeled `priority: critical` and `priority: low`, when `ai-conductor compose claim` runs, then the `critical` idea is claimed first, exactly as before this change. | 9, 6 | "[test] Running the claim command with pending ideas linked to `priority: critical` and `priority: low` GitHub issues claims the `critical` idea first, as the unchanged existing claim tests also assert." | diff-local |
| Story 5 happy: Given a pending intake idea linked to a Jira key, received before another linked to an unlabeled GitHub issue, when `compose claim` runs, then both band `unlabeled` and the GitHub idea is claimed, because the Jira idea's dependency verdict is `indeterminate` and the claim walk defers it. | 9, 6 | "[test] Running the claim command with a `PROJ-9` idea received before an unlabeled GitHub idea bands both `unlabeled` through `resolveClaimBands` and claims the GitHub idea, because the blocker resolver returns `indeterminate` for `PROJ-9` and `claimUnblocked` defers it." | diff-local |
| Story 5 happy: Given `ai-conductor overlap-scan` and the land-time coherence advisory overlap check run for a GitHub-linked spec, when they resolve blockers, then their reports are identical to before this change. | 10 | "[test] The existing `overlap-scan-cli.test.ts` real-dispatch case and the `advisoryDuplicateClaimWarn` cases in `coherence-validator.test.ts` produce byte-identical reports with the resolver now built through `createOrderingSource`." | diff-local |
| Story 5 negative: Given the GitHub label read throws during `compose claim`, when the claim runs, then exactly one warning is logged for that claim and the ideas are claimed in received-time FIFO order, never failing or emptying the claim. | 6 | "[test] The existing `dependency-claim.test.ts` cases pass with only construction changed, proving `claimUnblocked` with `resolveClaimBands` claims a `priority: critical` entry before a `priority: low` one and, when the source's `readFacts` throws, logs exactly one warning and claims in received-time FIFO order without failing or returning empty." | diff-local |
| Story 5 negative: Given the coherence advisory overlap check runs without a GitHub runner available, when land validates the spec, then the advisory check is skipped exactly as today and land does not fail because of it. | 10 | "[test] Coherence validation with no `gh` runner injected skips the advisory overlap check, makes no `readBlockers` call, and the land validation result does not fail because of the skipped check." | diff-local |
| Story 5 negative: Given a Jira-linked intake idea, when `compose claim` evaluates its dependencies, then its verdict is `indeterminate`, and it is treated exactly as today's `indeterminate` verdicts are in the claim walk. | 9 | "[test] Running the claim command with a `PROJ-9` idea and an unblocked GitHub idea claims the GitHub idea and defers the `PROJ-9` idea, which `claimUnblocked` receives as an `indeterminate` verdict, exactly as existing claim tests treat an indeterminate verdict." | diff-local |
| Story 6 happy: Given a GitHub issue labeled `size: M`, when its facts are read through the ordering source, then size is `M`. | 1 | "[test] `createOrderingSource(...).readFacts` for an issue labeled `priority: high` and `size: M` returns `{ priority: 'high', size: 'M' }` and the fake runner received exactly `['api', 'repos/<owner>/<repo>/issues/<n>']`, the argv `ghIssueLabelReader` sends today." | diff-local |
| Story 6 happy: Given a GitHub issue labeled both `size: S` and `size: L`, when its facts are read, then size is `L` (largest wins). | 1 | "[test] `readFacts` for an issue labeled `priority: low`, `priority: critical`, `size: S` and `size: L` returns priority `critical` (highest band wins) and size `L` (largest wins), both computed by the existing `parsePriorityLabels` and `parseSizeLabel`." | diff-local |
| Story 6 negative: Given a GitHub issue with no label matching `size: S`, `size: M`, or `size: L` (for example `size: XL` or `Size: M`), when its facts are read, then size is absent and priority is still reported. | 1 | "[test] `readFacts` for an issue whose only labels are `Priority: High`, `priority:high`, `size: XL` and `Size: M` returns `{ priority: undefined, size: undefined }`, so size is absent while the priority outcome is still reported in the same facts record." | diff-local |
| Story 6 negative: Given a Jira-linked reference, when its facts are read, then the result is unavailable and carries no size. | 3 | "[test] `readFacts(['PROJ-123'])` returns `'unavailable'` for `PROJ-123` and `readBlockers('PROJ-123')` returns `'unavailable'`, carrying no priority or size, and the runner that fails the test when called is never called." | diff-local |
| Story 6 negative: Given any size value, when the daemon orders its backlog, then ordering is unchanged by size because no ordering rule reads it. | 4 | "[test] `orderBacklog` over `createPriorityResolver` results gives the identical item order for a backlog whose issues carry `size: S` and `size: L` labels and for the same backlog without size labels." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
