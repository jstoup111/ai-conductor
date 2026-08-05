import type { StepName } from '../types/steps.js';

// These steps retain exhaustive provider-policy placeholders for StepName
// type safety, but execute entirely in-process and never dispatch a model.
export const MODEL_FREE_ENGINE_STEPS = [
  'wiring_check',
  'test_suite',
] as const satisfies readonly StepName[];

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
    'The assess skill dispatches 9 specialists and drives structure verification with Claude Sonnet; the final cross-referencing of all 9 reports is the cto-orchestrator agent on Claude Opus. The orchestrator also sets the env var that cascades effort to subagents.',
  explore:
    'Divergent discovery: approach trade-offs + product/technical track classification. At M/L or without a recorded tier, each built-in provider policy selects a high-capability reasoning model and HIGH effort for this high-branching, front-of-funnel step; attempt 2 therefore raises reasoning to XHIGH. S tier alone uses LOW effort for a fast scoping pass on small, well-understood work.',
  prd:
    'Front-of-funnel requirements and FR authoring has high downstream cascade cost. Each built-in provider policy selects a high-capability model and HIGH effort at every complexity tier; attempt 2 raises reasoning to XHIGH.',
  complexity:
    'Assigns S/M/L, which gates every downstream model/effort decision — a wrong tier cascades, but the classification itself is low-effort pattern matching.',
  stories: 'Pattern-following from design doc, structured output.',
  conflict_check:
    'Pairwise story comparison benefits from a stronger reasoning model at every tier; Large tier uses each provider policy\'s high-capability model for subtle contradiction detection at scale.',
  plan:
    'Task breakdown and dependency sequencing use a stronger Claude reasoning model at S/M; Large tier uses each provider policy\'s high-capability model and XHIGH effort for planning at scale.',
  coherence_check:
    'Cross-references outcomes/FRs/stories/tasks into a per-row traceability verdict — structured comparison across committed artifacts, comparable in depth to conflict_check. M/L tier only (S is skippable).',
  architecture_diagram: 'Structured output generation from codebase scan — pattern-following.',
  architecture_review:
    'Pre-implementation design feasibility and alignment requires a high-capability model from the selected provider policy.',
  worktree: 'Git operations — mechanical branch/worktree management.',
  acceptance_specs: 'Translating acceptance criteria into executable boundary-level specs requires strong reasoning to preserve behavioral intent and negative paths, using MEDIUM effort for S/M and HIGH effort for Large work.',
  build:
    'Launches the implementation session that authors code through the TDD RED/DOMAIN/GREEN cycle — the actual coding lane, not a thin dispatcher. Each provider policy uses its standard model with MEDIUM effort for reliable code authoring, rising to HIGH effort for Large work. S tier keeps the fixed three-attempt retry floor, so small features can still recover from a bad first pass.',
  build_review:
    'Fresh-session grader judging a maker\'s diff for test tautology, scope creep, and root-cause fixes vs band-aids — adversarial code review demands a high-capability model, same class of judgement as prd_audit/code-review.',
  wiring_check:
    'Deterministic reachability probe (git diff + import graph, Layer 1/2) that joins test_suite before build_review — mechanical evidence gathering, no generative judgement required.',
  test_suite:
    'Mechanical aggregate test gate that obtains a current full-suite proof from the shared verifier before SHIP; no generative judgement required.',
  manual_test: 'Structured validation against stories — pattern-following.',
  prd_audit: 'Cross-references PRD intent vs shipped implementation across two domains (spec + code) — deep reasoning, FR-by-FR.',
  architecture_review_as_built:
    'The SHIP --as-built compliance review compares shipped code with approved architecture and wiring contracts; missed drift can invalidate the release, so it uses a high-capability model and HIGH effort.',
  retro: 'Structured analysis from concrete data; Part C (context efficiency) is checklist-based.',
  rebase:
    'Semantic conflict resolution reasons over both sides of a hunk; a wrong merge can silently revert completed work, so rebase uses a capable provider-native model with HIGH effort.',
  finish: 'Coordinates final test, status, and coverage evidence with MEDIUM effort so completion claims remain grounded.',
  remediate:
    'A high-capability model from the selected provider policy guards failure disposition; a false HALT wastes context and wrong routing misroutes rework. MEDIUM effort balances concrete gap routing with the strength of the selected model.',
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
// still documents on the supported-host interactive path: domain-reviewer/evaluator
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
  executionPath: 'supported-host interactive';
  claudeModel: string;
  claudeEffort: '';
  codexModel: string;
  codexEffort: string;
  why: string;
}

const INTERACTIVE_EXECUTION_PATH = 'supported-host interactive' as const;
const CODEX_MODEL_INHERITANCE =
  'inherits model from the Codex session or spawned-agent configuration';
const CODEX_EFFORT_INHERITANCE =
  'inherits effort from the Codex session or spawned-agent configuration';

