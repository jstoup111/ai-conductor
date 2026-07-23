# Observability & Task Attribution

Reference for the deterministic attribution and telemetry machinery the pipeline uses
to track task progress and dispatch — git-trailer hooks, session-hook stamping at
subagent dispatch, and their fail-open/fail-closed guarantees.

**Task attribution automation (`task start|done`)** — The pipeline now automates task progress tracking
via `conduct-ts task` subcommands, which own the mechanics of updating `.pipeline/task-status.json`
and git hook wiring. Instead of editing JSON by hand or relying on prompt discipline, the orchestrator
calls:

```bash
# Before dispatching a subagent to work on a task
conduct-ts task start <id>

# After the subagent's commit lands (task complete)
conduct-ts task done <id>
```

- `<id>` is the bare task ID from the plan header (e.g., `7`, not `task-7`).
- `task start` flips the task status to `in_progress` in `.pipeline/task-status.json`.
- `task done` marks the task `completed` and clears the in-flight marker.
- Both commands are **deterministic and idempotent** — running them multiple times is safe.
- They fail gracefully on missing/corrupt state; orchestrator can continue.

**Git hook wiring (worktree-scoped, fail-open)** — When a daemon builds a feature worktree,
the conductor provisions two **deterministic attribution hooks** (run from the engine, not the prompt)
to capture proof that a task's code commits are load-bearing:

- **`prepare-commit-msg` hook** — Auto-injects the `Task: <id>` trailer (or amends a malformed one)
  from `.pipeline/current-task` so every commit carries the required attribution trailer.
- **`commit-msg` hook** — Validates the trailer format (non-empty id, no false-positive noise).

Both hooks are written to `.pipeline/git-hooks/` and wired via git config (`core.hooksPath`)
scoped to the worktree only — the host checkout is never affected. **Fail-open design:**
if hook provisioning fails, the build continues (hooks are logged as skipped, not fatal).
`Task:` trailers are telemetry only (progress/resolved-count reporting and attribution
spot-audit sampling) — they never gate build completion, so a missed stamp cannot block
the build either way.

**Chaining with repo's own hooks** — The wired hooks chain to the repository's own hooks
(if any exist under `.git/hooks/`), so a repo's custom pre-commit linter or post-commit
automation is not disabled. The engine's hooks run first, and exit codes propagate.

For implementation details and hook asset definitions, see `src/conductor/src/engine/git-hook-assets.ts`
and `src/conductor/README.md` → "Task attribution automation".

**Session-hook stamping at subagent dispatch (#477)** — Git-trailer attribution proves a task's
commits happened, but it fires at commit time, after the fact. A second, earlier layer stamps task
state at the moment a subagent is actually **dispatched**, independent of whether the dispatching
agent remembers to call `conduct-ts task start|done` itself.

When the daemon provisions a feature worktree, it writes two scripts —
`.pipeline/session-hooks/pre-dispatch.sh` and `.pipeline/session-hooks/post-dispatch.sh` — and wires
them as Claude-session `PreToolUse`/`PostToolUse` hooks (matcher `Task|Agent`) in that worktree's
`.claude/settings.local.json`. Every subagent dispatch (the `Task`/`Agent` tool call) passes through
these hooks before and after the subagent runs.

**The line-1 dispatch-marker contract:** every dispatch template's prompt MUST start with exactly one
of these as its first line:

```
Task: <id>
```
```
Task: none
```

`<id>` is the bare task id from the plan header (e.g. `7`), matching a row in
`.pipeline/task-status.json`. Templates that dispatch implementation work (the `pipeline` skill's
per-task DISPATCH step) use `Task: <id>`; templates that dispatch non-implementation work
(evaluator/`code-review`, `/simplify`, micro-retro, memory-checkpoint) use `Task: none`. Only line 1
is parsed — a later line, or an unrelated `Task:`-looking token in the prompt body (e.g. commit
trailer instructions), is invisible to the hook.

**What the hooks do:**
- `pre-dispatch.sh` (`PreToolUse`) parses line 1 of the dispatched prompt. `Task: <id>` flips that
  task's row to `in_progress` in `.pipeline/task-status.json` and writes `.pipeline/current-task`
  (atomic temp-file + rename); an existing stamp for a *different* id is removed first (overlap
  guard). `Task: none` is a pass-through no-op.
- `post-dispatch.sh` (`PostToolUse`) removes the `.pipeline/current-task` stamp if it still matches,
  once the subagent returns. It never writes `completed` — task completion is derived by
  `build_review`'s completeness rubric (plan-vs-diff, LLM-judged, fail-closed), not from these
  hooks; the stamps they write are telemetry only.

**Fail-open vs. fail-closed:** the two failure regimes are deliberately different.
- **Fail-open (exit 0, no state change):** the hook cannot parse the payload at all (e.g. malformed
  JSON on stdin). This mirrors #452's abstain path — an unreadable signal must never block dispatch.
- **Fail-closed (exit 2, blocks dispatch):** the payload parses but line 1 violates the grammar —
  unknown task id, missing marker, wrong format (`Task:7`, `task: 7`), or two ids on one line. stderr
  names the problem so it's actionable. This is a deliberate machinery-enforced guard against
  drift in dispatch-template authoring (see this repo's "Design Principles": deterministic
  enforcement over prompt discipline).

**`settings.local.json` ownership:** `.claude/settings.local.json` inside a feature worktree is
**untracked and engine-managed** — the daemon writes/merges it on every worktree provisioning pass,
preserving any unrelated keys and backing up (not discarding) a corrupt file before rebuilding it.
It is never committed and never read as project config; do not hand-edit it inside a build worktree,
since the next provisioning pass will merge over the hook entries again (identified by the
`session-hooks/` path in the wired command).

For implementation details, see `src/conductor/src/engine/session-hook-assets.ts` (hook script
bodies), `src/conductor/src/engine/worktree-prepare.ts` (provisioning/wiring), and
`src/conductor/README.md` → "Session-hook task stamping at subagent dispatch".
