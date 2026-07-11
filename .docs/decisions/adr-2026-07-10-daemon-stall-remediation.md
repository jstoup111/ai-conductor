# ADR: Route daemon build stalls (halt-user-input-required) through /remediate before halting

Status: APPROVED
Date: 2026-07-10
Issue: jstoup111/ai-conductor#459

## Context

When a build agent writes `.pipeline/halt-user-input-required` (the pipeline skill's
deliberate "I need human judgement" signal), the conductor's stall breaker
(`conductor.ts:1689-1802`) flags a `build_stall` with reason `halt_marker`, deletes the
marker (`clearHaltMarker`, `conductor.ts:1769`), and — in daemon/auto mode — skips the
interactive REPL and breaks to the generic unattended-failure HALT
(`conductor.ts:2222-2259`, reason `step 'build' failed in auto mode (retries exhausted)`).

Two defects (both verified on main):

1. **The agent's question is discarded.** `haltMarkerExists` (`task-progress.ts:73-80`)
   reads the marker only to return a boolean; no code path forwards the marker body into
   `.pipeline/HALT`. The operator sees "retries exhausted", never the question.
2. **The halt is a human dead end even when no human is needed.** Observed 2026-07-10 on
   `setup-before-dispatch-wedge`: the halt burned a retry cycle + rekick latency, and the
   next dispatch completed the build with no human input — the question was answerable
   from the committed artifacts.

Meanwhile `/remediate` already exists as a daemon-only, dispatch-only step whose entire
purpose is "autonomous fix where possible, HALT only for architectural-clarity /
product-scope" (`planRemediation`, `conductor.ts:766-824`), bounded by
`remediationRounds < MAX_KICKBACKS_PER_GATE`.

## Decision

In **daemon mode only**, route a `halt_marker` build stall through the existing
`/remediate` machinery before any HALT:

1. **Capture before clear.** In the stall branch, read the marker **content** before
   `clearHaltMarker` runs, and persist it as evidence to
   `.pipeline/build-stall-question.md` (gitignored run evidence, overwritten per stall).
2. **New `build_stall` trigger into `planRemediation()`.** Dispatch with a context
   naming the stall question and `hintSource = { source: 'build_stall', evidenceFile:
   '.pipeline/build-stall-question.md' }`. The remediation-planner reasons over the
   question plus committed artifacts (plan, stories, ADRs, task-status).
3. **Answerable → in-loop resume, no retry burned.** A `route` outcome with target
   `build` is consumed **in the retry loop** (not via `navigateBack` — the stall happens
   *during* build): set the loop-local `retryHint` to the remediation hint carrying the
   answer, then `attempt--; continue;` — the same no-burn idiom as `sessionExpired`
   (`conductor.ts:1497-1509`) and auth-park (`conductor.ts:1511-1582`).
4. **Human-scoped → HALT carrying the question verbatim.** A `halt` outcome
   (architectural-clarity / product-scope) writes `.pipeline/HALT` whose first line is
   the agent's question (plus the disposition detail), then breaks. The existing
   preserve-specific-reason mechanism (`conductor.ts:2229-2236`) guarantees the generic
   "retries exhausted" writer will not overwrite it.
5. **Fail-safe (unconditional).** If the remediation dispatch fails, returns `none`, or
   the `remediationRounds` budget is exhausted, the flow degrades to today's HALT — but
   `.pipeline/HALT` still carries the question verbatim. Under no path may the question
   be dropped in daemon mode.
6. **Budget.** Stall remediations share the existing per-run `remediationRounds` /
   `MAX_KICKBACKS_PER_GATE` budget (no new counter). Budget exhausted → fail-safe HALT.
7. **Skill contract extension (stall-question input mode).** `skills/remediate/SKILL.md`
   gains a `build_stall` input class: evidence is a question, not a gap list; the
   disposition `id` is `stall:<slug>`; for an answerable question the planner emits
   `disposition: "build"` with `tasks: []` and the **answer in `rationale`** — engine-side
   `readRemediationPlan` already accepts empty `tasks` (`artifacts.ts:1657-1667`; the
   "tasks non-empty for build" rule is a skill-contract rule for gap remediation and is
   explicitly relaxed for stall questions, so no plan-append occurs for an answer).

**Out of scope:** the implicit `no_task_progress` stall (belongs to #280); interactive
mode (the `runInteractive('build')` REPL path is unchanged); the daemon auto-park layer
(`conductor.ts:1727-1759`) runs before the stall branch and is untouched.

## Consequences

- An answerable stall costs one bounded remediation dispatch instead of a halt → rekick
  cycle (~1 idle-poll interval plus operator latency) — removing one of the three
  human-in-loop dead ends from the 2026-07-10 builds (companions: #280, #457).
- Operators reviewing a genuine HALT finally see the agent's actual question.
- The deliberate resume does not advance the retry-as-escalation ladder
  (adr-2026-07-05-retry-as-escalation-ladder) — consistent with the sessionExpired
  precedent; a stall answer is not a failure signal.
- A repeat stall on the same feature consumes the shared remediation budget; two stall
  remediations in one run exhaust it and the third stall halts (fail-safe), preventing
  ask→answer→ask loops.
- Aligned with the deterministic-first principle: content capture, evidence persistence,
  HALT plumbing, and budget are engine code; the LLM judges only answerability — the
  genuinely nondeterministic part.

## Evidence

- Stall breaker + clear-before-read defect: `src/conductor/src/engine/conductor.ts:1689-1802` (verified 2026-07-10).
- Generic HALT + preserve-existing-reason seam: `conductor.ts:2222-2259` (verified).
- No-burn idiom: `conductor.ts:1453-1582` — rateLimited, sessionExpired, authFailure all
  `attempt--; continue;` (verified).
- `retryHint` is loop-local and mutable per attempt: `conductor.ts:1417, 1451, 1587` (verified).
- `planRemediation` contract: `conductor.ts:766-824` (verified).
- Engine accepts `tasks: []` on a build gap: `src/conductor/src/engine/artifacts.ts:1646-1676` (verified).
- Marker content discarded today: `src/conductor/src/engine/task-progress.ts:73-90` (verified by Explore agent read).
