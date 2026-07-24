import type { StepName } from '../types/steps.js';

// ────────────────────────────────────────────────────────────────────────────
// Model-table metadata
//
// Human-readable "Why" text for each engine step, keyed by StepName. This is
// the single source the generated HARNESS.md model-selection table (and the
// completeness test in test/model-table-metadata.test.ts) draw from. It
// consolidates rationale that used to live beside the autonomous model
// defaults, plus the prose "Why" column from HARNESS.md's hand-authored
// model-selection table.
// ────────────────────────────────────────────────────────────────────────────

export const STEP_RATIONALE: Record<StepName, string> = {
  bootstrap: 'Detection and scaffolding — largely mechanical. Authors the project CLAUDE.md every later step depends on.',
  memory: 'Read/write files, update index — mechanical.',
  assess:
    'The assess skill dispatches 9 specialists and drives structure verification (sonnet); the final cross-referencing of all 9 reports is the cto-orchestrator agent on opus. The orchestrator also sets the env var that cascades effort to subagents.',
  explore:
    'Divergent discovery: approach trade-offs + product/technical track classification. At M/L or without a recorded tier, each built-in provider policy selects its own deepest model and HIGH effort for this high-branching, front-of-funnel step; attempt 2 therefore raises reasoning to XHIGH. Later model escalation uses that provider\'s native order but is capped, so this already-deepest default remains at its current model. S tier alone uses LOW effort for a fast scoping pass on small, well-understood work.',
  prd:
    'Front-of-funnel requirements and FR authoring has high downstream cascade cost. Each built-in provider policy selects its own deepest model and HIGH effort at every complexity tier; attempt 2 raises reasoning to XHIGH. Later model escalation uses that provider\'s native order but is a capped no-op for this already-deepest default.',
  complexity:
    'Assigns S/M/L, which gates every downstream model/effort decision — a wrong tier cascades, but the classification itself is low-effort pattern matching.',
  stories: 'Pattern-following from design doc, structured output.',
  conflict_check:
    'Pairwise comparison is manageable at each provider policy\'s standard tier with <=15 stories; Large tier selects that provider\'s deepest model for subtle contradiction detection.',
  plan:
    'Structured task breakdown from stories; Large tier selects each provider policy\'s deepest model for task sequencing and dependency reasoning at scale.',
  coherence_check:
    'Cross-references outcomes/FRs/stories/tasks into a per-row traceability verdict — structured comparison across committed artifacts, comparable in depth to conflict_check. M/L tier only (S is skippable).',
  architecture_diagram: 'Structured output generation from codebase scan — pattern-following.',
  architecture_review:
    'Pre-implementation design feasibility and alignment: Fable provides sufficient reasoning for early-stage architecture reviews.',
  worktree: 'Git operations — mechanical branch/worktree management.',
  acceptance_specs: 'Generating specs from acceptance criteria — templated work.',
  build:
    'Launches the implementation session that authors code through the TDD RED/DOMAIN/GREEN cycle — the actual coding lane, not a thin dispatcher. Each provider policy uses its standard model for reliable code authoring while genuinely mechanical steps use its lightweight model. S tier keeps the fixed three-attempt retry floor, so small features can still recover from a bad first pass.',
  build_review:
    'Fresh-session grader judging a maker\'s diff for test tautology, scope creep, and root-cause fixes vs band-aids — adversarial code review demands the deepest reasoning tier, same class of judgement as prd_audit/code-review.',
  wiring_check:
    'Deterministic reachability probe (git diff + import graph, Layer 1/2) between build_review and manual_test — mechanical evidence gathering, no generative judgement required.',
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
// CLAUDE_MODEL_POLICY.stepModels) or listed as exempt (skill has no 1:1
// engine step, so there is nothing to compare the pin against). Interactive
// pins are Claude-scoped; Codex policy values do not participate. An
// unmapped, non-exempt pinned skill is a hard failure — see
// classifyPinnedSkill in src/tools/generate-model-table.ts (TS-1 negative
// path 2 / TS-4).
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
// numbered engine step), so there is no autonomous Claude policy entry to
// compare the pin against.
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
// CLAUDE_MODEL_POLICY.stepModels) but that HARNESS.md's model-selection table
// still documents on the Claude interactive path: domain-reviewer/evaluator
// (dispatched sub-agents), code-review/debugging/simplify/engineer (skills
// with their own model pin but no engine step), conduct/pr (orchestration
// skills), tdd-red/tdd-green (TDD sub-phases), and the 10 cto-* assess
// specialists.
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
  executionPath: 'Claude interactive';
  claudeModel: string;
  claudeEffort: '';
  codexModel: '';
  codexEffort: '';
  why: string;
}

