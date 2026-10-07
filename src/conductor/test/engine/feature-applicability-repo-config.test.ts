// Covers: task:1
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/engine/config.js';
import { validateApplicability } from '../../src/engine/feature-applicability.js';
import { resolveFeatureApplicabilityConfig } from '../../src/engine/resolved-config.js';
import { ALL_STEPS } from '../../src/engine/steps.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');

describe('repository feature applicability configuration', () => {
  it('enables class-naming declarations while refusing gated and custom steps', async () => {
    const loaded = await loadConfig(repoRoot);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const enabled = resolveFeatureApplicabilityConfig(loaded.config).enabled;
    const customStepNames = Object.keys(loaded.config.steps ?? {})
      .filter((name) => !ALL_STEPS.some((step) => step.name === name));
    const options = { enabled, customStepNames };

    expect(enabled).toBe(true);
    expect(validateApplicability(
      'Inapplicable: acceptance_specs — dependency upgrade: the existing suite is the specification\n',
      options,
    )).toEqual({
      ok: true,
      declarations: [{
        step: 'acceptance_specs',
        reason: 'dependency upgrade: the existing suite is the specification',
        line: 1,
      }],
    });

    for (const step of ['test_suite', 'build_review', 'finish', ...customStepNames]) {
      expect(validateApplicability(`Inapplicable: ${step} — maintenance change\n`, options))
        .toMatchObject({ ok: false, error: { kind: 'not-declarable', step } });
    }
  });
});
