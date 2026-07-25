import type { StepName } from '../types/index.js';

export interface SkillInvocationDescriptor {
  readonly skillName: string;
  readonly arguments: readonly string[];
}

export const STEP_SKILL_INVOCATIONS: Readonly<
  Record<StepName, SkillInvocationDescriptor>
> = {
  bootstrap: { skillName: 'bootstrap', arguments: [] },
  memory: { skillName: 'memory', arguments: [] },
  assess: { skillName: 'assess', arguments: [] },
  explore: { skillName: 'explore', arguments: [] },
  prd: { skillName: 'prd', arguments: [] },
  complexity: { skillName: 'conduct', arguments: ['complexity'] },
  stories: { skillName: 'stories', arguments: [] },
  conflict_check: { skillName: 'conflict-check', arguments: [] },
  plan: { skillName: 'plan', arguments: [] },
  coherence_check: { skillName: 'coherence-check', arguments: [] },
  architecture_diagram: { skillName: 'architecture-diagram', arguments: [] },
  architecture_review: { skillName: 'architecture-review', arguments: [] },
  worktree: { skillName: 'conduct', arguments: ['worktree'] },
  acceptance_specs: { skillName: 'writing-system-tests', arguments: [] },
  build: { skillName: 'pipeline', arguments: [] },
  // Display sentinel for the model table; the grader dispatch is driven by
  // the fresh-session assembly logic (see resolveRebaseConflict pattern),
  // not by invoking a literal build-review skill.
  build_review: { skillName: 'build-review', arguments: [] },
  // Engine-native (like complexity/rebase) — the completion predicate reads
  // or computes the wiring-reachability evidence file directly; no skill
  // dispatch. Present only to keep the Record<StepName, ...> exhaustive.
  wiring_check: { skillName: 'conduct', arguments: ['wiring-check'] },
  // Engine-native aggregate verifier gate; never dispatched as a skill.
  test_suite: { skillName: 'conduct', arguments: ['test-suite'] },
  manual_test: { skillName: 'manual-test', arguments: [] },
  prd_audit: { skillName: 'prd-audit', arguments: [] },
  // Runs the architecture-review skill in its as-built compliance-gate mode.
  architecture_review_as_built: {
    skillName: 'architecture-review',
    arguments: ['--as-built'],
  },
  retro: { skillName: 'retro', arguments: [] },
  // Engine-native (like complexity) — never dispatched; present only to keep
  // the Record<StepName, ...> exhaustive.
  rebase: { skillName: 'conduct', arguments: ['rebase'] },
  finish: { skillName: 'finish', arguments: [] },
  // Conditional SHIP sub-routine: plans remediation for a blocking audit.
  remediate: { skillName: 'remediate', arguments: [] },
  // Out-of-band verification step: semantic attribution verification.
  attribution_verify: { skillName: 'attribution-verify', arguments: [] },
};

export function renderSkillInvocation(
  descriptor: SkillInvocationDescriptor,
  providerKey: string,
): string {
  const prefix = providerKey === 'codex' ? '$' : '/';
  return [`${prefix}${descriptor.skillName}`, ...descriptor.arguments].join(' ');
}
