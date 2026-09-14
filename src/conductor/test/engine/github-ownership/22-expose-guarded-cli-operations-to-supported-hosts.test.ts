// Covers: task:22
import { describe, expect, it, vi } from 'vitest';
import { dispatchGithubOperationCommand, detectGithubOperationCommand } from '../../../src/engine/github-operations-cli.js';

const readRequest = (request: object) => vi.fn().mockResolvedValue(JSON.stringify(request));
const issueRead = {
  operation: 'issue.read', repository: 'acme/widgets', resource: { kind: 'issue', number: 7 }, context: { actor: 'alice' },
};

describe('github-operation CLI', () => {
  it('serializes executed, refused, failed, and partial guarded results with canonical targets', async () => {
    const cases = [
      { name: 'executed', response: {}, exit: 0, kind: 'executed' },
      { name: 'refused', response: { kind: 'refused' as const, reason: 'missing-provenance' as const }, exit: 1, kind: 'refused' },
      { name: 'failed', error: new Error('transport unavailable'), exit: 1, kind: 'failed' },
      {
        name: 'partial',
        response: {
          created: { repository: 'acme/widgets', kind: 'issue' as const, number: 9 },
          metadataFailures: [{ operation: 'issue.label.add' as const, error: 'label unavailable' }],
        },
        exit: 1,
        kind: 'partial',
      },
    ];

    for (const testCase of cases) {
      const write = vi.fn();
      const run = testCase.error
        ? vi.fn().mockRejectedValue(testCase.error)
        : vi.fn().mockResolvedValue(testCase.response);
      const exit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
        cwd: '/fixture', readRequest: readRequest(issueRead), runner: { run }, write,
      });
      const output = JSON.parse(write.mock.calls[0]?.[0] ?? '') as { kind: string; target: unknown };
      expect(exit, testCase.name).toBe(testCase.exit);
      expect(output.kind, testCase.name).toBe(testCase.kind);
      expect(output.target, testCase.name).toEqual(testCase.kind === 'partial'
        ? { repository: 'acme/widgets', kind: 'issue', number: 9 }
        : { repository: 'acme/widgets', kind: 'issue', number: 7 });
    }
  });

  it('accepts only the closed request-file command form and never forwards trailing argv', () => {
    expect(detectGithubOperationCommand(['node', 'conduct', 'github-operation', '--request-file', 'request.json']))
      .toEqual({ requestFile: 'request.json' });
    expect(detectGithubOperationCommand(['node', 'conduct', 'github-operation', 'gh', 'api'])).toBeNull();
    expect(detectGithubOperationCommand(['node', 'conduct', 'github-operation', '--request-file', 'request.json', 'gh', 'api'])).toBeNull();
  });

  it('grants shared authority only through an injected positive interactive confirmation for that request', async () => {
    const write = vi.fn();
    const confirmation = { mode: 'interactive' as const, confirm: vi.fn().mockResolvedValue(true) };
    const request = {
      operation: 'label-definition.update', repository: 'acme/widgets',
      resource: { kind: 'label-definition', name: 'priority' }, context: { actor: 'alice' },
      payload: { name: 'priority', color: '123abc' },
    };
    const gh = vi.fn().mockResolvedValue({ stdout: '' });
    const exit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd: '/fixture', readRequest: readRequest(request), confirmation, gh, write,
    });

    expect(exit).toBe(0);
    expect(confirmation.confirm).toHaveBeenCalledOnce();
    expect(gh).toHaveBeenCalledWith(['label', 'edit', 'priority', '-R', 'acme/widgets', '--color', '123abc'], { cwd: '/fixture' });

    const noConfirmationWrite = vi.fn();
    const noConfirmationExit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd: '/fixture', readRequest: readRequest(request), gh, write: noConfirmationWrite,
    });
    expect(noConfirmationExit).toBe(1);
    expect(gh).toHaveBeenCalledTimes(1);
    expect(noConfirmationWrite.mock.calls[0]?.[0]).toContain('explicit-authorization-required');
  });
});
