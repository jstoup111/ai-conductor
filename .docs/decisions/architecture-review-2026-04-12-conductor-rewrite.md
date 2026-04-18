# Architecture Review: Phase 3 Conductor Rewrite

**Date:** 2026-04-12
**Status:** APPROVED (revised 2026-04-12 — all 3 blocking issues resolved in plan)
**Reviewer:** Architecture Review Agent

## Verdict

The 3-layer architecture (Engine/Execution/UI) is sound and the 38-task plan is well-structured
with correct dependency ordering and comprehensive story coverage. However, there are three
blocking issues: (1) the ESM-only constraint of ink v4+ and execa v8+ requires explicit
`package.json` and tsconfig handling that the plan does not address, (2) the skip list in ST-005
and the plan diverges from the actual bash conductor, and (3) several bash conductor behaviors
are not covered by any story.

## Feasibility Assessment

### 1. Technical Feasibility

**Stack viability: FEASIBLE with caveats.**

Each story's acceptance criteria can be implemented with TypeScript + ink + execa + vitest.
No story requires capabilities outside the stack. The core state machine, gate enforcement,
recovery flow, and backward navigation are pure logic — straightforward TypeScript.

**ESM-only libraries: RISK — plan does not address explicitly.**

- ink v4+ is ESM-only. execa v8+ is ESM-only. The plan sets `"type": "module"` in package.json
  (Task 1, step 1), which is correct. However:
  - Task 1 specifies `NodeNext` module resolution in tsconfig, which is correct for ESM.
  - vitest handles ESM natively, so testing is fine.
  - The plan does not mention that `commander` (CLI framework) is dual CJS/ESM and works fine,
    but `js-yaml` v4 is also ESM-only — this is fine but should be noted.
  - **tsup bundling** (Task 1, step 4) needs `format: ['esm']` explicitly, not just "format esm."
    If someone later adds CJS output, ink and execa imports will break.
  - The shell wrapper (Task 37) uses `exec node ...` which works, but the built file must have
    ESM syntax. This is fine if tsup is configured correctly.

**Verdict:** Feasible. The ESM setup in Task 1 is directionally correct but should explicitly
document that CJS output is not possible due to ink/execa constraints.

**State file backward compatibility: FEASIBLE.**

- Task 6 includes round-trip tests: TS writes, python3 reads, and bash-format reads by TS.
- The bash conductor uses `python3 -c` for JSON parsing, so the format is standard JSON with
  2-space indentation. TypeScript's `JSON.stringify(obj, null, 2)` produces identical output.
- Key names use underscores (`conflict_check`, `architecture_diagram`) matching the bash
  `ALL_STEPS` array. The plan's type definitions (Task 3) must match these exact key names.
- **One subtle risk:** The bash conductor stores metadata keys (`feature_desc`, `complexity_tier`,
  `run_started_at`, `last_step`, `pr_url`, `worktree_dir`, `worktree_branch`, `feature_status`)
  alongside step status keys in the same flat JSON object. The TS types must preserve this flat
  structure, not nest them.

**Verdict:** Feasible. Task 6's round-trip test is the right verification.

### 2. Architectural Alignment

**3-layer separation: HOLDS for all stories.**

- Engine (state machine, gates, recovery, steps): Tasks 2-18, 20-27 — pure logic, no I/O
  except file read/write for state. No layer violations.
- Execution (Claude CLI, sessions): Tasks 12-14, 35 — subprocess management only. Clean
  interface boundary via `LLMProvider`.
- UI (ink components, events): Tasks 19, 28-33 — event-driven rendering. No direct state
  mutation.

No story forces a layer violation. The closest risk is ST-003 (checkpoints) where the engine
must wait for a UI response, but the event-driven model handles this correctly: engine emits
`checkpoint_reached`, waits for a response promise, UI resolves it.

**Event-driven model: SUFFICIENT.**

The typed event system (Task 4/19) covers all UI interactions:
- `step_started`, `step_completed`, `step_failed` — dashboard updates
- `checkpoint_reached` — c/b/q prompt
- `recovery_needed` — r/i/b/s/q menu
- `navigation_back` — step selection menu
- `gate_blocked` — error display
- `tier_skip` — skip notification
- `dashboard_refresh` — periodic refresh
- `rate_limit` — cooldown display
- `session_reset` — session notification
- `feature_complete` — completion display

**One gap:** The bash conductor has a `live_refresh` mechanism (background process that
redraws the dashboard every 10 seconds). The event list includes `dashboard_refresh` but
the plan does not describe who triggers periodic refreshes. In ink, this would be a
`useInterval` hook or a `setInterval` in the subscriber. Task 28 (dashboard) or Task 33
(subscriber) should own this, but neither mentions periodic refresh explicitly.

