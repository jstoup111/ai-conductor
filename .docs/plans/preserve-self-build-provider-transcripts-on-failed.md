# Implementation Plan: Preserve self-host provider transcripts for failed, stalled, or zero-progress dispatches

**Date:** 2026-10-10
**Design:** `.docs/decisions/adr-2026-10-10-retain-self-host-provider-transcripts.md` (technical track; no PRD)
**Stories:** `.docs/stories/preserve-self-build-provider-transcripts-on-failed.md` (accepted stories)
**Conflict check:** Clean as of 2026-10-10 (`.docs/conflicts/2026-10-10-preserve-self-build-provider-transcripts-on-failed.md`)

## Summary

Capture every self-host provider home's allowlisted, sanitized transcripts into
`«worktree»/.pipeline/transcripts/` before the home is removed (normal teardown and dead-owner
sweep), keep or prune each capture once the conductor settles the owning step's verdict, cap what
is kept, announce every transition on the event spine, and add a read-only
`ai-conductor transcripts` reader. 18 tasks.

## Technical Approach

- **Declaration on the provider seam.** `SelfHostShape` in `src/conductor/src/execution/provider-catalog.ts`
  gains a required `transcripts` member: `{ globs: readonly string[]; extractFinalAssistantMessage(lines) }`.
  Claude `projects/**/*.jsonl`; Codex and Pi `sessions/**/*.jsonl`. The field is required in the
  type, so omission is a compile error; a catalog validation rejects an empty glob list.
- **Pure helpers in a new module family under `src/conductor/src/engine/self-host/`:**
  `transcript-sanitize.ts` (line sanitizer), `transcript-harvest.ts` (allowlisted copy),
  `transcript-retention.ts` (pending registry, verdict settlement, cap), and
  `transcript-format.ts` (per-provider final-message extractors).
- **Sanitizing.** Each captured line is parsed; every string leaf passes through the existing
  `redactSafetyText` (`src/conductor/src/engine/safety-diagnostics.ts`); any key matching
  `/^(api[_-]?key|token|secret|password|credential|authorization)$/i` has its value replaced by
  `"[REDACTED]"`; the object is re-serialized with `JSON.stringify`. An unparseable line goes
  through `redactSafetyText` as raw text. Known secrets (string leaves of 8+ chars from the home's
  `selectedAuthPath` file, plus an injected daemon build token) are masked by exact substring
  replacement on the final line. A sanitizer throw omits that line and counts it.
- **Harvest.** Walk the provider home with `lstat` (never following symlinks), keep regular files
  whose home-relative POSIX path matches a declared glob (Node `path.matchesGlob`), read, sanitize,
  and write to the destination at the same relative path. A write error removes the partial
  destination directory and returns a `failed` result; it never throws.
- **Identity.** The scratch lease (`provider-scratch.ts` `ScratchLease`) gains optional `step` and
  `provider`; the conductor passes the step name when it provisions a sandbox or provider home.
  Destination: `.pipeline/transcripts/«step»/«runId»-a«attempt»[-«member»]-«provider»/`
  (`unknown-step` when an older lease lacks `step`).
- **Wiring.** `SandboxBuildEnv.teardown()` and `ProviderHome.teardown()` harvest first, then remove,
  inside their existing once-only guard. The dead-owner sweep harvests each provider home inside a
  dead-owner scratch home before reclaim, marking the capture interrupted.
- **Retention.** A `TranscriptRetention` instance subscribes to `provider_transcripts_captured`
  through `ConductorEventEmitter.on` and holds non-interrupted captures as pending, in memory only
  (a daemon death therefore leaves captures retained by default). The conductor calls
  `settle(step, outcome)` where `outcome` is the closed union
  `succeeded-with-progress | succeeded-without-progress | failed | stalled | halted | needs-human`;
  the mapping is an exhaustive `switch` with an `assertNever` tail. Retain, then enforce the cap
  (20 captures, 1 GiB, oldest-first by captured timestamp, never the newest).
- **Reader.** `ai-conductor transcripts «slug» [--show «capture»]` is detected and dispatched in
  `src/conductor/src/index.ts` beside `shipped-record`. It resolves `«repoRoot»/.worktrees/«slug»`,
  reads `.pipeline/events.jsonl` for captured/retained/pruned/evicted events, lists captures still on
  disk, and prints a capture's final assistant message through the provider extractor, re-sanitized.
- **Release gate.** No `bin/conduct` file change, so the self-host release gate's CLI surface is not
  triggered; no migration block or waiver. The PR declares `Release-Disposition: note`, `Added`.

**Local pattern context.** The dead-owner sweep's "fail toward retention" decisions in
`provider-scratch.ts` (`sweepScratch`, `retainLegacyScratch`) are the precedent for every
uncertain case here: keep and report, never delete on doubt. Event variants follow the existing
`scratch_cleanup_*` variants in `src/conductor/src/types/events.ts` (flat object, `type` literal,
string paths). Search hints: `scratch_cleanup_retained`, `releaseScratchHome`, `detectShippedRecordCommand`.

## Prerequisites

- None. Scratch homes, leases, the sweep, the event spine, and `redactSafetyText` exist on main.

## Tasks

### Task 1: Declare transcript allowlists on every self-host provider
**Story:** Story 1 happy 1, happy 2 (globs), negative 1, negative 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in the provider-catalog test: Claude's self-host shape declares `transcripts.globs` equal to `['projects/**/*.jsonl']`; Codex's and Pi's equal `['sessions/**/*.jsonl']`; `validateProviderCatalog` given a copy of a descriptor whose glob list is `[]` throws an error containing the provider id and `transcript allowlist is empty`.
2. Add a test that type-checks an in-memory fixture constructing a `SelfHostShape` without `transcripts` through the TypeScript compiler API (`ts.createProgram` over the fixture plus `provider-catalog.ts`) and collects its diagnostics.
3. Verify RED.
4. Implement: add the required `transcripts: { globs: readonly string[] }` member to `SelfHostShape` (the extractor member is added in Task 14), populate the three built-ins, and add the empty-list check to the catalog validation run at load; the error text is `self-host provider «id»: transcripts.globs transcript allowlist is empty`.
5. Verify GREEN; commit.

**Done when:**
- [test] The provider-catalog test asserts `claude` declares `projects/**/*.jsonl` and `codex` and `pi` each declare `sessions/**/*.jsonl` on `selfHostShape.transcripts.globs`.
- [test] A test asserts catalog validation rejects a self-host descriptor with an empty `transcripts.globs` with an error naming the provider id and `transcripts.globs`.
- [test] A compiler-API test asserts a `SelfHostShape` fixture omitting `transcripts` produces a type error whose message names the missing property `transcripts`.

**Files likely touched:**
- `src/conductor/src/execution/provider-catalog.ts` — required `transcripts` member, built-in values, validation
- `src/conductor/test/execution/provider-catalog.test.ts` — declaration, validation, and type fixtures

**Dependencies:** none