export const EXTRA_MODEL_TABLE_ROWS: ExtraModelTableRow[] = [
  {
    name: 'verify-claims',
    executionPath: 'Claude interactive',
    claudeModel: 'inherits caller',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why:
      'Cross-cutting correctness protocol applied within the invoking skill\'s context (calibrate claims, gate assumptions) — not a separately dispatched agent, so it runs on the caller\'s model.',
  },
  {
    name: 'domain-reviewer',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet (<50-line diff), opus (≥50-line diff)',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why:
      'Right-sized by diff size: Sonnet for focused small diffs, Opus for large changes needing cross-boundary judgment.',
  },
  {
    name: 'evaluator',
    executionPath: 'Claude interactive',
    claudeModel:
      'sonnet (value objects, pure functions, config, infra) / opus (concurrency, state mutation, security, auth, finance)',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Right-sized by batch content.',
  },
  {
    name: 'code-review',
    executionPath: 'Claude interactive',
    claudeModel: 'opus',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Multi-dimensional analysis (spec, quality, domain).',
  },
  {
    name: 'debugging',
    executionPath: 'Claude interactive',
    claudeModel: 'fable',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Fable guards root-cause analysis; wrong diagnosis produces band-aid fixes.',
  },
  {
    name: 'simplify',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Pattern matching for duplication and complexity — structured checklist work.',
  },
  {
    name: 'engineer',
    executionPath: 'Claude interactive',
    claudeModel: 'fable',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why:
      'Interactive idea→spec control plane routing the real DECIDE skills. Kept on Fable for operator-driven interactive quality — this is a capability / operator-preference call, NOT a cost saving: Fable is the premium tier ($10/$50 per 1M, ~2x Opus).',
  },
  {
    name: 'intake',
    executionPath: 'Claude interactive',
    claudeModel: 'inherits caller',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why:
      'Issue authoring runs in whatever session observed the problem (operator chat, halt monitor, build session) — evidence is freshest there; structured writing needs no dedicated dispatch.',
  },
  {
    name: 'conduct',
    executionPath: 'Claude interactive',
    claudeModel: 'haiku',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Artifact checking and status reporting — mechanical.',
  },
  {
    name: 'pr',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Diff analysis and structured PR body — templated output.',
  },
  {
    name: 'tdd-red',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Writing one test at a time — focused, constrained.',
  },
  {
    name: 'tdd-green',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Writing minimal implementation — constrained scope.',
  },
  {
    name: 'cto-security',
    executionPath: 'Claude interactive',
    claudeModel: 'opus',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Deep security analysis requires reasoning about attack vectors.',
  },
  {
    name: 'cto-data-integrity',
    executionPath: 'Claude interactive',
    claudeModel: 'opus',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Transaction and race condition analysis requires deep reasoning.',
  },
  {
    name: 'cto-dependencies',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Checklist-based package and license scanning.',
  },
  {
    name: 'cto-architecture',
    executionPath: 'Claude interactive',
    claudeModel: 'opus',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Cross-module coherence and coupling analysis requires deep reasoning.',
  },
  {
    name: 'cto-duplication',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Pattern matching across modules — structured checklist work.',
  },
  {
    name: 'cto-testing',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Coverage gap analysis and test quality review — structured.',
  },
  {
    name: 'cto-infrastructure',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Infrastructure config review — checklist-based.',
  },
  {
    name: 'cto-observability',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Error handling and logging pattern review — checklist-based.',
  },
  {
    name: 'cto-devex',
    executionPath: 'Claude interactive',
    claudeModel: 'sonnet',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Documentation and tooling review — checklist-based.',
  },
  {
    name: 'cto-orchestrator',
    executionPath: 'Claude interactive',
    claudeModel: 'opus',
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: 'Cross-referencing 9 reports and prioritizing requires deep reasoning.',
  },
];
