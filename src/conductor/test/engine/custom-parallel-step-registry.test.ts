// Covers: task:10
import { describe, expect, it } from 'vitest';

import { buildStepRegistry } from '../../src/engine/steps.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepName } from '../../src/types/index.js';

describe('custom parallel step registry', () => {
  it('registers a custom parallel-only group after its target without a top-level skill', () => {
    const config: HarnessConfig = {
      steps: {
        fanout: {
          after: 'build',
          when: 'tier == L',
          parallel: [
            { name: 'review', skill: 'skills/review/SKILL.md' },
            { name: 'security', skill: 'skills/security/SKILL.md' },
          ],
        },
      },
    };

    const registry = buildStepRegistry(config);
    const buildIndex = registry.findIndex((step) => step.name === 'build');
    const fanout = registry[buildIndex + 1];

    expect(fanout).toMatchObject({
      name: 'fanout',
      phase: 'BUILD',
      prerequisites: ['build'],
    });
    expect(fanout?.skillName).toBeUndefined();
  });

  it('continues to skip a custom step with neither a skill nor a parallel group', () => {
    const registry = buildStepRegistry({
      steps: { inert: { after: 'build' } },
    });

    expect(registry.map((step) => step.name)).not.toContain('inert' as StepName);
  });
});
