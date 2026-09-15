// Covers: S1.1, S1.2, S1.3
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeSelfHostHalt } from '../../../src/engine/self-host/gate-halt.js';
import { HALT_CLASS_MARKER } from '../../../src/engine/halt-marker.js';

// Self-host gate HALTs (release-gate, version-gate, integrity) are always
// operator-only — the daemon re-kick sweep must never mechanically retry
// them. writeSelfHostHalt must classify its HALT as `needs-human`.

describe('writeSelfHostHalt classification', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'gate-halt-test-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('persists a needs-human HALT.class sidecar', async () => {
    await writeSelfHostHalt(projectRoot, 'release-gate failed: missing artifact');
    const cls = await readFile(join(projectRoot, HALT_CLASS_MARKER), 'utf-8');
    expect(cls.trim()).toBe('needs-human');
  });

  it('prints only the self-build resume procedure', async () => {
    await writeSelfHostHalt(projectRoot, 'release-gate failed: missing artifact');

    const body = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf-8');
    expect({
      hasInstallerInstruction: body.includes('bin/install'),
      hasVerifyInstruction: body.includes('/verify'),
      numberedSteps: body.split('\n').filter((line) => /^  \d\. /.test(line)),
    }).toEqual({
      hasInstallerInstruction: false,
      hasVerifyInstruction: false,
      numberedSteps: [
        '  1. Address the gate reason above in this worktree and commit the fix.',
        '  2. Clear .pipeline/HALT and .pipeline/HALT.class — the daemon re-dispatches the feature, re-runs the gates, and opens or updates the PR.',
        '  3. Merge the PR yourself once its checks pass.',
      ],
    });
  });

  it('redacts a safety canary while retaining every resume step', async () => {
    const canary = 'CANARY_SECRET_907';
    await writeSelfHostHalt(projectRoot, `cleanup failed: token=${canary}`);

    const body = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf-8');
    expect({
      hasCanary: body.includes(canary),
      numberedSteps: body.split('\n').filter((line) => /^  \d\. /.test(line)),
    }).toEqual({
      hasCanary: false,
      numberedSteps: [
        '  1. Address the gate reason above in this worktree and commit the fix.',
        '  2. Clear .pipeline/HALT and .pipeline/HALT.class — the daemon re-dispatches the feature, re-runs the gates, and opens or updates the PR.',
        '  3. Merge the PR yourself once its checks pass.',
      ],
    });
  });
});
