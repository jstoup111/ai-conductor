# Implementation Plan: Daemon log lines are readable to operators (#2867, covers #2367)

**Date:** 2026-10-09
**Design:** .docs/decisions/architecture-review-2026-10-09-daemon-log-lines-are-unreadable-to-operators.md
**Stories:** .docs/stories/daemon-log-lines-are-unreadable-to-operators.md
**Conflict check:** Clean as of 2026-10-09 (two prior-feature stories corrected in DECIDE; see `.docs/conflicts/daemon-log-lines-are-unreadable-to-operators.md`)

## Summary

Make `.daemon/daemon.log` readable: one line shape whose indentation encodes depth (#2367), a
verbose level on the existing `daemon_verbose` key, one line per logical message, once-per-dispatch
boilerplate, no UUIDs at default, retention logged per state change, findings named by title, a
provisional build_review FAIL followed by one final verdict, and a next action on every warning and
halt line. 20 tasks. This also delivers jstoup111/ai-conductor#2367.

## Technical Approach

- **Logger owns the line body (Tasks 1-3).** `src/conductor/src/engine/daemon-log.ts` gains
  `DaemonLogDepth` (0|1|2), `DaemonLogEntry { depth; text; moreAt? }`, `NextAction`
  (`{ kind: 'none'; why } | { kind: 'operator'; action }`), `formatNextAction`, and
  `composeDaemonLineBody`. Depth 0 text starts at column 0, depth 1 after `· `, depth 2 after `·   `.
  A plain string message is depth 0 with its leading whitespace removed. `createDaemonModeLogger`
  gains `verbose`. Every logical message is presented once and blank lines are dropped. *Forwarded*
  text (event payload text such as a step error or halt reason, and provider diagnostic output)
  collapses at default to its first line plus `(+N more lines; …)`, and whole-JSON forwarded text
  becomes `JSON payload (N bytes; …)`; verbose writes its continuation lines as `│ ` + the raw line.
  Multi-line text the daemon composes itself (per-file tables, the setup output tail required by
  adr-2026-07-09-setup-failure-triage) stays whole, with `│ ` continuations, at both verbosities.
  `createFeatureDaemonLogger` stops splitting lines itself and hands the whole message to the base
  logger, so feature-owned and daemon-wide messages collapse the same way. `runDaemonMode` passes
  `config.daemon_verbose`.
- **Presenter owns depth, level and severity (Tasks 4-11).** New module
  `src/conductor/src/engine/daemon-event-presenter.ts` holds `DAEMON_EVENT_PRESENTATION`, a mapped type
  over the rendered event types (`EVENT_SINKS` entries with `render: true`). It gives each a single
  `depth` and a `level`: `default`, `once-per-dispatch` or `verbose`.
  `createDaemonEventPresenter({ log, verbose })` hands each renderer case an output API:
  - `info(text)`;
  - `warning(text, next)` and `halt(text, next)`, where the `NextAction` parameter is required;
  - `detail(text)`, verbose-only, one depth deeper;
  - `once(key, …)` for once-per-dispatch memory.

  Depth always comes from the table, never from the case. The existing `renderDaemonEventUnsafe`
  cases move onto this API in three groups (Tasks 6-10). They drop their hand-built `${dot}`
  prefixes and move UUID-bearing identifiers into verbose-only text. `runDaemonMode` builds one
  presenter per dispatch in `beginFeatureRun`, one per recovery bus, and one daemon-lifetime presenter
  for the global subscriber.
- **Local patterns.** Render-once memory follows `renderedReclaimRetentions` in `daemon-cli.ts`:
  keyed by subject, re-renders on changed detail, forgets on a terminal transition. The new memories
  are instance-scoped, not module-level. Halt and retention next actions reuse `recoveryProcedure`
  (`src/conductor/src/engine/monitor/session.ts`) and the guided command `ai-conductor monitor all`.
  The verbose hint wording follows `worktree-prepare.ts`'s `(set daemon_verbose: true to echo them)`.
- **build_review verdict (Tasks 12-16).** `step_failed` gains optional
  `provisional: 'pending-adjudication'`. It is set from one extracted predicate,
  `buildReviewFailureEntersAdjudication`, which the conductor's build_review branch also uses to
  decide entry. A new `build_review_adjudicated` union member carries the outcome kind, an
  `overturned` flag, titled findings and verbose case detail. The conductor emits it exactly once on
  every exit of the adjudication branch, and the raw `this.log?.(outcome.trace)` is removed. Titles
  come from `projectBuildReviewAggregateSources`, which `effectiveBuildReviewFailureDetails` and the
  suppressed-finding event also use. The event spine verdict is: extend the union, no new channel.
- **Retention and raw lines (Tasks 17-20).** `createRetentionLogGate()` in `engine/daemon-rekick.ts`
  is constructed once per `runDaemonMode` and shared by the progress re-kick check, the episode-end
  sweep and the base-advance re-kick sweep. The routine fresh-session replacement stops logging.
  `formatDaemonWarning` and `formatDaemonHalt` in `daemon-log.ts` put next actions on raw warning and
  halt sites. A source audit keeps unrouted warning markers out of the daemon emitters.
- **Sequencing.** Logger first, then the presenter and its wiring, then case migrations, then the
  contract fixtures that need every case migrated. The build_review, retention and raw-line work is
  independent of the case migrations except where noted.

## Prerequisites

- None. `daemon_verbose` already exists and is validated as a boolean in `engine/config.ts`.

## Tasks

### Task 1: Daemon line-body shape, depth entries and next-action suffix
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-log.test.ts` for `composeDaemonLineBody`, `formatNextAction`, and string-message normalization through `createDaemonModeLogger` and `createFeatureDaemonLogger`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/daemon-log.ts`: `DaemonLogDepth`, `DaemonLogEntry`, `NextAction`, `formatNextAction`, `composeDaemonLineBody`. Both loggers accept `string | DaemonLogEntry`; a string is depth 0 with leading whitespace removed. Keep the `[daemon]`/feature-tag prefix composition and the start/resume/done transition suppression unchanged.
4. Verify GREEN; commit.

**Done when:**
- [test] `composeDaemonLineBody` returns the text at column 0 for depth 0, after `· ` for depth 1 and after `·   ` for depth 2, as asserted in `src/conductor/test/engine/daemon-log.test.ts`.
- [test] A feature logger built by `createFeatureDaemonLogger` over `createDaemonModeLogger` writes the string message `   ! [rejected] x` as a line whose body is `! [rejected] x`, at the column of the depth the emitter declared (depth 0), to both the live and the persisted sink.
- [test] `formatNextAction` renders `{ kind: 'operator', action: 'ai-conductor monitor all' }` as ` — next: ai-conductor monitor all` and `{ kind: 'none', why: 'the daemon retries automatically' }` as ` — no action needed: the daemon retries automatically`.

**Files likely touched:**
- src/conductor/src/engine/daemon-log.ts
- src/conductor/test/engine/daemon-log.test.ts

**Dependencies:** none

### Task 2: Forwarded-output collapse and continuation marker in the daemon logger
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-log.test.ts` for a 40-line forwarded feature-owned entry, a 40-line forwarded daemon-wide entry, blank lines, a whole-JSON forwarded line, an invalid-JSON forwarded line, verbose continuation, a forwarded first line that begins with whitespace, and a daemon-composed multi-line string.
2. Verify RED.
3. In `daemon-log.ts`, add `kind: 'authored' | 'forwarded'` to `DaemonLogEntry`; a plain string is `authored`. `createDaemonModeLogger({ …, verbose })` presents each logical message once:
   - drop blank and whitespace-only lines at both verbosities;
   - a `forwarded` entry at default collapses to its first line plus ` (+N more lines; full text in <moreAt> or set daemon_verbose: true to show them)`, with `<moreAt>` from the entry when present;
   - a `forwarded` entry at verbose writes its first line, then each continuation as `│ ` + the raw continuation;
   - a `forwarded` entry whose trimmed text parses as a JSON object or array becomes `JSON payload (<bytes> bytes; set daemon_verbose: true to show it)` at default; invalid JSON is unchanged;
   - an `authored` multi-line message writes every non-blank line at both verbosities, continuations as `│ ` + the line.

   `createFeatureDaemonLogger` passes the whole message to its base logger instead of splitting it, and exposes a `forwarded(text, moreAt?)` method.
4. Verify GREEN; commit.

**Done when:**
- [test] At default verbosity a forwarded feature-owned entry of 40 non-blank lines produces exactly one persisted line containing its first line and `+39 more lines`, and a forwarded 40-line entry logged through the daemon-wide logger with no feature tag is collapsed to one line the same way, as asserted in `src/conductor/test/engine/daemon-log.test.ts`.
- [test] With `verbose: true` the same 40-line forwarded entry, given depth 1, produces its first line with its body beginning at the depth-1 column (after `· `), followed by one line per non-blank continuation, each line body beginning with `│ ` and keeping that continuation's own leading spaces after the marker.
- [test] At both verbosities a multi-line message containing blank and whitespace-only lines writes no blank or whitespace-only line, and a daemon-authored plain-string message of several lines writes every non-blank line with each continuation line body beginning with `│ `.
- [test] At default verbosity a single-line forwarded entry that parses as a JSON object or array is written as one line containing `JSON payload` and its byte size, and the single-line forwarded entry `{not json` is written unchanged.
- [test] At default verbosity a forwarded entry whose first line is ` ! [rejected]  HEAD -> feat/x` produces no line body beginning with whitespace.

**Files likely touched:**
- src/conductor/src/engine/daemon-log.ts
- src/conductor/test/engine/daemon-log.test.ts

**Dependencies:** Task 1

### Task 3: runDaemonMode applies `daemon_verbose` to the daemon log
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing integration test that runs `runDaemonMode` twice through the existing bounded daemon-run harness (see `src/conductor/test/engine/daemon-log-feature-tags.acceptance.test.ts`), with `daemon_verbose` unset and then `true`. Have a feature emit a multi-line diagnostic and read `.daemon/daemon.log`.
2. Verify RED.
3. In `src/conductor/src/daemon-cli.ts` pass `verbose: config?.daemon_verbose ?? false` to `createDaemonModeLogger`; feature loggers inherit it. Make the provider diagnostic sink handed to provider execution (`beginFeatureRun`, `createSlugScopedProviderExecution`) log through the feature logger's `forwarded` method.
4. Verify GREEN; commit.

**Done when:**
- [test] Through `runDaemonMode` with `daemon_verbose` unset, a feature-owned multi-line provider diagnostic lands in `.daemon/daemon.log` as one collapsed line; with `daemon_verbose: true` it lands as its first line followed by `│ ` continuation lines.
- [test] In both runs every persisted line still begins with a timestamp and the `[daemon]` prefix, and feature-owned lines carry the feature's tag.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/daemon-log-verbosity.acceptance.test.ts

**Dependencies:** Task 2

### Task 4: Presentation table and per-dispatch event presenter
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-event-presenter.test.ts`.
2. Verify RED.
3. Create `src/conductor/src/engine/daemon-event-presenter.ts`:
   - `RenderedEventType`, the `ConductorEvent['type']` members whose `EVENT_SINKS` entry has `render: true`;
   - `DAEMON_EVENT_PRESENTATION`, mapped over `RenderedEventType`, with `{ depth; level: 'default' | 'once-per-dispatch' | 'verbose' }`;
   - `createDaemonEventPresenter({ log, verbose })`, returning `{ render(event) }`. Its per-case output API is `info`, `warning(text, next)`, `halt(text, next)`, `detail`, `once(key)` and `whenChanged(key, value)` (renders when `value` differs from the last value seen for `key`). Warning and halt append `formatNextAction(next)` after the logger's collapse summary of the first line (the suffix is never placed on a continuation line) and prefix the glyphs `⚠` and `✋`; depth comes from the table; instance-scoped once memory.

   Re-export `renderDaemonEvent(event, log)` as a wrapper over a lazily created daemon-lifetime presenter so unmigrated callers keep working. Assign every current rendered type a depth matching its current visual depth: depth 1 for `· ` lines, depth 2 for `·   ` lines, and depth 0 for undotted lines such as `kickback`, `navigation_back`, `provider_fallback` and `credentials_park_progress`. Assign levels per Tasks 6-10.
4. Verify GREEN; commit.

**Done when:**
- [test] A test asserts the keys of `DAEMON_EVENT_PRESENTATION` equal `renderedEventTypes()` exactly, so a rendered type with no declared depth and level fails the test.
- [test] Renders of one event type at `info` severity and at `warning` severity through one presenter both begin at that type's table depth column. A `once` key renders once per presenter instance and again in a new presenter instance, and `whenChanged` renders for values `a`, `b`, `a` in sequence but not for a repeated `a`.
- [test] A `verbose`-level type and a `detail` line write nothing when the presenter's `verbose` is false and write their line when it is true.
- [test] A type-level test marks `warning(text)` and `halt(text)` without a `NextAction` with `// @ts-expect-error`, and runtime assertions show both append `formatNextAction(next)` to the line.

**Files likely touched:**
- src/conductor/src/engine/daemon-event-presenter.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/daemon-event-presenter.test.ts

**Dependencies:** Task 1

### Task 5: Daemon dispatches render through a per-dispatch presenter
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write a failing wiring test in `src/conductor/test/engine/daemon-presenter-wiring.test.ts`. Drive two dispatches of one feature through the daemon's feature-run wiring, each emitting two identical `self_host_containment_verdict`, `self_host_boundary_fingerprint` and `session_policy` events on the feature event bus, and capture the feature logger.
2. Verify RED.
3. In `runDaemonMode` (`src/conductor/src/daemon-cli.ts`):
   - in `beginFeatureRun`, replace `renderEvent` with `createDaemonEventPresenter({ log: featureLog, verbose })`;
   - in `createSlugScopedProviderExecution` and `subscribeRecoverySessionOccurrences`, create one presenter per recovery dispatch (each call creates its own bus for one rebase-autoresolve or ci-fix dispatch, which is a separate dispatch from the feature run, so its once-memory is scoped to that recovery dispatch);
   - give the global subscriber one daemon-lifetime presenter.
4. Verify GREEN; commit.

**Done when:**
- [test] Through the daemon's feature-run wiring, every event of one dispatch reaches the same presenter: two dispatches of the same feature each render exactly one `self_host_containment_verdict` line, one `self_host_boundary_fingerprint` line and one `session_policy` line at default, although each dispatch emits each of those events twice with identical content.
- [test] A presenter built by `beginFeatureRun` receives `verbose` equal to the loaded `daemon_verbose`, as observed by a verbose-level line appearing only when `daemon_verbose: true`.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/daemon-presenter-wiring.test.ts

**Dependencies:** Tasks 3, 4, 7

### Task 6: build_review event lines through the presenter
**Story:** 3
**Type:** happy-path

**Steps:**
1. Update or add failing tests in `src/conductor/test/daemon-render-build-review-rubrics.test.ts` and `src/conductor/test/engine/daemon-render.test.ts`.
2. Verify RED.
3. Move these cases onto the presenter API:
   - `build_review_cache_discarded`, `remediation_adjudication_completed` (decision stops), `remediation_case_refuted`;
   - `build_review_rubric_started`, `build_review_read_only_capability`, `build_review_policy_resolved`, `build_review_policy_failed`;
   - `build_review_cache_hit`, `build_review_rubric_result`, `build_review_rubric_skipped`, `build_review_outer_verdict`, `build_review_rubric_infrastructure_failure`;
   - `build_review_scope_incomplete`, `build_review_stale_mirage_regrade`, `build_review_base`.

   Case ids move to `detail` (verbose). Warnings get next actions: policy/infra failures say `no action needed: the gate re-runs build_review`, and scope-incomplete says `next: ai-conductor monitor all`.
4. Verify GREEN; commit.

**Done when:**
- [test] Each build_review event type listed in Steps renders through the presenter at its table depth. The warning-severity renders end with a next-action suffix: `build_review_policy_failed`, `build_review_rubric_infrastructure_failure`, `build_review_scope_incomplete`, `build_review_cache_discarded`, and an `unavailable` `build_review_read_only_capability`.
- [test] At default verbosity a `remediation_adjudication_completed` with a decision stop renders the stop's owner, source count and rationale without its case id, and `remediation_case_refuted` renders without its case id; with `verbose: true` both include the case id.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts
- src/conductor/test/daemon-render-build-review-rubrics.test.ts
- src/conductor/test/engine/daemon-render.test.ts

**Dependencies:** Task 4

### Task 7: Provider, session and self-host event lines through the presenter
**Story:** 5
**Type:** happy-path

**Steps:**
1. Update or add failing tests in `src/conductor/test/daemon-render-provider-attempt.test.ts`, `src/conductor/test/engine/session-event-rendering.test.ts` and `src/conductor/test/engine/daemon-render.test.ts`.
2. Verify RED.
3. Move these cases onto the presenter, with the levels and memories below:
   - `provider_attempt`: lifecycle `preparing`, `running` and `settled` are verbose with the attempt id. `recovering` is a default warning naming step, recovery count and reason, with `no action needed: the supervisor replaces the attempt`. `exhausted` is a default halt naming step, `halted`, recovery count and reason, with `next: ai-conductor monitor all`. The attempt id appears only in verbose detail. The non-lifecycle `via <provider>` line is unchanged in content.
   - `provider_fallback`: a warning with `no action needed:` and its reason.
   - `session_policy`: once per dispatch per provider + reason.
   - `self_host_containment_verdict`: `whenChanged` keyed per dispatch on the `contained` value + reason, so every change renders, including a return to an earlier verdict.
   - `self_host_boundary_fingerprint`: first per dispatch at default, every one at verbose.
   - `self_host_dispatch_admission`, `contained_live_checkout_drift`, `credentials_park_progress`, `rate_limit` (`no action needed:` with the wait), `session_reset`.
   - Session occurrences (`session_command_refused`, `github_bypass_attempt`, `github_bypass_result`, `github_possible_bypass`, `session_event_delivery_diagnostic`): the default text names feature, provider and command or operation, and the dispatch and event ids move to verbose detail.
4. Verify GREEN; commit.

**Done when:**
- [test] At default verbosity `provider_attempt` lifecycle phases `preparing`, `running` and `settled` render nothing. `recovering` renders step, recovery count and timeout reason, and `exhausted` renders a halt line naming step, `halted`, recovery count and reason with a next-action suffix. None of these lines contains a UUID-shaped token. With `verbose: true` all five render with the attempt id.
- [test] Within one presenter, repeated `self_host_containment_verdict` events with the same `contained` value and reason render one line, and each change renders another, including the sequence contained → unavailable → contained rendering three lines. Repeated `self_host_boundary_fingerprint` events render only the first line at default and every line with `verbose: true`.
- [test] Within one presenter, `session_policy` events with the same provider and reason render one line at default, and a different provider or reason renders another line.
- [test] At default verbosity managed-session refusal and GitHub bypass occurrence lines name the feature, provider and command or operation and contain no UUID-shaped token; with `verbose: true` they include the dispatch and event ids.
- [test] `provider_fallback` and `rate_limit` lines end with ` — no action needed: ` followed by their reason, and a successful and a failed non-lifecycle `provider_attempt` both begin at the same depth column.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts
- src/conductor/src/engine/daemon-event-presenter.ts
- src/conductor/test/daemon-render-provider-attempt.test.ts
- src/conductor/test/engine/session-event-rendering.test.ts
- src/conductor/test/engine/daemon-render.test.ts

**Dependencies:** Task 4

### Task 8: Step lifecycle, gate, retry and kickback event lines through the presenter
**Story:** 6
**Type:** happy-path

**Steps:**
1. Update or add failing tests in `src/conductor/test/engine/daemon-render.test.ts`.
2. Verify RED.
3. Move these cases onto the presenter: `step_started`, `step_completed`, `parallel_started`, `parallel_completed`, `when_skip`, `step_failed` (non-provisional form), `step_interrupted`, `step_refused`, `step_status_write_refused`, `step_inapplicable`, `step_inapplicable_ignored`, `step_inapplicable_refused`, `step_retry`, `gate_verdict`, `kickback`, `navigation_back`, `operator_rewind`, `plan_growth`, `test_suite_verification`, `setup_repair`, `project_setup` and `memory_setup`.
   - `step_failed` is a warning. It passes `error` as forwarded text, collapsing a multi-line error to its first line through a `DaemonLogEntry.moreAt` of `<worktree>/.pipeline/events.jsonl`. Its next action is `no action needed: the step retries`, or `next: ai-conductor monitor all` when no retry remains.
   - `setup_repair` and `project_setup` pass any setup output tail as authored text, so it stays whole (adr-2026-07-09-setup-failure-triage D5).
   - `step_retry` says `no action needed:`. `kickback` and `gate_verdict` are info severity: `kickback` keeps the adr-2026-07-04 form, bold styling and depth 0, with only the first evidence line (whitespace collapsed) inline and any further evidence lines as verbose `detail` lines, so the kickback line itself never carries a collapse suffix; `gate_verdict` keeps its current text (make-every-gate-verdict-recoverable-from-the-event Story 2).
4. Verify GREEN; commit.

**Done when:**
- [test] A `step_failed` whose `error` has 40 lines renders at default as exactly one line containing the error's first line, `+39 more lines`, a pointer to the feature's `.pipeline/events.jsonl` and `daemon_verbose: true`; with `verbose: true` it renders its first line followed by 39 continuation lines whose bodies begin with `│ `.
- [test] `step_retry` lines end with ` — no action needed: ` followed by the retry reason, and the `kickback` line, including one with multi-line evidence, is info severity at depth 0 with exactly the adr-2026-07-04 single-line form `↩ KICKBACK: <from> re-opened <to> — <evidence> (×<count>)` and no next-action suffix.
- [test] `step_started`, `step_completed` and both satisfied and unsatisfied `gate_verdict` render with no next-action suffix, the unsatisfied gate line keeping its current text. The warning-severity renders each end with a next-action suffix: `step_failed`, `step_interrupted`, `step_refused`, `step_status_write_refused`, `step_inapplicable_ignored`, `step_inapplicable_refused`, and a rejected `setup_repair`.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/daemon-render.test.ts

**Dependencies:** Tasks 2, 4

### Task 9: Halt, finish, rebase and CI event lines through the presenter
**Story:** 7
**Type:** happy-path

**Steps:**
1. Update or add failing tests in `src/conductor/test/engine/daemon-render.test.ts`.
2. Verify RED.
3. Move these cases onto the presenter: `loop_halt`, `halt_marker_write_failed`, `halt_record_written`, `halt_record_write_failed`, `halt_record_push_failed`, `shipment_evidence_refused`, `loop_converged`, `rebase_mergeable_skip`, `rebase_conflict_halt`, `ci_failed`, `ci_repair_diagnostic`, `finish_publication_transition`, `finish_publication_blocked`, `finish_publication_disposition`, `operator_park_boundary`, `auto_park_contradiction` and `build_stall`.
   - `loop_halt` is a halt. Its multi-line reason is forwarded text and collapses with `moreAt` `<worktree>/.pipeline/HALT`. Its next action is `ai-conductor monitor all`, followed by `recoveryProcedure(event.haltClass)` when a class is present.
   - A recognized class uses its own procedure. An absent, unclassified or unrecognized class uses `recoveryProcedure('unclassified')` only on lines that state a disposition.
4. Verify GREEN; commit.

**Done when:**
- [test] A `loop_halt` whose reason has several lines renders at default as exactly one line containing the reason's first line, a pointer to the feature's `.pipeline/HALT`, and ` — next: ai-conductor monitor`.
- [test] A `loop_halt` with `haltClass: 'plan-gap'` renders `recoveryProcedure('plan-gap')` in its suffix.
- [test] Every halt or warning case listed in Steps ends with a next-action suffix, and `halt_record_written`, `loop_converged` and `rebase_mergeable_skip` render with no next-action suffix.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/daemon-render.test.ts

**Dependencies:** Tasks 2, 4

### Task 10: Housekeeping and progress event lines through the presenter
**Story:** 8
**Type:** happy-path

**Steps:**
1. Update or add failing tests in `src/conductor/test/daemon-render-progress.test.ts`, `src/conductor/test/engine/daemon-render.test.ts` and `src/conductor/test/ui/github-credential-fallback-render.test.ts`.
2. Verify RED.
3. Move every remaining rendered case onto the presenter:
   - `scratch_cleanup_reclaimed`, `scratch_cleanup_retained`, `scratch_cleanup_failed`;
   - `worktree_reclaim_reclaimed`, `worktree_reclaim_failed` (move `renderedReclaimRetentions` into the presenter's daemon-lifetime memory);
   - `protected_artifact_rebaseline`, `protected_artifact_rebaseline_refused`, `protected_artifact_reseal`, `protected_artifact_reseal_refused`;
   - `remediation_sealed_artifact_redirect`, `remediation_disposition_rejected`, `verdict_freshness`;
   - `build_member_evidence_reused`, `build_member_evidence_recomputed`;
   - `build_progress`, `unattributed_progress`, `build_no_progress`, `build_active_stall`, `pipeline_closeout`;
   - `renderer_error`, `pipeline_tail_diagnostic`;
   - `github_operation_refused`, `github_write_credential_fallback`, `bot_co_author_skipped`, `tracker_backend_unavailable`, `feature_usage_total`;
   - any other rendered type the Task 4 exhaustiveness test reports as unmigrated.

   Remove the hand-built `${dot}` prefixes from `renderDaemonEventUnsafe`.
4. Verify GREEN; commit.

**Done when:**
- [test] Each event type listed in Steps renders at its table depth. `build_progress` has no next-action suffix. Each of these ends with a next-action suffix: `build_no_progress`, `build_active_stall`, `worktree_reclaim_failed`, `scratch_cleanup_failed`, `renderer_error`, `pipeline_tail_diagnostic`, `protected_artifact_rebaseline_refused` and `tracker_backend_unavailable`.
- [test] A repeated `worktree_reclaim_failed` retention with unchanged detail renders once per daemon process and again after its detail changes.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts
- src/conductor/src/engine/daemon-event-presenter.ts
- src/conductor/test/daemon-render-progress.test.ts
- src/conductor/test/engine/daemon-render.test.ts
- src/conductor/test/ui/github-credential-fallback-render.test.ts

**Dependencies:** Task 4

### Task 11: Presentation contract fixtures for every rendered event type
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write `src/conductor/test/engine/daemon-event-presentation-contract.test.ts`, with one fixture per `RenderedEventType`. Type it as `{ [T in RenderedEventType]: Extract<ConductorEvent, { type: T }>[] }` so a missing type fails type-checking. Put a UUID-shaped value in every identifier field. Include warning and info variants where a type has both.
2. Run it; any rendered case that fails is corrected in this task's diff.
3. Commit.

**Done when:**
- [test] For a fixture of every rendered event type, each carrying a UUID-shaped value in every identifier field, no line rendered at default verbosity matches `/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i`.
- [test] For every fixture, at both verbosities, each line body other than a `│ ` continuation begins at the column of its type's declared depth: column 0, after `· `, or after `·   `.
- [test] For every fixture rendered with warning or halt severity, the line ends with ` — next: ` or ` — no action needed: ` followed by non-empty text, and no info-severity line contains either suffix.

**Files likely touched:**
- src/conductor/test/engine/daemon-event-presentation-contract.test.ts
- src/conductor/src/daemon-cli.ts

**Dependencies:** Tasks 6, 7, 8, 9, 10

### Task 12: Provisional build_review FAIL label from one shared predicate
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`, plus a renderer test in `src/conductor/test/engine/daemon-render.test.ts`.
2. Verify RED.
3. In `src/conductor/src/types/events.ts`, add `provisional?: 'pending-adjudication'` to `step_failed`.
4. In `src/conductor/src/engine/conductor.ts`, extract `buildReviewFailureEntersAdjudication(...)` from the build_review branch entry conditions. The predicate is true for step `build_review` in daemon, auto or custom-policy mode, with a FAIL verdict file, a parseable aggregate, a current (non-stale) lap and `buildReviewAdjudicationEnabled()`.
   - Use the predicate both to set `provisional` on the step-failure `step_failed` emission and to enter the adjudication branch.
5. In the presenter's `step_failed` case, render `provisional` as a warning: `✗ build_review provisional FAIL (try <n>) — pending adjudication: <first line of error>` with `no action needed: adjudication decides the route and a final verdict line follows`.
6. Verify GREEN; commit.

**Done when:**
- [test] A conductor test where build_review completes with a current FAIL aggregate and adjudication enabled emits `step_failed` with `provisional: 'pending-adjudication'`. Tests with adjudication disabled, or with an unparseable aggregate, emit `step_failed` without `provisional`.
- [test] In those tests the adjudication coordinator is invoked exactly when the emitted `step_failed` carried `provisional`, because both read `buildReviewFailureEntersAdjudication`.
- [test] The presenter renders a provisional `step_failed` as a line containing `provisional FAIL` and `pending adjudication` that ends with ` — no action needed: ` followed by a non-empty reason. An unmarked build_review `step_failed` renders as the ordinary `failed` line without the word `provisional`.

**Files likely touched:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/conductor-build-review-adjudication.test.ts
- src/conductor/test/engine/daemon-render.test.ts

**Dependencies:** Task 8

### Task 13: `build_review_adjudicated` event and its final-verdict line
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-sinks.test.ts` and `src/conductor/test/daemon-render-build-review-rubrics.test.ts`.
2. Verify RED.
3. Add the union member to `src/conductor/src/types/events.ts`. Its fields are `lapId`, `outcome: 'pass' | 'build' | 'decision-stop' | 'halt' | 'retry'`, `overturned: boolean`, `findings: readonly { rubric; title; disposition }[]` and `cases: readonly { caseId; disposition; resolution }[]`.
4. Add the `EVENT_SINKS` row `{ render: true, persist: true, audit: false, otel: false }` and a `DAEMON_EVENT_PRESENTATION` row at depth 1 and default level.
5. Add the presenter case, which renders one line `build_review final verdict: …`:
   - `pass` is info, saying `PASS` and, when `overturned`, `provisional FAIL overturned` plus the rejected findings by title;
   - `build` is a warning with `no action needed: the daemon re-runs build`;
   - `retry` is a warning with `no action needed: build_review re-runs`;
   - `decision-stop` and `halt` are halts with `next: ai-conductor monitor all`;
   - each case adds one `detail` (verbose) line with its case id, disposition and resolution.
6. Verify GREEN; commit.

**Done when:**
- [test] `EVENT_SINKS.build_review_adjudicated` is `{ render: true, persist: true, audit: false, otel: false }` and the event-sinks exhaustiveness test passes.
- [test] A `pass` event with `overturned: true` and one rejected finding titled `Missing negative-path test for park` renders exactly one default line containing `PASS`, `overturned` and that title, and no line starting with `route:`.
- [test] `build`, `decision-stop` and `halt` events each render exactly one default line naming that route and ending with a next-action suffix, and with `verbose: true` each case adds a detail line containing its case id.

**Files likely touched:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/src/engine/daemon-event-presenter.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/event-sinks.test.ts
- src/conductor/test/daemon-render-build-review-rubrics.test.ts

**Dependencies:** Task 4

### Task 14: Conductor emits exactly one final verdict per adjudicated lap
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`.
2. Verify RED.
3. Extend the coordinator/outcome result to carry the settled case records (`id`, `disposition`, `resolution`, `sourceIds`):
   - in `src/conductor/src/engine/build-review-adjudication-coordinator.ts`, alongside `trace`;
   - in `src/conductor/src/engine/build-review-outcome.ts`, through `applyBuildReviewOutcome`.
4. In `conductor.ts`, emit `build_review_adjudicated` exactly once on every exit of the branch entered under `buildReviewFailureEntersAdjudication`:
   - effective-resolution failure halt;
   - unreadable kickback ledger halt;
   - `decision-stop`;
   - infrastructure `halt`;
   - `settled` (pass);
   - `repair` (build);
   - the mechanical re-land lane (retry).

   Use one local `emitAdjudicated(outcome)` helper called once per exit. Build titles by joining each case's `rubric:findingId` source ids to `projectBuildReviewAggregateSources(verdictRaw)` summaries. Set `overturned` when the outcome is `pass`.
5. Delete the `this.log?.(outcome.trace)` write for the settled outcome and any other raw write of `outcome.trace` on the branch's exits (the trace stays in the kickback evidence and HALT text).
6. Verify GREEN; commit.

**Done when:**
- [test] A conductor test drives a FAIL lap that adjudication settles as pass. It observes exactly one `build_review_adjudicated` event with `outcome: 'pass'`, `overturned: true` and the rejected finding's aggregate summary as its title. No log call writes text starting with `route:` or containing a `[<disposition>/<resolution>]` case trace.
- [test] Repair, decision-stop and infrastructure-halt laps each produce exactly one `build_review_adjudicated` event, with outcome `build`, `decision-stop` and `halt` respectively.
- [test] An adjudication that settles over two rounds within one lap produces exactly one `build_review_adjudicated` event.
- [test] A FAIL lap with adjudication disabled, and a FAIL lap whose aggregate does not parse, each produce no `build_review_adjudicated` event.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/src/engine/build-review-outcome.ts
- src/conductor/test/engine/conductor-build-review-adjudication.test.ts

**Dependencies:** Tasks 12, 13

### Task 15: Effective-FAIL completion reason names findings by title
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-effective-failure-details.test.ts`.
2. Verify RED.
3. In `src/conductor/src/engine/artifacts.ts`, give `effectiveBuildReviewFailureDetails` the aggregate sources from `projectBuildReviewAggregateSources`.
   - Render the details as `unresolved findings: "<summary>" [<rubric>]; …` in aggregate source order. Collapse whitespace in the summary.
   - Fall back to `[<rubric>] <findingId>` when a summary is absent.
   - Update both build_review completion-check call sites.
4. Verify GREEN; commit.

**Done when:**
- [test] For an aggregate whose unresolved finding in rubric `testQuality` has summary `Missing negative-path test for park`, `effectiveBuildReviewFailureDetails` returns a detail containing `"Missing negative-path test for park" [testQuality]` and no `sha256:` text.
- [test] For three unresolved findings it lists each by its own title in aggregate source order on repeated calls. A finding id with no summary appears as `[<rubric>] <id>` while the others keep their titles.
- [test] A summary containing a newline appears on one line with its whitespace collapsed to single spaces.
- [test] Both build_review completion-check sites in `artifacts.ts` return the titled reason for an effective FAIL, as asserted through the completion check entry point.
- [test] A `step_failed` for build_review whose error is that titled reason renders a default line containing `Missing negative-path test for park` and `testQuality` and no `sha256:` text, and one whose reason carries three titled findings renders all three titles on that one line.

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/build-review-effective-failure-details.test.ts

**Dependencies:** Task 8

### Task 16: Suppressed-finding line names the finding by title
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/daemon-render-build-review-rubrics.test.ts` and in the step-runner outer-verdict test that already covers `suppressedFindings`.
2. Verify RED.
3. Add optional `summary` to `build_review_outer_verdict.suppressedFindings` entries in `types/events.ts`.
4. Map `summary` from `projectBuildReviewSuppressionEntries` in `emitBuildReviewOuterVerdict` (`engine/step-runners.ts`).
5. Render `build_review suppressed "<summary>" [<rubric>] (confidence c < floor f)` in the presenter, falling back to `[<rubric>] <findingId>`.
6. Verify GREEN; commit.

**Done when:**
- [test] `emitBuildReviewOuterVerdict` emits suppressed-finding entries that carry the finding's aggregate summary.
- [test] A suppressed entry with summary `Prefer a named constant` renders a line containing that summary, its rubric, confidence and floor and no `sha256:` text, and an entry without `summary` renders its rubric and id.

**Files likely touched:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/test/daemon-render-build-review-rubrics.test.ts

**Dependencies:** Task 6

### Task 17: Daemon-scoped retention log gate for halted features
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-rekick.test.ts` and `src/conductor/test/engine/daemon-cli-progress-rekick-wiring.test.ts`.
2. Verify RED.
3. In `src/conductor/src/engine/daemon-rekick.ts`, add `createRetentionLogGate(log)`:
   - `observe(slug, disposition, subject)` logs only when the slug is new or its disposition changed;
   - `forget(slug)` runs when a slug is evaluated as not retained or its halt is cleared;
   - the line is `<subject>: <slug> retained — halt disposition <d>`, with `formatNextAction({ kind: 'operator', action: 'ai-conductor monitor all — ' + recoveryProcedure(d) })`, where an unrecognized `d` uses `'unclassified'`.

   Route the three retention logs through one gate:
   - `buildProgressReKickDeps` (`daemon-cli.ts`);
   - `recoverEpisodeHalts`;
   - `rekickSweep`'s `skipped — halt disposition` line.

   Construct the gate once in `runDaemonMode`.
4. Verify GREEN; commit.

**Done when:**
- [test] One gate observing slug `a` with `needs-human` on ten consecutive calls logs exactly one line naming `a`, `needs-human`, ` — next: ai-conductor monitor` and `recoveryProcedure('needs-human')` text. A following observation of `a` with `kickback-cap` logs one line naming `kickback-cap`.
- [test] After `forget('a')`, observing `a` with `needs-human` logs again. Two slugs with the same disposition each log exactly once, naming their own slug. A newly created gate logs a still-retained slug once.
- [test] With one gate shared by `buildProgressReKickDeps`, `recoverEpisodeHalts` and `rekickSweep`, a retained slug that all three evaluate with an unchanged disposition yields one retention line in total.
- [test] Through the daemon's progress re-kick wiring, ten evaluations of a retained feature write one retention line to the daemon log, and after an evaluation finds that feature's halt cleared (not retained, so the gate forgets it), a later re-halt with the same disposition writes a new retention line.
- [test] A retention line for disposition `unclassified`, or for an unrecognized value, carries `recoveryProcedure('unclassified')` text rather than a disposition-specific runbook.

**Files likely touched:**
- src/conductor/src/engine/daemon-rekick.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/daemon-rekick.test.ts
- src/conductor/test/engine/daemon-cli-progress-rekick-wiring.test.ts

**Dependencies:** Task 1

### Task 18: Routine fresh-session replacement writes nothing to the daemon log
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/fresh-session-enforcement.test.ts`.
2. Verify RED.
3. In `src/conductor/src/execution/fresh-session.ts`, emit the notice only when `options.resume === true`. Send it to `diagnosticLog` when present, otherwise to `console.warn`. The text says resume was suppressed and ends with `formatNextAction({ kind: 'none', why: 'every provider dispatch starts a fresh session by design' })`. The routine replacement emits nothing.
4. Verify GREEN; commit.

**Done when:**
- [test] `enforceFreshSessionOptions` with a caller-supplied `sessionId` and no `resume` returns a fresh session id, calls neither `options.diagnosticLog` nor `console.warn`, and no daemon log line results at either verbosity.
- [test] With `resume: true`, it calls `options.diagnosticLog` exactly once with a line that says resume was suppressed and ends with ` — no action needed: `, and still returns `resume: false`.

**Files likely touched:**
- src/conductor/src/execution/fresh-session.ts
- src/conductor/test/execution/fresh-session-enforcement.test.ts

**Dependencies:** Task 1

### Task 19: Severity helpers for raw daemon warning and halt lines
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-log.test.ts` and the daemon-runner halted-dispatch test.
2. Verify RED.
3. Add `formatDaemonWarning(text, next)` → `WARNING: <text><suffix>` and `formatDaemonHalt(text, next)` → `✋ <text><suffix>` to `daemon-log.ts`. Migrate these sites:
   - `daemon-cli.ts`: the pidfile warning, memory-provider warnings, and the `--continuous` no-ceiling warning;
   - `engine/daemon-command.ts`: the concurrency warning;
   - `engine/daemon-runner.ts`: the `✋ … halted — worktree kept` and false-ship halted lines (`next: ai-conductor monitor all`), and the HALT-marker write failure;
   - `engine/daemon-rekick.ts`: the kickback-budget `halt retained` / `not superseded` / `retained — live halt generation` lines, `could not list halted worktrees`, and `re-kick …: halted —`;
   - `engine/step-runners.ts`: the `WARNING:` containment advisory lines.
4. Verify GREEN; commit.

**Done when:**
- [test] `formatDaemonWarning('x', { kind: 'none', why: 'y' })` returns `WARNING: x — no action needed: y`, and `formatDaemonHalt('x', { kind: 'operator', action: 'z' })` returns `✋ x — next: z`.
- [test] The daemon-runner halted-dispatch line for a halted feature ends with ` — next: ai-conductor monitor all`.
- [test] Each site listed in Steps produces its line through `formatDaemonWarning` or `formatDaemonHalt`, as observed by a next-action suffix on that line in the site's existing test or a new one.

**Files likely touched:**
- src/conductor/src/engine/daemon-log.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/src/engine/daemon-command.ts
- src/conductor/src/engine/daemon-runner.ts
- src/conductor/src/engine/daemon-rekick.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/daemon-log.test.ts

**Dependencies:** Task 1

### Task 20: Halt-PR maintenance and conductor warning lines, plus a warning-marker source audit
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-pr-rehabilitation.test.ts` and `src/conductor/test/engine/halt-pr-reconciliation.test.ts` (or their existing equivalents), and an audit test `src/conductor/test/engine/daemon-warning-marker-audit.test.ts`.
2. Verify RED.
3. Route these lines through `formatDaemonWarning` with `no action needed: the next sweep retries`:
   - every `[halt-pr-rehab] … failed …`, `… refused …` and `… was partial …` line in `engine/halt-pr-rehabilitation.ts`;
   - `[halt-pr-reconciliation] failed to enumerate PRs` and `sweep error` in `engine/halt-pr-reconciliation.ts`.

   Route the conductor's `halt marker write failed` raw line in `engine/conductor.ts` through `formatDaemonHalt` with `next: ai-conductor monitor all`.
4. The audit scans `src/conductor/src/daemon-cli.ts` and the `src/conductor/src/engine/` files whose names start with `daemon` or `halt-pr-`, plus `step-runners.ts` and `conductor.ts`. It fails on any string or template literal beginning with `WARNING:`, `⚠` or `✋` outside `daemon-log.ts`, `daemon-event-presenter.ts` and an allowlist whose entries each carry a written reason.
5. Verify GREEN; commit.

**Done when:**
- [test] Every halt-pr-rehabilitation and halt-pr-reconciliation line listed in Steps ends with ` — no action needed: the next sweep retries`, and the conductor's halt-marker-write-failure line ends with ` — next: ai-conductor monitor all`.
- [test] The audit test fails on each of three fixture sources containing `` log(`WARNING: x`) ``, `` log(`⚠ x`) `` and `` log(`✋ x`) `` in a scanned file, and passes on the repository's scanned files.

**Files likely touched:**
- src/conductor/src/engine/halt-pr-rehabilitation.ts
- src/conductor/src/engine/halt-pr-reconciliation.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/daemon-warning-marker-audit.test.ts

**Dependencies:** Tasks 6, 7, 8, 9, 10, 19

## Task Dependency Graph

```
Task 1 ─┬─ Task 2 ─ Task 3 ─┐
        ├─ Task 4 ─┬─ Task 6 ─ Task 16
        │          ├─ Task 7 ─┴──────── Task 5 (also Task 3)
        │          ├─ Task 8 (also Task 2) ─ Task 12 ─┐
        │          ├─ Task 9 (also Task 2)            ├─ Task 14
        │          ├─ Task 10                         │
        │          └─ Task 13 ────────────────────────┘
        ├─ Task 17
        ├─ Task 18
        └─ Task 19 ─ Task 20 (also Tasks 6-10)
Tasks 6-10 ─ Task 11
Task 8 ─ Task 15
```

## Integration Points

- After Task 3: `runDaemonMode` writes collapsed or verbose multi-line output per `daemon_verbose`.
- After Task 5: every feature dispatch renders through its own presenter; once-per-dispatch memory resets per dispatch.
- After Task 14: an adjudicated build_review lap shows one provisional line and one final-verdict line in a real conductor run.
- After Task 17: the daemon's re-kick checks share one retention gate.

## Coverage Check

Every criterion row below was judged by an independent coverage judge (three rounds; all 49 rows assert). An independent contradiction judge found no conflict after two rounds; the round-1 findings (containment verdict returning to an earlier value, the first forwarded line in verbose output, multi-line kickback evidence) were resolved in Tasks 2, 4, 7 and 8 and Story 8.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon build_review lap whose effective verdict is FAIL and which the conductor will adjudicate, when the step failure is logged, then its line contains `provisional FAIL`, says adjudication is pending, and ends with a no-action-needed suffix. | 12 | "The presenter renders a provisional `step_failed` as a line containing `provisional FAIL` and `pending adjudication` that ends with ` — no action needed: ` followed by a non-empty reason. An unmarked build_review `step_failed` renders as the ordinary `failed` line without the word `provisional`." | diff-local |
| Story 1 happy: Given that lap's adjudication rejects every unresolved finding and routes the lap to pass, when adjudication finishes, then exactly one final-verdict line for that lap is logged that states `PASS`, says the provisional FAIL was overturned, and names each rejected finding by its title. | 13, 14 | "A `pass` event with `overturned: true` and one rejected finding titled `Missing negative-path test for park` renders exactly one default line containing `PASS`, `overturned` and that title, and no line starting with `route:`." | diff-local |
| Story 1 happy: Given that lap's adjudication routes it back to BUILD, stops for a decision, or halts, when adjudication finishes, then exactly one final-verdict line for that lap is logged that states that route and ends with a next-action suffix. | 13, 14 | "`build`, `decision-stop` and `halt` events each render exactly one default line naming that route and ending with a next-action suffix, and with `verbose: true` each case adds a detail line containing its case id." | diff-local |
| Story 1 negative: Given a build_review FAIL that the conductor will not adjudicate (adjudication disabled, or the verdict is not a parseable aggregate), when the step failure is logged, then the line is the ordinary `failed` line, does not contain the word `provisional`, and no final-verdict line follows for that lap. | 12, 14 | "The presenter renders a provisional `step_failed` as a line containing `provisional FAIL` and `pending adjudication` that ends with ` — no action needed: ` followed by a non-empty reason. An unmarked build_review `step_failed` renders as the ordinary `failed` line without the word `provisional`." | diff-local |
| Story 1 negative: Given an adjudicated lap, when the default log is read, then it contains no line beginning with `route:` and no line beginning with a case identifier followed by a `[<disposition>/<resolution>]` pair. | 14, 13 | "A conductor test drives a FAIL lap that adjudication settles as pass. It observes exactly one `build_review_adjudicated` event with `outcome: 'pass'`, `overturned: true` and the rejected finding's aggregate summary as its title. No log call writes text starting with `route:` or containing a `[<disposition>/<resolution>]` case trace." | diff-local |
| Story 1 negative: Given an adjudication that settles over more than one round within one lap, when it finishes, then exactly one final-verdict line is logged for that lap, not one per round. | 14, 13 | "An adjudication that settles over two rounds within one lap produces exactly one `build_review_adjudicated` event." | diff-local |
| Story 2 happy: Given an effective build_review FAIL with one unresolved finding whose aggregate summary is `Missing negative-path test for park`, when the failure is logged, then the line contains `Missing negative-path test for park` and that finding's rubric, and does not contain the finding's `sha256:` id. | 15 | "For an aggregate whose unresolved finding in rubric `testQuality` has summary `Missing negative-path test for park`, `effectiveBuildReviewFailureDetails` returns a detail containing `"Missing negative-path test for park" [testQuality]` and no `sha256:` text." | diff-local |
| Story 2 happy: Given an effective FAIL with several unresolved findings, when the failure is logged, then every finding appears by its own title on that one line, in the same order on every render of the same aggregate. | 15 | "For three unresolved findings it lists each by its own title in aggregate source order on repeated calls. A finding id with no summary appears as `[<rubric>] <id>` while the others keep their titles." | diff-local |
| Story 2 happy: Given a build_review lap that suppresses a below-floor finding whose aggregate summary is `Prefer a named constant`, when the lap's outer verdict renders, then the suppressed-finding line names `Prefer a named constant` with its rubric, confidence and floor, and does not contain the finding's `sha256:` id. | 16 | "A suppressed entry with summary `Prefer a named constant` renders a line containing that summary, its rubric, confidence and floor and no `sha256:` text, and an entry without `summary` renders its rubric and id." | diff-local |
| Story 2 negative: Given an unresolved finding id that has no summary in the aggregate, when the failure is logged, then that finding appears by its id instead of being omitted, and every other finding still appears by title. | 15 | "For three unresolved findings it lists each by its own title in aggregate source order on repeated calls. A finding id with no summary appears as `[<rubric>] <id>` while the others keep their titles." | diff-local |
| Story 2 negative: Given a finding summary that contains a line break, when the failure is logged, then the title appears on the same physical line with its whitespace collapsed to single spaces. | 15 | "A summary containing a newline appears on one line with its whitespace collapsed to single spaces." | diff-local |
| Story 2 negative: Given a persisted outer-verdict event whose suppressed-finding entry carries no summary (recorded before this change), when it renders, then that finding is named by its rubric and id and the line still renders. | 16 | "A suppressed entry with summary `Prefer a named constant` renders a line containing that summary, its rubric, confidence and floor and no `sha256:` text, and an entry without `summary` renders its rubric and id." | diff-local |
| Story 3 happy: Given every event type the daemon renders, each carrying a UUID-shaped value in every identifier field it has (provider attempt, adjudication case, dispatch, event, session), when each renders to the default log, then no rendered line contains a UUID-shaped token. | 11 | "For a fixture of every rendered event type, each carrying a UUID-shaped value in every identifier field, no line rendered at default verbosity matches `/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i`." | diff-local |
| Story 3 happy: Given the verbose log, when a provider lifecycle event, a managed-session occurrence, and an adjudicated lap's per-case detail render, then their identifiers appear on their lines. | 7, 13 | "At default verbosity `provider_attempt` lifecycle phases `preparing`, `running` and `settled` render nothing. `recovering` renders step, recovery count and timeout reason, and `exhausted` renders a halt line naming step, `halted`, recovery count and reason with a next-action suffix. None of these lines contains a UUID-shaped token. With `verbose: true` all five render with the attempt id." | diff-local |
| Story 3 negative: Given a provider attempt that exhausts its recovery and halts, when it renders to the default log, then the line names the step, the halted phase, the recovery count and the reason, and contains no UUID-shaped token. | 7 | "At default verbosity `provider_attempt` lifecycle phases `preparing`, `running` and `settled` render nothing. `recovering` renders step, recovery count and timeout reason, and `exhausted` renders a halt line naming step, `halted`, recovery count and reason with a next-action suffix. None of these lines contains a UUID-shaped token. With `verbose: true` all five render with the attempt id." | diff-local |
| Story 3 negative: Given a managed-session command refusal or a GitHub bypass occurrence, when it renders to the default log, then the line names the feature, the provider and the refused command or operation, and contains no UUID-shaped token. | 7 | "At default verbosity managed-session refusal and GitHub bypass occurrence lines name the feature, provider and command or operation and contain no UUID-shaped token; with `verbose: true` they include the dispatch and event ids." | diff-local |
| Story 4 happy: Given a halted feature retained with disposition `needs-human`, when ten consecutive daemon ticks evaluate it, then exactly one retention line for it is logged, naming the slug, `needs-human`, and a next-action suffix. | 17 | "One gate observing slug `a` with `needs-human` on ten consecutive calls logs exactly one line naming `a`, `needs-human`, ` — next: ai-conductor monitor` and `recoveryProcedure('needs-human')` text. A following observation of `a` with `kickback-cap` logs one line naming `kickback-cap`." | diff-local |
| Story 4 happy: Given that retained feature's disposition changes from `needs-human` to `kickback-cap`, when the next tick evaluates it, then one new retention line naming `kickback-cap` is logged. | 17 | "One gate observing slug `a` with `needs-human` on ten consecutive calls logs exactly one line naming `a`, `needs-human`, ` — next: ai-conductor monitor` and `recoveryProcedure('needs-human')` text. A following observation of `a` with `kickback-cap` logs one line naming `kickback-cap`." | diff-local |
| Story 4 negative: Given a retained feature whose halt is cleared and which later halts again with the same disposition, when a tick evaluates the new halt, then a new retention line is logged for it. | 17 | "After `forget('a')`, observing `a` with `needs-human` logs again. Two slugs with the same disposition each log exactly once, naming their own slug. A newly created gate logs a still-retained slug once." | diff-local |
| Story 4 negative: Given two halted features retained with the same disposition, when ticks evaluate both, then each feature has exactly one retention line, each naming its own slug. | 17 | "After `forget('a')`, observing `a` with `needs-human` logs again. Two slugs with the same disposition each log exactly once, naming their own slug. A newly created gate logs a still-retained slug once." | diff-local |
| Story 4 negative: Given a daemon restart while a feature remains retained, when the new daemon process first evaluates it, then exactly one retention line for it is logged. | 17 | "After `forget('a')`, observing `a` with `needs-human` logs again. Two slugs with the same disposition each log exactly once, naming their own slug. A newly created gate logs a still-retained slug once." | diff-local |
| Story 4 negative: Given the progress re-kick check, the episode-end sweep and the base-advance re-kick sweep each evaluate the same retained feature with an unchanged disposition, when all three run, then that feature has one retention line in total, not one per check. | 17 | "With one gate shared by `buildProgressReKickDeps`, `recoverEpisodeHalts` and `rekickSweep`, a retained slug that all three evaluate with an unchanged disposition yields one retention line in total." | diff-local |
| Story 5 happy: Given a self-host dispatch whose steps each report the same containment verdict and reason, when the default log is read, then that containment line appears once for the dispatch. | 7, 5 | "Within one presenter, repeated `self_host_containment_verdict` events with the same `contained` value and reason render one line, and each change renders another, including the sequence contained → unavailable → contained rendering three lines. Repeated `self_host_boundary_fingerprint` events render only the first line at default and every line with `verbose: true`." | diff-local |
| Story 5 happy: Given a self-host dispatch whose steps each produce a boundary fingerprint, when the default log is read, then only the dispatch's first fingerprint line appears; when the verbose log is read, then every fingerprint line appears. | 7 | "Within one presenter, repeated `self_host_containment_verdict` events with the same `contained` value and reason render one line, and each change renders another, including the sequence contained → unavailable → contained rendering three lines. Repeated `self_host_boundary_fingerprint` events render only the first line at default and every line with `verbose: true`." | diff-local |
| Story 5 happy: Given a dispatch whose steps each report the same session policy notice for the same provider and reason, when the default log is read, then that notice appears once for the dispatch. | 7 | "Within one presenter, `session_policy` events with the same provider and reason render one line at default, and a different provider or reason renders another line." | diff-local |
| Story 5 happy: Given a provider attempt that moves through preparing, running and settled, when the default log is read, then none of those three lifecycle lines appears; when the verbose log is read, then each appears with its attempt identity. | 7 | "At default verbosity `provider_attempt` lifecycle phases `preparing`, `running` and `settled` render nothing. `recovering` renders step, recovery count and timeout reason, and `exhausted` renders a halt line naming step, `halted`, recovery count and reason with a next-action suffix. None of these lines contains a UUID-shaped token. With `verbose: true` all five render with the attempt id." | diff-local |
| Story 5 negative: Given a dispatch whose containment verdict changes between steps (from contained to unavailable, or to a different reason), when the default log is read, then a containment line appears for each change. | 7 | "Within one presenter, repeated `self_host_containment_verdict` events with the same `contained` value and reason render one line, and each change renders another, including the sequence contained → unavailable → contained rendering three lines. Repeated `self_host_boundary_fingerprint` events render only the first line at default and every line with `verbose: true`." | diff-local |
| Story 5 negative: Given a provider attempt that enters recovery or exhausts its recovery, when the default log is read, then a recovering line naming the step, recovery count and timeout reason, or a halt line, appears. | 7 | "At default verbosity `provider_attempt` lifecycle phases `preparing`, `running` and `settled` render nothing. `recovering` renders step, recovery count and timeout reason, and `exhausted` renders a halt line naming step, `halted`, recovery count and reason with a next-action suffix. None of these lines contains a UUID-shaped token. With `verbose: true` all five render with the attempt id." | diff-local |
| Story 5 negative: Given a provider invocation that replaces a caller-supplied session id without a resume request, when the provider runs, then no session-replacement line is written to the daemon log at either verbosity; given one that suppresses a requested resume, then exactly one line says resume was suppressed and ends with a no-action-needed suffix. | 18 | "`enforceFreshSessionOptions` with a caller-supplied `sessionId` and no `resume` returns a fresh session id, calls neither `options.diagnosticLog` nor `console.warn`, and no daemon log line results at either verbosity." | diff-local |
| Story 5 negative: Given a second dispatch of the same feature, when its first containment verdict, fingerprint and session policy notice occur, then each appears again in the default log. | 5 | "Through the daemon's feature-run wiring, every event of one dispatch reaches the same presenter: two dispatches of the same feature each render exactly one `self_host_containment_verdict` line, one `self_host_boundary_fingerprint` line and one `session_policy` line at default, although each dispatch emits each of those events twice with identical content." | diff-local |
| Story 6 happy: Given a step failure whose error text has 40 lines including git push output and test-runner output, when it is logged to the default log, then exactly one line is written for it, containing the error's first line, the count of omitted lines, and a pointer to the feature's `.pipeline/events.jsonl` and to `daemon_verbose: true`. | 8, 2 | "A `step_failed` whose `error` has 40 lines renders at default as exactly one line containing the error's first line, `+39 more lines`, a pointer to the feature's `.pipeline/events.jsonl` and `daemon_verbose: true`; with `verbose: true` it renders its first line followed by 39 continuation lines whose bodies begin with `│ `." | diff-local |
| Story 6 happy: Given a loop halt whose reason has several lines, when it is logged to the default log, then exactly one line is written, containing the reason's first line and a pointer to the feature's `.pipeline/HALT`. | 9 | "A `loop_halt` whose reason has several lines renders at default as exactly one line containing the reason's first line, a pointer to the feature's `.pipeline/HALT`, and ` — next: ai-conductor monitor`." | diff-local |
| Story 6 happy: Given the verbose log, when the same 40-line step failure is logged, then its first line is followed by each non-blank continuation line, each beginning with the forwarded-output marker `│ `. | 2, 3 | "With `verbose: true` the same 40-line forwarded entry, given depth 1, produces its first line with its body beginning at the depth-1 column (after `· `), followed by one line per non-blank continuation, each line body beginning with `│ ` and keeping that continuation's own leading spaces after the marker." | diff-local |
| Story 6 negative: Given forwarded provider diagnostic output whose entire content is a single-line JSON object or array, when it is logged to the default log, then the line is replaced by a one-line summary naming it a JSON payload and its size in bytes. | 2 | "At default verbosity a single-line forwarded entry that parses as a JSON object or array is written as one line containing `JSON payload` and its byte size, and the single-line forwarded entry `{not json` is written unchanged." | diff-local |
| Story 6 negative: Given single-line forwarded output that begins with `{` but is not valid JSON, when it is logged, then it is written unchanged. | 2 | "At default verbosity a single-line forwarded entry that parses as a JSON object or array is written as one line containing `JSON payload` and its byte size, and the single-line forwarded entry `{not json` is written unchanged." | diff-local |
| Story 6 negative: Given a multi-line message containing blank or whitespace-only lines, when it is logged at either verbosity, then no blank or whitespace-only line is written. | 2 | "At both verbosities a multi-line message containing blank and whitespace-only lines writes no blank or whitespace-only line, and a daemon-authored plain-string message of several lines writes every non-blank line with each continuation line body beginning with `│ `." | diff-local |
| Story 6 negative: Given a multi-line event payload rendered by the daemon-wide subscriber, which has no feature tag, when it is logged to the default log, then it is collapsed to one line in the same way as a feature-owned payload. | 2 | "At default verbosity a forwarded feature-owned entry of 40 non-blank lines produces exactly one persisted line containing its first line and `+39 more lines`, and a forwarded 40-line entry logged through the daemon-wide logger with no feature tag is collapsed to one line the same way, as asserted in `src/conductor/test/engine/daemon-log.test.ts`." | diff-local |
| Story 6 negative: Given a multi-line message the daemon composes itself (such as a per-file table or a setup output tail that an existing decision requires in the log), when it is logged at either verbosity, then every non-blank line is written and each continuation line body begins with `│ `. | 2 | "At both verbosities a multi-line message containing blank and whitespace-only lines writes no blank or whitespace-only line, and a daemon-authored plain-string message of several lines writes every non-blank line with each continuation line body beginning with `│ `." | diff-local |
| Story 7 happy: Given each event type the daemon renders with warning or halt severity, when it renders, then its line ends with a next-action suffix. | 11 | "For every fixture rendered with warning or halt severity, the line ends with ` — next: ` or ` — no action needed: ` followed by non-empty text, and no info-severity line contains either suffix." | diff-local |
| Story 7 happy: Given a feature halt line (a loop halt or the dispatch's halted line), when it renders, then its suffix names `ai-conductor monitor`; given a retention line for a feature with a recognized halt disposition, when it renders, then its suffix names `ai-conductor monitor` and that disposition's recovery procedure. | 9, 19, 17 | "One gate observing slug `a` with `needs-human` on ten consecutive calls logs exactly one line naming `a`, `needs-human`, ` — next: ai-conductor monitor` and `recoveryProcedure('needs-human')` text. A following observation of `a` with `kickback-cap` logs one line naming `kickback-cap`." | diff-local |
| Story 7 negative: Given a warning the daemon recovers from on its own (a rate-limit wait, a provider fallback, a step retry), when it renders, then its suffix is `no action needed:` with the reason, not an operator action. | 7, 8 | "`provider_fallback` and `rate_limit` lines end with ` — no action needed: ` followed by their reason, and a successful and a failed non-lifecycle `provider_attempt` both begin at the same depth column." | diff-local |
| Story 7 negative: Given a retention line whose disposition is unclassified or unrecognized, when it renders, then its suffix gives the undetermined-classification procedure rather than a disposition-specific runbook. | 17 | "A retention line for disposition `unclassified`, or for an unrecognized value, carries `recoveryProcedure('unclassified')` text rather than a disposition-specific runbook." | diff-local |
| Story 7 negative: Given a raw daemon line outside the event renderer that is marked as a warning or halt (`WARNING:`, `⚠`, `✋`, or a feature halt), when it is logged, then it also ends with a next-action suffix. | 19, 20 | "Each site listed in Steps produces its line through `formatDaemonWarning` or `formatDaemonHalt`, as observed by a next-action suffix on that line in the site's existing test or a new one." | diff-local |
| Story 7 negative: Given an informational line (a step start or completion, a progress heartbeat, a cache hit), when it renders, then no next-action suffix is appended. | 11, 8 | "For every fixture rendered with warning or halt severity, the line ends with ` — next: ` or ` — no action needed: ` followed by non-empty text, and no info-severity line contains either suffix." | diff-local |
| Story 8 happy: Given any event the daemon renders, when it is logged, then its line body begins at the column for its declared depth — depth 0 at column 0, depth 1 after `· `, depth 2 after `·   ` — and that event type uses the same depth on every dispatch and at both verbosities. | 11, 4 | "For every fixture, at both verbosities, each line body other than a `│ ` continuation begins at the column of its type's declared depth: column 0, after `· `, or after `·   `." | diff-local |
| Story 8 happy: Given forwarded subprocess output shown in the verbose log, when it is logged, then its first line joins the daemon line it belongs to at that line's depth, and each following forwarded line body begins with `│ ` with the output's own leading whitespace after that marker. | 2 | "With `verbose: true` the same 40-line forwarded entry, given depth 1, produces its first line with its body beginning at the depth-1 column (after `· `), followed by one line per non-blank continuation, each line body beginning with `│ ` and keeping that continuation's own leading spaces after the marker." | diff-local |
| Story 8 negative: Given forwarded output whose first line begins with whitespace, such as ` ! [rejected]  HEAD -> feat/x`, when it is logged to the default log, then no line body begins with that whitespace. | 2 | "At default verbosity a forwarded entry whose first line is ` ! [rejected]  HEAD -> feat/x` produces no line body beginning with whitespace." | diff-local |
| Story 8 negative: Given two events of the same type whose payloads differ in outcome (a provider attempt that succeeds and one that fails), when both render, then both line bodies begin at the same depth column. | 7 | "`provider_fallback` and `rate_limit` lines end with ` — no action needed: ` followed by their reason, and a successful and a failed non-lifecycle `provider_attempt` both begin at the same depth column." | diff-local |
| Story 8 negative: Given a daemon line whose message an emitter composed with its own leading spaces, when it is logged, then the line body begins at the column of the depth the emitter declared, with the extra leading spaces removed. | 1 | "A feature logger built by `createFeatureDaemonLogger` over `createDaemonModeLogger` writes the string message `   ! [rejected] x` as a line whose body is `! [rejected] x`, at the column of the depth the emitter declared (depth 0), to both the live and the persisted sink." | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
