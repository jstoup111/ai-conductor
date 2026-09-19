// Covers: task:23
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { EventPersister } from '../../../src/engine/event-persister.js';
import { executeGithubOperation } from '../../../src/engine/github-operations.js';
import { executeRemoteGit } from '../../../src/engine/remote-git-operations.js';
import { createGuardedGithubOperationRunner, type GhRunner } from '../../../src/engine/tracker-client.js';
import { createLiveRegion } from '../../../src/ui/live-region.js';
import { TerminalRenderer } from '../../../src/ui/terminal-renderer.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import type { ConductorEvent } from '../../../src/types/events.js';

class CaptureStream extends Writable {
  chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  output(): string {
    return this.chunks.join('');
  }
}

function foreignOwnerContext() {
  return {
    provenance: {
      repository: 'acme/owned',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial' as const,
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true as const, id: 'alice' }),
      provenanceDiscovery: {
        readCommittedRecords: async () => [{ path: '.docs/specs/owned.md', content: 'Owner: bob\n' }],
      },
    },
  };
}

function deniedOperation(events: ConductorEventEmitter, terminal: GhRunner) {
  return executeGithubOperation({
    operation: 'issue.comment.create',
    repository: 'acme/owned',
    resource: { kind: 'issue', number: 17 },
    context: { actor: 'alice' },
    payload: { body: 'sk-live-not-for-telemetry' },
  }, createGuardedGithubOperationRunner(terminal, {
    cwd: '/fixture/worktree',
    mutation: foreignOwnerContext(),
  }), { events });
}

describe('canonical GitHub ownership refusal event', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('emits, persists, and renders a denied mutation without exposing its request body', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'github-ownership-refusal-'));
    temporaryDirectories.push(directory);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(directory, '.pipeline', 'events.jsonl'), events);
    const stream = new CaptureStream();
    const renderer = new TerminalRenderer({
      stateFilePath: join(directory, 'conduct-state.json'),
      steps: [],
      readStateFn: async () => ({ ok: true as const, value: {} }),
      liveRegion: createLiveRegion({ stream, forceTTY: false }),
    });
    const terminal = vi.fn<GhRunner>(async () => ({ stdout: '' }));
    const seen: Array<Extract<ConductorEvent, { type: 'github_operation_refused' }>> = [];

    persister.start();
    events.on('github_operation_refused', async (event) => {
      if (event.type === 'github_operation_refused') seen.push(event);
      await renderer.handle(event);
    });

    try {
      await expect(deniedOperation(events, terminal)).resolves.toEqual({
        kind: 'refused',
        operation: 'issue.comment.create',
        reason: 'other-owner',
      });

      expect(terminal).not.toHaveBeenCalled();
      expect(seen).toEqual([{
        type: 'github_operation_refused',
        operator: 'alice',
        target: { repository: 'acme/owned', kind: 'issue', number: 17 },
        operation: 'issue.comment.create',
        reason: 'other-owner',
        remedy: 'ask-resource-owner',
      }]);

      const ledger = await readFile(join(directory, '.pipeline', 'events.jsonl'), 'utf8');
      expect(JSON.parse(ledger)).toEqual({
        ...seen[0],
        ts: expect.any(String),
      });
      expect(ledger).not.toContain('sk-live-not-for-telemetry');
      expect(stream.output()).toContain(
        'GitHub operation refused: issue.comment.create on acme/owned#17 (other-owner); remedy: ask-resource-owner',
      );
      expect(stream.output()).not.toContain('sk-live-not-for-telemetry');
    } finally {
      persister.stop();
      await renderer.stop();
    }
  });

  it('keeps the refusal and skips the remote write when persistence or rendering fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'github-ownership-refusal-failure-'));
    temporaryDirectories.push(directory);
    const blocker = join(directory, 'not-a-directory');
    await writeFile(blocker, 'blocks event persistence');

    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(blocker, 'events.jsonl'), events);
    const terminal = vi.fn<GhRunner>(async () => ({ stdout: '' }));
    persister.start();
    events.on('github_operation_refused', () => {
      throw new Error('renderer failed after the refusal');
    });

    try {
      await expect(deniedOperation(events, terminal)).resolves.toEqual({
        kind: 'refused',
        operation: 'issue.comment.create',
        reason: 'other-owner',
      });
      expect(terminal).not.toHaveBeenCalled();
    } finally {
      persister.stop();
    }
  });

  it('uses the emitter carried by the guarded production adapter when the caller has no separate event option', async () => {
    const events = new ConductorEventEmitter();
    const terminal = vi.fn<GhRunner>(async () => ({ stdout: '' }));
    const observed: ConductorEvent[] = [];
    events.on('github_operation_refused', (event) => { observed.push(event); });

    await expect(executeGithubOperation({
      operation: 'issue.comment.create',
      repository: 'acme/owned',
      resource: { kind: 'issue', number: 17 },
      context: { actor: 'alice' },
      payload: { body: 'never-written' },
    }, createGuardedGithubOperationRunner(terminal, {
      cwd: '/fixture/worktree',
      mutation: foreignOwnerContext(),
      events,
    }))).resolves.toMatchObject({ kind: 'refused', reason: 'other-owner' });

    expect(terminal).not.toHaveBeenCalled();
    expect(observed).toEqual([expect.objectContaining({
      type: 'github_operation_refused',
      operation: 'issue.comment.create',
      reason: 'other-owner',
      remedy: 'ask-resource-owner',
    })]);
  });

  it('emits the canonical refusal for a remote push with missing provenance after refusing it', async () => {
    const events = new ConductorEventEmitter();
    const remoteWrite = vi.fn();
    const observed: ConductorEvent[] = [];
    events.on('github_operation_refused', (event) => { observed.push(event); });

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feature/owned'],
      {
        cwd: '/fixture/worktree',
        config: async () => ({ stdout: 'git@github.com:acme/owned.git\n' }),
        runRemoteGit: remoteWrite,
        events,
      },
    )).resolves.toMatchObject({ kind: 'refused', reason: 'missing-provenance' });

    expect(remoteWrite).not.toHaveBeenCalled();
    expect(observed).toEqual([expect.objectContaining({
      type: 'github_operation_refused',
      operator: 'unknown',
      target: { repository: 'acme/owned', kind: 'remote-ref', ref: 'refs/heads/feature/owned' },
      operation: 'remote-ref.push',
      reason: 'missing-provenance',
      remedy: 'record-feature-ownership',
    })]);
  });

  it('emits the canonical refusal for a policy-denied remote push after authorization fails', async () => {
    const events = new ConductorEventEmitter();
    const remoteWrite = vi.fn();
    const observed: ConductorEvent[] = [];
    events.on('github_operation_refused', (event) => { observed.push(event); });

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feature/owned'],
      {
        cwd: '/fixture/worktree',
        config: async () => ({ stdout: 'git@github.com:acme/owned.git\n' }),
        runRemoteGit: remoteWrite,
        events,
        mutation: foreignOwnerContext(),
      },
    )).resolves.toMatchObject({ kind: 'refused', reason: 'other-owner' });

    expect(remoteWrite).not.toHaveBeenCalled();
    expect(observed).toEqual([expect.objectContaining({
      type: 'github_operation_refused',
      operator: 'alice',
      target: { repository: 'acme/owned', kind: 'remote-ref', ref: 'refs/heads/feature/owned' },
      operation: 'remote-ref.push',
      reason: 'other-owner',
      remedy: 'ask-resource-owner',
    })]);
  });
});
