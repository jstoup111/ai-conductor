**Status:** Accepted

# Stories: Non-blocking plan-scope containment recorder

**Track:** Technical (no PRD — acceptance criteria live here)
**Tier:** M
**Source:** intake `jstoup111/ai-conductor#1390`
**Authoritative design:** `adr-2026-08-09-non-blocking-plan-scope-containment` (D1–D4),
`adr-2026-08-09-hook-owned-containment-event-ledger` (E1–E3)
**Review conditions:** `architecture-review-2026-08-09-out-of-plan-production-edits-reach-build-review-in` (C1–C6)

> **Scope note.** Intake #1390's first desired outcome asks that an out-of-scope commit be
> *refused*. By operator direction these stories deliberately assert the opposite: the commit
> always lands. Detection, rationale, and durable recording replace refusal. Any future story
> asserting a refusal contradicts `adr-2026-08-09-non-blocking-plan-scope-containment` D3.

---

## Story 1: Adjacent test files and same-directory neighbors no longer read as out-of-scope

**Requirement:** D1

As a BUILD agent, I want a commit that touches a declared file's test sibling or a neighbor in the
same declared directory to count as inside my task's scope, so that ordinary, necessary edits
produce no advisory and no widening record.

### Acceptance Criteria

#### Happy Path
- Given task 3 is `in_progress` and declares `src/conductor/src/engine/config.ts`, when a commit
  stages `src/conductor/src/engine/config.ts` and `src/conductor/src/engine/config.test.ts`, then
  the containment evaluator reports allowed and `scope-check` exits 0 with no output on stderr.
- Given task 3 declares `src/conductor/src/engine/config.ts`, when a commit stages
  `src/conductor/src/engine/resolved-config.ts` (same directory), then the evaluator reports
  allowed and no widening is recorded.
- Given task 3 declares `src/conductor/src/engine/config.ts`, when a commit also stages
  `docs/reference/configuration.md` and `CHANGELOG.md`, then both are treated as
  docs/generated artifacts, the evaluator reports allowed, and no widening is recorded.
- Given task 3 declares `src/conductor/src/engine/config.ts`, when a commit stages a fixture under
  a test directory that corresponds to that declared file, then the evaluator reports allowed.

#### Negative Paths
- Given task 3 declares `src/conductor/src/engine/config.ts`, when a commit stages
  `src/conductor/src/daemon/backlog.ts` (different directory, unrelated), then the evaluator
  reports NOT allowed and names exactly `src/conductor/src/daemon/backlog.ts` as offending — the
  widened floor must not swallow a genuinely unrelated path.
- Given a task whose declared file list is empty, when any commit is made, then the evaluator
  reports allowed and the widened-floor logic is never consulted (existing not-applicable path is
  preserved).
- Given a task declaring a bare suffix such as `config.ts` (plans commonly name suffixes), when a
  commit stages `src/conductor/src/engine/config.test.ts`, then sibling matching resolves against
  the same `/`-boundary rule `fileMatchesPlanPath` already uses and does not match
  `src/other/unrelated-config.test.ts`.
- Given a declared path in a flat directory containing many unrelated modules, when a commit stages
  one of those unrelated modules, then it is allowed by the same-directory rule and no advisory is
  emitted — this is the accepted R3 weakening, and a test pins it as intended behavior so a later
  reader does not treat it as a bug.
- Given a declared file path that does not exist on disk, when containment is evaluated, then the
  evaluator does not throw and treats the declaration as a plain path pattern.

### Done When
- [ ] `evaluateScopeContainment` allows a declared file's test sibling, a same-directory neighbor,
      and a docs/generated path, proven by unit tests for each of the three additions separately.
- [ ] `evaluateScopeContainment` still reports NOT allowed, with the exact offending path list, for
      a file in an undeclared directory.
- [ ] Sibling and neighbor matching reuse `fileMatchesPlanPath`'s `/`-boundary semantics — a test
      asserts `src/other/unrelated-config.test.ts` does not match a declaration of `config.ts`.
