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
  build_review:
    'Fresh-session grader judging a maker\'s diff for test tautology, scope creep, and root-cause fixes vs band-aids — adversarial code review demands the deepest reasoning tier, same class of judgement as prd_audit/code-review.',
  manual_test: 'Structured validation against stories — pattern-following.',
  prd_audit: 'Cross-references PRD intent vs shipped implementation across two domains (spec + code) — deep reasoning, FR-by-FR.',
  architecture_review_as_built:
    'The SHIP --as-built compliance mode is lighter than the pre-implementation review (code vs APPROVED ADRs) — pattern-match code vs approved design.',
  retro: 'Structured analysis from concrete data; Part C (context efficiency) is checklist-based.',
  rebase: 'Fable guards semantic merges; wrong merge silently reverts merged work. Conflict resolution dispatch reasons over both sides of a hunk.',
  finish: 'Mechanical checks — run tests, check git status, verify coverage.',
  remediate: 'Fable guards failure disposition; false HALT wastes context, wrong routing misroutes rework. Gap reasoning + concrete task planning.',
  attribution_verify: 'Semantic attribution verification of commits against task metadata — validating work ownership, evidence marshalling, and provenance consistency demands deep reasoning about task-to-commit linkages.',
};

// ────────────────────────────────────────────────────────────────────────────
// SKILL_STEP_MAP / PIN_EXEMPT_SKILLS
//
// Every `skills/*/SKILL.md` that carries a hand-authored `model:` pin in its
// frontmatter must be accounted for here — either mapped to the engine
// StepName it corresponds to (so the pin can be checked against
// DEFAULT_STEP_MODELS) or listed as exempt (skill has no 1:1 engine step, so
// there is nothing to compare the pin against). An unmapped, non-exempt
// pinned skill is a hard failure — see classifyPinnedSkill in
// src/tools/generate-model-table.ts (TS-1 negative path 2 / TS-4).
// ────────────────────────────────────────────────────────────────────────────

export const SKILL_STEP_MAP: Record<string, StepName> = {
  'architecture-diagram': 'architecture_diagram',
  'architecture-review': 'architecture_review',
  assess: 'assess',
  explore: 'explore',
  prd: 'prd',
  'prd-audit': 'prd_audit',
  rebase: 'rebase',
  remediate: 'remediate',
};

// Skills whose `model:` pin has no corresponding engine StepName — the skill
// runs standalone (dispatched directly by the operator/conductor, not as a
// numbered engine step), so there is no DEFAULT_STEP_MODELS entry to compare
// the pin against.
export const PIN_EXEMPT_SKILLS: readonly string[] = [
  'code-review', // dispatches an evaluator agent directly; not an engine step
  'debugging', // standalone investigation skill; not an engine step
  'engineer', // interactive idea→spec loop; orchestrates other skills/steps, isn't one itself
  'simplify', // batch-boundary gate dispatched directly; not an engine step
];

// ────────────────────────────────────────────────────────────────────────────
// Extra model-table rows
//
// Rows for skills/agents that are NOT engine steps (no StepName / no entry in
// DEFAULT_STEP_MODELS) but that HARNESS.md's hand-authored model-selection
// table still documents: domain-reviewer/evaluator (dispatched sub-agents),
// code-review/debugging/simplify/engineer (skills with their own model pin
// but no engine step), conduct/pr (orchestration skills), tdd-red/tdd-green
// (TDD sub-phases), and the 10 cto-* assess specialists.
// Rendered after the engine rows by the generator (Task 5).
//
// NOTE: "writing-system-tests" is deliberately NOT listed here — it is the
// display name of the `acceptance_specs` engine step (see
// DISPLAY_NAME_OVERRIDES in generate-model-table.ts), not a standalone extra
// row. Listing it here too would collide with the renamed engine row and
// trip assertNoDuplicateRowNames.
// ────────────────────────────────────────────────────────────────────────────