### Task 2: Add transcript lifecycle event variants to the spine
**Story:** Story 8 happy 1, happy 2, negative 1
**Type:** infrastructure

**Steps:**
1. Write a failing test that emits each new variant through a `ConductorEventEmitter` wired to an `EventPersister` in a temp dir and reads `.pipeline/events.jsonl` back.
2. Implement variants in the `ConductorEvent` union: `provider_transcripts_captured { step, runId, attempt, member?, provider, path, files, bytes, interrupted, skipped, omittedLines }`, `provider_transcripts_harvest_failed { step, runId, attempt, member?, provider, path, error }`, `provider_transcripts_retained { path }`, `provider_transcripts_pruned { path }`, `provider_transcripts_evicted { path, reason: 'count' | 'size' }`, `provider_transcripts_retention_failed { path, action: 'prune' | 'evict', error }`.
3. Verify GREEN; commit.

**Done when:**
- [test] A persister test asserts a `provider_transcripts_captured` record in `events.jsonl` carries step, runId, attempt, member, provider, path, files, bytes, and interrupted.
- [test] The same test asserts `provider_transcripts_retained`, `_pruned`, and `_evicted` records each carry the capture `path`.
- [test] The same test asserts `provider_transcripts_harvest_failed` carries step, runId, attempt, provider, path, and error, and `provider_transcripts_retention_failed` carries path, action, and error.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — six new union variants
- `src/conductor/test/engine/self-host/transcript-events.test.ts` — persistence round-trip

**Dependencies:** none

### Task 3: Sanitize a captured transcript line
**Story:** Story 2 happy 4, happy 5, happy 6; Story 3 negative 4
**Type:** happy-path

**Steps:**
1. Write failing unit tests for `sanitizeTranscriptLine(line, knownSecrets)` in `transcript-sanitize.ts`:
   - JSON lines whose string value contains `Authorization: Bearer abc123def`, `api_key=sk-live-9999`, or `authorization: Bearer xyz98765` → output parses as JSON and that value equals `redactSafetyText` of the original.
   - JSON line with keys `Token`, `api_key`, `SECRET`, `Password`, `credential`, `Authorization` (top level and nested) → every value `"[REDACTED]"`.
   - non-JSON line `token=abc123` → contains `token=[REDACTED]`, not `abc123`.
   - JSON line with nothing to redact → `JSON.parse(output)` deep-equals `JSON.parse(input)`.
   - JSON tool-result string containing the full text of a fixture `auth.json` (`{"OPENAI_API_KEY":"sk-test-0123456789"}`), with knownSecrets `['sk-test-0123456789']` → output contains no `sk-test-0123456789`.
2. Implement per Technical Approach (parse → walk leaves → key rule → `redactSafetyText` → stringify; raw fallback; exact-substring known-secret masking last). Also export `collectKnownSecrets(authFileText, extra)` returning string leaves of 8+ chars plus `extra`.
3. Verify GREEN; commit.

**Done when:**
- [test] A test asserts a bearer token, an `api_key=` value, and an `authorization:` header each inside a JSON string value are replaced by `redactSafetyText`'s form and each sanitized line still parses as JSON.
- [test] A test asserts values under keys `token`, `api_key`, `secret`, `password`, `credential`, and `authorization` in mixed case, top-level and nested, become `[REDACTED]`.
- [test] A test asserts a non-JSON `token=abc123` line becomes `token=[REDACTED]` and contains no `abc123`.
- [test] A test asserts a line with nothing to redact is semantically unchanged (parsed values deep-equal).
- [test] A test asserts a known secret collected by `collectKnownSecrets` from a fixture `auth.json` is absent from a sanitized line that echoed that file's text.

**Files likely touched:**
- `src/conductor/src/engine/self-host/transcript-sanitize.ts` — new
- `src/conductor/test/engine/self-host/transcript-sanitize.test.ts` — new

**Dependencies:** none

### Task 4: Copy only allowlisted transcript files out of a provider home
**Story:** Story 2 happy 1 (relative paths), negative 1; Story 3 happy 1, happy 2, negative 3
**Type:** happy-path

**Steps:**
1. Write failing tests for `harvestTranscripts({ home, globs, destination, knownSecrets })` in `transcript-harvest.ts` against a temp-dir home seeded with `projects/w/s.jsonl`, `projects/w/s/subagents/a.jsonl`, `projects/w/notes.txt`, `auth.json`, `.claude.json`, `settings.json`, and real directories `skills/` and `hooks/` symlinked to a temp harness dir.
2. Implement: `lstat`-walk the home, select regular files whose home-relative POSIX path satisfies `path.matchesGlob` for a declared glob, sanitize each line with `sanitizeTranscriptLine`, write to `destination/«relative path»`, return `{ kind: 'captured', files, bytes, skipped, omittedLines }`. Also export `harvestThenRemove({ harvest, remove })`, the single retirement routine (ADR decision 2) that awaits the harvest, reports its result, and then always awaits `remove`; Tasks 8, 9, and 10 call it rather than sequencing harvest and removal themselves. With no matches, create the destination directory empty (no files written into it) and return `files: 0`, so a zero-file capture is still a capture on disk that retention and the reader can see.
3. Verify GREEN; commit.

**Done when:**
- [test] A test asserts both `projects/w/s.jsonl` and `projects/w/s/subagents/a.jsonl` exist under the destination at the same home-relative paths.
- [test] A test asserts the destination contains no `auth.json`, `.claude.json`, `settings.json`, `notes.txt`, or anything from `skills/` or `hooks/`.
- [test] A test asserts a home with no matching file returns `kind: 'captured'` with `files: 0` and the destination directory exists and contains no entries.

**Files likely touched:**
- `src/conductor/src/engine/self-host/transcript-harvest.ts` — new
- `src/conductor/test/engine/self-host/transcript-harvest.test.ts` — new

**Dependencies:** Task 1, Task 3

### Task 5: Refuse symlinked matches and unsanitizable lines during harvest
**Story:** Story 3 negative 1, negative 2, negative 5
**Type:** negative-path

**Steps:**
1. Write failing tests: `projects/w/link.jsonl` symlinked to a file outside the home; `sessions/` itself a symlink to a directory outside the home containing `x.jsonl`; a sanitizer stub that throws on one line.
2. Implement: a symlink whose path matches a glob is not copied and its home-relative path is appended to `skipped`; the walk never descends a symlinked directory; a line whose sanitization throws is omitted and `omittedLines` is incremented, the rest of the file is still written.
3. Verify GREEN; commit.

**Done when:**
- [test] A test asserts a symlinked `link.jsonl` is not in the destination and its path is listed in the result's `skipped`.
- [test] A test asserts nothing beneath a symlinked `sessions/` directory appears in the destination.
- [test] A test asserts a line whose sanitization throws is absent from the written file, `omittedLines` is 1, and no unsanitized copy of that line is written.

**Files likely touched:**
- same as Task 4

**Dependencies:** Task 4

### Task 6: Harvest failures never escape and never leave a partial capture
**Story:** Story 4 negative 1 (harvest layer), negative 2, negative 3
**Type:** negative-path

