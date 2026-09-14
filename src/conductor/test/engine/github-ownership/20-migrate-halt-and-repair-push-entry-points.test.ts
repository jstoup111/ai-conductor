// Covers: task:20
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pushRefreshedBranch } from '../../../src/engine/autoresolve.js';
import { escalateBuildFailure } from '../../../src/engine/build-failure-escalation.js';
import { pushPostFinishShippedRecord } from '../../../src/engine/conductor.js';
import { publishHaltRecord } from '../../../src/engine/halt-record.js';
import { executeRemoteGit } from '../../../src/engine/remote-git-operations.js';
import { makeProductionRepairPublisher } from '../../../src/engine/shipment-evidence-cli.js';

const scratch: string[] = [];
afterEach(async () => Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

function executedRemoteGit() {
  return vi.fn().mockResolvedValue({ kind: 'executed', targets: [] }) as unknown as typeof executeRemoteGit;
}

describe('engine remote Git publication callers', () => {
  it('routes halt records, lease repair, and conductor refresh through explicit guarded destinations', async () => {
    const haltRemote = executedRemoteGit();
    await publishHaltRecord('/fixture', 'feature/halted', { remoteGit: haltRemote });
    expect(haltRemote).toHaveBeenCalledWith(
      ['push', 'origin', 'HEAD:refs/heads/feature/halted'],
      expect.objectContaining({ cwd: '/fixture' }),
    );

    const repairRemote = executedRemoteGit();
    await expect(pushRefreshedBranch(
      vi.fn(),
      'feature/repaired',
      undefined,
      { remoteGit: repairRemote },
    )).resolves.toEqual({ pushed: true });
    expect(repairRemote).toHaveBeenCalledWith(
      ['push', 'origin', 'HEAD:refs/heads/feature/repaired', '--force-with-lease'],
      expect.any(Object),
    );

    const conductorRemote = executedRemoteGit();
    await pushPostFinishShippedRecord({
      cwd: '/fixture',
      branch: 'feature/finished',
      runGit: vi.fn(),
      remoteGit: conductorRemote,
    });
    expect(conductorRemote).toHaveBeenCalledWith(
      ['push', 'origin', 'HEAD:refs/heads/feature/finished'],
      expect.objectContaining({ cwd: '/fixture' }),
    );
  });

  it('stops escalation before any PR or comment when guarded publication refuses', async () => {
    const runGh = vi.fn().mockResolvedValue({ stdout: '' });
    const remoteGit = vi.fn().mockResolvedValue({ kind: 'refused', reason: 'other-owner' }) as unknown as typeof executeRemoteGit;
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse') return { stdout: 'feature/escalation\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'refs/remotes/origin/main\n' };
      if (args[0] === 'merge-base') return { stdout: 'base\n' };
      return { stdout: '1\n' };
    });

    await expect(escalateBuildFailure({
      projectRoot: '/fixture',
      failureReason: 'failed build',
      runGit,
      runGh,
      remoteGit,
    })).resolves.toEqual({});
    expect(remoteGit).toHaveBeenCalledWith(
      ['push', '-u', 'origin', 'HEAD:refs/heads/feature/escalation'],
      expect.objectContaining({ cwd: '/fixture' }),
    );
    expect(runGh).not.toHaveBeenCalled();
  });

  it('routes shipment repair through the guard and does not issue a raw push', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'remote-git-repair-'));
    scratch.push(cwd);
    const remoteGit = executedRemoteGit();
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'diff') return { stdout: '.docs/shipped/feature.md\n' };
      if (args[0] === 'rev-parse') return { stdout: 'repair-head\n' };
      return { stdout: '' };
    });
    const publisher = makeProductionRepairPublisher({
      cwd,
      implementationPr: 'https://github.com/acme/rocket/pull/42',
      slug: 'feature',
      runGh: vi.fn(),
      runGit,
      evaluateEvidence: vi.fn(),
      repo: 'acme/rocket',
      remoteGit,
    });

    await publisher.commitRecordOnly({
      branch: 'repair/feature',
      writes: [{ path: '.docs/shipped/feature.md', content: 'record\n' }],
    });

    expect(remoteGit).toHaveBeenCalledWith(
      ['push', 'origin', 'HEAD:refs/heads/repair/feature'],
      expect.objectContaining({ cwd }),
    );
    expect(runGit.mock.calls.map(([args]) => args)).not.toContainEqual(
      ['push', 'origin', 'HEAD:refs/heads/repair/feature'],
    );
  });
});
