# ADR: Session-hook task stamping at subagent dispatch

**Date:** 2026-07-10
**Status:** APPROVED
**Feature:** engine-invoked task start/done at subagent dispatch (#477)
**Related:** #452 (task CLI + git hooks), #433 (deterministic attribution), #302 (engine-owned task-status), #403 (stale-engine class)

## Context

#452 shipped the current-task stamping machinery, but its trigger is prompt
discipline: `skills/pipeline/SKILL.md` step 0 instructs the orchestrator agent to
run `conduct-ts task start <id>` before each subagent dispatch. `conductor.ts`
never invokes the task CLI (verified: `runTaskStart`/`runTaskDone` are imported
only by `index.ts` CLI dispatch). Three builds on 2026-07-10 landed real commits
with `T=[]` because the orchestrator skipped step 0 → evidence-starvation halts.

The Node engine cannot stamp at the task boundary itself: it spawns ONE headless
`/pipeline` session per build step (`claude-provider.ts`, `--print
--output-format text`); per-task subagents are in-session Agent-tool dispatches,
invisible to the engine process.

## Decision

**Install Claude-session PreToolUse/PostToolUse hooks, matched on the
subagent-dispatch tool, into every build worktree at provisioning time
(`prepareWorktree`) — the same moment and pattern as #452's git hooks.**

1. **Trigger (machinery, not prompt):** PreToolUse fires on 100% of Agent-tool
   dispatches. The hook parses the dispatch prompt from the payload's
   `tool_input.prompt`.
2. **Dispatch-prompt contract (fail-closed):** every pipeline subagent dispatch
   prompt MUST carry either `Task: <id>` (implementation dispatch) or
   `Task: none` (review/grader/evaluator dispatch) **as its FIRST LINE — the
   hook parses line 1 of `tool_input.prompt` only and never scans the body**.
   Line 1 must exactly match `Task: <id>` or `Task: none`; anything else is
   BLOCKED (hook exit 2) with an instructive stderr naming the exact fix.
   Line-1-only parsing is what makes the marker unambiguous: dispatch prompts
   already contain `Task:` tokens in their body by contract (#417/#302 inject
   the commit-trailer instruction, e.g. "include trailer `Task: 7`"), and body
   text MUST NOT be able to satisfy, contradict, or ambiguate the marker.
   The prompt carries only *data*; enforcement is mechanical and fails at the
   point of violation. This applies to ALL in-session Agent dispatches in the
   build worktree — the hook is worktree-global, so every `/pipeline` dispatch
   template (TDD implementation, evaluator, simplify, micro-retro,
   memory-checkpoint) carries a line-1 marker.
3. **Stamping semantics (replicates `runTaskStart`):** on `Task: <id>` the hook
   validates the id against the engine-seeded `task-status.json` row set
   (unknown id → block, exit 2), flips the row to `in_progress` (atomic
   temp-file + rename), and writes `.pipeline/current-task`. On `Task: none` it
   passes through untouched.
4. **Overlap guard:** if a different task's stamp is already present, the hook
   still flips the new row to `in_progress` but CLEARS the stamp file — #452's
   `prepare-commit-msg` then finds ≥2 `in_progress` rows and abstains. Parallel
   dispatch degrades to today's abstain-on-ambiguity, never a wrong stamp.
5. **Task done:** PostToolUse (same matcher) removes `.pipeline/current-task`
   iff its content matches that dispatch's id (mirrors `runTaskDone`). It fires
   on subagent return regardless of verdict — safe, since a FIX re-dispatch
   re-stamps via PreToolUse. It never writes `completed` to task-status.json
   (completion stays evidence-gate-only, per #302/#456).
6. **Delivery:** hook scripts are embedded engine assets (extending the
   `git-hook-assets.ts` pattern — pure bash + inline `node -e`, no dist, no
   `conduct-ts` invocation, so they can never run stale engine code, #403
   class), written under `.pipeline/session-hooks/` in the build worktree and
   wired via a machine-written `.claude/settings.local.json` in that worktree
   (merge-preserving if one exists; never touches the consumer's committed
   `.claude/settings.json`).
7. **Degradation rule (brick-resistant):** an unparseable hook payload passes
   through WITHOUT stamping (fail-open to #452's abstain path) — only a parsed
   prompt missing the contract marker or carrying an unknown id blocks. A CLI
   payload-format change therefore degrades attribution to today's behavior
   instead of bricking every build.
8. **Skill layer:** `skills/pipeline/SKILL.md` steps 0/6 are rewritten as
   documentation of engine behavior plus the dispatch-prompt contract; the
   orchestrator no longer invokes the task CLI.

## Evidence (verify-claims ledger)

| Claim | Basis | Confidence |
|---|---|---|
| PreToolUse tool-matcher hooks fire in headless `claude -p` sessions | **verified** — spike 2026-07-10, session `95588bbd`: hook captured `hook_event_name: PreToolUse`, `tool_name: Agent` during a headless dispatch | 100% |
| The dispatch prompt is visible to the hook (`tool_input.prompt`) | **verified** — same capture contains the verbatim subagent prompt incl. `Task: 7` | 100% |
| Hooks fire from machine-written `.claude/settings.local.json` | **verified** — spike session `9dce55c0` with settings moved to settings.local.json | 100% |
| Exit 2 blocks the dispatch and feeds stderr to the orchestrator | **verified** — spike: id-less dispatch blocked; orchestrator echoed the hook's stderr verbatim | 100% |
| PostToolUse fires on subagent return in headless mode | **inferred** — same event system as the verified PreToolUse | 95% |
| Engine call-site absence (`runTaskStart` unwired) | **verified** — grep: sole importer is `index.ts` | 100% |

PostToolUse is the only inferred link, and its failure mode is benign: the stamp
persists until the next PreToolUse overwrites it or build-entry cleanup clears
it (`task-seed.ts` already rm's a stale `current-task` at seed time — verified).

## Supersession

Item 1 of `adr-2026-07-09-deterministic-evidence-attribution-enforcement`
(orchestrator runs `conduct-ts task start <id>` at SKILL.md step 0) is
superseded by this ADR: the session hooks perform the stamp/flip mechanically
and the SKILL.md step becomes documentation. The task CLI itself is retained
(operator/recovery use). #433's other decisions (git hooks, CLI verbs,
completion authority) are unchanged and remain authoritative.

## Related follow-up (not absorbed)

Issue #485 (commit-msg hook should normalize a body-embedded anchored
`Task: <id>` line into the trailer block) targets the *git commit message*
surface and stays a separate spec. It is the remaining net for the windows
where this ADR's stamp is legitimately absent: amend paths and the overlap
guard's parallel-dispatch abstain window.

## Alternatives rejected

- **Stream-json observation** — engine parses tool_use events and stamps
  in-process. Reactive (cannot block a violating dispatch → loses fail-closed),
  reworks the execution layer, couples to CLI output format, front-runs the
  unresolved OTel hooks-vs-stream-json spike.
- **Engine-driven per-task sessions** — one session per task with engine-side
  start/done. Correct end-state but a build-phase rewrite (ordering, scoped
  VERIFY, FIX loops, conformance checks all live in-session) colliding with the
  deferred `conductor.run()` refactor. If that restructure ever lands, this
  ADR's hooks are simply removed with it.
- **Stronger SKILL.md prompt** — the exact failure mode this repo's
  deterministic-first principle forbids relying on.

## Consequences

- #452's protection becomes unconditional: no build converges or starves based
  on orchestrator compliance.
- New canonical breaking surface touched (**hook wiring**) → the implementation
  PR MUST carry a CHANGELOG `## Migration` block (or a release-gate waiver only
  if the final diff is judged internal-only — not expected here).
- Review/grader dispatches gain one mandatory prompt token (`Task: none`);
  violations self-correct instantly via the block message.
- Build worktrees gain a machine-owned `.claude/settings.local.json`; the
  consumer's committed settings are never modified.
