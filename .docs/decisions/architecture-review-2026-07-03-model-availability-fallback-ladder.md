# Architecture Review: Model Availability Probe + Fallback Ladder
**Date:** 2026-07-03
**Mode:** Lightweight (Medium tier) — feasibility + alignment
**Input reviewed:** explore output + technical intent (intake jstoup111/ai-conductor#186); approved diagram `.docs/architecture/model-availability-fallback-ladder.md`
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** pure TypeScript inside `src/conductor/src`; no new
  dependencies, services, or infrastructure. ✓
- **Seam fit:** `ClaudeProvider.invoke()` already captures output and flags two
  failure classes (`rateLimited`, `sessionExpired`) consumed specially by
  `runAutonomous()` (`step-runners.ts`) — `modelUnavailable` is a third instance
  of an established pattern, not a new mechanism. ✓
- **Retry isolation:** placing the ladder walk inside the step-runner seam means
  `conductor.ts` retry/HALT logic needs **zero changes** — an exhausted ladder
  returns an ordinary failure. The "downgrade never burns a retry" requirement is
  satisfied structurally, not by new conditional logic in the most sensitive file. ✓
- **Known limitation:** `invokeInteractive()` inherits stdio and returns void — no
  output capture, so no reactive detection there. Mitigated by pre-invoke cache
  consult on both paths (interactive steps benefit from earlier detection).
  Documented in the ADR; acceptable because the motivating failure (daemon HALT)
  occurs on the autonomous `invoke()` path.
- **Config:** top-level `model_fallback_ladder: string[]` in HarnessConfig;
  `config.ts` already has per-block validators to extend (`validateConfig`).
  Empty array = no fallback (valid; negative-path test mandated). ✓

## Alignment

- **Pattern consistency:** detection-flag threading mirrors `sessionExpired`
  end-to-end (provider flag → step-runner special case). New module
  `engine/model-availability.ts` follows the one-concern-per-module layout of
  `engine/`. ✓
- **Domain boundaries:** execution/ (detection) and engine/ (policy: cache +
  ladder) stay cleanly split; config stays in the existing HarnessConfig path. ✓
- **State management:** cache is an explicit per-process map keyed by exact model
  string (aliases and full IDs opaque); no hidden globals beyond the process-
  lifetime singleton, which is the issue's stated requirement. ✓
- **Worktree isolation:** no ports, DBs, files, or shared state — cache is
  in-memory per process. Two daemons/worktrees cannot conflict. ✓
- **Security:** no new inputs beyond a validated config array of strings; model
  strings were already passed through unvalidated — the ladder only narrows
  behavior. ✓
- **Diagram accuracy:** `.docs/architecture/model-availability-fallback-ladder.md`
  (approved 2026-07-03) matches this design. ✓

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Detection regex false-positive downgrades on an unrelated error | Technical | Medium | Medium | Anchor regex to known CLI/API error signatures; negative test asserting ordinary failures do NOT set the flag |
| CLI error-text drift silently disables detection | Technical | Medium | Medium | Fail-safe direction (old HALT behavior returns); real-binary smoke test per feedback_injected_runner_needs_real_binary_smoke |
| Transient blip pins a long-running daemon on a downgraded model | Technical | Low | Medium | Loud per-downgrade warning in step output/daemon.log; restart clears cache (per issue #186) |
| Interactive steps still fail on a dead model never seen by an autonomous step | Technical | Low | Low | Pre-invoke cache consult on both paths; documented limitation |

No High-impact risks registered.

## ADRs Created

- `adr-2026-07-03-reactive-model-fallback-ladder` (APPROVED by operator, 2026-07-03)

## Conditions

None. APPROVED, contingent only on the ADR reaching APPROVED status (lifecycle gate,
not a design condition).