**Step runner abstraction: WORKS for all 14 steps.**

Task 35 implements one function per step, ported from the bash `run_*()` functions. The
abstraction is: check gate -> invoke Claude -> validate artifacts -> return result. This
maps cleanly to all 14 steps. The bash conductor's `STEP_FUNCS` array maps 1:1 to step
runner functions.

### 3. Story Coverage Gaps

**Behaviors in bash NOT covered by any story:**

1. **Harness update check** (`check_harness_update`, `check_harness_update_tagged`,
   `check_harness_update_main`). The bash conductor checks for harness updates on every run.
   This is ~150 lines of logic. No story covers this. **Recommendation:** This may be
   intentionally excluded from the conductor rewrite (it could remain as a separate concern),
   but this should be an explicit decision.

2. **Harness config check** (`check_harness_config`). Auto-detects missing HARNESS.md
   reference in project CLAUDE.md and offers to add it. No story covers this.

3. **`--step` (single step execution)**. The bash conductor supports `--step brainstorm` to
   run a single step in isolation. The plan's CLI (Task 34) does not mention `--step`. It
   mentions `--from` and `--resume` but not single-step mode.

4. **`--cooldown` flag**. The bash conductor has configurable step cooldown
   (`STEP_COOLDOWN=10`) with escalation based on call count. ST-008 mentions rate limit
   handling, but the proactive cooldown between steps (not rate-limit-triggered) is not in
   any story.

5. **`--reset` flag**. Clears state file, session file, and log. Not in any story or the CLI
   plan (Task 34).

6. **`--log` flag**. Tails the session log. Not in any story or CLI plan.

7. **`--status` flag**. The plan mentions this in Task 34 (CLI parses --status). ST-002
   covers the dashboard display, so this is partially covered.

8. **Desktop notifications** (`send_notification`). The bash conductor sends desktop
   notifications on failure, rate limit, and completion. No story mentions this.

9. **Session naming** (`session_name`). The bash conductor sets a display name on the Claude
   session (`--name "project: feature"`). ST-008 covers session ID but not naming.

10. **`--dangerously-skip-permissions`**. The bash conductor passes this flag to every Claude
    invocation. The plan's Claude adapter (Task 14) does not mention this. This is critical
    for automated execution — without it, Claude will prompt for permission on every tool use.

11. **`--output` / `VIEW_MODE`**. The bash conductor supports `--output` mode that disables
    the dashboard and shows raw Claude output. Not in any story.

12. **`--interactive` / `RUN_MODE=interactive`**. The bash conductor supports fully interactive
    mode. ST-003 mentions auto mode but the plan does not define how `interactive` mode differs
    from `default` mode beyond checkpoint behavior.

13. **Progress log** (`append_progress`). Writes to `.pipeline/progress.log` with timestamps
    and step summaries. Not in any story.

14. **Signal handling** (`trap cleanup_and_exit INT TERM HUP`). The bash conductor saves state
    and stops live refresh on Ctrl+C. The TS conductor needs this too — Node.js `process.on('SIGINT')`
    must save state before exit.

15. **Project-level vs feature-level state separation**. The bash conductor preserves
    `bootstrap`, `assess`, and other project-level step state when starting a new feature,
    clearing only feature-level state. The TS conductor needs this distinction.

16. **User approval flow within steps**. The bash conductor has an approval loop within
    `run_architecture_review` and `run_architecture_diagram` where the user reviews and
    approves/rejects individual artifacts. This is step-internal behavior, not conductor-level,
    but the step runners (Task 35) need to handle it.

**Acceptance criteria not addressed by the plan:**

- ST-002 "Dashboard includes feature name, project name, branch, and run mode" — Task 28 tests
  mention "feature name in header" but not project name, branch, or run mode.
- ST-002 "Activity line shows elapsed time and last meaningful log line" — Not mentioned in any
  task. The bash conductor tracks step elapsed time (`get_step_elapsed`).
- ST-005 skip list discrepancy (see Risks below).

### 4. Risk Assessment

**HIGH RISK:**

