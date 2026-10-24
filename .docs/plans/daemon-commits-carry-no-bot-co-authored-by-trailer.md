# Implementation Plan: Daemon commits carry the bot co-author trailer under every executor isolation mode

**Date:** 2026-10-24
**Design:** [architecture review](../decisions/architecture-review-2026-10-24-daemon-commits-carry-no-bot-co-authored-by-trailer.md) (technical track, no PRD)
**Stories:** .docs/stories/daemon-commits-carry-no-bot-co-authored-by-trailer.md
**Conflict check:** Clean as of 2026-10-24
**Source:** jstoup111/ai-conductor#3377

## Summary

This plan restores the bot `Co-authored-by` trailer on daemon commits under the default
`executor_isolation: child`. One shared daemon-process bootstrap installs the co-author resolver in
both daemon entry points, and a daemon dispatch that finds no resolver installed emits a closed
`resolver-absent` skip event instead of failing silently. The work is seven tasks.

## Technical Approach

- **Closed reason.** `bot_co_author_skipped.reason` in `src/conductor/src/types/events.ts` gains
  `'resolver-absent'`. `formatBotCoAuthorSkipped` in `src/conductor/src/engine/bot-co-author.ts`
  stays an exhaustive switch with no default branch, and adds the rendered text
  `bot co-author skipped: resolver not installed for daemon dispatch`. The existing
  `bot_co_author_skipped` case in `daemon-cli.ts` renders it into `daemon.log` unchanged.
- **Dispatch-aware refresh.** `refreshWorktreeCoAuthor(worktreePath, events, options?)` gains an
  optional `{ dispatch?: boolean }`. When `dispatch` is true and no resolver is installed, it emits
  exactly `{ type: 'bot_co_author_skipped', reason: 'resolver-absent' }` on `events` after the
  existing stale-file removal, writes no co-author file, and returns. `prepareWorktree` in
  `src/conductor/src/engine/worktree-prepare.ts` passes `{ dispatch: opts?.dispatchStart === true }`.
  `dispatchStart: true` is passed only by daemon paths (`daemon-deps.ts`, the `daemon-cli.ts`
  triage helper, and the two `executor-child-runtime.ts` calls; verified), so operator-run
  preparation stays silent. `ConductorEventEmitter.emit` already swallows handler errors (verified,
  `src/conductor/src/ui/events.ts`), so a failing subscriber cannot stop setup.
  `withDaemonCoAuthorTrailer` is unchanged: with no resolver it returns the message unchanged and
  emits nothing.
- **Shared bootstrap.** A new module, `src/conductor/src/engine/daemon-process-bootstrap.ts`,
  exports `installDaemonProcessServices({ projectRoot, events, runner?, readCredential?, readToken? })`.
  It calls `installDaemonBotCoAuthor(createBotCoAuthorResolver({ runner: runner ?? makeProductionGh(), cwd: projectRoot, events, readCredential, readToken }))`.
  The optional parameters exist only so tests can fake the GitHub and credential boundary; production
  callers pass only `projectRoot` and `events`. `runDaemonMode` in `daemon-cli.ts` replaces its
  inline install with one call, keeping the current position: after the daemon `events` emitter is
  created and before `makeRunFeature(`.
- **Child entry composition.** `src/conductor/src/engine/executor-child-runtime.ts` exports
  `makeExecutorChildRun({ projectRoot, runFeature?, githubBoundary? })`. `runFeature` defaults to
  `runExecutorChildFeature`. `githubBoundary` holds the optional `runner`, `readCredential` and
  `readToken` test fakes, passed straight through to the bootstrap. It returns the `run(input)`
  callback, which first calls
  `installDaemonProcessServices({ projectRoot, events: input.events, ...githubBoundary })` directly
  (the bootstrap is never injected) and then calls `runFeature` with the same arguments `index.ts`
  builds today: worktree path, leaf branch, `projectRoot`, and `supervisorEngineVersionId`. The
  `executor-child` branch of `index.ts` uses `run: makeExecutorChildRun({ projectRoot })`.
  `input.events` is the per-order bus that `executor-child.ts` persists to the worktree
  `.pipeline/events.jsonl` and forwards over IPC as `{ kind: 'event', scope: 'feature', payload }`.
