import type { StepDefinition, StepName, ComplexityTier } from '../types/index.js';
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
    name: 'plan',
    label: 'Plan',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: ['conflict_check'],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: 'plan',
  },
  {
    name: 'architecture_diagram',
    label: 'Architecture Diagram',
    phase: 'DECIDE',
    enforcement: 'advisory',
    prerequisites: ['plan'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'architecture-diagram',
  },
  {
    name: 'architecture_review',
    label: 'Architecture Review',
    phase: 'DECIDE',
    enforcement: 'advisory',
    prerequisites: ['plan'],
    skippableForTiers: ['S'],
    isCheckpoint: false,
    skillName: 'architecture-review',
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
  const additions = config.steps?.add ?? [];

  // Group insertions by their `after` target, preserving config order
  const insertionsByTarget = new Map<string, typeof additions>();
  for (const custom of additions) {
    const list = insertionsByTarget.get(custom.after) ?? [];
    list.push(custom);
    insertionsByTarget.set(custom.after, list);
  }

  // Process each target: find position in current result, insert all steps after it
  // Work backwards through the result to avoid index shifting issues
  for (const [target, customs] of insertionsByTarget) {
    const targetIdx = result.findIndex((s) => s.name === target);
    if (targetIdx === -1) continue; // validation catches this separately

    const targetStep = result[targetIdx];
    const newSteps: StepDefinition[] = customs.map((c) => ({
      name: c.name as StepName,
      label: c.name,
      phase: targetStep.phase,
      enforcement: c.enforcement,
      prerequisites: [target as StepName],
      skippableForTiers: [],
      isCheckpoint: false,
      skillName: c.skill,
    }));

    result.splice(targetIdx + 1, 0, ...newSteps);
  }

  return result;
}
