import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  startFeatureEventPersistence,
  startSessionEventTail,
  withSessionEventTail,
  withFeatureEventPersistence,
} from '../../src/engine/event-persister.js';
import {
  prepareDaemonFeatureManagedSessionContext,
  renderDaemonEvent,
} from '../../src/daemon-cli.js';
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

  it('refuses a symlinked pipeline root without creating producer directories outside the worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-managed-session-pipeline-link-'));
    roots.push(root);
    const worktree = join(root, '.worktrees', 'feature-a');
    const outside = join(root, 'outside');
    await mkdir(worktree, { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(worktree, '.pipeline'));

    await expect(prepareDaemonFeatureManagedSessionContext({
      projectRoot: root, worktreeRoot: worktree, featureSlug: 'feature-a', dispatchId: 'dispatch-1', provider: 'codex',
    })).rejects.toThrow('daemon managed-session context refused: producer-root-outside-worktree');

    expect(await readdir(outside)).toEqual([]);
  });

  it('refuses a symlinked session-events root without creating producer directories outside the worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-managed-session-events-link-'));
    roots.push(root);
    const worktree = join(root, '.worktrees', 'feature-a');
    const outside = join(root, 'outside');
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(worktree, '.pipeline', 'session-events'));

    await expect(prepareDaemonFeatureManagedSessionContext({
      projectRoot: root, worktreeRoot: worktree, featureSlug: 'feature-a', dispatchId: 'dispatch-1', provider: 'codex',
    })).rejects.toThrow('daemon managed-session context refused: producer-root-outside-worktree');

    expect(await readdir(outside)).toEqual([]);
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

  it('projects concurrent producer occurrences to the canonical ledger and daemon renderer before detaching', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-event-owner-'));
    roots.push(root);
    const producerRoot = join(root, '.pipeline', 'session-events', 'dispatch-1');
    await mkdir(producerRoot, { recursive: true });
    const occurrence = (eventId: string, subcommand: string) => JSON.stringify({
      type: 'session_command_refused',
      eventId,
      sourceTime: '2026-10-02T12:00:00.000Z',
      dispatchId: 'dispatch-1',
      provider: 'codex',
      scope: { kind: 'feature', featureSlug: 'feature-a' },
      subcommand,
    });
    await Promise.all([
      writeFile(join(producerRoot, 'producer-a.jsonl'), `${occurrence('event-1', 'finish-record')}\n`),
      writeFile(join(producerRoot, 'producer-b.jsonl'), `${occurrence('event-2', 'ship')}\n`),
    ]);

    const rootEvents = new ConductorEventEmitter();
    const scope = startFeatureEventPersistence(root, rootEvents, 'feature-a');
    const rendered: string[] = [];
    const renderer = (event: Parameters<typeof renderDaemonEvent>[0]) =>
      renderDaemonEvent(event, (line) => rendered.push(line));
    scope.events.on('session_command_refused', renderer);

    await scope.drain();

    const ledger = await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8');
    expect(ledger).toContain('"eventId":"event-1"');
    expect(ledger).toContain('"eventId":"event-2"');
    expect(rendered).toHaveLength(2);
    expect(rendered.join('\n')).toContain('feature-a');
    expect(rendered.join('\n')).toContain('finish-record');
    expect(rendered.join('\n')).toContain('ship');
  });

  it('gives project-scoped managed sessions an explicit tail owner that drains before the caller detaches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'project-session-owner-'));
    roots.push(root);
    const producerRoot = join(root, '.pipeline', 'session-events', 'dispatch-1');
    await mkdir(producerRoot, { recursive: true });
    await writeFile(join(producerRoot, 'producer-a.jsonl'), `${JSON.stringify({
      type: 'session_command_refused',
      eventId: 'event-1',
      sourceTime: '2026-10-02T12:00:00.000Z',
      dispatchId: 'dispatch-1',
      provider: 'codex',
      scope: { kind: 'project' },
      subcommand: 'bootstrap',
    })}\n`);

    const events = new ConductorEventEmitter();
    const received: string[] = [];
    events.on('session_command_refused', (event) => {
      if (event.type === 'session_command_refused') received.push(event.eventId);
    });
    const tail = startSessionEventTail(root, events);

    await tail.drain();

    expect(received).toEqual(['event-1']);
  });

  it('drains a transient repair worktree into the retained feature persistence scope after failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transient-repair-session-owner-'));
    roots.push(root);
    const retainedWorktree = join(root, 'retained-feature');
    const transientWorktree = join(root, 'transient-repair');
    const producerRoot = join(transientWorktree, '.pipeline', 'session-events', 'dispatch-1');
    await mkdir(producerRoot, { recursive: true });

    const scope = startFeatureEventPersistence(retainedWorktree, new ConductorEventEmitter(), 'feature-a');
    const rendered: string[] = [];
    scope.events.on('session_command_refused', (event) => renderDaemonEvent(event, (line) => rendered.push(line)));
    scope.events.on('github_bypass_result', (event) => {
      renderDaemonEvent(event, (line) => rendered.push(line));
    });

    await expect(withSessionEventTail({
      projectRoot: transientWorktree,
      events: scope.events,
      featureSlug: 'feature-a',
      run: async () => {
        await writeFile(join(producerRoot, 'repair.jsonl'), [
          {
            type: 'session_command_refused',
            eventId: 'repair-refusal-1',
            sourceTime: '2026-10-03T12:00:00.000Z',
            dispatchId: 'dispatch-1',
            provider: 'codex',
            scope: { kind: 'feature', featureSlug: 'feature-a' },
            subcommand: 'finish-record',
          },
          {
            type: 'github_bypass_result',
            eventId: 'repair-result-1',
            sourceTime: '2026-10-03T12:00:00.000Z',
            dispatchId: 'dispatch-1',
            provider: 'codex',
            scope: { kind: 'feature', featureSlug: 'feature-a' },
            attemptId: 'repair-attempt-1',
            outcome: 'cli-failed',
          },
        ].map((event) => `${JSON.stringify(event)}\n`).join(''));
        throw new Error('repair cancelled');
      },
    })).rejects.toThrow('repair cancelled');
    await scope.drain();

    await expect(readFile(join(retainedWorktree, '.pipeline', 'events.jsonl'), 'utf8'))
      .resolves.toContain('repair-result-1');
    expect(rendered.join('\n')).toContain('managed session command refused');
    expect(rendered.join('\n')).toContain('GitHub bypass result');
    expect(rendered.join('\n')).toContain('repair-refusal-1');
    expect(rendered.join('\n')).toContain('repair-result-1');
  });

  it('starts the feature owner before a failing managed invocation and drains its settled record before rethrowing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'failing-session-event-owner-'));
    roots.push(root);
    const producerRoot = join(root, '.pipeline', 'session-events', 'dispatch-1');
    await mkdir(producerRoot, { recursive: true });

    const globalEvents = new ConductorEventEmitter();
    const rendered: string[] = [];
    // The daemon renders from its feature-scoped bus; forwarded copies on the
    // daemon-wide bus are deliberately suppressed to avoid duplicate lines.
    await expect(withFeatureEventPersistence({
      worktreePath: root,
      globalEvents,
      featureSlug: 'feature-a',
      run: async (featureEvents) => {
        featureEvents.on('session_command_refused', (event) => {
          if (event.type === 'session_command_refused') rendered.push(event.eventId);
        });
        // This write models a managed provider that settles an observation
        // immediately before its failure/cancellation reaches its owner.
        await writeFile(join(producerRoot, 'provider.jsonl'), `${JSON.stringify({
          type: 'session_command_refused',
          eventId: 'event-3',
          sourceTime: '2026-10-02T12:00:00.000Z',
          dispatchId: 'dispatch-1',
          provider: 'codex',
          scope: { kind: 'feature', featureSlug: 'feature-a' },
          subcommand: 'finish-record',
        })}\n`);
        throw new Error('provider cancelled');
      },
    })).rejects.toThrow('provider cancelled');

    await expect(readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'))
      .resolves.toContain('event-3');
    expect(rendered).toEqual(['event-3']);
    // Tail ownership is not producer lifecycle ownership: interruption keeps
    // the source record available for normal restart recovery.
    await expect(readFile(join(producerRoot, 'provider.jsonl'), 'utf8'))
      .resolves.toContain('event-3');
  });
});