- [ ] The three floor additions apply unconditionally, with no dependency on
      `build_review.scopeContainmentEnforced` — proven by a test with the flag `false`.

---

## Story 2: An out-of-floor path is recorded with a rationale, never left unexplained

**Requirement:** D2

As `build_review`, I want every out-of-floor path to arrive with a stated reason, so that I can
judge whether the widening was legitimate instead of kicking the build back for an unexplained
bundled change.

### Acceptance Criteria

#### Happy Path
- Given a commit whose message carries `Scope: src/conductor/src/engine/smoke-runner.ts — required
  to unblock the task's test run`, when that path is outside the floor, then a widening is recorded
  carrying the path, the rationale verbatim, the task id, the commit sha, and `derived: false`.
- Given a commit with an out-of-floor path and **no** `Scope:` trailer, when containment is
  evaluated, then a widening is recorded whose rationale is drawn from the commit's own subject and
  body and which is flagged `derived: true`.
- Given a commit with two out-of-floor paths and a `Scope:` trailer for only one of them, when
  containment is evaluated, then the trailered path records `derived: false` with its verbatim
  rationale and the other records `derived: true` with the message-derived rationale.
- Given recorded widenings exist for a build, when `build_review` inputs are assembled, then each
  appears in the `## Engine-accepted scope widenings` prompt section with its `derived` state
  distinguishable from an authored trailer.

#### Negative Paths
- Given a commit with an out-of-floor path and an empty commit body (subject only), when the
  rationale is derived, then the subject alone is recorded and the rationale is never written as an
  empty string, `null`, or the literal word "unexplained".
- Given a commit message containing a newline-laden body, a double quote, and a backslash, when the
  rationale is derived and appended to the ledger, then the record is produced with `JSON.stringify`
  and re-reads as exactly one well-formed JSON line — a crafted message cannot split or forge a
  record (condition C2).
- Given a `Scope:` trailer naming a path that is **not** in the staged set, when trailers are
  parsed, then that trailer is ignored (existing `parseScopeTrailers` behavior) and the real
  out-of-floor path still receives a derived rationale rather than silently borrowing the trailer's.
- Given a malformed `Scope:` line missing the ` — ` separator, when trailers are parsed, then it is
  not treated as a widening and the affected path falls back to a derived rationale.
- Given a commit message whose derived rationale would be extremely long, when the record is
  written, then the value is bounded to a documented maximum and truncation is visible in the
  recorded value rather than silently corrupting the line.

### Done When
- [ ] A widening record carries `path`, `rationale`, `taskId`, `sha`, and a boolean `derived`.
- [ ] With a `Scope:` trailer present the rationale is byte-identical to the trailer's rationale and
      `derived` is `false`; with none it is message-derived and `derived` is `true`.
- [ ] No code path can produce a widening whose rationale is empty — proven by a test over a
      subject-only commit.
