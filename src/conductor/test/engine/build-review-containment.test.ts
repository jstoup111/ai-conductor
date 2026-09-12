// Covers: task:13
import { describe, expect, it } from 'vitest';

import { prepareBuildReviewContainment } from '../../src/engine/build-review-containment.js';
import * as providerScratch from '../../src/engine/self-host/provider-scratch.js';

describe('engine/build-review-containment', () => {
  it('derives review bookkeeping inside the candidate private scratch lease', () => {
    const resolve = Reflect.get(providerScratch, 'resolveReviewScratchHome') as (options: {
      readonly worktreeRoot: string;
      readonly runId: string;
      readonly attempt: number;
      readonly provider: 'codex';
    }) => string;

    expect(resolve({
      worktreeRoot: '/worktree', runId: 'run-7', attempt: 2, provider: 'codex',
    })).toBe('/worktree/.daemon/scratch/run-7/2-codex');
  });

  it('proves read-only review access through the production process boundary', async () => {
    const processCalls: Array<{ readonly executable: string; readonly args: readonly string[] }> = [];
    const result = await prepareBuildReviewContainment({
      provider: 'codex',
      paths: {
        frozenSource: '/review/frozen-source', policyMaterial: '/review/policy',
        originalCheckout: '/review/original', originalInstallation: '/review/installed-policy',
        engineEvidence: '/review/engine-evidence', siblingEvidence: '/review/sibling-evidence',
        scratch: '/review/private-scratch', sourceWriteProbe: '/review/frozen-source/sentinel',
        installationWriteProbe: '/review/installed-policy/sentinel',
        engineStateWriteProbe: '/review/engine-evidence/sentinel',
        scratchWriteProbe: '/review/private-scratch/sentinel',
        siblingEvidenceProbe: '/review/sibling-evidence/result.json',
      },
      runProcess: async (executable, args) => {
        processCalls.push({ executable, args });
        return {
          exitCode: 0,
          stderr: '',
          stdout: [
            'source-write-refused', 'installation-write-refused', 'engine-state-write-refused',
            'scratch-write-succeeded', 'sibling-evidence-withheld', 'nested-sandbox-available',
          ].join('\n'),
        };
      },
    });

    expect(result).toMatchObject({ kind: 'ready', provider: 'codex' });
    if (result.kind !== 'ready') throw new Error('expected the injected probe to prepare containment');
    expect(result.profile.mountArgs).not.toContain('/bin/sh');
    expect(processCalls).toEqual([expect.objectContaining({
      executable: 'bwrap',
      args: expect.arrayContaining([
        '--ro-bind', '/review/frozen-source', '/review/frozen-source',
        '--ro-bind', '/review/policy', '/review/policy',
        '--ro-bind', '/review/original', '/review/original',
        '--ro-bind', '/review/installed-policy', '/review/installed-policy',
        '--tmpfs', '/review/engine-evidence',
        '--tmpfs', '/review/sibling-evidence',
        '--bind', '/review/private-scratch', '/review/private-scratch',
      ]),
    })]);
  });

  it.each([
    ['missing bubblewrap', async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }],
    ['a successful protected write', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-succeeded\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-succeeded\nsibling-evidence-withheld\nnested-sandbox-available',
    })],
    ['a failed scratch write', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-refused\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-refused\nsibling-evidence-withheld\nnested-sandbox-available',
    })],
    ['an unsupported nested sandbox', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-refused\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-succeeded\nsibling-evidence-withheld\nnested-sandbox-denied',
    })],
  ])('refuses review preparation when containment has %s', async (_reason, runProcess) => {
    const result = await prepareBuildReviewContainment({
      provider: 'claude',
      paths: {
        frozenSource: '/review/frozen-source', policyMaterial: '/review/policy',
        originalCheckout: '/review/original', originalInstallation: '/review/installed-policy',
        engineEvidence: '/review/engine-evidence', siblingEvidence: '/review/sibling-evidence',
        scratch: '/review/private-scratch', sourceWriteProbe: '/review/frozen-source/sentinel',
        installationWriteProbe: '/review/installed-policy/sentinel',
        engineStateWriteProbe: '/review/engine-evidence/sentinel',
        scratchWriteProbe: '/review/private-scratch/sentinel',
        siblingEvidenceProbe: '/review/sibling-evidence/result.json',
      },
      runProcess,
    });

    expect(result).toMatchObject({
      kind: 'unsupported', provider: 'claude', capability: 'linux-read-only-review-boundary',
      recovery: 'install-bubblewrap-and-enable-nested-sandboxing',
    });
  });
});