1. **Skip list mismatch between ST-005 and bash conductor.** ST-005 says Small skips:
   `conflict-check, architecture-diagram, architecture-review, acceptance-specs, pipeline,
   code-review, retro`. The bash conductor skips: `conflict-check, architecture-diagram,
   architecture-review, acceptance-specs, code-review`. Key differences:
   - ST-005 includes `pipeline` and `retro` in the skip list. The bash conductor does NOT
     skip `retro` or `pipeline` (which is `build` in the step registry — pipeline is not a
     separate step).
   - `code-review` is in the ST-005 skip list and the bash `should_skip_for_tier()` function,
     but `code-review` is NOT in the 14-step `ALL_STEPS` array. It appears to be a sub-step
     within `build`.
   - Task 8 tests: "Small tier skips exactly: conflict_check, architecture_diagram,
     architecture_review, acceptance_specs, retro" — this matches neither ST-005 nor the bash.
   - **This must be resolved before implementation.** The canonical skip list needs to be
     one consistent definition.

2. **`--dangerously-skip-permissions` omission.** Every Claude CLI invocation in the bash
   conductor passes this flag. The plan's Claude adapter (Task 14) does not mention it. Without
   it, the TS conductor will hang waiting for permission prompts on every tool use. This is a
   **functional blocker** if missed during implementation.

3. **Live refresh mechanism undefined.** The bash conductor redraws the dashboard every 10
   seconds via a background subshell. The ink-based UI needs an equivalent (likely `setInterval`
   + event emit). Neither Task 28 nor Task 33 specifies this. Without it, the dashboard appears
   static during long Claude invocations.

**MEDIUM RISK:**

4. **Step cooldown between Claude calls.** The bash conductor sleeps 10s between steps (with
   escalation to 20s/30s based on call count) to prevent rate limit bursts. This proactive
   throttling is not in any story or task. Without it, the TS conductor may hit rate limits
   more frequently.

5. **ink component testing with ink-testing-library.** ink-testing-library works for static
   rendering assertions. However, testing interactive components (`useInput` for key handling)
   requires firing synthetic input events. The library supports this via `stdin.write()`, but
   the plan's test descriptions (Tasks 30, 31, 32) only verify rendering, not key handling
   responses. The checkpoint and recovery components need input-handling tests.

6. **Integration test scope (Task 38).** The integration test mocks the Claude provider, which
   is correct for CI. However, there is no plan for a smoke test with the real Claude CLI. At
   minimum, one manual test should verify that `bin/conduct-ts --status` works end-to-end.

7. **`--from` marks prior steps as done.** The bash conductor's `--from` flag marks all prior
   steps as `done` (lines 2973-2979). Task 21 tests `--from` but does not mention this
   behavior. If prior steps are not marked done, gates will block.

**LOW RISK:**

8. **38 tasks is appropriate granularity.** Each task is narrowly scoped (2-5 minutes as
   stated). The dependency graph is acyclic. No tasks need splitting. Tasks 28-33 (UI) could
   potentially be parallelized more aggressively since they only depend on the event types, not
   on each other (except Task 33 which depends on all components).

9. **Backward compatibility during side-by-side period.** Both conductors reading/writing the
   same state file is safe because the format is identical. The risk is if one adds a field the
   other does not expect — but JSON.parse ignores unknown fields, and python3's json.load does
   too. Low risk.

### 5. Testing Strategy

**Mocking execa: SUFFICIENT for unit tests, INSUFFICIENT for confidence.**

- Mocked execa tests verify that the correct arguments are passed to Claude CLI and that
  stdout/stderr are handled correctly. This is the right approach for fast, reliable unit tests.