**Steps:**
1. Write failing tests: destination parent made read-only; a transcript file deleted between walk and read (inject via an fs seam); a write that fails with `ENOSPC` on the second file (fs seam).
2. Implement: catch per-file read `ENOENT` → record in `skipped` and continue; catch any write error → remove the partial destination directory and return `{ kind: 'failed', error }`; `harvestTranscripts` never throws.
3. Verify GREEN; commit.

**Done when:**
- [test] A test asserts an unwritable destination yields `kind: 'failed'` with the error text and the function resolves without throwing.
- [test] A test asserts a file vanishing mid-harvest is listed in `skipped` while the remaining matched files are written and the result is `captured`.
- [test] A test asserts an `ENOSPC` on the second file yields `kind: 'failed'` and the destination directory no longer exists.

**Files likely touched:**
- same as Task 4

**Dependencies:** Task 4

### Task 7: Record the owning step and provider in the scratch lease
**Story:** Story 2 happy 1 (step-named destination); Story 5 happy 1 (sweep identity)
**Type:** infrastructure

**Steps:**
1. Write failing tests: `acquireScratchHome({ …, step: 'build', provider: 'codex', member: 'rubric-a' })` writes a lease that `readScratchLease` returns with `step: 'build'`, `provider: 'codex'`, `member: 'rubric-a'` alongside the existing `runId` and `attempt`; a lease JSON without the new fields still reads as `present`.
2. Implement: optional `step` on `ResolveScratchHomeOptions`; persist optional `step`, `provider`, and `member` in `ScratchLease` (the lease already carries `runId` and `attempt`), `provider` and `member` from the existing options; thread `step` through `ProvisionOptions` (`sandbox-build-env.ts`) and `ProvisionProviderHomeOptions` (`provider-home.ts`); pass `step: name` at both conductor provisioning sites in `runAdmittedSelfBuildDispatch` (legacy `provisionSandbox` path and the candidate `prepareCandidateSelfHost` path).
3. Verify GREEN; commit.

**Done when:**
- [test] A provider-scratch test asserts a lease written with `step: 'build'`, `provider: 'codex'`, and `member: 'rubric-a'` reads back with those values and its `runId` and `attempt`.
- [test] A provider-scratch test asserts a lease lacking `step`, `provider`, and `member` still reads as `kind: 'present'`.
- Both conductor provisioning calls in `runAdmittedSelfBuildDispatch` pass `step: name`, visible in the diff of `src/conductor/src/engine/conductor.ts`.

**Files likely touched:**
- `src/conductor/src/engine/self-host/provider-scratch.ts` — lease fields
- `src/conductor/src/engine/self-host/sandbox-build-env.ts` — option threading
- `src/conductor/src/engine/self-host/provider-home.ts` — option threading
- `src/conductor/src/engine/conductor.ts` — pass step at provisioning
- `src/conductor/test/engine/self-host/provider-scratch.test.ts` — lease tests

**Dependencies:** none

### Task 8: Claude sandbox teardown captures before removal
**Story:** Story 2 happy 1, negative 2, negative 3; Story 4 negative 1 (teardown layer)
**Type:** happy-path

**Steps:**
1. Write failing tests in the sandbox-build-env test: provision with `step: 'build'`, `runId: 'r1'`, `attempt: 1`, an events emitter wired to an `EventPersister`, and a worktree temp dir; seed `projects/w/s.jsonl` and `projects/w/s/subagents/a.jsonl` in `configDir`; call `teardown()`; repeat with `member: 'rubric-a'`.
2. Implement: `SandboxBuildEnv.teardown()` calls `harvestThenRemove` with `harvestTranscripts` (Claude globs, known secrets from `.credentials.json` if present plus the injected `CLAUDE_CODE_OAUTH_TOKEN`) into `.pipeline/transcripts/«step»/«runId»-a«attempt»[-«member»]-claude/` (here `build/r1-a1-claude/`, and `build/r1-a1-rubric-a-claude/` for the member), emits `provider_transcripts_captured` or `provider_transcripts_harvest_failed`, then removes the home exactly as today; all inside the existing `tornDown` guard. Harvest runs regardless of the attempt's result, because teardown has no result input.
3. Verify GREEN; commit.

**Done when:**
- [test] A test asserts after `teardown()` both seeded files exist under `«worktree»/.pipeline/transcripts/build/r1-a1-claude/` at their home-relative paths, `configDir` no longer exists, and `events.jsonl` holds one `provider_transcripts_captured` record for that path with step, runId, attempt, provider, files, and bytes.
- [test] A test asserts the `rubric-a` member's teardown writes to `build/r1-a1-rubric-a-claude/`.
- [test] A test asserts a second `teardown()` emits no second `provider_transcripts_captured` event and resolves without error.
- [test] A test asserts with an unwritable `.pipeline/transcripts` one `provider_transcripts_harvest_failed` event naming step, attempt, provider `claude`, and the error is emitted, `teardown()` resolves, and `configDir` no longer exists.

**Files likely touched:**
- `src/conductor/src/engine/self-host/sandbox-build-env.ts` — harvest in teardown
- `src/conductor/test/engine/self-host/sandbox-build-env.test.ts` — teardown capture tests

**Dependencies:** Task 2, Task 4, Task 6, Task 7

### Task 9: Codex and Pi provider-home teardown captures before removal
**Story:** Story 2 happy 2, happy 3, negative 4; Story 3 happy 1
**Type:** happy-path

**Steps:**
1. Write failing tests in the provider-home test for `codex` and `pi`: seed `sessions/2026/10/10/rollout-x.jsonl` (one line of which is a tool result echoing the full text of the seeded `auth.json`) and `auth.json` (`{"OPENAI_API_KEY":"sk-test-0123456789","refresh":"rt-abcdefgh"}`) in `homeDir`, tear down; then two members `rubric-a`/`rubric-b` sharing `runId`/`attempt`, torn down concurrently with `Promise.all`; then attempt 2 of the same step.
2. Implement: `ProviderHome.teardown()` calls `harvestThenRemove`, harvesting with the provider's globs and known secrets from `selectedAuthPath` into `.pipeline/transcripts/«step»/«runId»-a«attempt»[-«member»]-«provider»/`, emits the captured/failed event, then removes as today.
3. Verify GREEN; commit.

**Done when:**
- [test] A test asserts for both `codex` and `pi` that `sessions/2026/10/10/rollout-x.jsonl` exists under `.pipeline/transcripts/«step»/«runId»-a1-«provider»/` with no `auth.json`, and `homeDir` no longer exists.
- [test] A test asserts that, with the seeded transcript containing a tool-result line echoing the full text of the seeded `auth.json`, no string value of that `auth.json` (`sk-test-0123456789`, `rt-abcdefgh`) occurs in any file anywhere under the capture directory.
- [test] A test asserts members `rubric-a` and `rubric-b` torn down concurrently write to `«runId»-a1-rubric-a-«provider»` and `«runId»-a1-rubric-b-«provider»` and each directory's files match only its own home's content.
- [test] A test asserts attempt 2 writes to an `-a2-` directory and the attempt-1 capture's files are byte-identical before and after.

