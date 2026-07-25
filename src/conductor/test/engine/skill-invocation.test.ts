import { describe, expect, it } from 'vitest';
import {
  STEP_SKILL_INVOCATIONS,
  renderSkillInvocation,
  type SkillInvocationDescriptor,
} from '../../src/engine/skill-invocation.js';
import type { StepName } from '../../src/types/index.js';

const EXPECTED_INVOCATIONS = {
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
  build_review: { skillName: 'build-review', arguments: [] },
  wiring_check: { skillName: 'conduct', arguments: ['wiring-check'] },
  test_suite: { skillName: 'conduct', arguments: ['test-suite'] },
  manual_test: { skillName: 'manual-test', arguments: [] },
  prd_audit: { skillName: 'prd-audit', arguments: [] },
  architecture_review_as_built: {
    skillName: 'architecture-review',
    arguments: ['--as-built'],
  },
  retro: { skillName: 'retro', arguments: [] },
  rebase: { skillName: 'conduct', arguments: ['rebase'] },
  finish: { skillName: 'finish', arguments: [] },
  remediate: { skillName: 'remediate', arguments: [] },
  attribution_verify: { skillName: 'attribution-verify', arguments: [] },
} as const satisfies Record<StepName, SkillInvocationDescriptor>;

describe('provider-native skill invocation', () => {
  it('defines the exhaustive semantic invocation map', () => {
    expect(STEP_SKILL_INVOCATIONS).toEqual(EXPECTED_INVOCATIONS);
  });

  it.each([
    {
      providerKey: 'claude',
      descriptor: {
        skillName: 'architecture-review',
        arguments: ['--as-built'],
      },
      expected: '/architecture-review --as-built',
    },
    {
      providerKey: 'codex',
      descriptor: { skillName: 'pipeline', arguments: [] },
      expected: '$pipeline',
    },
    {
      providerKey: 'custom-provider',
      descriptor: {
        skillName: 'explore',
        arguments: ['complexity', '--deep'],
      },
      expected: '/explore complexity --deep',
    },
  ] satisfies ReadonlyArray<{
    providerKey: string;
    descriptor: SkillInvocationDescriptor;
    expected: string;
  }>)('renders $providerKey syntax and preserves arguments', ({
    providerKey,
    descriptor,
    expected,
  }) => {
    expect(renderSkillInvocation(descriptor, providerKey)).toBe(expected);
  });
});
