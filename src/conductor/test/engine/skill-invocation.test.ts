// Covers: task:2, task:11
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STEP_SKILL_INVOCATIONS,
  renderAuxiliarySkillInvocation,
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
  plan_review: { kind: 'skill', skillName: 'plan-review', arguments: [] },
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
  test_suite: { kind: 'engine-native' },
  manual_test: { kind: 'skill', skillName: 'manual-test', arguments: [] },
  prd_audit: { kind: 'skill', skillName: 'prd-audit', arguments: [] },
  architecture_review_as_built: {
    kind: 'skill',
    skillName: 'architecture-review',
    arguments: ['--as-built'],
  },
  rebase: { kind: 'skill', skillName: 'rebase', arguments: [] },
  finish: { kind: 'skill', skillName: 'finish', arguments: [] },
  remediate: { kind: 'skill', skillName: 'remediate', arguments: [] },
  attribution_verify: { kind: 'engine-native' },
} as const satisfies Partial<Record<StepName, SkillInvocationDescriptor>>;

describe('provider-native skill invocation', () => {
  it.each([
    ['claude', '/ac-explore'],
    ['codex', '$ac-explore'],
    ['pi', '/skill:ac-explore'],
  ])('renders a resolved frontmatter name for %s', (providerKey, expected) => {
    expect(renderSkillInvocation(STEP_SKILL_INVOCATIONS.explore!, providerKey, 'ac-explore')).toBe(expected);
  });

  it('defines the exhaustive semantic invocation map', () => {
    expect(STEP_SKILL_INVOCATIONS).toEqual(EXPECTED_INVOCATIONS);
  });

  it('publishes the distinct re-raise contract through the shared remediate skill', async () => {
    const skill = await readFile(resolve(process.cwd(), '../../skills/remediate/SKILL.md'), 'utf8');

    expect({
      claude: renderSkillInvocation(STEP_SKILL_INVOCATIONS.remediate!, 'claude'),
      codex: renderSkillInvocation(STEP_SKILL_INVOCATIONS.remediate!, 'codex'),
      contract: [
        'distinctFrom',
        'caseId',
        'reason must be non-empty',
        'three applied attempts',
        'entry not naming a resolved action owner of a row source is ignored',
      ].every((text) => skill.includes(text)),
    }).toEqual({ claude: '/remediate', codex: '$remediate', contract: true });
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
      providerKey: 'pi',
      descriptor: { kind: 'skill', skillName: 'pipeline', arguments: [] },
      expected: '/skill:pipeline',
    },
    {
      providerKey: 'pi',
      descriptor: {
        kind: 'skill',
        skillName: 'architecture-review',
        arguments: ['--as-built'],
      },
      expected: '/skill:architecture-review --as-built',
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
    ['build-review-security', '/skill:build-review-security'],
    ['rebase-regrade', '/skill:rebase-regrade'],
  ])('renders Pi auxiliary skill %s', (skillName, expected) => {
    expect(renderAuxiliarySkillInvocation(skillName, 'pi')).toBe(expected);
  });

  it('preserves Claude and Codex prefixes for every skill step', () => {
    for (const descriptor of Object.values(STEP_SKILL_INVOCATIONS)) {
      if (descriptor?.kind !== 'skill') continue;

      expect(renderSkillInvocation(descriptor, 'claude').startsWith(
        `/${descriptor.skillName}`,
      )).toBe(true);
      expect(renderSkillInvocation(descriptor, 'codex').startsWith(
        `$${descriptor.skillName}`,
      )).toBe(true);
    }
  });

  it.each([
    'build_review',
    'test_suite',
    'attribution_verify',
  ] as const)(
    'rejects rendering the %s engine-native sentinel as a skill',
    (stepName) => {
      expect(() =>
        renderSkillInvocation(STEP_SKILL_INVOCATIONS[stepName]!, 'claude'),
      ).toThrow(/engine-native/i);
    },
  );

  it('rejects Pi rendering of an engine-native step', () => {
    expect(() =>
      renderSkillInvocation(STEP_SKILL_INVOCATIONS.attribution_verify!, 'pi'),
    ).toThrow('Cannot render an engine-native step as a skill invocation');
  });

  it('uses the slash prefix for an unknown provider', () => {
    expect(renderSkillInvocation(STEP_SKILL_INVOCATIONS.build!, 'my-plugin')).toBe(
      '/pipeline',
    );
  });
});
