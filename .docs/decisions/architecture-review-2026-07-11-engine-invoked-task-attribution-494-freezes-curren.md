# Architecture Review: Attribution Abstain-or-Loud Hardening (#519)
**Date:** 2026-07-11
**Mode:** lightweight (Tier M, technical track, pre-stories)
**Input reviewed:** explore output + operator-approved design direction (approach A);
architecture doc `.docs/architecture/engine-invoked-task-attribution-494-freezes-curren.md`
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility** — all three changes live in existing embedded asset templates
  (`session-hook-assets.ts`, `git-hook-assets.ts`): pure bash + inline `node -e`, no new
  dependencies, no dist invocation (preserves the #403 stale-engine immunity property).
  Verified against the shipped hook copies in the kept #492 worktree.
- **Prerequisites** — none. #509's enforcement (build-step-active marker + fail-closed gate)
  is merged and armed; this feature composes with it, requires nothing new from it.
- **Integration surface** — two template files + their provisioning tests. The evidence gate,
  dispatch grammar, overlap guard, `post-dispatch.sh`, and `worktree-prepare.ts` wiring are
  untouched.
- **Test seam** — exists and is precedented: `test/engine/session-hook-behavior.test.ts`
  executes the generated bash against fixture `.pipeline` state;
  `test/integration/git-hooks-attribution.test.ts` and
  `test/integration/session-hooks-attribution.test.ts` cover commit-time behavior in real
  temp repos. The #519 regression shape (sequential dispatches, later bookkeeping failure,
  assert no inherited stale id) fits these harnesses directly.
- **Worktree isolation** — hooks are provisioned per worktree; tests use temp repos. No shared
  state, no ports, no services.

## Alignment

- **adr-2026-07-09-deterministic-evidence-attribution-enforcement (APPROVED)** — two findings:
  1. That ADR *mandates* the `prepare-commit-msg` unique-in_progress fallback this feature
     deletes. The new ADR (below) explicitly **amends** that clause rather than silently
     contradicting it. Rationale for the amendment: #519 demonstrated the fallback is a silent
     guesser that converts bookkeeping failures into plausible-but-wrong evidence — the exact
     failure class the ADR's own "abstains when neither yields exactly one id" language was
     trying to prevent.
  2. That ADR requires `commit-msg` to "reject a Task: trailer id outside the seeded id set."
     The shipped implementation checks `Object.keys(data.tasks || {})` on an ARRAY — indices,
     not ids — so the code **already violates the APPROVED ADR**. Fix #3 is drift REPAIR
     (restores conformance), not a new decision.
- **adr-2026-07-11-semantic-attribution-verification-lane (APPROVED)** — explicitly sanctions
  this work: "Bug fixes to existing machinery — e.g. #501/#519/#510 — are repairs, not growth,
  and remain sanctioned." Its mechanical-lane CAP (no new hook, sentinel, marker, or
  enforcement surface) is honored: approach A hardens existing surfaces only. Stories and plan
  MUST NOT introduce any new enforcement surface.
- **adr-2026-07-10-session-hook-task-stamping / adr-2026-07-10-inline-work-attribution-
  enforcement (APPROVED)** — dispatch grammar, overlap-guard clear-on-switch, build-step-active
  marker semantics, and engine-commit exemptions all unchanged. The abstain→loud-reject→agent
  self-stamp path is those ADRs' intended composition, now made reliable by real-id validation.
- **CLAUDE.md deterministic-first principle** — the fix is machinery that abstains/validates at
  the moment of the mistake, not prompt discipline. Conforms.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Fallback removal starves attribution where the stamp is legitimately absent mid-task (e.g. host session restart), increasing loud gate rejections | Technical | Medium | Low | That is the designed behavior: rejection is instructive and the agent self-stamps a validated id; regression tests assert the rejection message names the fix |
| Real-id validation newly rejects in-flight builds whose trailers relied on the index bug (id == task count) | Integration | Low | Medium | Fix ships in asset templates; only NEWLY provisioned worktrees get it. Kept worktrees (e.g. #492 rekick) re-provision on dispatch — verify in stories |
| stderr diagnostics from PreToolUse hooks may be invisible in headless daemon sessions | Knowledge | Medium | Low | #477 probe verified hook stderr reaches the session log in `claude -p`; regression test asserts the diagnostic text exists on the failure path |
| Exact #492 trigger unproven — fix could miss an unimagined uncertainty path | Knowledge | Low | Medium | Operator-accepted unknown; hardening covers every early-exit path in the script (enumerated in the ADR), not just hypothesized ones |

## Domain Integrity

Not applicable at depth (lightweight mode; no new domain types). The one state-machine rule is
captured in the ADR as an invariant: `current-task` present ⇒ written by the most recent
successful dispatch bookkeeping.

## ADRs Created

- `adr-2026-07-11-attribution-abstain-or-loud.md` — the abstain-or-loud invariant; amends the
  fallback clause of adr-2026-07-09-deterministic-evidence-attribution-enforcement.

## Adjacent, deliberately deferred

- `task-N` alias inconsistency (derivation accepts guarded alias, commit-msg hook rejects it) —
  documented non-goal in adr-2026-07-11-semantic-attribution-verification-lane; separate
  mechanical fix.
- Parallel-native attribution (F4) — separate intake issue, prerequisite of #474.
