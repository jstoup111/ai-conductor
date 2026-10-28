// Covers: task:10
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { validateConfig } from '../../src/engine/config.js';
import { resolveRemediationLapAllowance } from '../../src/engine/remediation-caps.js';

const repoRoot = resolve(process.cwd(), '../..');

describe('repository remediation configuration', () => {
  it('keeps the committed config on tier-derived remediation allowances', async () => {
    const raw = loadYaml(await readFile(resolve(repoRoot, '.ai-conductor/config.yml'), 'utf8'));
    const validated = validateConfig(raw, repoRoot);
    if (!validated.ok) throw new Error(validated.error.message);

    expect(validated.config.prd_audit?.max_remediation_laps).toBeUndefined();
    expect(validated.config.architecture_review_as_built?.max_remediation_laps).toBeUndefined();
    expect(validated.config.prd_audit?.max_appended_tasks).toBe(8);
    expect(validated.config.prd_audit?.max_appended_ratio).toBe(0.8);
    expect(validated.config.architecture_review_as_built?.remediation?.enabled).toBe(true);
    expect(resolveRemediationLapAllowance('prd_audit', validated.config, 'L').limit).toBe(4);
    expect(resolveRemediationLapAllowance('architecture_review_as_built', validated.config, 'L').limit).toBe(4);
    expect(resolveRemediationLapAllowance('architecture_review_as_built', validated.config, 'S').limit).toBe(2);
  });
});