- **Supervisor relay and render (existing machinery, newly pinned).** `executor-broker.ts` re-emits a
  forwarded `feature`-scoped event that is in `EVENT_SINKS` on that feature's supervisor bus. In
  `runDaemonMode`, `attachFeatureEventRenderer` subscribes `renderDaemonEvent` to every
  `renderedEventTypes()` type on that bus and writes each line through `featureLogFor(slug)` into
  `.daemon/daemon.log`. The in-process daemon bus renders through the same `renderDaemonEvent`.
  `bot_co_author_skipped` is declared `render: true` in `event-sinks.ts`.
- **Wiring guard.** `src/conductor/test/engine/daemon-bot-co-author-wiring.test.ts` is rewritten.
  `installDaemonBotCoAuthor(` may appear only in `bot-co-author.ts` (its definition) and
  `daemon-process-bootstrap.ts`. `installDaemonProcessServices(` must be called exactly once from
  `daemon-cli.ts`, before `makeRunFeature(`, and exactly once from `executor-child-runtime.ts`, inside
  `makeExecutorChildRun` and before its `runFeature(` call. No other `src/` file may call it. Each
  failure message names the offending or missing file.
- **Local pattern: daemon-only process wiring.** The precedent is the current inline install in
  `runDaemonMode`. Preserve these traits: install once per process, before any dispatch work, from
  a daemon entry point only, bound to that process's event bus, and pinned by a static wiring test.
  Allowed variation: the call goes through the bootstrap, and the child binds its per-order feature
  bus. Search hints: `installDaemonBotCoAuthor`, `runDaemonMode`, `dispatchCliCommand`,
  `executor-child`, `daemon-bot-co-author-wiring`.
- **Test harnesses to reuse.** For real-git preparation, use the temp-repo setup in
  `src/conductor/test/engine/worktree-prepare-co-author.test.ts`: `git init`, operator identity,
  and an installed-resolver reset in `afterEach`. For the child path, use the `FakePort`,
  `runExecutorChild`, and `withExecutorBrokerProxies` harness in
  `src/conductor/test/engine/executor-child.test.ts`. Pass `dispatchStart` together with
  `dispatchStartTimeoutSeconds`, as production does (`daemon-cli.ts` documents them as a matched pair).
- **Sequencing.** Tasks 1 and 3 can start immediately: Task 1 adds the reason and Task 3 the
  bootstrap. Task 2 adds the dispatch-aware refresh that uses the reason, and Task 7 pins the
  supervisor relay and render once the reason exists. Task 4 composes the child on the bootstrap
  with the resolved path, and Task 6 adds the child's skip and unconfigured paths. Task 5 pins both
  entry points.

## Prerequisites

- None. #2839 shipped the resolver, hook stamp, and engine commit helper; #3306 made child isolation the default.

## Tasks

### Task 1: Add the closed `resolver-absent` skip reason and its rendering
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/engine/bot-co-author.test.ts`: `formatBotCoAuthorSkipped({ type: 'bot_co_author_skipped', reason: 'resolver-absent' })` returns `bot co-author skipped: resolver not installed for daemon dispatch`, and each of the three existing reasons still returns its current text.
2. Verify RED (type error or wrong text).
3. Implement: add `'resolver-absent'` to the reason union in `src/conductor/src/types/events.ts` and a matching `case` in `formatBotCoAuthorSkipped`, keeping the switch exhaustive with no default branch.
4. Verify GREEN.
5. Commit: "feat(co-author): add closed resolver-absent skip reason".

**Done when:**
- [test] The formatter test asserts `formatBotCoAuthorSkipped` renders `resolver-absent` as `bot co-author skipped: resolver not installed for daemon dispatch` and leaves the three existing reasons' text unchanged.
- The `bot_co_author_skipped` reason union in `types/events.ts` is exactly `token-unavailable`, `identity-read-failed`, `worktree-write-failed`, `resolver-absent`, and `formatBotCoAuthorSkipped` has no `default` branch.

**Files likely touched:**
- src/conductor/src/types/events.ts — add the reason
- src/conductor/src/engine/bot-co-author.ts — formatter case
- src/conductor/test/engine/bot-co-author.test.ts — formatter test

**Dependencies:** none

### Task 2: Emit `resolver-absent` when daemon dispatch prepares a worktree with no resolver
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/worktree-prepare-co-author.test.ts`, using the real temp git repo and `installDaemonBotCoAuthor(undefined)`:
   - dispatch preparation (`dispatchStart: true` plus `dispatchStartTimeoutSeconds`) with a pre-existing stale `.pipeline/co-author` file and a recording `ConductorEventEmitter`;
   - non-dispatch preparation (no `dispatchStart`);
   - dispatch preparation whose event handler throws;
   - after a dispatch preparation that started with a stale `.pipeline/co-author` file, a real `git commit --allow-empty -m "<withDaemonCoAuthorTrailer('engine commit')>"` in that repo, with an event recorder still attached.
