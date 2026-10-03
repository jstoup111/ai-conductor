import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { prepareDaemonFeatureManagedSessionContext } from '../../src/daemon-cli.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('feature session-event lifecycle', () => {
  it('prepares daemon provider context from the authoritative feature worktree, not cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-managed-session-'));
    roots.push(root);
    const worktree = join(root, '.worktrees', 'feature-a');
    await mkdir(worktree, { recursive: true });

    const context = await prepareDaemonFeatureManagedSessionContext({
      projectRoot: root,
      worktreeRoot: worktree,
      featureSlug: 'feature-a',
      dispatchId: 'dispatch-1',
      provider: 'codex',
    });

    expect(context).toMatchObject({
      projectRoot: root,
      worktreeRoot: worktree,
      scope: { kind: 'feature', featureSlug: 'feature-a' },
      dispatchId: 'dispatch-1',
      provider: 'codex',
      producerRoot: join(worktree, '.pipeline', 'session-events', 'dispatch-1'),
    });
  });

  it('drains a settled producer record before the feature persistence owner detaches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-event-lifecycle-'));
    roots.push(root);
    const producer = join(root, '.pipeline', 'session-events', 'dispatch-1', 'producer-a.jsonl');
    await mkdir(join(root, '.pipeline', 'session-events', 'dispatch-1'), { recursive: true });
    await writeFile(producer, `${JSON.stringify({
      type: 'session_command_refused',
      eventId: 'event-1',
      sourceTime: '2026-10-02T12:00:00.000Z',
      dispatchId: 'dispatch-1',
      provider: 'codex',
      scope: { kind: 'feature', featureSlug: 'feature-a' },
      subcommand: 'finish-record',
    })}\n`);

    const scope = startFeatureEventPersistence(root, new ConductorEventEmitter(), 'feature-a');
    await scope.drain();

    const ledger = await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8');
    expect(ledger).toContain('"eventId":"event-1"');
  });
});