- [ ] A commit message containing `"`, `\`, and embedded newlines produces exactly one parseable
      JSONL line, proven by writing then re-reading the ledger.
- [ ] `build-review-prompt.ts` renders the `derived` state for each widening.

---

## Story 3: The containment check never blocks a commit

**Requirement:** D3

As a BUILD agent, I want the containment check to be advisory only, so that no commit is ever
refused at the commit boundary and the common path carries no added friction.

### Acceptance Criteria

#### Happy Path
- Given a commit with every staged path inside the floor, when the `commit-msg` hook runs, then
  `scope-check` exits 0, writes nothing to stderr, and the commit lands.
- Given a commit with an out-of-floor path, when the `commit-msg` hook runs, then the commit
  **lands**, and stderr carries an advisory naming the task id, each offending path, and the exact
  `Scope: <path> — <rationale>` line to add next time.
- Given the advisory is emitted, when its text is inspected, then it reads as advice rather than
  refusal — the word "refusing" no longer appears (`renderScopeRefusal` reworded).

#### Negative Paths
- Given a commit with an out-of-floor path, when the hook completes, then `scope-check` does not
  return exit 2 and the hook does not execute `exit 1` — asserted directly, because an accidental
  restoration of the refusal branch is the single most damaging regression this feature can suffer.
- Given exit code 2, when the CLI's exit-code space is inspected, then 2 is unused and reserved for
  a future enforcement decision (condition C4) — no code path returns it.
- Given a merge commit, an amend, or a commit replayed during a rebase, when the hook runs, then the
  existing exemptions short-circuit before containment is evaluated and no widening is recorded.
- Given a commit with 200 staged out-of-floor paths, when the advisory is rendered, then output is
  bounded rather than printing an unbounded wall of text that buries the signal.
- Given the containment evaluator throws while classifying paths, when the hook runs, then the
  commit still lands (see Story 4 for how the failure is recorded).

### Done When
- [ ] An integration test performs a real `git commit` with an out-of-floor staged path against the
      generated hook and asserts the commit object exists afterward.
- [ ] The same test asserts the advisory text is present on stderr and contains the task id, the
      offending path, and a copy-pasteable `Scope:` line.
- [ ] A test asserts no `runScopeCheck` code path returns 2.
- [ ] `grep` over the rendered advisory confirms the refusal wording is gone.

---

## Story 4: A check that cannot reach a verdict is recorded, not swallowed

**Requirement:** E1, E3

As an operator diagnosing containment behavior, I want a crashed or unresolvable check to leave a
durable record, so that a tool bug is visible in the build record instead of scrolling past as one
line of stderr.

### Acceptance Criteria

#### Happy Path
- Given a commit with no `Task:` trailer, when `scope-check` runs, then it exits **0** silently and
  records nothing — not-applicable is no longer conflated with failure.
- Given a task that is not `in_progress`, or a task declaring no files, when `scope-check` runs,
  then it exits 0 silently and records nothing.
- Given `.pipeline/task-status.json` contains malformed JSON, when `scope-check` runs, then it exits
  **3**, records an event carrying the failure classification, the task id where resolvable, and
  `ts`, and the commit still lands.
- Given the recorded event exists, when the engine reads the build record, then the unresolved check
  is visible to bus consumers through the normal merged-ledger path.

#### Negative Paths
- Given `.pipeline/task-status.json` is absent entirely, when `scope-check` runs, then the outcome
  is classified as not-applicable (exit 0) rather than a failure — an unstarted build must not
  generate a stream of failure events.
- Given the `conduct-ts` binary does not recognize the `scope-check` subcommand (the observed
  stale-binary case, where a CLI usage banner printed and exit 1 followed), when the hook runs, then
  the hook allows the commit and its fallback branch is exercised without error.
- Given a consumer still running the previously generated hook, when the CLI returns the new exit 3,
  then the old hook's existing non-0/non-2 branch handles it and the commit lands — degraded
  observability, never a broken commit.
- Given the ledger's parent directory is not writable, when an event would be recorded, then the
  write failure is swallowed and the commit still lands (condition C3).
- Given the check throws inside the evaluator after the task resolved successfully, when the hook
  runs, then exit 3 is returned rather than the old catch-all exit 1.

### Done When
- [ ] `runScopeCheck` returns 0 for all three not-applicable conditions and 3 for an unresolvable
      one, proven by a test per condition.
- [ ] A new variant is added to the `ConductorEvent` union in `src/conductor/src/types/events.ts`
      carrying the failure classification, the resolvable task id, and `ts`.
- [ ] A test makes the ledger path unwritable, performs a real commit, and asserts the commit exists
      and no error surfaced to the committing process.
- [ ] The generated hook's branch for a non-0/non-2 exit is exercised by a test proving the commit
      lands.

---

## Story 5: Hook-authored events go to a single-writer sibling ledger in the shared schema

**Requirement:** E2, E3

As a consumer of conductor telemetry, I want hook-authored events written in the existing
`ConductorEvent` schema to their own ledger, so that there is one union and one reader path and no
risk of corrupting `.pipeline/events.jsonl` by cross-process append.

### Acceptance Criteria

#### Happy Path
- Given `scope-check` records an event, when the write occurs, then it appends one JSON line to
  `.pipeline/hook-events.jsonl` and never to `.pipeline/events.jsonl`.
- Given records exist in both ledgers, when a reader merges them, then the result is ordered by `ts`
  and every record parses against the same `ConductorEvent` union with no second schema or adapter.
- Given a worktree that has never run the hook, when a reader looks for the sibling ledger, then the
  absence is tolerated and the condition is reported as unrecorded rather than raising.

#### Negative Paths
- Given `.pipeline/events.jsonl` exists, when the hook records an event, then the engine ledger's
  bytes are unchanged — asserted, because a cross-process append to it is the specific corruption
  exception B exists to prevent.
- Given two commits are made in rapid succession in the same worktree, when both record events, then
  both lines are well-formed and neither is interleaved or truncated.
- Given two different worktrees commit concurrently, when each records an event, then each writes
  only to its own `.pipeline/hook-events.jsonl` and neither observes the other's records.
- Given `.pipeline/hook-events.jsonl` contains one malformed line from an earlier failure, when a
  reader merges the ledgers, then the damage is confined to hook-authored records and the engine
  ledger's records remain readable.
- Given the disk is full when an event is recorded, when the append fails, then the failure is
  swallowed and the commit lands (condition C3).

### Done When
- [ ] Events are appended only to `.pipeline/hook-events.jsonl`; a test asserts
      `.pipeline/events.jsonl` is byte-identical before and after a hook-recorded event.
- [ ] Appended records validate against the existing `ConductorEvent` union — no new schema, no
      bespoke field naming.
- [ ] A reader merges both ledgers by `ts` and tolerates either being absent, proven by tests for
      absent-sibling and absent-engine cases.
- [ ] A test writes a malformed line into the sibling ledger and asserts engine-ledger records are
      still readable.

---

## Story 6: Consumer behavior is unchanged; this repository opts itself in

**Requirement:** D4, C5

As a consumer of the harness, I want the recording behavior off by default, so that updating past
this release changes nothing about how my builds behave until I choose otherwise.

### Acceptance Criteria

#### Happy Path
- Given a consumer project with no `build_review` block in its config, when the check runs, then
  `scopeContainmentEnforced` resolves to `false`, no widening is recorded, and no advisory is
  emitted — behavior identical to today.
- Given this repository's own `config.yml` sets `build_review.scopeContainmentEnforced: true`, when
  a self-host build runs, then out-of-floor paths are recorded and advisories are emitted.
- Given the key resolves to either value, when the floor is evaluated, then the three floor
  additions apply regardless — widening the floor is unconditional (D1).

#### Negative Paths
- Given a config sets `build_review.scopeContainmentEnforced` to a non-boolean, when the config is
  resolved, then the existing validation path rejects the value and the resolved setting falls back
  to `false` rather than to an enforcing state.
- Given the config file is unreadable or malformed, when `loadScopeCheckEnforcement` runs, then it
  returns the `false` default and does not throw into the hook.
- Given the shipped default constant is inspected, when the diff is reviewed, then
  `DEFAULT_SCOPE_CONTAINMENT_ENFORCED` is still `false` — a diff flipping it violates the operator's
  blast-radius direction (condition C5).
- Given the key's name no longer describes enforcement, when a reader consults the config
  reference, then the redefined meaning is documented and the key is **not** renamed — a rename
  would be a config-schema break requiring a migration block.

### Done When
- [ ] A test asserts `DEFAULT_SCOPE_CONTAINMENT_ENFORCED` resolves `false` with no config block.
- [ ] A test asserts an unreadable or malformed config yields `false` and does not throw.
- [ ] This repository's `config.yml` carries `build_review.scopeContainmentEnforced: true`.
- [ ] A test asserts the widened floor applies with the flag `false`.
- [ ] No rename of `scopeContainmentEnforced` appears in the diff.