2. Verify RED (no event is emitted today).
3. Implement: add the optional `{ dispatch?: boolean }` parameter to `refreshWorktreeCoAuthor`. When `dispatch` is true and `daemonBotCoAuthorResolver()` is undefined, emit `{ type: 'bot_co_author_skipped', reason: 'resolver-absent' }` through `events.emit` after the stale-file removal, then return. `prepareWorktree` passes `{ dispatch: opts?.dispatchStart === true }`.
4. Verify GREEN, including the existing tests in that file.
5. Commit: "fix(co-author): surface an absent resolver at daemon dispatch".

**Done when:**
- [test] With no resolver installed, `prepareWorktree` with `dispatchStart: true` emits exactly one event deep-equal to `{ type: 'bot_co_author_skipped', reason: 'resolver-absent' }`, the stale `.pipeline/co-author` file no longer exists, and `prepareWorktree` resolves through to its setup stage.
- [test] With no resolver installed, `prepareWorktree` without `dispatchStart` emits no `bot_co_author_skipped` event and leaves no `.pipeline/co-author` file.
- [test] With no resolver installed and a `bot_co_author_skipped` handler that throws, `prepareWorktree` with `dispatchStart: true` still resolves, and `.pipeline/co-author` is absent.
- [test] After a dispatch preparation that removed a stale co-author file, `withDaemonCoAuthorTrailer('engine commit')` returns `'engine commit'` byte-identical, a real `git commit` with that message exits 0, its recorded message contains no `Co-authored-by` trailer, and the recorder sees no additional `bot_co_author_skipped` event.

**Files likely touched:**
- src/conductor/src/engine/bot-co-author.ts — dispatch-aware `refreshWorktreeCoAuthor`
- src/conductor/src/engine/worktree-prepare.ts — pass the dispatch flag
- src/conductor/test/engine/worktree-prepare-co-author.test.ts — absent-resolver tests

**Dependencies:** Task 1