const EXTRA_MODEL_TABLE_ROW_DEFAULTS = {
  executionPath: INTERACTIVE_EXECUTION_PATH,
  codexModel: CODEX_MODEL_INHERITANCE,
  codexEffort: CODEX_EFFORT_INHERITANCE,
} as const;

const EXTRA_MODEL_TABLE_ROW_INPUTS: Array<
  Omit<ExtraModelTableRow, keyof typeof EXTRA_MODEL_TABLE_ROW_DEFAULTS>
> = [
  {
    name: 'verify-claims',
    claudeModel: 'inherits caller',
    claudeEffort: '',
    why:
      'Cross-cutting correctness protocol applied within the invoking skill\'s context (calibrate claims, gate assumptions) — not a separately dispatched agent, so it runs on the caller\'s model.',
  },
  {
    name: 'domain-reviewer',
    claudeModel: 'sonnet (<50-line diff), opus (≥50-line diff)',
    claudeEffort: '',
    why:
      'Right-sized by diff size: Sonnet for focused small diffs, Opus for large changes needing cross-boundary judgment.',
  },
  {
    name: 'evaluator',
    claudeModel:
      'sonnet (value objects, pure functions, config, infra) / opus (concurrency, state mutation, security, auth, finance)',
    claudeEffort: '',
    why: 'Right-sized by batch content.',
  },
  {
    name: 'code-review',
    claudeModel: 'opus',
    claudeEffort: '',
    why: 'Multi-dimensional analysis (spec, quality, domain).',
  },
  {
    name: 'debugging',
    claudeModel: 'opus',
    claudeEffort: '',
    why: 'Fable guards root-cause analysis; wrong diagnosis produces band-aid fixes.',
  },
  {
    name: 'simplify',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: 'Pattern matching for duplication and complexity — structured checklist work.',
  },
  {
    name: 'engineer',
    claudeModel: 'opus',
    claudeEffort: '',
    why:
      'Interactive idea→spec control plane routing the real DECIDE skills. Kept on Fable for operator-driven interactive quality — this is a capability / operator-preference call, NOT a cost saving: Fable is the premium tier ($10/$50 per 1M, ~2x Opus).',
  },
  {
    name: 'intake',
    claudeModel: 'inherits caller',
    claudeEffort: '',
    why:
      'Issue authoring runs in whatever session observed the problem (operator chat, halt monitor, build session) — evidence is freshest there; structured writing needs no dedicated dispatch.',
  },
  {
    name: 'conduct',
    claudeModel: 'haiku',
    claudeEffort: '',
    why: 'Artifact checking and status reporting — mechanical.',
  },
  {
    name: 'daemon-triage',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: "Operator-invoked, read-only triage. Routing determinism lives in the skill's signal table, not the model; the model gathers evidence and matches rows.",
  },
  {
    name: 'pr',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: 'Diff analysis and structured PR body — templated output.',
  },
  {
    name: 'tdd-red',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: 'Writing one test at a time — focused, constrained.',
  },
  {
    name: 'tdd-green',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: 'Writing minimal implementation — constrained scope.',
  },
  {
    name: 'cto-security',
    claudeModel: 'opus',
    claudeEffort: '',
    why: 'Deep security analysis requires reasoning about attack vectors.',
  },
  {
    name: 'cto-data-integrity',
    claudeModel: 'opus',
    claudeEffort: '',
    why: 'Transaction and race condition analysis requires deep reasoning.',
  },
  {
    name: 'cto-dependencies',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: 'Checklist-based package and license scanning.',
  },
  {
    name: 'cto-architecture',
    claudeModel: 'opus',
    claudeEffort: '',
    why: 'Cross-module coherence and coupling analysis requires deep reasoning.',
  },
  {
    name: 'cto-duplication',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: 'Pattern matching across modules — structured checklist work.',
  },
  {
    name: 'cto-testing',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: 'Coverage gap analysis and test quality review — structured.',
  },
  {
    name: 'cto-infrastructure',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: 'Infrastructure config review — checklist-based.',
  },
  {
    name: 'cto-observability',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: 'Error handling and logging pattern review — checklist-based.',
  },
  {
    name: 'cto-devex',
    claudeModel: 'sonnet',
    claudeEffort: '',
    why: 'Documentation and tooling review — checklist-based.',
  },
  {
    name: 'cto-orchestrator',
    claudeModel: 'opus',
    claudeEffort: '',
    why: 'Cross-referencing 9 reports and prioritizing requires deep reasoning.',
  },
];

export const EXTRA_MODEL_TABLE_ROWS: ExtraModelTableRow[] =
  EXTRA_MODEL_TABLE_ROW_INPUTS.map((row) => ({
    ...EXTRA_MODEL_TABLE_ROW_DEFAULTS,
    ...row,
  }));
