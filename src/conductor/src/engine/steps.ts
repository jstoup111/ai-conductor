import type { StepDefinition, StepName, ComplexityTier, BootstrapMode } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';

export const ALL_STEPS: StepDefinition[] = [
  {
    name: 'worktree',
    label: 'Worktree',
    phase: 'SETUP',
    enforcement: 'structural',
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'worktree',
  },
  {
    name: 'memory',
    label: 'Memory',
    phase: 'UNDERSTAND',
    enforcement: 'advisory',
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'memory',
  },
  {
    name: 'brainstorm',
    label: 'Brainstorm',
    phase: 'DECIDE',
    enforcement: 'advisory',
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'brainstorm',
  },
  {
    name: 'complexity',
    label: 'Complexity',
    phase: 'DECIDE',
    enforcement: 'advisory',
    prerequisites: ['brainstorm'],
    skippableForTiers: [],
    isCheckpoint: false,
  },
  {
    name: 'stories',
    label: 'Stories',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: ['brainstorm'],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'stories',
  },
  {
    name: 'conflict_check',
    label: 'Conflict Check',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: ['stories'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'conflict-check',
  },
  {
    name: 'architecture_diagram',
    label: 'Architecture Diagram',
    phase: 'DECIDE',
    enforcement: 'advisory',
    prerequisites: ['conflict_check'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'architecture-diagram',
  },
  {
    name: 'architecture_review',
    label: 'Architecture Review',
    phase: 'DECIDE',
    enforcement: 'advisory',
    prerequisites: ['architecture_diagram'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'architecture-review',
  },
  {
    // Architecture (system-level HOW) now precedes the plan (task-level HOW),
    // so the technical implementation plan is grounded in the agreed design.
    name: 'plan',
    label: 'Plan',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: ['architecture_review'],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'plan',
  },
  {
    name: 'acceptance_specs',
    label: 'Acceptance Specs',
    phase: 'BUILD',
    enforcement: 'gating',
    prerequisites: ['plan'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'writing-system-tests',
  },
  {
    name: 'build',
    label: 'Build',
    phase: 'BUILD',
    enforcement: 'structural',
    prerequisites: ['plan'],
    skippableForTiers: [],
    isCheckpoint: true,
    skillName: 'pipeline',
  },
  {
    name: 'manual_test',
    label: 'Manual Test',
    phase: 'SHIP',
    enforcement: 'advisory',
    prerequisites: ['build'],
    skippableForTiers: [],
    isCheckpoint: true,
    skillName: 'manual-test',
  },
  {
    name: 'retro',
    label: 'Retro',
    phase: 'SHIP',
    enforcement: 'advisory',
    prerequisites: ['manual_test'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'retro',
  },
  {
    name: 'finish',
    label: 'Finish',
    phase: 'SHIP',
    enforcement: 'gating',
    prerequisites: ['retro'],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'finish',
  },
];

const stepMap = new Map(ALL_STEPS.map((s) => [s.name, s]));
const stepIndexMap = new Map(ALL_STEPS.map((s, i) => [s.name, i]));

export function getStepDefinition(name: StepName): StepDefinition {
  const def = stepMap.get(name);
  if (!def) throw new Error(`Unknown step: ${name}`);
  return def;
}

export function getStepIndex(name: StepName): number {
  const idx = stepIndexMap.get(name);
  if (idx === undefined) throw new Error(`Unknown step: ${name}`);
  return idx;
}

export function getStepByIndex(index: number): StepDefinition {
  if (index < 0 || index >= ALL_STEPS.length) {
    throw new Error(`Step index out of range: ${index}`);
  }
  return ALL_STEPS[index];
}

export function shouldSkipForTier(step: StepName, tier: ComplexityTier): boolean {
  const def = getStepDefinition(step);
  return def.skippableForTiers.includes(tier);
}

/**
 * Steps that have nothing to do when the project has no codebase yet
 * (bootstrap mode = 'new' — bootstrap is the one scaffolding it). For these
 * the conductor short-circuits with a `mode_skip` event rather than
 * dispatching the skill and letting the completion gate fail.
 *
 * Currently just `assess` — the nine-specialist review has no material in
 * a project that was an empty directory a minute ago. Add to this list
 * sparingly; most steps are still meaningful on a freshly-scaffolded
 * codebase.
 */
const STEPS_SKIPPED_WHEN_NEW: ReadonlySet<StepName> = new Set<StepName>([
  'assess',
]);

export function shouldSkipForBootstrapMode(
  step: StepName,
  mode: BootstrapMode | undefined,
): boolean {
  if (mode !== 'new') return false;
  return STEPS_SKIPPED_WHEN_NEW.has(step);
}

export function getSkippableSteps(tier: ComplexityTier): StepName[] {
  return ALL_STEPS
    .filter((s) => s.skippableForTiers.includes(tier))
    .map((s) => s.name);
}

export function isCheckpointStep(step: StepName): boolean {
  return getStepDefinition(step).isCheckpoint;
}

export function getPrerequisites(step: StepName): StepName[] {
  return getStepDefinition(step).prerequisites;
}

export function buildStepRegistry(config: HarnessConfig): StepDefinition[] {
  const result = [...ALL_STEPS];

  // Custom steps are entries under config.steps whose name isn't in ALL_STEPS.
  // Each has `after` (insertion target — either a built-in step OR another
  // custom step earlier in the chain) and `skill` (SKILL.md path). Entries
  // that match built-in step names are treated as per-step overrides, not
  // additions, and are ignored here.
  //
  // Ordering policy (Option B in the design discussion): steps are inserted
  // in the order they appear in the config file. When two customs share the
  // same `after`, the one that appears first in the file runs first (since
  // we splice each immediately after its target, the latter gets pushed to
  // index target+1 and the earlier slides to target+2 — so we walk in
  // reverse when siblings share a target, or more simply: we insert each
  // sibling after the previous sibling so file order == execution order).
  const builtInNames = new Set(result.map((s) => s.name as string));
  type Addition = {
    name: string;
    after: string;
    skill: string;
    enforcement: import('../types/index.js').EnforcementLevel;
  };
  const additions: Addition[] = [];
  for (const [name, cfg] of Object.entries(config.steps ?? {})) {
    if (builtInNames.has(name)) continue;
    if (!cfg || typeof cfg !== 'object') continue;
    const after = (cfg as { after?: string }).after;
    const skill = (cfg as { skill?: string }).skill;
    if (!after || !skill) continue;
    additions.push({
      name,
      after,
      skill,
      enforcement:
        (cfg as { enforcement?: import('../types/index.js').EnforcementLevel }).enforcement ??
        'advisory',
    });
  }

  // Resolve insertions iteratively. Each pass inserts every custom whose
  // `after` target is already present in `result`, then repeats. Within a
  // pass, customs are processed in config-file order; for same-target
  // siblings we track the last inserted index so each subsequent sibling
  // lands AFTER the previous one (preserving file order for execution).
  //
  // Customs whose `after` target never resolves (typo, broken chain) are
  // skipped here — the validator catches that separately and surfaces the
  // error.
  const pending = [...additions];
  let progress = true;
  while (pending.length > 0 && progress) {
    progress = false;
    const stillPending: Addition[] = [];
    // Track, for each `after` target processed this pass, the index at which
    // the LAST sibling was inserted. The next sibling goes one slot later.
    const lastInsertByTarget = new Map<string, number>();
    for (const custom of pending) {
      const existingIdx = result.findIndex((s) => s.name === custom.after);
      if (existingIdx === -1) {
        stillPending.push(custom);
        continue;
      }
      const siblingAnchor = lastInsertByTarget.get(custom.after);
      const insertAt = (siblingAnchor !== undefined ? siblingAnchor : existingIdx) + 1;
      const targetStep = result[existingIdx];
      const newStep: StepDefinition = {
        name: custom.name as StepName,
        label: custom.name,
        phase: targetStep.phase,
        enforcement: custom.enforcement,
        prerequisites: [custom.after as StepName],
        skippableForTiers: [],
        isCheckpoint: false,
        skillName: custom.skill,
      };
      result.splice(insertAt, 0, newStep);
      lastInsertByTarget.set(custom.after, insertAt);
      progress = true;
    }
    pending.length = 0;
    pending.push(...stillPending);
  }

  return result;
}
