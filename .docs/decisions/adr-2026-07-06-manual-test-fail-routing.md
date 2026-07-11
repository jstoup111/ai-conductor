# ADR: manual_test FAIL routing, fix-evidence gate, and gating enforcement

**Status:** APPROVED (operator-selected Approach B, 2026-07-06 session decision)
**Date:** 2026-07-06
**Issue:** ai-conductor#367
**Related:** #364 (incident), #365/#325 (fresh sessions — merged prerequisite), #324 (future
build_review step — deliberately independent), #297/#181 (RED-evidence precedent), #368 (gate
seam precedent)

## Context

Two verified engine defects let a feature ship green after its manual test failed:

1. **Whitewash:** the manual_test completion gate (`artifacts.ts`) checks only that
   `.pipeline/manual-test-results.md` is fresh and FAIL-free. A within-step retry — whose
   miss reason literally instructs "fix the bugs and re-run manual-test" — can satisfy the
   gate by rewriting the results file as PASS with zero fix commits (incident: 52-second
   retry, PR #364 shipped implementing none of its plan).
2. **Advisory auto-skip:** in auto mode, an advisory step whose retries exhaust is silently
   skipped (`conductor.ts` — `if (step.enforcement === 'advisory') … 'skipped'; continue`).
   manual_test is advisory, so even a persistently-failing manual test cannot stop a ship.

There is no route from manual_test back to build: `build` is not a `kickbackTarget`, and the
daemon remediation hooks cover only `prd_audit`, `finish`, and `architecture_review_as_built`.

## Decision

Approach B (operator-selected over A "keep advisory" and C "gate-hardening only"):

1. **Enforcement flip:** `manual_test` becomes `gating` in `steps.ts`. Exhausted retries HALT
   (auto/daemon) or open the recovery menu (interactive) instead of silently skipping. This
   reconciles the engine with `skills/manual-test/SKILL.md`, whose frontmatter has declared
   `enforcement: gating` all along. manual_test also joins `ENFORCEMENT_LOCKED_STEPS`
   (`skill-resolver.ts`) so a project-local skill override cannot downgrade it back, and the
   consumer-facing break (a config that `disabled` manual_test now hard-errors) ships with a
   CHANGELOG Migration note.
2. **Deterministic daemon kickback manual_test → build.** In the daemon failure-routing block
   of `conductor.ts` (beside the prd_audit hook), a manual_test gate failure with FAIL rows
   routes back to `build` via `navigateBack` + `pendingRetryHints` carrying the FAIL rows as
   evidence, restaging manual_test as `stale`, bounded by a dedicated self-heal counter
   capped at `MAX_KICKBACKS_PER_GATE`; the budget's exhaustion HALTs.
   *Simplification vs the issue's proposal:* no `/remediate` dispatch. A manual-test FAIL is
   by definition an implementation gap — the routing decision prd_audit needs an agent for
   (impl vs product-scope) has exactly one answer here, so the deterministic route is
   strictly simpler and cheaper. Product-scope problems still surface at prd_audit, which
   retains its agentic routing.
3. **Fix-evidence (anti-whitewash) gate.** The manual_test completion gate records
   `.pipeline/manual-test-fail-evidence.json` (`headSha`, `observedAt`, fail excerpt) when it
   observes FAIL rows. A subsequent FAIL-free results file is accepted only when `HEAD` has
   moved past the recorded sha (new commits = the fix exists); an unchanged sha returns
   not-done with an explicit whitewash-guard reason. The marker is cleared on legitimate
   pass. `HEAD` is read via a new optional `CompletionContext.getHeadSha` seam (injected by
   the conductor with a real `git rev-parse HEAD`; injectable in tests — the seam pattern
   #368 asks for). Missing seam / null sha (no git, test envs) fails open to preserve
   existing behavior outside real runs.
4. **Append-only per-attempt results.** The manual-test skill appends `## Attempt N — <ts>`
   sections instead of overwriting; the gate evaluates the LATEST attempt section when
   sections are present (whole file otherwise, back-compat), so history is preserved and an
   old FAIL cannot permanently block after a real fix.

## Consequences

- A daemon feature whose manual test fails now loops build→manual_test (bounded) and then
  HALTs — it can no longer ship un-fixed or be silently skipped. More parked features is the
  correct trade (operator-accepted).
- Interactive `/conduct` behavior change: manual_test failures now block like other gating
  steps (recovery menu) rather than being skippable.
- The gate acquires one write responsibility (the fail-evidence marker). Accepted: it keeps
  observation and enforcement in one place; the marker is gitignored run evidence like
  `acceptance-specs-red.json`.
- Compatible with a future #324 `build_review` step: this ADR touches only the
  manual_test-and-after seam and adds no new step; `build_review` would slot before
  manual_test unchanged.
- No settings.json / CLI / hook-schema change → no migration block; consumer-visible
  behavior change is CHANGELOG'd.
