// Covers: task:12, task:18
import { describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('conductor transcript retention wiring', () => {
  it('settles failed, stalled, halted, and non-build successful captures on the event spine', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-retention-'));
    const events = new ConductorEventEmitter();
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }) },
    });
    const capture = async (step: 'build' | 'test_suite', name: string) => {
      const path = join('.pipeline', 'transcripts', step, name);
      await mkdir(join(root, path), { recursive: true });
      await writeFile(join(root, path, 'session.jsonl'), '{}\n');
      await events.emit({ type: 'provider_transcripts_captured', step, runId: 'r', attempt: 1,
        provider: 'codex', path, files: 1, bytes: 3, interrupted: false, skipped: 0, omittedLines: 0 });
      return path;
    };
    try {
      const failed = await capture('build', 'failed');
      await events.emit({ type: 'step_failed', step: 'build', error: 'failed', retryCount: 1 });
      await expect(access(join(root, failed))).resolves.toBeUndefined();

      const stalled = await capture('build', 'stalled');
      await events.emit({ type: 'build_stall', step: 'build', reason: 'no_task_progress', resolvedBefore: 7, resolvedAfter: 7 });
      await expect(access(join(root, stalled))).resolves.toBeUndefined();

      const halted = await capture('build', 'halted');
      await events.emit({ type: 'loop_halt', step: 'build', reason: 'halted' });
      await expect(access(join(root, halted))).resolves.toBeUndefined();

      const completed = await capture('test_suite', 'completed');
      await events.emit({ type: 'step_completed', step: 'test_suite', status: 'done' });
      await expect(access(join(root, completed))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('settles the failed configured-member attempt when its retry is emitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-transcript-member-retry-'));
    const events = new ConductorEventEmitter();
    const retained: string[] = [];
    events.on('provider_transcripts_retained', (event) => {
      if (event.type === 'provider_transcripts_retained') retained.push(event.path);
    });
    new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      events,
      stepRunner: { run: async () => ({ success: true }) },
    });
    const path = join('.pipeline', 'transcripts', 'build_review', 'attempt-1');
    try {
      await mkdir(join(root, path), { recursive: true });
      await writeFile(join(root, path, 'session.jsonl'), '{}\n');
      await events.emit({
        type: 'provider_transcripts_captured', step: 'build_review', runId: 'review', attempt: 1,
        member: 'build_review', provider: 'codex', path, files: 1, bytes: 3,
        interrupted: false, skipped: 0, omittedLines: 0,
      });
      await events.emit({
        type: 'step_retry', step: 'ship_validation', attempt: 2, maxAttempts: 3, reason: 'retry',
        executionContext: {
          executionId: 'member-retry',
          subject: { kind: 'configured-member', parentGroup: 'ship_validation', member: 'build_review' },
        },
      });
      await expect(access(join(root, path))).resolves.toBeUndefined();
      expect(retained).toEqual([path]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