**Files likely touched:**
- `src/conductor/src/engine/self-host/provider-home.ts` — harvest in teardown
- `src/conductor/test/engine/self-host/provider-home.test.ts` — capture tests

**Dependencies:** Task 2, Task 4, Task 6, Task 7

### Task 10: The dead-owner sweep captures interrupted homes before reclaim
**Story:** Story 5 happy 1, negative 1, negative 2
**Type:** happy-path

**Steps:**
1. Write failing tests in the provider-scratch test: a scratch home with a lease naming a dead pid, `step: 'build'`, `provider: 'codex'`, containing a `self-host-codex-*` child with `sessions/x.jsonl`; a missing-lease home; a live-owner home; an unreadable-lease home; and a dead-owner home where harvest is forced to fail.
2. Implement: in `sweepScratch`, for a dead-owner home, take step, runId, attempt, member, and provider from its lease (a pre-upgrade lease without `step` files under `unknown-step`; without `provider`, the provider is parsed from the `«attempt»-«provider»` home directory name; it is still harvested before reclaim) and harvest each provider-home child directory with that provider's globs and known secrets collected from the child's `selectedAuthPath` file (plus the daemon build token, when the daemon passes one in the sweep options from `readDaemonBuildToken`) into `.pipeline/transcripts/«step»/«runId»-a«attempt»[-«member»]-«provider»/`, emit `provider_transcripts_captured` with `interrupted: true` (or `_harvest_failed`), then reclaim exactly as today, sequenced through `harvestThenRemove`. Homes the sweep retains are untouched.
3. Verify GREEN; commit.

**Done when:**
- [test] A test asserts a dead-owner home's `sessions/x.jsonl` is under `.pipeline/transcripts/build/…-codex/`, a captured event has `interrupted: true`, and the home is removed afterward.
- [test] A test asserts missing-lease, unreadable-lease, and live-owner homes produce no capture directory, no captured event, and remain on disk.
- [test] A test asserts a forced harvest failure emits `provider_transcripts_harvest_failed` and the dead-owner home is still reclaimed (the sweep decision equals the no-capture baseline).

**Files likely touched:**
- `src/conductor/src/engine/self-host/provider-scratch.ts` — harvest in sweep
- `src/conductor/test/engine/self-host/provider-scratch.test.ts` — sweep capture tests

**Dependencies:** Task 2, Task 4, Task 7

### Task 11: Track pending captures and settle them by an exhaustive outcome mapping
**Story:** Story 5 happy 2; Story 6 negative 2, negative 3; Story 8 happy 2 (retained/pruned)
**Type:** happy-path

**Steps:**
1. Write failing unit tests for `TranscriptRetention` in `transcript-retention.ts` using an emitter wired to an `EventPersister` and temp dirs.
2. Implement: on construction, reconcile from `.pipeline/events.jsonl`: every capture with a captured event, still on disk, and no retained/pruned/evicted event (orphaned by a process death) is retained and a `provider_transcripts_retained` record is persisted for it. Then subscribe via `emitter.on('provider_transcripts_captured', …)`; non-interrupted captures go to a pending map keyed by step; interrupted captures are retained immediately (emit `_retained`). `settle(step, outcome)` maps the closed union through a `switch` ending in `assertNever`: `succeeded-with-progress` → remove dirs, emit `_pruned`; every other member → emit `_retained`. A removal error emits `provider_transcripts_retention_failed { action: 'prune' }` and `settle` resolves normally.
3. Add a `@ts-expect-error` fixture calling the mapping with an unlisted outcome literal.
4. Verify GREEN; commit.

**Done when:**
- [test] A test asserts an interrupted capture is retained and stays on disk after `settle(step, 'succeeded-with-progress')`.
- [test] A test asserts `settle(step, 'succeeded-with-progress')` removes that step's pending capture directories and persists to `events.jsonl` one `provider_transcripts_pruned` record naming each pruned capture path, while `failed`, `stalled`, `halted`, `needs-human`, and `succeeded-without-progress` each persist a `provider_transcripts_retained` record naming each capture path and leave the directories.
- [test] A test asserts a prune that fails with a permission error persists `provider_transcripts_retention_failed` with the capture path, action `prune`, and the error text, `settle` resolves without throwing, and no file other than capture directories exists under `.pipeline/transcripts`.
- The outcome mapping is a `switch` with no `default` arm ending in `assertNever`, proven by a `@ts-expect-error` fixture passing an unlisted outcome.

**Files likely touched:**
- `src/conductor/src/engine/self-host/transcript-retention.ts` — new
- `src/conductor/test/engine/self-host/transcript-retention.test.ts` — new

**Dependencies:** Task 2

### Task 12: The conductor settles captures when it settles a step's verdict
**Story:** Story 6 happy 1, happy 2, happy 3, happy 4, negative 1
**Type:** happy-path

**Steps:**
1. Write failing conductor tests using the existing self-host dispatch test harness with a fake provider runtime that writes a transcript into its home: (a) `build` exits 0 with tasks resolved 7→7 so the conductor emits `build_stall` reason `no_task_progress`; (b) `build_review` with two rubric members where the step fails; (c) `build` succeeds with tasks resolved 7→8; (d) attempt 1 of `build` fails, attempt 2 succeeds with progress; (e) a capture written, then a fresh conductor/`TranscriptRetention` instance constructed (simulated restart) with no settle.
2. Implement: construct one `TranscriptRetention` per conductor run on its emitter. Ordering relied on: a dispatch's provider-home teardown (and so its captured event) completes inside the dispatch's `finally`, before the conductor emits that attempt's `step_failed`/`step_completed`/`build_stall`, so each attempt's capture is pending when its own verdict settles. Each attempt is settled exactly once: for `build`, settlement happens after the stall evaluation for that attempt, so a `build_stall` (any reason) settles as `stalled` and suppresses the `step_completed`-based mapping; at the step-outcome points call `settle(name, outcome)` — `build_stall` (any reason) → `stalled`; `step_failed` → `failed`; HALT write → `halted`; needs-human halt class → `needs-human`; `step_completed` for `build` with `resolvedAfter > resolvedBefore` → `succeeded-with-progress`, else `succeeded-without-progress`; `step_completed` for any other step → `succeeded-with-progress`.
3. Verify GREEN; commit.

**Done when:**
- [test] A conductor test asserts a `build` attempt that exits 0 and is judged `no_task_progress` leaves its capture directory on disk with a `provider_transcripts_retained` event.
- [test] A conductor test asserts a failed `build_review` leaves every rubric member's capture on disk with a retained event per member.
- [test] A conductor test asserts a `build` attempt resolving 7→8 tasks has its capture directory removed and a `provider_transcripts_pruned` event.
- [test] A conductor test asserts after attempt 1 fails and attempt 2 succeeds with progress, the attempt-1 capture remains and only the attempt-2 capture is removed.
- [test] A test asserts a capture written before a simulated restart (new retention instance, no settle) is still on disk and the new instance persists a `provider_transcripts_retained` record for it.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — construct retention, settle at outcome points
- `src/conductor/test/engine/conductor-transcript-retention.test.ts` — new

