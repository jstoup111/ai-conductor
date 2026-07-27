import { describe, expect, it } from 'vitest';
import {
  STEP_SKILL_INVOCATIONS,
  renderSkillInvocation,
  type SkillInvocationDescriptor,
} from '../../src/engine/skill-invocation.js';
import type { StepName } from '../../src/types/index.js';

const EXPECTED_INVOCATIONS = {
  bootstrap: { kind: 'skill', skillName: 'bootstrap', arguments: [] },
  memory: { kind: 'skill', skillName: 'memory', arguments: [] },
  assess: { kind: 'skill', skillName: 'assess', arguments: [] },
  explore: { kind: 'skill', skillName: 'explore', arguments: [] },
  prd: { kind: 'skill', skillName: 'prd', arguments: [] },
  complexity: {
    kind: 'skill',
    skillName: 'conduct',
    arguments: ['complexity'],
  },
  stories: { kind: 'skill', skillName: 'stories', arguments: [] },
  conflict_check: {
    kind: 'skill',
    skillName: 'conflict-check',
    arguments: [],
  },
  plan: { kind: 'skill', skillName: 'plan', arguments: [] },
  coherence_check: {
    kind: 'skill',
    skillName: 'coherence-check',
    arguments: [],
  },
  architecture_diagram: {
    kind: 'skill',
    skillName: 'architecture-diagram',
    arguments: [],
  },
  architecture_review: {
    kind: 'skill',
    skillName: 'architecture-review',
    arguments: [],
  },
  worktree: { kind: 'skill', skillName: 'conduct', arguments: ['worktree'] },
  acceptance_specs: {
    kind: 'skill',
    skillName: 'writing-system-tests',
    arguments: [],
  },
  build: { kind: 'skill', skillName: 'pipeline', arguments: [] },
  build_review: { kind: 'engine-native' },
  wiring_check: { kind: 'engine-native' },
  test_suite: { kind: 'engine-native' },
  manual_test: { kind: 'skill', skillName: 'manual-test', arguments: [] },
  prd_audit: { kind: 'skill', skillName: 'prd-audit', arguments: [] },
  architecture_review_as_built: {
    kind: 'skill',
    skillName: 'architecture-review',
    arguments: ['--as-built'],
  },
  retro: { kind: 'skill', skillName: 'retro', arguments: [] },
  rebase: { kind: 'skill', skillName: 'rebase', arguments: [] },
  finish: { kind: 'skill', skillName: 'finish', arguments: [] },
  remediate: { kind: 'skill', skillName: 'remediate', arguments: [] },
  attribution_verify: { kind: 'engine-native' },
} as const satisfies Record<StepName, SkillInvocationDescriptor>;

describe('provider-native skill invocation', () => {
  it('defines the exhaustive semantic invocation map', () => {
    expect(STEP_SKILL_INVOCATIONS).toEqual(EXPECTED_INVOCATIONS);
  });

  it.each([
    {
      providerKey: 'claude',
      descriptor: {
        kind: 'skill',
        skillName: 'architecture-review',
        arguments: ['--as-built'],
      },
      expected: '/architecture-review --as-built',
    },
    {
      providerKey: 'codex',
      descriptor: { kind: 'skill', skillName: 'pipeline', arguments: [] },
      expected: '$pipeline',
    },
    {
      providerKey: 'custom-provider',
      descriptor: {
        kind: 'skill',
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

  it.each([
    'build_review',
    'wiring_check',
    'test_suite',
    'attribution_verify',
  ] as const)(
    'rejects rendering the %s engine-native sentinel as a skill',
    (stepName) => {
      expect(() =>
        renderSkillInvocation(STEP_SKILL_INVOCATIONS[stepName], 'claude'),
      ).toThrow(/engine-native/i);
    },
  );
});