### Task 3: Install the resolver through one shared daemon-process bootstrap in the supervisor
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/daemon-process-bootstrap.test.ts`, using the real temp git repo from `worktree-prepare-co-author.test.ts`. Call `installDaemonProcessServices({ projectRoot, events, runner, readCredential, readToken })`, where only the GitHub runner and credential readers are faked: the runner returns `{"login":"example-bot","id":42}` for `api user`. Then run `prepareWorktree` with `dispatchStart: true` and a real `git commit` in the repo (the installed hook stamps). Cover three cases:
   - resolved identity: assert the `.pipeline/co-author` content and the commit's trailers and author;
   - `readToken` returns `unavailable`: pass a separate feature-scoped emitter as `prepareWorktree`'s `events`, and assert the event on that feature bus, no co-author file, and no trailer;
   - `readCredential` returns `unconfigured`: assert no file, no event, and no trailer.
2. Verify RED (module does not exist).
3. Implement `src/conductor/src/engine/daemon-process-bootstrap.ts` as described in Technical Approach. Replace the inline `installDaemonBotCoAuthor(createBotCoAuthorResolver(...))` in `runDaemonMode` (`src/conductor/src/daemon-cli.ts`) with `installDaemonProcessServices({ projectRoot, events })` at the same position, and drop imports the change makes unused. Pattern traits to keep: one install per process, before any dispatch work, bound to the daemon `events` bus that the supervisor renders into `daemon.log`.
4. Verify GREEN.
5. Commit: "refactor(daemon): install co-author resolver via shared daemon-process bootstrap".

**Done when:**
- [test] After `installDaemonProcessServices` with an identity of `example-bot`/`42`, dispatch `prepareWorktree` writes `.pipeline/co-author` containing exactly `Co-authored-by: example-bot <42+example-bot@users.noreply.github.com>`, and a subsequent `git commit` carries that trailer exactly once with author `Operator <operator@example.com>`.
- [test] With `readToken` returning unavailable, dispatch `prepareWorktree` given a separate feature-scoped `ConductorEventEmitter` (the in-process feature bus whose persister writes the worktree `.pipeline/events.jsonl`) makes the bootstrap-installed resolver emit exactly one `{ type: 'bot_co_author_skipped', reason: 'token-unavailable' }` on that feature bus, no `.pipeline/co-author` file is written, and the commit carries no bot trailer.
- [test] With `readCredential` returning unconfigured, dispatch `prepareWorktree` writes no `.pipeline/co-author` file, emits no `bot_co_author_skipped` event, and the commit message carries no `Co-authored-by` trailer for the bot.
- `runDaemonMode` in `daemon-cli.ts` calls `installDaemonProcessServices({ projectRoot, events })` after `const events = new ConductorEventEmitter();` and before `makeRunFeature(`, and contains no direct `installDaemonBotCoAuthor(` call.

**Files likely touched:**
- src/conductor/src/engine/daemon-process-bootstrap.ts — new bootstrap
- src/conductor/src/daemon-cli.ts — call the bootstrap
- src/conductor/test/engine/daemon-process-bootstrap.test.ts — bootstrap and in-process tests

**Dependencies:** none

### Task 4: Bootstrap daemon-process services in the executor child before its feature run
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/executor-child.test.ts` that drive `runExecutorChild(port, withExecutorBrokerProxies(port, { …, run: makeExecutorChildRun({ projectRoot, githubBoundary, runFeature }) }))` with `FakePort`.
   - `githubBoundary` fakes only the GitHub runner, which returns `{"login":"example-bot","id":42}` for `api user`, and the credential readers. The real `installDaemonProcessServices` runs inside `makeExecutorChildRun`, and no resolver is injected.
   - `runFeature` stands in for the conductor. It runs the real `prepareWorktree` on a real git repo (operator identity `Operator <operator@example.com>`) created at the order's worktree path, with `dispatchStart: true`, `dispatchStartTimeoutSeconds`, and `input.events`. It then records the `.pipeline/co-author` contents, makes one real agent-style `git commit`, and builds one `withDaemonCoAuthorTrailer('halt record')` engine message, then returns `done`.
2. Verify RED: `makeExecutorChildRun` does not exist, and the child installs no resolver.
3. Implement `makeExecutorChildRun` in `src/conductor/src/engine/executor-child-runtime.ts` as described in Technical Approach. Replace the inline `run` callback in the `executor-child` branch of `src/conductor/src/index.ts` with `makeExecutorChildRun({ projectRoot })`, preserving the worktree path, leaf branch, and `supervisorEngineVersionId` arguments it passes today. Pattern traits to keep: one install per process, before the feature run, bound to this order's feature bus. The allowed variation is that the child uses the per-order bus, because it runs exactly one order.
4. Verify GREEN, including the existing tests in `executor-child.test.ts`.
5. Commit: "fix(executor-child): install the bot co-author resolver in the child".

**Done when:**
- [test] Driving `runExecutorChild` with `makeExecutorChildRun` and a resolved `example-bot`/`42` identity, the child-prepared worktree's `.pipeline/co-author` contains exactly `Co-authored-by: example-bot <42+example-bot@users.noreply.github.com>` when `runFeature` reads it right after `prepareWorktree`, before any conductor step.
- [test] In that child run, the agent-style `git commit` carries the bot trailer exactly once with author `Operator <operator@example.com>`, and `withDaemonCoAuthorTrailer('halt record')` returns the message with the trailer appended exactly once.
- The `executor-child` branch of `index.ts` passes `run: makeExecutorChildRun({ projectRoot })`, and `makeExecutorChildRun` calls `installDaemonProcessServices({ projectRoot, events: input.events, ... })` before invoking `runFeature`.

**Files likely touched:**
- src/conductor/src/engine/executor-child-runtime.ts — `makeExecutorChildRun`
- src/conductor/src/index.ts — use it in the child entry
- src/conductor/test/engine/executor-child.test.ts — child resolved-path test

**Dependencies:** Task 3

### Task 5: Pin both daemon entry points to the bootstrap and keep operator paths unstamped
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Rewrite `src/conductor/test/engine/daemon-bot-co-author-wiring.test.ts` as a source scan over every `.ts` file under `src/conductor/src`. Assert the allowed call sites and ordering listed in Technical Approach, and name the offending or missing file in every failure message.
   - Add a self-test that runs the same checker over in-memory fixture source maps: one with an extra `installDaemonBotCoAuthor(` in `src/engine/foo.ts`, one whose `daemon-cli.ts` lacks the bootstrap call, and one whose `executor-child-runtime.ts` lacks it. Each must fail naming its file.
   - Keep the existing assertions that default rebase-resolution and CI-fix preparation stay on `prepareWorktree`.
2. Add an operator-path test to `src/conductor/test/engine/daemon-process-bootstrap.test.ts`. In a temp git repo with no daemon hooks and no bootstrap call, but with a configured bot credential reader, run `git commit` directly. Assert no bot trailer and no `bot_co_author_skipped` event on a recorder.
3. Verify RED where possible, by running the checker against the pre-change fixture shape.
4. Make it GREEN against the source from Tasks 3 and 4.
5. Commit: "test(co-author): pin daemon entry points to the shared bootstrap".

**Done when:**
- [test] The wiring test passes against production source only when `installDaemonBotCoAuthor(` appears solely in `bot-co-author.ts` and `daemon-process-bootstrap.ts`, and `installDaemonProcessServices(` is called exactly once in `daemon-cli.ts` before `makeRunFeature(` and exactly once in `executor-child-runtime.ts` before `makeExecutorChildRun`'s `runFeature(` call, with no other `src/` caller.
- [test] The checker self-test asserts that a fixture with an extra install in `src/engine/foo.ts` fails naming `src/engine/foo.ts`, a fixture missing the call in `daemon-cli.ts` fails naming `daemon-cli.ts`, and a fixture missing the child bootstrap call fails naming `executor-child-runtime.ts`.
- [test] In a repo where no daemon bootstrap ran, an operator `git commit` carries no `Co-authored-by` trailer for the bot, and the recorder sees no `bot_co_author_skipped` event.

**Files likely touched:**
- src/conductor/test/engine/daemon-bot-co-author-wiring.test.ts — rewritten guard
- src/conductor/test/engine/daemon-process-bootstrap.test.ts — operator-path test

**Dependencies:** Task 3, Task 4

### Task 6: Child-side skip and unconfigured paths reach the feature spine without stamping
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Extend the Task 4 child harness in `src/conductor/test/engine/executor-child.test.ts` with three `githubBoundary` variants:
   - `readToken` returns `unavailable`;
   - the GitHub runner throws for `api user`;
   - `readCredential` returns `unconfigured`.
   In each, `runFeature` runs the real dispatch `prepareWorktree`, makes one real agent-style `git commit`, and makes one real `git commit --allow-empty -m "<withDaemonCoAuthorTrailer('halt record')>"`, then returns `done`.
2. Verify RED against the pre-Task-4 child, which emits nothing. Then confirm GREEN after Task 4. If no production change is needed beyond Task 4, the commit adds only the tests.
3. Commit: "test(executor-child): pin child co-author skip and unconfigured paths".

**Done when:**
- [test] With `readToken` unavailable in the child, no `.pipeline/co-author` file exists, `runFeature` still returns `done`, the worktree `.pipeline/events.jsonl` contains one `bot_co_author_skipped` record with reason `token-unavailable`, and `port.sent` contains one `{ kind: 'event', payload }` whose payload is that event.
- [test] With the identity read throwing in the child, the agent commit carries no bot trailer, the `halt record` engine commit exits 0 with a recorded message byte-identical to `halt record`, and one `bot_co_author_skipped` with reason `identity-read-failed` is both persisted to the worktree `events.jsonl` and forwarded in `port.sent`.
- [test] With `readCredential` unconfigured in the child, no `.pipeline/co-author` file is written, neither commit carries a `Co-authored-by` trailer for the bot, the worktree `events.jsonl` has no `bot_co_author_skipped` record, and `port.sent` forwards no `bot_co_author_skipped` payload.

**Files likely touched:**
- src/conductor/test/engine/executor-child.test.ts — child skip and unconfigured tests

**Dependencies:** Task 4

### Task 7: The supervisor relays child skip events and renders every skip reason into daemon.log
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Write tests:
   - In `src/conductor/test/engine/executor-broker.test.ts`, feed the broker a child message `{ kind: 'event', scope: 'feature', payload }` for each `bot_co_author_skipped` reason. Assert the payload is re-emitted once on that feature's supervisor bus. Then attach the exported `attachFeatureEventRenderer` to that bus with a recording `featureLog`, and assert one rendered line each for forwarded `token-unavailable` and `identity-read-failed` skips.
   - In a new `src/conductor/test/daemon-render-bot-co-author.test.ts`, drive the exported `attachFeatureEventRenderer(featureEvents, featureLog)`. Emit one `token-unavailable` skip on `featureEvents` and assert the `featureLog` sink receives exactly one line. Also assert that `renderedEventTypes()` from `event-sinks.ts` includes `bot_co_author_skipped`, and that `renderDaemonEvent` from `daemon-cli.ts`, given each of the four reasons, calls its log sink exactly once with a line containing that reason's `formatBotCoAuthorSkipped` text.
2. Verify RED for `resolver-absent` before Task 1. The other reasons already pass; they pin the existing relay.
3. Make it GREEN. In `src/conductor/src/daemon-cli.ts`, lift the `attachFeatureEventRenderer` closure out of `runDaemonMode` into an exported module-level function `attachFeatureEventRenderer(featureEvents, featureLog)` with the same body: it subscribes `renderDaemonEvent` to every `renderedEventTypes()` type and returns a detach function. `runDaemonMode` calls it with `featureLogFor(slug)`, the `createFeatureDaemonLogger` sink that writes `.daemon/daemon.log`. Behavior is unchanged. If the broker drops the variant, fix the relay in `executor-broker.ts`.
4. Commit: "refactor(daemon): export the feature event renderer and pin co-author skip rendering".

**Done when:**
- [test] For each of `token-unavailable`, `identity-read-failed`, `worktree-write-failed` and `resolver-absent`, the executor broker re-emits a forwarded `{ kind: 'event', scope: 'feature', payload }` `bot_co_author_skipped` message exactly once on that feature's supervisor event bus.
- [test] In child isolation, with `attachFeatureEventRenderer(featureEvents, featureLog)` attached to the supervisor bus the executor broker re-emits onto, a forwarded child `token-unavailable` skip and a forwarded `identity-read-failed` skip each call `featureLog` (the daemon.log sink) exactly once, with lines containing `bot co-author skipped: token unavailable` and `bot co-author skipped: identity read failed`.
- [test] `renderedEventTypes()` includes `bot_co_author_skipped`, so `attachFeatureEventRenderer` and the in-process daemon bus subscribe `renderDaemonEvent` to it.
- [test] With the exported `attachFeatureEventRenderer(featureEvents, featureLog)` attached to an in-process feature bus, emitting one `{ type: 'bot_co_author_skipped', reason: 'token-unavailable' }` on that bus calls `featureLog` exactly once with a line containing `bot co-author skipped: token unavailable`; `runDaemonMode` passes `featureLogFor(slug)`, the daemon.log sink.
- [test] `renderDaemonEvent` writes exactly one daemon.log line per `bot_co_author_skipped` event, containing `bot co-author skipped: token unavailable`, `bot co-author skipped: identity read failed`, `bot co-author skipped: worktree setup failed`, or `bot co-author skipped: resolver not installed for daemon dispatch` for the respective reason.

**Files likely touched:**
- src/conductor/test/engine/executor-broker.test.ts — relay test
- src/conductor/test/daemon-render-bot-co-author.test.ts — render test
- src/conductor/src/daemon-cli.ts — export `attachFeatureEventRenderer`
- src/conductor/src/engine/executor-broker.ts — only if the relay drops the variant

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──▶ Task 2
Task 1 ──▶ Task 7
Task 3 ──▶ Task 4 ──▶ Task 6
Task 3, Task 4 ──▶ Task 5
```

## Integration Points

- After Task 3: an in-process daemon dispatch stamps the trailer through the bootstrap.
- After Task 4: a child-isolated dispatch stamps the trailer. Task 4 owns the cross-process integration proof through the `executor-child` entry composition, and Task 7 owns the supervisor relay into `daemon.log`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given `executor_isolation: child` and a configured bot whose identity resolves to login `example-bot` and id `42`, when the daemon dispatches a feature, then the dispatched worktree's `.pipeline/co-author` contains exactly `Co-authored-by: example-bot <42+example-bot@users.noreply.github.com>` before the first build step runs. | 4 | "the child-prepared worktree's `.pipeline/co-author` contains exactly `Co-authored-by: example-bot <42+example-bot@users.noreply.github.com>` when `runFeature` reads it right after `prepareWorktree`, before any conductor step" | diff-local |
| Story 1 happy: Given that dispatch, when a build agent commits in the feature worktree, then the commit message carries that trailer exactly once and the commit author is the operator's git identity. | 4 | "the agent-style `git commit` carries the bot trailer exactly once with author `Operator <operator@example.com>`" | diff-local |
| Story 1 happy: Given that dispatch, when the executor child makes an engine bookkeeping commit through the shared commit helper (for example a halt record), then that commit message carries the same trailer exactly once. | 4 | "`withDaemonCoAuthorTrailer('halt record')` returns the message with the trailer appended exactly once" | diff-local |
| Story 1 negative: Given `executor_isolation: child` and a configured bot whose token file is unreadable, when the daemon dispatches a feature, then no `.pipeline/co-author` file exists in the worktree, setup continues, and one `bot_co_author_skipped` event with reason `token-unavailable` appears in that worktree's `.pipeline/events.jsonl` and as a rendered line in `.daemon/daemon.log`. | 6, 7 | "the worktree `.pipeline/events.jsonl` contains one `bot_co_author_skipped` record with reason `token-unavailable`, and `port.sent` contains one `{ kind: 'event', payload }` whose payload is that event" | diff-local |
| Story 1 negative: Given `executor_isolation: child` and a configured bot whose identity read fails, when the daemon dispatches a feature, then the build agent's commits carry no bot trailer and one `bot_co_author_skipped` event with reason `identity-read-failed` reaches the worktree spine and `.daemon/daemon.log`. | 6, 7 | "one `bot_co_author_skipped` with reason `identity-read-failed` is both persisted to the worktree `events.jsonl` and forwarded in `port.sent`" | diff-local |
| Story 1 negative: Given `executor_isolation: child` and a configured bot whose identity read fails, when the executor child makes an engine bookkeeping commit, then that commit succeeds and its message is byte-identical to the message without the helper. | 6 | "the `halt record` engine commit exits 0 with a recorded message byte-identical to `halt record`" | diff-local |
| Story 2 happy: Given `executor_isolation: in-process` and a configured bot whose identity resolves, when the daemon dispatches a feature, then the worktree's `.pipeline/co-author` contains the resolved trailer and build-agent commits carry it exactly once. | 3 | "a subsequent `git commit` carries that trailer exactly once with author `Operator <operator@example.com>`" | diff-local |
| Story 2 happy: Given the daemon entry point and the executor-child entry point, when the wiring test inspects production source, then each calls the shared daemon-process bootstrap exactly once before any feature dispatch work, and the resolver is installed nowhere else. | 5 | "`installDaemonProcessServices(` is called exactly once in `daemon-cli.ts` before `makeRunFeature(` and exactly once in `executor-child-runtime.ts` before `makeExecutorChildRun`'s `runFeature(` call, with no other `src/` caller" | diff-local |
| Story 2 happy: Given an operator-run CLI that prepares or commits in a worktree, when it runs, then it installs no resolver and its commits carry no bot trailer. | 5, 2 | "In a repo where no daemon bootstrap ran, an operator `git commit` carries no `Co-authored-by` trailer for the bot" | diff-local |
| Story 2 negative: Given `executor_isolation: in-process` and a configured bot whose token file is unreadable, when the daemon dispatches a feature, then no co-author file is written and one `bot_co_author_skipped` event with reason `token-unavailable` reaches the feature spine and `.daemon/daemon.log`. | 3, 7 | "makes the bootstrap-installed resolver emit exactly one `{ type: 'bot_co_author_skipped', reason: 'token-unavailable' }` on that feature bus, no `.pipeline/co-author` file is written" | diff-local |
| Story 2 negative: Given a production source change that adds a resolver install outside the shared bootstrap, or removes the bootstrap call from either daemon entry point, when the wiring test runs, then it fails and names the offending or missing entry point. | 5 | "a fixture with an extra install in `src/engine/foo.ts` fails naming `src/engine/foo.ts`, a fixture missing the call in `daemon-cli.ts` fails naming `daemon-cli.ts`, and a fixture missing the child bootstrap call fails naming `executor-child-runtime.ts`" | diff-local |
| Story 2 negative: Given a configured bot and an operator running a manual `git commit` in their root checkout, when the commit is recorded, then its message carries no bot trailer and no `bot_co_author_skipped` event is emitted. | 5 | "an operator `git commit` carries no `Co-authored-by` trailer for the bot, and the recorder sees no `bot_co_author_skipped` event" | diff-local |
| Story 3 happy: Given a daemon dispatch whose process has no resolver installed, when the worktree is prepared for dispatch, then no `.pipeline/co-author` file exists, setup continues to the first build step, and one `bot_co_author_skipped` event with reason `resolver-absent` is emitted on that feature's spine. | 2 | "`prepareWorktree` with `dispatchStart: true` emits exactly one event deep-equal to `{ type: 'bot_co_author_skipped', reason: 'resolver-absent' }`, the stale `.pipeline/co-author` file no longer exists, and `prepareWorktree` resolves through to its setup stage" | diff-local |
| Story 3 happy: Given that event, when the supervisor renders it, then `.daemon/daemon.log` carries one line naming the skip as caused by an absent resolver, and the event payload contains only its type and closed reason. | 7, 2 | "`renderDaemonEvent` writes exactly one daemon.log line per `bot_co_author_skipped` event, containing" | diff-local |
| Story 3 happy: Given `github_bot` is not configured and the resolver is installed, when the daemon dispatches a feature under either isolation mode, then no co-author file is written, commits carry no bot trailer, and no `bot_co_author_skipped` event is emitted. | 3, 6 | "With `readCredential` unconfigured in the child, no `.pipeline/co-author` file is written, neither commit carries a `Co-authored-by` trailer for the bot" | diff-local |
| Story 3 negative: Given an operator-run worktree preparation that is not a daemon dispatch and has no resolver installed, when it runs, then it emits no `bot_co_author_skipped` event and writes no co-author file. | 2 | "`prepareWorktree` without `dispatchStart` emits no `bot_co_author_skipped` event and leaves no `.pipeline/co-author` file" | diff-local |
| Story 3 negative: Given a daemon dispatch with no resolver installed, when the event emitter rejects the skip event, then worktree setup still completes and the stale co-author file is still absent. | 2 | "a `bot_co_author_skipped` handler that throws, `prepareWorktree` with `dispatchStart: true` still resolves, and `.pipeline/co-author` is absent" | diff-local |
| Story 3 negative: Given a daemon dispatch with no resolver installed, when the engine later makes a bookkeeping commit in that process, then the commit succeeds without a trailer and no additional skip event is emitted for that commit. | 2 | "a real `git commit` with that message exits 0, its recorded message contains no `Co-authored-by` trailer, and the recorder sees no additional `bot_co_author_skipped` event" | diff-local |
| Story 3 negative: Given a stale `.pipeline/co-author` file left by an earlier dispatch, when a dispatch with no resolver installed prepares the worktree, then the stale file is removed and no trailer from it reaches any new commit. | 2 | "After a dispatch preparation that removed a stale co-author file, `withDaemonCoAuthorTrailer('engine commit')` returns `'engine commit'` byte-identical, a real `git commit` with that message exits 0, its recorded message contains no `Co-authored-by` trailer" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-11-github-operation-ownership#D1 | existing | none | The bot identity read already goes through the guarded GitHub boundary as the typed `ambient.bot-identity.read` operation (`runBotIdentityRead` in `tracker-client.ts` decodes it with `decodeGithubAmbientRead`); the bootstrap reuses `createBotCoAuthorResolver` and adds no new GitHub call path. |
| adr-2026-09-11-github-operation-ownership#D2 | no-change | none | No feature-resource ownership record, label, issue, or PR mutation is added or changed; the feature only installs an in-process resolver and writes the worktree's gitignored `.pipeline/co-author`. |
| adr-2026-09-11-github-operation-ownership#D3 | no-change | none | Pre-spec intake and resource creation are untouched; no intake or creation path calls the bootstrap. |
| adr-2026-09-11-github-operation-ownership#D4 | no-change | none | No shared-resource write is introduced; the only GitHub call is the existing read of the bot's own identity. |
| adr-2026-09-11-github-operation-ownership#D5 | no-change | none | Local commits stay on their existing paths and only gain the trailer through the unchanged hook and helper; no remote Git write is added or rerouted. |
| adr-2026-09-11-github-operation-ownership#D6 | no-change | none | No GitHub mutation, and therefore no refusal result, is introduced; the existing identity-read failure stays a closed `identity-read-failed` skip. |
| adr-2026-09-11-github-operation-ownership#D7 | no-change | none | The completeness checks over the GitHub operation registry are unchanged because no new operation is registered. |
| adr-2026-09-11-github-operation-ownership#D8 | no-change | none | Gated visibility and foreign-resource writes are untouched; nothing in this feature writes to a foreign resource. |
| adr-2026-09-11-github-operation-ownership#D9 | no-change | none | Write-credential selection is unchanged. The executor child already selects the bot credential for its own GitHub writes through `makeProductionGh` (`pr-labels.ts`), and this feature adds no write and changes no credential choice. |
| adr-2026-09-11-github-operation-ownership#D10 | task | task-3, task-4, task-2 | the child-prepared worktree's `.pipeline/co-author` contains exactly `Co-authored-by: example-bot <42+example-bot@users.noreply.github.com>` |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
- [x] Tasks do not invalidate each other's fixtures or assertions (plan review sweeps this at Tier M)
