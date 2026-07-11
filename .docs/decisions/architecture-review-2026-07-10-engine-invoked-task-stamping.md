# Architecture Review: Engine-Invoked Task Start/Done at Subagent Dispatch (#477)
**Date:** 2026-07-10
**Mode:** lightweight (tier M, technical track) — Sections 2 (Feasibility) + 4 (Alignment)
**Inputs reviewed:** track marker, complexity tier, component/sequence diagrams (operator-approved), decision record 2026-07-10-engine-invoked-task-stamping-approach
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** no new dependencies. Hooks are pure bash + inline
  `node -e` (git-hook-assets.ts precedent); wiring is a JSON file the engine
  already knows how to write at provisioning. Engine changes are additive in
  `worktree-prepare.ts` + a new embedded-asset module.
- **Load-bearing behaviors settled by spike (all VERIFIED 2026-07-10, evidence
  in the ADR's verify-claims ledger):** (1) PreToolUse tool-matcher hooks fire
  in headless `claude -p` sessions; (2) the hook receives the full dispatch
  prompt via `tool_input.prompt`, so `Task: <id>` extraction is mechanical;
  (3) hooks fire from machine-written `.claude/settings.local.json`; (4) exit 2
  blocks the dispatch and the stderr message reaches the orchestrator verbatim
  (fail-closed is real, and self-explanatory to the agent).
- **Prerequisites:** none beyond merged #452 machinery (shipped). No schema, no
  migration of data; a CHANGELOG Migration block for the hook-wiring surface.
- **Integration surface:** worktree provisioning, session settings, pipeline
  SKILL.md. The evidence gate, task-seed, task CLI, and both git hooks are
  untouched.
- **Performance:** one subshell per subagent dispatch (~10ms); negligible
  against a multi-minute TDD dispatch.
- **Worktree isolation:** hooks + settings.local.json are per-build-worktree
  files; no shared state, no ports, no cross-worktree contention. Engineer/spec
  worktrees are unaffected (hooks install only on the daemon build path).

## Alignment

- **Deterministic-first (CLAUDE.md design principle):** this is the principle's
  canonical application — machinery stamps/validates/rejects at the moment of
  the mistake; the prompt carries only data. Directly extends #433/#452.
- **Pattern consistency:** mirrors git-hook-assets.ts (embedded assets, no
  dist, installed at `prepareWorktree`). No new pattern without an ADR — the
  one novel decision (session-hook layer + dispatch-prompt contract) is
  captured in adr-2026-07-10-session-hook-task-stamping.
- **Authority boundaries preserved:** hook never writes `completed`
  (evidence gate remains sole completion authority, #302/#456); `Task: none`
  keeps review/grader dispatches out of the stamp lifecycle.
- **State management:** stamp lifecycle is explicit (write at dispatch,
  validated removal at return, clear-on-overlap → abstain). Invalid state
  (wrong-task stamp during parallel dispatch) is made unrepresentable by the
  overlap guard: ambiguity always degrades to abstention, never misattribution.
- **Failure-mode budget:** fail-closed only on a *parsed* violation (missing
  marker / unknown id); fail-open on unparseable payloads so a CLI format
  change degrades to today's abstain path instead of bricking builds.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| CLI hook-payload format change silently stops stamping | Integration | Low | Medium | Fail-open degradation to #452 abstain (never wrong); evidence-gate halt surfaces it; payload shape asserted in tests |
| PostToolUse absent/late in headless mode (only inferred link) | Technical | Low | Low | Stale stamp is overwritten by next PreToolUse; task-seed clears it at build entry (verified) |
| Orchestrator loops on block message | Technical | Low | Medium | Block stderr names the exact fix (`add Task: <id> or Task: none`); forward-progress/halt machinery catches pathological loops |
| Consumer repo ships its own settings.local.json in a build worktree | Integration | Low | Low | Engine merge-preserves unknown keys; build worktrees are engine-created so the file is effectively engine-owned |
| Release gate flags hook-wiring surface | Process | Certain | Low | PR carries a real CHANGELOG Migration block (obligation recorded in ADR) |

No High-impact risks.

## ADRs Created

- `adr-2026-07-10-session-hook-task-stamping.md` — DRAFT, presented for
  operator approval in this session (engineer flow gates land on APPROVED).

## Conditions

None. (Verdict is APPROVED; the only open item is the ADR approval gate itself,
which is the standard §7b lifecycle, not a design condition.)
