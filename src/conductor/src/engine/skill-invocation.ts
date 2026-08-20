import type { StepName } from '../types/index.js';

export type SkillInvocationDescriptor =
  | {
      readonly kind: 'skill';
      readonly skillName: string;
      readonly arguments: readonly string[];
    }
  | { readonly kind: 'engine-native' };

export const STEP_SKILL_INVOCATIONS: Readonly<
  Partial<Record<StepName, SkillInvocationDescriptor>>
> = {
  bootstrap: { kind: 'skill', skillName: 'bootstrap', arguments: [] },
  memory: { kind: 'skill', skillName: 'memory', arguments: [] },
  assess: { kind: 'skill', skillName: 'assess', arguments: [] },
  explore: { kind: 'skill', skillName: 'explore', arguments: [] },
  prd: { kind: 'skill', skillName: 'prd', arguments: [] },
  complexity: { kind: 'skill', skillName: 'conduct', arguments: ['complexity'] },
  stories: { kind: 'skill', skillName: 'stories', arguments: [] },
  conflict_check: { kind: 'skill', skillName: 'conflict-check', arguments: [] },
  plan: { kind: 'skill', skillName: 'plan', arguments: [] },
  coherence_check: { kind: 'skill', skillName: 'coherence-check', arguments: [] },
  architecture_diagram: { kind: 'skill', skillName: 'architecture-diagram', arguments: [] },
  architecture_review: { kind: 'skill', skillName: 'architecture-review', arguments: [] },
  worktree: { kind: 'skill', skillName: 'conduct', arguments: ['worktree'] },
  acceptance_specs: { kind: 'skill', skillName: 'writing-system-tests', arguments: [] },
  build: { kind: 'skill', skillName: 'pipeline', arguments: [] },
  // Grader dispatch is assembled by engine logic, not by invoking a skill.
  build_review: { kind: 'engine-native' },
  // The engine runs the aggregate verifier directly; no skill dispatch.
  test_suite: { kind: 'engine-native' },
  manual_test: { kind: 'skill', skillName: 'manual-test', arguments: [] },
  prd_audit: { kind: 'skill', skillName: 'prd-audit', arguments: [] },
  // Runs the architecture-review skill in its as-built compliance-gate mode.
  architecture_review_as_built: {
    kind: 'skill',
    skillName: 'architecture-review',
    arguments: ['--as-built'],
  },
  retro: { kind: 'skill', skillName: 'retro', arguments: [] },
  rebase: { kind: 'skill', skillName: 'rebase', arguments: [] },
  finish: { kind: 'skill', skillName: 'finish', arguments: [] },
  // Conditional SHIP sub-routine: plans remediation for a blocking audit.
  remediate: { kind: 'skill', skillName: 'remediate', arguments: [] },
  // The engine performs semantic attribution verification directly.
  attribution_verify: { kind: 'engine-native' },
};

export function renderSkillInvocation(
  descriptor: SkillInvocationDescriptor,
  providerKey: string,
): string {
  if (descriptor.kind === 'engine-native') {
    throw new Error('Cannot render an engine-native step as a skill invocation');
  }

  const prefix = providerKey === 'codex' ? '$' : '/';
  return [`${prefix}${descriptor.skillName}`, ...descriptor.arguments].join(' ');
}

/** Render a registry-owned auxiliary skill without pretending it is a StepName. */
export function renderAuxiliarySkillInvocation(skillName: string, providerKey: string): string {
  return renderSkillInvocation({ kind: 'skill', skillName, arguments: [] }, providerKey);
}
