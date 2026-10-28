# Complexity: Code-valid as-built verdict re-run after a prd_audit refusal halt

Tier: S

Rationale: One production file, `src/conductor/src/engine/conductor.ts`. The validation-group join's
judgement-halt exits gain the satisfied-sibling retention that its no-verdict and mechanical-fault
exits already perform, and the auto-mode group fan-out calls the serial walk's existing
stale-preservation probe, extracted into one shared helper, for each `stale` member before
dispatch. No new module, state status, event variant, config key, HALT class, CLI, or schema.
Signals: 0 models, 0 external integrations, no auth, no new state machine (existing step statuses
only), 2 stories. Both behaviors reuse already-approved decisions
(adr-2026-07-10-validation-group-join D2 as amended by #1425; adr-2026-07-22-gate-evidence-code-validity-on-redispatch
as extended by #2639) on paths that bypassed them, so no new ADR is needed. Risk is bounded to
validation-group resume scheduling and is covered by conductor-level tests through `Conductor.run()`
plus one real-git acceptance test.
