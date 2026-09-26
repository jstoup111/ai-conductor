import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BuildReviewLapGate } from '../../src/engine/build-review-lap-gate.js';

const roots = { frozenHead: [], frozenBaseline: [], capturedPolicyMaterial: [], installedPolicyPackage: [], evidenceRoot: [] };

describe('BuildReviewLapGate.registerPolicy', () => {
  let dir: string | undefined;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = undefined; });

  async function policyDirs(): Promise<{ firstMaterial: string; retryMaterial: string; packageRoot: string }> {
    dir = await mkdtemp(join(tmpdir(), 'lap-gate-'));
    const firstMaterial = join(dir, 'policy-bundle-first');
    const retryMaterial = join(dir, 'policy-bundle-retry');
    const packageRoot = join(dir, 'skill');
    for (const path of [firstMaterial, retryMaterial, packageRoot]) {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, 'SKILL.md'), 'policy\n');
    }
    return { firstMaterial, retryMaterial, packageRoot };
  }

  it('accepts a retry candidate registering fresh material after the barrier opens', async () => {
    const { firstMaterial, retryMaterial, packageRoot } = await policyDirs();
    const gate = await BuildReviewLapGate.begin({ roots, maxParallel: 1, members: ['moneySafety'] });
    await gate.registerPolicy(firstMaterial, packageRoot);
    await gate.waitForBaseline('moneySafety');
    expect(gate.hasOpened).toBe(true);

    await expect(gate.registerPolicy(retryMaterial, packageRoot)).resolves.toBeUndefined();

    await writeFile(join(retryMaterial, 'SKILL.md'), 'mutated by reviewer\n');
    const settlement = await gate.settle();
    expect(settlement.records.map((record) => record.roots.capturedPolicyMaterial)).toContain(retryMaterial);
    expect(settlement.changedInputs.length).toBeGreaterThan(0);
  });
});