**Dependencies:** Task 8, Task 9, Task 11

### Task 13: Cap retained captures per worktree
**Story:** Story 7 happy 1, happy 2, negative 1, negative 2
**Type:** happy-path

**Steps:**
1. Write failing tests on `TranscriptRetention`; export `TRANSCRIPT_RETENTION_MAX_CAPTURES = 20` and `TRANSCRIPT_RETENTION_MAX_BYTES = 1073741824` as the production defaults, with the byte cap injectable so tests use small files.
2. Implement `enforceCap()` after every retention: list retained capture dirs under `.pipeline/transcripts/*/*` ordered by captured timestamp (from the captured event, falling back to directory mtime), evict oldest-first until count ≤ 20 and total bytes ≤ 1 GiB, never evicting the newest; emit `provider_transcripts_evicted { reason }`; on an eviction error emit `retention_failed { action: 'evict' }` and stop evicting in that pass.
3. Verify GREEN; commit.

**Done when:**
- [test] A test asserts the production `TranscriptRetention` defaults are `TRANSCRIPT_RETENTION_MAX_CAPTURES` = 20 and `TRANSCRIPT_RETENTION_MAX_BYTES` = 1073741824 (1 GiB), and the conductor constructs retention without overriding them.
- [test] A test asserts retaining a 21st capture evicts exactly the oldest, leaves 20, and persists one `provider_transcripts_evicted` record naming it with reason `count`.
- [test] A test asserts captures totalling over the byte cap are evicted oldest-first until the total is at or below the byte cap, each with reason `size`.
- [test] A test asserts a single newest capture larger than the byte cap is kept while every older retained capture is evicted.
- [test] A test asserts an eviction that fails emits `retention_failed` with action `evict` and no other capture is removed in that pass.

**Files likely touched:**
- `src/conductor/src/engine/self-host/transcript-retention.ts` — cap
- `src/conductor/test/engine/self-host/transcript-retention.test.ts` — cap tests

**Dependencies:** Task 11

### Task 14: Declare a final-assistant-message extractor per provider
**Story:** Story 1 happy 1, happy 2 (extractor); Story 9 happy 2 (extraction), negative 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `transcript-format.test.ts` with fixture lines:
   - Claude: `type: "assistant"` records with `message.content[]` items `{type:"text", text}`.
   - Codex: `type: "response_item"`, `payload.type: "message"`, `payload.role: "assistant"`, `payload.content[]` items `{type:"output_text", text}`.
   - Pi: `type: "message"`, `message.role: "assistant"`, `message.content[]` items `{type:"text", text}`.
   Each fixture includes a malformed line after the last assistant message.
2. Implement the three extractors (concatenate text items of the last assistant record; skip unparseable lines; return `undefined` when none) and add `extractFinalAssistantMessage` to `SelfHostShape.transcripts` for each built-in.
3. Verify GREEN; commit.

**Done when:**
- [test] A test asserts each of the `claude`, `codex`, and `pi` descriptors' `transcripts.extractFinalAssistantMessage` returns the last assistant text from its provider-format fixture.
- [test] A test asserts a malformed JSON line is skipped and the last well-formed assistant message is returned.
- [test] A test asserts a fixture with no assistant record returns `undefined`.

**Files likely touched:**
- `src/conductor/src/engine/self-host/transcript-format.ts` — new
- `src/conductor/src/execution/provider-catalog.ts` — extractor member
- `src/conductor/test/engine/self-host/transcript-format.test.ts` — new

**Dependencies:** Task 1

### Task 15: `ai-conductor transcripts` lists captures and shows a final message
**Story:** Story 9 happy 1, happy 2, negative 1, negative 2, negative 3, negative 5, negative 6
**Type:** happy-path

**Steps:**
1. Write failing CLI tests that run the real CLI entry (as the existing `shipped-record` CLI tests do) against a temp repo with `.worktrees/«slug»/.pipeline/events.jsonl` and capture dirs for claude, codex, and pi.
2. Implement `detectTranscriptsCommand`/`dispatchTranscripts` in a new `transcripts-cli.ts`, routed from `src/conductor/src/index.ts` beside `shipped-record`. List: captures that have a `provider_transcripts_retained` event, are still on disk, and have no later pruned/evicted event, newest first (a pending capture is not listed), printing step, attempt, member, provider, interrupted, path. `--show «capture»`: pick the provider's top-level session file (Claude: `projects/*/*.jsonl` excluding paths with a `subagents/` segment; Codex/Pi: newest `sessions/**/*.jsonl`), extract, pass through `sanitizeTranscriptLine` before printing.
3. Verify GREEN; commit.

**Done when:**
- [test] A CLI test asserts `ai-conductor transcripts «slug»` prints each retained capture's step, attempt, member, provider, interrupted flag, and path newest first and exits 0.
- [test] A CLI test asserts `--show` prints the top-level session's final assistant message for a claude, a codex, and a pi capture and exits 0, and for a capture whose session ends with a malformed JSON line prints the last well-formed assistant message.
- [test] A CLI test asserts an unknown slug prints `no feature worktree for «slug»` and exits non-zero, and a slug with no retained captures prints `no retained transcripts for «slug»` and exits 0.
- [test] A CLI test asserts `--show` on a zero-file capture or one with no assistant message prints `no assistant message in «capture»` and exits non-zero.
- [test] A CLI test asserts a hand-placed capture containing `token=abc123` prints `token=[REDACTED]`, and a recursive mtime/content snapshot of the worktree is identical before and after every invocation.

**Files likely touched:**
- `src/conductor/src/engine/transcripts-cli.ts` — new
- `src/conductor/src/index.ts` — route the subcommand
- `src/conductor/test/engine/transcripts-cli.test.ts` — new

**Dependencies:** Task 2, Task 3, Task 14

### Task 16: Capture through a real self-host dispatch never changes its result
**Story:** Story 4 happy 1; Story 8 negative 2; Story 2 negative 3
**Type:** happy-path