- However, the Claude CLI's actual behavior (session resume semantics, `--output-format
  stream-json` parsing, error message formats for rate limits and stale sessions) can only be
  verified against the real CLI.
- **Recommendation:** Add a `test/smoke/` directory with tests that require a real Claude CLI
  installation. Mark them as `@slow` or skip in CI. Run manually before each release.

**ink-testing-library: SUFFICIENT with caveats.**

- Static rendering tests (Task 28-29) work well with `render()` + `lastFrame()`.
- Interactive tests (Tasks 30-32) need `stdin.write('c')` to simulate key presses. The plan's
  test descriptions say "calls onChoice with 'continue' for c" which implies testing the
  callback, not simulating the key press. Both should be tested.
- **Recommendation:** Task 30 should include a test that simulates `stdin.write('c')` and
  verifies the ink component calls the callback. Not just prop-level testing.

**Round-trip test: ROBUST.**

- Task 6 includes: "write state with TS, read with python3 -c." This directly validates
  backward compatibility. The test should also verify: (a) key ordering is preserved (or at
  least that python3 reads all keys regardless of order), and (b) unicode in `feature_desc`
  round-trips correctly.

## Risks and Mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Skip list mismatch (ST-005 vs bash vs plan Task 8) | HIGH | Resolve canonical skip list. Update ST-005, Task 8, and bash to match. |
| 2 | Missing `--dangerously-skip-permissions` in Claude adapter | HIGH | Add to Task 14 acceptance criteria: all Claude invocations include this flag. |
| 3 | Live refresh not specified | HIGH | Add periodic dashboard refresh to Task 33 (subscriber) or Task 28 (dashboard). |
| 4 | Step cooldown not in any story | MEDIUM | Add proactive throttling to Task 14 (Claude adapter) or a new Task between 14 and 35. |
| 5 | Interactive component tests incomplete | MEDIUM | Add stdin.write() tests to Tasks 30-32. |
| 6 | No smoke test with real CLI | MEDIUM | Add test/smoke/ directory. Manual run before release. |
| 7 | `--from` prior-step marking not tested | MEDIUM | Add test to Task 21: "--from marks all prior steps as done." |
| 8 | 15+ bash behaviors uncovered by stories | LOW | Decide per-behavior: include in Phase 3 scope, defer, or drop. See Recommendations. |

## Recommendations

### Blocking (must fix before implementation starts)

1. **Resolve the ST-005 skip list.** The story, the plan (Task 8), and the bash conductor all
   have different skip lists. Produce one canonical list. Specifically decide:
   - Does Small skip `retro`? (bash says no, ST-005 says yes, Task 8 says yes)
   - Does Small skip `pipeline`/`code-review`? (these are not in the 14-step registry —
     they are sub-behaviors within `build`)
   - Update ST-005, Task 8 tests, and the bash conductor to match.

2. **Add `--dangerously-skip-permissions` to Task 14.** The Claude adapter must include this
   flag in all non-interactive invocations. Add it to the `buildClaudeArgs()` function in
   Task 12 and verify it in Task 14's tests.

3. **Specify live refresh in the plan.** Add to Task 33 (UI subscriber): "TerminalSubscriber
   emits `dashboard_refresh` event every 10 seconds during step execution." Or add a
   `useInterval` hook in the dashboard component (Task 28).

### Non-blocking (address during implementation)

4. **Add `--step` and `--reset` to CLI flags (Task 34).** These are used in the bash conductor
   and users depend on them. At minimum, `--step` enables running a single step for debugging.

5. **Add signal handling to Task 34 or Task 20.** `process.on('SIGINT', () => { saveState();
   process.exit(130); })` — ensures state is preserved on Ctrl+C.

6. **Add step cooldown to Claude adapter (Task 14).** Configurable delay between Claude
   invocations, with escalation based on cumulative call count. Default 10s matching bash.

7. **Add elapsed time to dashboard (Task 28).** ST-002 requires "Activity line shows elapsed
   time." Add a timer that starts when a step begins and displays in the dashboard.

8. **Add `--output` mode (Task 34).** The bash conductor's `VIEW_MODE=output` disables the
   dashboard and shows raw output. Useful for debugging and CI. Map to a CLI flag.

9. **Document intentional exclusions.** The following bash behaviors should be explicitly
   documented as out-of-scope for Phase 3, deferred to Phase 4/5, or dropped:
   - Harness update check (recommend: keep in bash, separate from conductor)
   - Harness config check (recommend: keep in bash, separate from conductor)
   - Desktop notifications (recommend: defer to Phase 5 UI abstraction)
   - Session naming (recommend: include in Task 14 — low effort)
   - Progress log (recommend: defer or drop — event log replaces it)

## ADR Decisions

### ADR-1: ESM-only constraint is acceptable

The conductor will be ESM-only (no CommonJS output). This is forced by ink v4+ and execa v8+.
The tsup config must use `format: ['esm']` only. The shell wrapper (`bin/conduct-ts`) invokes
Node directly, so no CJS interop is needed.

### ADR-2: Harness update and config checks remain in bash

The `check_harness_update()` and `check_harness_config()` functions are pre-conductor
bootstrapping concerns. They should remain in a thin bash wrapper (`bin/conduct`) that checks
for updates, then delegates to the TypeScript conductor. This avoids rebuilding git-tag-parsing
and CLAUDE.md-patching logic in TypeScript.

### ADR-3: `--dangerously-skip-permissions` is a required Claude adapter flag

All non-interactive Claude invocations must include `--dangerously-skip-permissions`. Interactive
recovery sessions (ST-009's `i` option) should NOT include this flag, as the user is present
and can approve tool use. This maps to the bash conductor's existing behavior.

### ADR-4: Canonical Small-tier skip list must be resolved before implementation

The authoritative skip list for Small tier will be defined in ST-005 and propagated to the
step registry. The current inconsistency between ST-005, Task 8, and the bash conductor must
be resolved as a prerequisite.
