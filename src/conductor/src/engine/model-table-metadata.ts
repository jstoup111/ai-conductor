import type { StepName } from '../types/steps.js';

// ────────────────────────────────────────────────────────────────────────────
// Model-table metadata
//
// Human-readable "Why" text for each engine step, keyed by StepName. This is
// the single source the generated HARNESS.md model-selection table (and the
// completeness test in test/model-table-metadata.test.ts) draw from. It
// consolidates rationale that used to live as inline `//` comments on
// DEFAULT_STEP_MODELS / DEFAULT_STEP_EFFORT in resolved-config.ts, plus the
// prose "Why" column from HARNESS.md's hand-authored model-selection table.
// ────────────────────────────────────────────────────────────────────────────

export const STEP_RATIONALE: Record<StepName, string> = {
  bootstrap: 'Detection and scaffolding — largely mechanical. Authors the project CLAUDE.md every later step depends on.',
  memory: 'Read/write files, update index — mechanical.',
  assess:
    'The assess skill dispatches 9 specialists and drives structure verification (sonnet); the final cross-referencing of all 9 reports is the cto-orchestrator agent on opus. The orchestrator also sets the env var that cascades effort to subagents.',
  explore:
    'Divergent discovery: approach trade-offs + product/technical track classification. Front-of-funnel with high branching factor — mistake cost is localized; Fable\'s cheaper generation wins, but mistakes here cascade downstream.',
  prd: 'Front-of-funnel PRD authoring: requirements + FRs. Fable handles product writing competently; speed over supreme depth in the early design phase.',
  complexity:
    'Assigns S/M/L, which gates every downstream model/effort decision — a wrong tier cascades, but the classification itself is low-effort pattern matching.',
  stories: 'Pattern-following from design doc, structured output.',
  conflict_check:
    'Pairwise comparison is manageable for Sonnet with <=15 stories; Large tier escalates to Fable for subtle contradiction detection. Enforced via DEFAULT_STEP_TIER_OVERRIDES.conflict_check.L.',
  plan: 'Structured task breakdown from stories; Large tier escalates to Fable for task sequencing and dependency reasoning at scale. Enforced via DEFAULT_STEP_TIER_OVERRIDES.plan.L.',
  architecture_diagram: 'Structured output generation from codebase scan — pattern-following.',
  architecture_review:
    'Pre-implementation design feasibility and alignment: Fable provides sufficient reasoning for early-stage architecture reviews.',
  worktree: 'Git operations — mechanical branch/worktree management.',
  acceptance_specs: 'Generating specs from acceptance criteria — templated work.',
  build: 'Dispatcher; intelligence is in per-task sub-sessions, so the dispatcher itself runs mechanically on the cheapest model.',
  manual_test: 'Structured validation against stories — pattern-following.',
  prd_audit: 'Cross-references PRD intent vs shipped implementation across two domains (spec + code) — deep reasoning, FR-by-FR.',
  architecture_review_as_built:
    'The SHIP --as-built compliance mode is lighter than the pre-implementation review (code vs APPROVED ADRs) — pattern-match code vs approved design.',
  retro: 'Structured analysis from concrete data; Part C (context efficiency) is checklist-based.',
  rebase: 'Fable guards semantic merges; wrong merge silently reverts merged work. Conflict resolution dispatch reasons over both sides of a hunk.',
  finish: 'Mechanical checks — run tests, check git status, verify coverage.',
  remediate: 'Fable guards failure disposition; false HALT wastes context, wrong routing misroutes rework. Gap reasoning + concrete task planning.',
};