export interface ExtraModelTableRow {
  /** Row name as it appears in the "Skill/Agent" column. Must be unique across
   *  both this list and the engine-derived rows — enforced by
   *  assertNoDuplicateRowNames() in generate-model-table.ts. */
  name: string;
  /** "Recommended Model" column text, verbatim. */
  model: string;
  /** "Why" column text, verbatim. */
  rationale: string;
}

export const EXTRA_MODEL_TABLE_ROWS: ExtraModelTableRow[] = [
  {
    name: 'verify-claims',
    model: 'inherits caller',
    rationale:
      'Cross-cutting correctness protocol applied within the invoking skill\'s context (calibrate claims, gate assumptions) — not a separately dispatched agent, so it runs on the caller\'s model.',
  },
  {
    name: 'domain-reviewer',
    model: 'sonnet (<50-line diff), opus (≥50-line diff)',
    rationale:
      'Right-sized by diff size: Sonnet for focused small diffs, Opus for large changes needing cross-boundary judgment.',
  },
  {
    name: 'evaluator',
    model:
      'sonnet (value objects, pure functions, config, infra) / opus (concurrency, state mutation, security, auth, finance)',
    rationale: 'Right-sized by batch content.',
  },
  {
    name: 'code-review',
    model: 'opus',
    rationale: 'Multi-dimensional analysis (spec, quality, domain).',
  },
  {
    name: 'debugging',
    model: 'fable',
    rationale: 'Fable guards root-cause analysis; wrong diagnosis produces band-aid fixes.',
  },
  {
    name: 'simplify',
    model: 'sonnet',
    rationale: 'Pattern matching for duplication and complexity — structured checklist work.',
  },
  {
    name: 'engineer',
    model: 'fable',
    rationale:
      'Interactive idea→spec control plane: cheaper generation with interactive feedback loop — routes real DECIDE skills without the cost of opus for every iteration.',
  },
  {
    name: 'intake',
    model: 'inherits caller',
    rationale:
      'Issue authoring runs in whatever session observed the problem (operator chat, halt monitor, build session) — evidence is freshest there; structured writing needs no dedicated dispatch.',
  },
  {
    name: 'conduct',
    model: 'haiku',
    rationale: 'Artifact checking and status reporting — mechanical.',
  },
  {
    name: 'pr',
    model: 'sonnet',
    rationale: 'Diff analysis and structured PR body — templated output.',
  },
  {
    name: 'tdd-red',
    model: 'sonnet',
    rationale: 'Writing one test at a time — focused, constrained.',
  },
  {
    name: 'tdd-green',
    model: 'sonnet',
    rationale: 'Writing minimal implementation — constrained scope.',
  },
  {
    name: 'cto-security',
    model: 'opus',
    rationale: 'Deep security analysis requires reasoning about attack vectors.',
  },
  {
    name: 'cto-data-integrity',
    model: 'opus',
    rationale: 'Transaction and race condition analysis requires deep reasoning.',
  },
  {
    name: 'cto-dependencies',
    model: 'sonnet',
    rationale: 'Checklist-based package and license scanning.',
  },
  {
    name: 'cto-architecture',
    model: 'opus',
    rationale: 'Cross-module coherence and coupling analysis requires deep reasoning.',
  },
  {
    name: 'cto-duplication',
    model: 'sonnet',
    rationale: 'Pattern matching across modules — structured checklist work.',
  },
  {
    name: 'cto-testing',
    model: 'sonnet',
    rationale: 'Coverage gap analysis and test quality review — structured.',
  },
  {
    name: 'cto-infrastructure',
    model: 'sonnet',
    rationale: 'Infrastructure config review — checklist-based.',
  },
  {
    name: 'cto-observability',
    model: 'sonnet',
    rationale: 'Error handling and logging pattern review — checklist-based.',
  },
  {
    name: 'cto-devex',
    model: 'sonnet',
    rationale: 'Documentation and tooling review — checklist-based.',
  },
  {
    name: 'cto-orchestrator',
    model: 'opus',
    rationale: 'Cross-referencing 9 reports and prioritizing requires deep reasoning.',
  },
];
