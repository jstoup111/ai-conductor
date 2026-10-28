// Covers: task:1
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CloseoutEventTail } from '../../src/engine/closeout-tail.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'closeout-tail-'));
  directories.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  return root;
}

describe('CloseoutEventTail', () => {
  it('projects a github-operation failure from the sibling ledger onto the canonical bus', async () => {
    const root = await project();
    const failure = {
      type: 'github_operation_failed',
      operation: 'pull-request.edit',
      target: { kind: 'pull-request', repository: 'owner/repo', number: 3372 },
      error: 'GraphQL: Your token has not been granted the required scopes.',
      ts: '2026-10-24T00:00:00.000Z',
    } as const;
    await writeFile(join(root, '.pipeline', 'pipeline-events.jsonl'), `${JSON.stringify(failure)}\n`);

    const events = new ConductorEventEmitter();
    const received: unknown[] = [];
    const diagnostics: unknown[] = [];
    events.on('github_operation_failed', (event) => { received.push(event); });
    events.on('pipeline_tail_diagnostic', (event) => { diagnostics.push(event); });
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();

    try {
      await new CloseoutEventTail({ projectRoot: root, events }).poll();
    } finally {
      persister.stop();
    }

    expect(received).toEqual([failure]);
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ reason: 'unadmitted-type' }));
    const persisted = JSON.parse((await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim());
    expect(persisted).toMatchObject({
      type: failure.type,
      operation: failure.operation,
      target: failure.target,
      error: failure.error,
    });
    expect(persisted.ts).toEqual(expect.any(String));
  });
});
