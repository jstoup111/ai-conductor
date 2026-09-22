// Covers: task:9
import { describe, expect, it, vi } from 'vitest';

import { createDaemonHaltPrOperations } from '../../../src/engine/daemon-halt-pr-operations.js';
import { executeGithubOperation } from '../../../src/engine/github-operations.js';

const PROJECT_ROOT = '/fixture';
const PR = {
  number: 44,
  url: 'https://github.com/acme/widgets/pull/44',
  headRefName: 'feat/daemon-owned-halt',
};

describe('daemon halt-PR reconciliation live operation composition', () => {
  it('derives a fresh provenance-backed guarded runner for a daemon PR and keeps a foreign owner outside the transport boundary', async () => {
    let committedOwner = 'alice';
    const gh = vi.fn(async () => ({ stdout: '' }));
    const git = vi.fn(async (args: string[]) => {
      expect(args).toEqual(['show', 'main:.docs/intake/owned-halt.md']);
      return { exitCode: 0, stdout: `Owner: ${committedOwner}\n`, stderr: '' };
    });
    const resolveMachineOwner = vi.fn(async () => ({ resolved: true as const, id: 'alice' }));
    const operationsForPr = createDaemonHaltPrOperations({
      projectRoot: PROJECT_ROOT,
      baseBranch: 'main',
      gh,
      git,
      resolveMachineOwner,
    });
    const operations = operationsForPr(PR);
    if (!operations) throw new Error('expected a daemon PR to receive a guarded runner');

    await expect(executeGithubOperation({
      operation: 'pull-request.label.add',
      repository: 'acme/widgets',
      resource: { kind: 'pull-request', number: PR.number },
      context: { actor: 'daemon-halt-reconciliation' },
      payload: { label: 'needs-remediation' },
    }, operations)).resolves.toMatchObject({ kind: 'executed' });
    expect(gh).toHaveBeenCalledTimes(1);

    committedOwner = 'bob';
    await expect(executeGithubOperation({
      operation: 'pull-request.draft',
      repository: 'acme/widgets',
      resource: { kind: 'pull-request', number: PR.number },
      context: { actor: 'daemon-halt-reconciliation' },
    }, operations)).resolves.toMatchObject({ kind: 'refused', reason: 'other-owner' });

    expect(resolveMachineOwner).toHaveBeenCalledTimes(2);
    expect(git).toHaveBeenCalledTimes(2);
    expect(gh).toHaveBeenCalledTimes(1);
  });

  it('does not construct mutation authority from a foreign branch or an unparseable PR URL', () => {
    const operationsForPr = createDaemonHaltPrOperations({
      projectRoot: PROJECT_ROOT,
      baseBranch: 'main',
      gh: async () => ({ stdout: '' }),
      git: async () => ({ exitCode: 0, stdout: 'Owner: alice\n', stderr: '' }),
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
    });

    expect(operationsForPr({ ...PR, headRefName: 'feature/not-daemon' })).toBeUndefined();
    expect(operationsForPr({ ...PR, url: 'https://example.test/pull/44' })).toBeUndefined();
  });
});
