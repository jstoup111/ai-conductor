// Covers: task:3, task:rem-prd-audit-rem-s1.2-1, task:rem-prd-audit-rem-s1.2-2
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchGithubOperationCommand } from '../../src/engine/github-operations-cli.js';
import type { ExternalPipelineEvent } from '../../src/engine/closeout-events.js';

const title = 'Private FINISH title';
const body = 'Private line one\nPrivate line two';
const missingScope = 'GraphQL: Your token has not been granted the required scopes: read:org';
const roots: string[] = [];

async function worktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'github-operation-failed-event-'));
  roots.push(root);
  return root;
}

async function ledger(root: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(join(root, '.pipeline', 'pipeline-events.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

const readRequest = (request: object) => async () => JSON.stringify(request);
const noFeatureMutation = vi.fn(async () => ({ stdout: '' }));

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('github-operation failed external events', () => {
  it('writes a sanitized PR-edit failure only to the sibling ledger', async () => {
    const cwd = await worktree();
    const write = vi.fn();
    const events = { emit: vi.fn() };
    const request = {
      operation: 'pull-request.edit', repository: 'owner/repo', resource: { kind: 'pull-request', number: 7 },
      context: { actor: 'operator' }, payload: { title, body },
    };
    const error = `Command failed: gh pr edit 7 -R owner/repo --title ${title} --body ${body}\n${missingScope}`;

    const exit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd, readRequest: readRequest(request), git: noFeatureMutation,
      runner: { run: vi.fn().mockRejectedValue(new Error(error)) }, events, write,
    });

    const eventsInLedger = await ledger(cwd);
    expect(eventsInLedger).toHaveLength(1);
    const [event] = eventsInLedger;
    expect({ exit, output: JSON.parse(write.mock.calls[0]?.[0] ?? '{}'), event, emitted: events.emit.mock.calls })
      .toEqual(expect.objectContaining({
        exit: 1,
        output: expect.objectContaining({ kind: 'failed', operation: 'pull-request.edit' }),
        event: expect.objectContaining({ type: 'github_operation_failed', operation: 'pull-request.edit', target: { repository: 'owner/repo', kind: 'pull-request', number: 7 }, ts: expect.any(String) }),
        emitted: [],
      }));
    expect(event.error).toContain(missingScope);
    expect(String(event.error).length).toBeLessThanOrEqual(1000);
    for (const secret of ['Command failed', 'gh pr edit', '-R', '--title', '--body', title, body]) expect(event.error).not.toContain(secret);
    await expect(readFile(join(cwd, '.pipeline', 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('bounds another failed operation and leaves refused, malformed, and executed results unrecorded', async () => {
    const failedRoot = await worktree();
    const comment = {
      operation: 'pull-request.comment.create', repository: 'owner/repo', resource: { kind: 'pull-request', number: 7 },
      context: { actor: 'operator' }, payload: { body: 'comment' },
    };
    await expect(dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd: failedRoot, readRequest: readRequest(comment), git: noFeatureMutation,
      runner: { run: vi.fn().mockRejectedValue(new Error('x'.repeat(3000))) }, write: vi.fn(),
    })).resolves.toBe(1);
    expect(await ledger(failedRoot)).toEqual([expect.objectContaining({
      type: 'github_operation_failed', operation: 'pull-request.comment.create', error: 'x'.repeat(1000),
    })]);

    for (const input of [
      { readRequest: async () => '{', runner: { run: vi.fn() } },
      { readRequest: readRequest({ operation: 'issue.read', repository: 'owner/repo', resource: { kind: 'issue', number: 1 }, context: { actor: 'operator' } }), runner: { run: vi.fn().mockResolvedValue({ kind: 'refused', reason: 'missing-provenance' }) } },
      { readRequest: readRequest({ operation: 'issue.read', repository: 'owner/repo', resource: { kind: 'issue', number: 1 }, context: { actor: 'operator' } }), runner: { run: vi.fn().mockResolvedValue({}) } },
    ]) {
      const cwd = await worktree();
      await dispatchGithubOperationCommand({ requestFile: '/request.json' }, { cwd, git: noFeatureMutation, write: vi.fn(), ...input });
      await expect(readFile(join(cwd, '.pipeline', 'pipeline-events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('preserves the failed CLI result when the external ledger writer throws', async () => {
    const write = vi.fn();
    const appendExternalEvent = vi.fn(() => { throw new Error('ledger unavailable'); });
    const request = {
      operation: 'pull-request.edit', repository: 'owner/repo', resource: { kind: 'pull-request', number: 7 }, context: { actor: 'operator' }, payload: { body: 'replacement' },
    };

    await expect(dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd: await worktree(), readRequest: readRequest(request), git: noFeatureMutation,
      runner: { run: vi.fn().mockRejectedValue(new Error('unavailable')) }, appendExternalEvent, write,
    })).resolves.toBe(1);

    expect({ appendExternalEvent: appendExternalEvent.mock.calls, output: JSON.parse(write.mock.calls[0]?.[0] ?? '{}') })
      .toEqual({ appendExternalEvent: [expect.any(Array)], output: expect.objectContaining({ kind: 'failed' }) });
  });

  it('records decoded failures from the shared-write and remote-ref-write paths', async () => {
    const events: ExternalPipelineEvent[] = [];
    const appendExternalEvent = (_root: string, event: ExternalPipelineEvent) => { events.push(event); };
    const shared = {
      operation: 'label-definition.update', repository: 'owner/repo', resource: { kind: 'label-definition', name: 'priority' },
      context: { actor: 'operator' }, payload: { name: 'priority', color: '123abc' },
    };
    await expect(dispatchGithubOperationCommand({ requestFile: '/shared.json' }, {
      cwd: await worktree(), readRequest: readRequest(shared), write: vi.fn(), appendExternalEvent,
      confirmation: { mode: 'interactive', confirm: vi.fn().mockResolvedValue(true) }, gh: vi.fn().mockRejectedValue(new Error('shared unavailable')),
    })).resolves.toBe(1);

    const remote = {
      operation: 'remote-ref.push', repository: 'owner/repo', resource: { kind: 'remote-ref', ref: 'refs/heads/feature' }, context: { actor: 'operator' },
    };
    await expect(dispatchGithubOperationCommand({ requestFile: '/remote.json' }, {
      cwd: await worktree(), readRequest: readRequest(remote), git: noFeatureMutation, write: vi.fn(), appendExternalEvent,
      confirmation: { mode: 'interactive', confirm: vi.fn().mockResolvedValue(true) }, remoteGit: vi.fn().mockResolvedValue({ kind: 'failed', error: 'remote unavailable' }),
    })).resolves.toBe(1);

    expect(events).toEqual([
      expect.objectContaining({ type: 'github_operation_failed', operation: 'label-definition.update', error: 'shared unavailable' }),
      expect.objectContaining({ type: 'github_operation_failed', operation: 'remote-ref.push', error: 'remote unavailable' }),
    ]);
  });

  it.each([
    ['pull-request.create', { kind: 'repository' }, { title: 'PR', body: 'body', head: 'feature', base: 'main' }],
    ['issue.create', { kind: 'repository' }, { title: 'Issue', body: 'body' }],
    ['intake.issue.close', { kind: 'issue', number: 7 }, undefined],
    ['issue.read', { kind: 'issue', number: 7 }, undefined],
  ] as const)('records a failed %s operation regardless of access class', async (operation, resource, payload) => {
    const cwd = await worktree();
    const write = vi.fn();
    const request = {
      operation, repository: 'owner/repo', resource, context: { actor: 'operator' },
      ...(payload === undefined ? {} : { payload }),
    };

    const exit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
      cwd, readRequest: readRequest(request), git: noFeatureMutation, write,
      runner: { run: vi.fn().mockRejectedValue(new Error(`${operation} unavailable`)) },
    });

    expect(exit).toBe(1);
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? '{}')).toMatchObject({ kind: 'failed', operation });
    expect(await ledger(cwd)).toEqual([expect.objectContaining({
      type: 'github_operation_failed', operation,
      target: expect.objectContaining({ repository: 'owner/repo', kind: resource.kind }),
    })]);
  });
});