**Steps:**
1. Write failing conductor tests through `runAdmittedSelfBuildDispatch` (the candidate `prepareCandidateSelfHost` path) with a fake provider runtime: (a) a successful dispatch run three times — capture disabled (the guardrails' harvester replaced by a no-op through the existing `guardrails` injection), capture enabled, and capture enabled with `.pipeline/transcripts` made unwritable; (b) a dispatch whose `EventPersister` append throws; (c) a dispatch whose provider exits with failure.
2. Implement only what the tests expose; Tasks 8–9 own the harvest itself. This task owns the cross-boundary proof that the conductor's self-host dispatch reaches the harvest and that harvest and persistence failures cannot reach the `StepRunResult`.
3. Verify GREEN; commit.

**Done when:**
- [test] A conductor test asserts a successful self-host dispatch produces a capture directory under `.pipeline/transcripts/«step»/` via the candidate provisioning path.
- [test] A conductor test asserts the `StepRunResult` with capture enabled and with an unwritable transcripts directory each deep-equal the `StepRunResult` with capture disabled.
- [test] A conductor test asserts when the event persister's append throws, the capture directory's files are byte-identical to those of the same dispatch with a working persister and the `StepRunResult` equals the capture-disabled baseline.
- [test] A conductor test asserts a self-host dispatch whose provider exits with failure produces a capture directory with the same transcript files as a successful dispatch of the same fixture.

**Files likely touched:**
- `src/conductor/test/engine/conductor-transcript-capture.test.ts` — new
- `src/conductor/src/engine/conductor.ts` — only if the tests expose a leak

**Dependencies:** Task 8, Task 9

### Task 17: Teardown survives harvest faults and leaves no substitute files
**Story:** Story 2 negative 1 (home removed); Story 4 negative 2, negative 3; Story 8 negative 1
**Type:** negative-path

**Steps:**
1. Write failing tests in the provider-home test (codex) driving `ProviderHome.teardown()` with an events emitter wired to an `EventPersister` and an injected harvest fs seam: (a) a home with no matching transcript; (b) a transcript file deleted between walk and read; (c) `ENOSPC` on the second file's write.
2. Implement only what the tests expose in teardown's harvest call; the fault handling itself is Task 6's.
3. Verify GREEN; commit.

**Done when:**
- [test] A test asserts teardown of a home with no matching transcript persists a `provider_transcripts_captured` record with `files: 0` and the home directory no longer exists.
- [test] A test asserts teardown with a transcript vanishing mid-harvest resolves, the remaining files are captured, and the home directory no longer exists.
- [test] A test asserts teardown with `ENOSPC` mid-copy persists one `provider_transcripts_harvest_failed` record carrying step, runId, attempt, provider, capture path, and the `ENOSPC` error text, leaves no capture directory, and the home directory no longer exists.
- [test] A test asserts after each fault case `.pipeline/transcripts` contains no file outside a capture directory's transcript paths (no index, marker, or sidecar file).

**Files likely touched:**
- `src/conductor/test/engine/self-host/provider-home.test.ts` — fault-path teardown tests
- `src/conductor/src/engine/self-host/provider-home.ts` — only if the tests expose a gap

**Dependencies:** Task 6, Task 9

### Task 18: The conductor settles captures for non-build steps and survives retention faults
**Story:** Story 6 happy 2 (HALT, needs-human), happy 3 (non-build steps), negative 3
**Type:** happy-path

**Steps:**
1. Write failing conductor tests with the Task 12 harness: (a) a `test_suite` self-host dispatch that succeeds; (b) a `build` dispatch that ends in a HALT; (c) a `build` dispatch whose halt class is needs-human; (d) a successful `test_suite` dispatch whose capture prune fails with a permission error.
2. Implement only what the tests expose in the Task 12 settle calls.
3. Verify GREEN; commit.

**Done when:**
- [test] A conductor test asserts a successful `test_suite` self-host dispatch has its capture directory removed and a `provider_transcripts_pruned` record persisted.
- [test] A conductor test asserts a `build` dispatch ending in a HALT and one ending needs-human each leave their capture directory with a `provider_transcripts_retained` record.
- [test] A conductor test asserts when the prune for a successful `test_suite` fails, the persisted `step_completed` event and the next dispatched step are the same as in the prune-succeeds run.

**Files likely touched:**
- `src/conductor/test/engine/conductor-transcript-retention.test.ts` — non-build and fault cases
- `src/conductor/src/engine/conductor.ts` — only if the tests expose a gap

**Dependencies:** Task 12

## Task Dependency Graph

```
T1 ─┬─> T4 ─┬─> T5
    │       ├─> T6
    │       └─> T10
    └─> T14 ─> T15
T3 ──> T4, T15
T2 ──> T8, T9, T10, T11, T15
T7 ──> T8, T9, T10
T4, T6 ──> T8, T9
T8, T9, T11 ──> T12
T11 ──> T13
T8, T9 ──> T16
T6, T9 ──> T17
T12 ──> T18
```

Authoritative edges are the per-task `**Dependencies:**` lines.

## Integration Points

- After Task 9: a real teardown of any self-host home produces a capture.
- After Task 12: verdict-driven keep/prune is live in the conductor.
- After Task 15: an operator can read captures from the CLI.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the built-in provider catalog, when the self-host shape of `claude` is read, then it declares the transcript allowlist `projects/**/*.jsonl` and a final-assistant-message extractor. | 1, 14 | "`claude` declares `projects/**/*.jsonl`" | diff-local |
| Story 1 happy: Given the built-in provider catalog, when the self-host shape of `codex` or `pi` is read, then each declares the transcript allowlist `sessions/**/*.jsonl` and a final-assistant-message extractor. | 1, 14 | "`codex` and `pi` each declare `sessions/**/*.jsonl`" | diff-local |
| Story 1 negative: Given a built-in provider descriptor that declares self-host support but omits the transcript allowlist, when the conductor package is type-checked, then compilation fails naming the missing field. | 1 | "produces a type error whose message names the missing property `transcripts`" | diff-local |
| Story 1 negative: Given a built-in provider descriptor whose transcript allowlist is an empty list, when the provider catalog is validated at load, then validation rejects it with an error naming the provider id and the empty allowlist. | 1 | "with an error naming the provider id and `transcripts.globs`" | diff-local |
| Story 2 happy: Given a self-host `build` dispatch through the Claude config sandbox whose home contains `projects/«cwd»/«session».jsonl` and `projects/«cwd»/«session»/subagents/«agent».jsonl`, when the attempt ends and the home is torn down, then both files exist under `«worktree»/.pipeline/transcripts/build/«runId»-a«attempt»-claude/` at the same paths relative to the home, and the home directory no longer exists. | 8, 4 | "both seeded files exist under" | diff-local |
| Story 2 happy: Given a self-host dispatch through a Codex or Pi provider home containing `sessions/2026/10/10/rollout-x.jsonl`, when the home is torn down, then that file exists under `«worktree»/.pipeline/transcripts/«step»/«runId»-a«attempt»-«provider»/sessions/2026/10/10/rollout-x.jsonl`, and the home directory no longer exists. | 9 | "for both `codex` and `pi`" | diff-local |
| Story 2 happy: Given concurrent `build_review` rubric members sharing a run and attempt, when each member's home is torn down, then each member's transcripts land in its own `«runId»-a«attempt»-«member»-«provider»` directory and no member's capture overwrites another's. | 9, 8 | "torn down concurrently write to `«runId»-a1-rubric-a-«provider»`" | diff-local |
| Story 2 happy: Given a transcript line containing a bearer token, an API key, or an authorization header inside a JSON string value, when it is captured, then that string value is replaced by the sanitized form `redactSafetyText` produces, the line is still valid JSON, and lines with nothing to redact are semantically unchanged. | 3 | "each inside a JSON string value are replaced by `redactSafetyText`'s form" | diff-local |
| Story 2 happy: Given a transcript line whose JSON object has a key named `token`, `api_key`, `secret`, `password`, `credential`, or `authorization` (any case), when it is captured, then that key's value is `[REDACTED]` in the capture. | 3 | "`token`, `api_key`, `secret`, `password`, `credential`, and `authorization` in mixed case" | diff-local |
| Story 2 happy: Given a transcript line that is not valid JSON and contains `token=abc123`, when it is captured, then the captured line contains `token=[REDACTED]` and not `abc123`. | 3 | "a non-JSON `token=abc123` line becomes `token=[REDACTED]`" | diff-local |
| Story 2 negative: Given a provider home that contains no file matching its allowlist, when it is torn down, then a capture is still recorded with zero files, no capture directory content is fabricated, and the home is removed. | 4, 17 | "teardown of a home with no matching transcript persists a `provider_transcripts_captured` record with `files: 0` and the home directory no longer exists" | diff-local |
| Story 2 negative: Given a teardown invoked twice on the same home, when the second teardown runs, then no second capture is created and no error is raised. | 8 | "a second `teardown()` emits no second `provider_transcripts_captured` event" | diff-local |
| Story 2 negative: Given an attempt that exits with failure, when its home is torn down, then its transcripts are captured exactly as for a successful exit. | 16 | "whose provider exits with failure produces a capture directory with the same transcript files" | diff-local |
| Story 2 negative: Given the same step dispatched for a second attempt, when the second home is torn down, then its capture is written to a distinct `a«attempt»` directory and the first attempt's capture is unchanged. | 9 | "attempt 2 writes to an `-a2-` directory" | diff-local |
| Story 3 happy: Given a Codex or Pi home containing `auth.json` alongside a session transcript, when it is captured, then the capture contains the transcript and contains no `auth.json`. | 9, 4 | "with no `auth.json`" | diff-local |
| Story 3 happy: Given a Claude sandbox home containing `.claude.json`, `settings.json`, and symlinked `skills/` and `hooks/` directories alongside a transcript, when it is captured, then the capture contains only the transcript. | 4 | "the destination contains no `auth.json`, `.claude.json`, `settings.json`" | diff-local |
| Story 3 negative: Given a home in which a path matching the allowlist is a symlink to a file outside the home, when it is captured, then that path is not copied and the capture records it as skipped. | 5 | "a symlinked `link.jsonl` is not in the destination" | diff-local |
| Story 3 negative: Given a home in which a directory on an allowlisted path is a symlink that leaves the home, when it is captured, then nothing beneath that symlink is copied. | 5 | "nothing beneath a symlinked `sessions/` directory appears" | diff-local |
| Story 3 negative: Given a home containing `projects/x/notes.txt` (outside the `*.jsonl` allowlist), when it is captured, then `notes.txt` is not copied. | 4 | "`notes.txt`" | diff-local |
| Story 3 negative: Given an allowlisted transcript in which a tool result or provider error echoed the contents of `auth.json`, when it is captured, then no credential value from that file appears anywhere in the capture. | 9, 3 | "no string value of that `auth.json`" | diff-local |
| Story 3 negative: Given the sanitizer throws on a line, when capture runs, then that line is omitted from the capture and the omission is reported, rather than written unsanitized. | 5 | "a line whose sanitization throws is absent from the written file" | diff-local |
| Story 4 happy: Given a successful attempt whose capture succeeds, when teardown completes, then the step result is identical to what it would be with capture disabled. | 16 | "each deep-equal the `StepRunResult` with capture disabled" | diff-local |
| Story 4 negative: Given the capture destination cannot be written (for example, the transcripts directory is not writable), when teardown runs, then a harvest-failed event names the step, attempt, provider, and error, the home is still removed, and the step result is unchanged. | 8, 16 | "one `provider_transcripts_harvest_failed` event naming step, attempt, provider `claude`, and the error is emitted" | diff-local |
| Story 4 negative: Given a transcript file disappears between matching and copying, when capture runs, then the remaining files are copied, the missing file is reported, and teardown completes. | 6, 17 | "teardown with a transcript vanishing mid-harvest resolves" | diff-local |
| Story 4 negative: Given the disk fills partway through a capture, when the copy fails, then the partial capture is removed or marked incomplete, a harvest-failed event is emitted, and the home is still removed. | 6, 17 | "teardown with `ENOSPC` mid-copy persists one `provider_transcripts_harvest_failed` record" | diff-local |
| Story 5 happy: Given an orphaned provider home whose lease names a dead owner and which contains a transcript, when the dead-owner sweep reclaims it, then the transcript is captured before the home is removed and the capture is marked interrupted. | 10 | "a captured event has `interrupted: true`" | diff-local |
| Story 5 happy: Given an interrupted capture, when retention runs, then it is retained regardless of any later verdict. | 11 | "an interrupted capture is retained and stays on disk" | diff-local |
| Story 5 negative: Given a home whose lease is missing, unreadable, or whose owner is still alive, when the sweep runs, then the home is neither captured nor removed (existing retention behavior unchanged). | 10 | "missing-lease, unreadable-lease, and live-owner homes produce no capture directory" | diff-local |
| Story 5 negative: Given capture fails during a sweep reclaim, when the sweep continues, then a harvest-failed event is emitted and the sweep's reclaim decision for that home is unchanged. | 10 | "a forced harvest failure emits `provider_transcripts_harvest_failed`" | diff-local |
| Story 6 happy: Given a `build` attempt that exits 0 and is then judged `no_task_progress`, when the verdict is settled, then that attempt's capture is retained. | 12 | "judged `no_task_progress` leaves its capture directory on disk" | diff-local |
| Story 6 happy: Given any self-host step attempt that fails, or ends in any `build_stall` reason, a HALT, or a needs-human outcome, when the verdict is settled, then that attempt's captures (including every rubric member's) are retained. | 11, 12, 18 | "`failed`, `stalled`, `halted`, `needs-human`, and `succeeded-without-progress` each persist a `provider_transcripts_retained` record naming each capture path" | diff-local |
| Story 6 happy: Given a self-host step attempt that succeeds and, for `build`, resolves at least one task, when the verdict is settled, then that attempt's captures are pruned from disk. | 12, 18 | "a successful `test_suite` self-host dispatch has its capture directory removed" | diff-local |
| Story 6 happy: Given attempt 1 of a step failed and attempt 2 succeeds, when attempt 2's verdict is settled, then attempt 1's capture remains retained and only attempt 2's is pruned. | 12 | "the attempt-1 capture remains and only the attempt-2 capture is removed" | diff-local |
| Story 6 negative: Given the daemon dies after a capture is written but before its verdict is settled, when the daemon restarts, then the capture is still on disk and is not pruned. | 12 | "a capture written before a simulated restart (new retention instance, no settle) is still on disk and the new instance persists a `provider_transcripts_retained` record for it" | diff-local |
| Story 6 negative: Given a step outcome that the retention mapping does not recognize, when the conductor package is type-checked, then compilation fails (the mapping has no default arm). | 11 | "no `default` arm ending in `assertNever`" | diff-local |
| Story 6 negative: Given a prune fails (for example, a permission error), when retention runs, then the failure is reported on the spine and the step's outcome is unchanged. | 11, 18 | "the persisted `step_completed` event and the next dispatched step are the same" | diff-local |
| Story 7 happy: Given 20 retained captures in a worktree, when a 21st is retained, then the oldest retained capture is evicted and an eviction event names it. | 13 | "retaining a 21st capture evicts exactly the oldest" | diff-local |
| Story 7 happy: Given retained captures totalling more than 1 GiB, when retention runs, then the oldest retained captures are evicted until the total is at or below 1 GiB. | 13 | "`TRANSCRIPT_RETENTION_MAX_BYTES` = 1073741824 (1 GiB)" | diff-local |
| Story 7 negative: Given a single retained capture larger than 1 GiB, when retention runs, then that newest capture is kept and every older retained capture is evicted (the most recent evidence is never evicted by the size cap). | 13 | "`TRANSCRIPT_RETENTION_MAX_BYTES` = 1073741824 (1 GiB)" | diff-local |
| Story 7 negative: Given eviction of a capture fails, when retention runs, then the failure is reported on the spine and no other retained capture is evicted in its place. | 13 | "an eviction that fails emits `retention_failed` with action `evict`" | diff-local |
| Story 8 happy: Given a capture is written, when it completes, then a captured event is persisted with step, run id, attempt, member (when present), provider, capture path, file count, total bytes, and whether it was interrupted. | 2, 8 | "holds one `provider_transcripts_captured` record for that path with step, runId, attempt, provider, files, and bytes" | diff-local |
| Story 8 happy: Given a capture is retained, pruned, or evicted, when that happens, then a retained, pruned, or evicted event is persisted naming the capture path. | 11, 13 | "persists to `events.jsonl` one `provider_transcripts_pruned` record naming each pruned capture path" | diff-local |
| Story 8 negative: Given a capture or retention failure, when it occurs, then the corresponding failure event carries the capture identity and error text, and no index or sidecar file is written as a substitute. | 17, 11 | "contains no file outside a capture directory's transcript paths (no index, marker, or sidecar file)" | diff-local |
| Story 8 negative: Given the event persister cannot append, when a capture event is emitted, then the capture on disk is unaffected and the dispatch outcome is unchanged. | 16 | "the capture directory's files are byte-identical to those of the same dispatch with a working persister" | diff-local |
| Story 9 happy: Given a feature with retained captures, when the operator runs `ai-conductor transcripts «slug»`, then each retained capture is listed with step, attempt, member, provider, interrupted flag, and path, newest first, and the command exits 0. | 15 | "prints each retained capture's step, attempt, member, provider, interrupted flag, and path newest first" | diff-local |
| Story 9 happy: Given a retained Claude, Codex, or Pi capture, when the operator runs `ai-conductor transcripts «slug» --show «capture»`, then the final assistant message of the top-level session is printed and the command exits 0. | 15, 14 | "`--show` prints the top-level session's final assistant message" | diff-local |
| Story 9 negative: Given an unknown slug, when the command runs, then it prints `no feature worktree for «slug»` and exits non-zero. | 15 | "an unknown slug prints `no feature worktree for «slug»`" | diff-local |
| Story 9 negative: Given a feature with no retained captures, when the command runs, then it prints `no retained transcripts for «slug»` and exits 0. | 15 | "prints `no retained transcripts for «slug»` and exits 0" | diff-local |
| Story 9 negative: Given a capture with zero files or whose transcript contains no assistant message, when `--show` runs, then it prints `no assistant message in «capture»` and exits non-zero. | 15 | "prints `no assistant message in «capture»`" | diff-local |
| Story 9 negative: Given a transcript with a malformed JSON line, when `--show` runs, then the malformed line is skipped and the last well-formed assistant message is printed. | 15, 14 | "prints the last well-formed assistant message" | diff-local |
| Story 9 negative: Given any invocation, when the command runs, then no file under the worktree is created, modified, or removed. | 15 | "content snapshot of the worktree is identical" | diff-local |
| Story 9 negative: Given a capture file that was placed in the transcripts directory by hand and contains an unsanitized token, when `--show` prints from it, then the printed output is sanitized with `redactSafetyText` as well. | 15 | "prints `token=[REDACTED]`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-retain-self-host-provider-transcripts#D1 | task | task-1, task-14 | produces a type error whose message names the missing property `transcripts` |
| adr-2026-10-10-retain-self-host-provider-transcripts#D2 | task | task-8, task-9, task-10, task-17 | a forced harvest failure emits `provider_transcripts_harvest_failed` |
| adr-2026-10-10-retain-self-host-provider-transcripts#D3 | task | task-3, task-8 | a known secret collected by `collectKnownSecrets` |
| adr-2026-10-10-retain-self-host-provider-transcripts#D4 | task | task-11, task-12, task-13, task-18 | judged `no_task_progress` leaves its capture |
| adr-2026-10-10-retain-self-host-provider-transcripts#D5 | task | task-2 | carries step, runId, attempt, member, provider, path, files, bytes, and interrupted |
| adr-2026-10-10-retain-self-host-provider-transcripts#D6 | task | task-15 | content snapshot of the worktree is identical |
| adr-2026-08-09-worktree-local-provider-scratch#D1 | existing | none | `resolveScratchHome` in `src/conductor/src/engine/self-host/provider-scratch.ts` already resolves `«worktree»/.daemon/scratch/«runId»/«attempt»-«provider»`; this feature reads homes there and does not change placement |
| adr-2026-08-09-worktree-local-provider-scratch#D2 | task | task-7 | reads back with those values and its `runId` and `attempt` |
| adr-2026-08-09-worktree-local-provider-scratch#D3 | task | task-8, task-9 | `configDir` no longer exists |
| adr-2026-08-09-worktree-local-provider-scratch#D4 | task | task-10 | the dead-owner home is still reclaimed (the sweep decision equals the no-capture baseline) |
| adr-2026-08-09-worktree-local-provider-scratch#D5 | no-change | none | The run id stays injected by the caller: the conductor passes `identity.runId` at both provisioning sites and this feature only adds `step`; nothing reads `.pipeline/conduct-session-id` |
| adr-2026-08-09-worktree-local-provider-scratch#D6 | task | task-10 | missing-lease, unreadable-lease, and live-owner homes produce no capture directory, no captured event, and remain on disk |
| adr-2026-08-09-worktree-local-provider-scratch#D7 | no-change | none | `verifyTokenLiveness` is a foreground CLI probe with no provider transcripts to preserve; no task touches `token-liveness.ts` |
| adr-2026-08-09-worktree-local-provider-scratch#D8 | task | task-2 | carries step, runId, attempt, member, provider, path, files, bytes, and interrupted |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
