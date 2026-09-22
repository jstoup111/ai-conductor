// Covers: task:1
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { HarnessConfig } from '../../src/types/config.js';
import { buildStepRegistry } from '../../src/engine/steps.js';
import { selectFinishPrerequisiteSteps } from '../../src/engine/finish-custom-step-prerequisites.js';

describe('selectFinishPrerequisiteSteps', () => {
  it('selects only marker-backed gating custom steps before finish in registry order', async () => {
    const config: HarnessConfig = {
      steps: {
        'first-gate': {
          after: 'rebase', skill: 'first/SKILL.md', enforcement: 'gating', completion_artifact: '.pipeline/first',
        },
        'advisory-gate': {
          after: 'rebase', skill: 'advisory/SKILL.md', enforcement: 'advisory', completion_artifact: '.pipeline/advisory',
        },
        'markerless-gate': {
          after: 'rebase', skill: 'markerless/SKILL.md', enforcement: 'gating',
        },
        'second-gate': {
          after: 'first-gate', skill: 'second/SKILL.md', enforcement: 'gating', completion_artifact: '.pipeline/second',
        },
        'post-finish-gate': {
          after: 'finish', skill: 'post/SKILL.md', enforcement: 'gating', completion_artifact: '.pipeline/post',
        },
        finish: { enforcement: 'gating', completion_artifact: '.pipeline/not-a-custom-step' },
      },
    };
    const source = await readFile(
      new URL('../../src/engine/finish-custom-step-prerequisites.ts', import.meta.url),
      'utf8',
    );

    expect([
      selectFinishPrerequisiteSteps({}, buildStepRegistry({})),
      selectFinishPrerequisiteSteps(config, buildStepRegistry(config)),
      /release-disposition|maintain-documentation/.test(source),
      /as StepName/.test(source),
    ]).toEqual([[], ['first-gate', 'second-gate'], false, false]);
  });
});
