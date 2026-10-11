// Covers: task:6, task:7
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { closeoutDurationMs } from '../src/engine/closeout-trust.js';
import { detectCloseoutEventCommand, dispatchCloseoutEventCommand } from '../src/engine/closeout-cli.js';

const SURVIVING_CLOSEOUT_OBLIGATIONS = ['evaluator', 'simplify', 'architecture-diagram', 'memory', 'summary'] as const;

describe('closeout-event CLI', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function projectRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'closeout-cli-'));
    directories.push(root);
    return root;
  }

  async function records(root: string): Promise<unknown[]> {
    return (await readFile(join(root, '.pipeline/pipeline-events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  }

  async function dispatch(argv: string[], root: string, now: () => number, errors: string[] = []): Promise<number> {
    const command = detectCloseoutEventCommand(argv);
    expect(command).not.toBeNull();
    return dispatchCloseoutEventCommand(command!, root, now, (message) => errors.push(message));
  }

  it.each(SURVIVING_CLOSEOUT_OBLIGATIONS)('stamps the %s start from the command clock', async (obligation) => {
    const root = await projectRoot();

    await expect(dispatch(['node', 'conduct-ts', 'closeout-event', 'start', obligation], root, () => 1_788_012_000_000)).resolves.toBe(0);

    await expect(records(root)).resolves.toEqual([{ type: 'pipeline_closeout_started', obligation, ts: 1_788_012_000_000 }]);
  });

  it('uses the latest obligation-local open start and the end clock for a trusted duration', async () => {
    const root = await projectRoot();
    const T1 = 1_788_012_000_000;
    const T3 = T1 + 60_000;
    const T4 = T1 + 120_000;
    await dispatch(['node', 'conduct-ts', 'closeout-event', 'start', 'evaluator'], root, () => T1);
    await dispatch(['node', 'conduct-ts', 'closeout-event', 'start', 'summary'], root, () => T1 + 10);
    await dispatch(['node', 'conduct-ts', 'closeout-event', 'start', 'evaluator'], root, () => T3);

    await expect(dispatch(['node', 'conduct-ts', 'closeout-event', 'end', 'evaluator'], root, () => T4)).resolves.toBe(0);
    await expect(dispatch(['node', 'conduct-ts', 'closeout-event', 'end', 'summary'], root, () => T4 + 10)).resolves.toBe(0);

    const ledger = await records(root) as Array<Record<string, unknown>>;
    expect(ledger.slice(-2)).toEqual([
      { type: 'pipeline_closeout', obligation: 'evaluator', startedAt: T3, endedAt: T4, ts: T4 },
      { type: 'pipeline_closeout', obligation: 'summary', startedAt: T1 + 10, endedAt: T4 + 10, ts: T4 + 10 },
    ]);
    expect(closeoutDurationMs(ledger.at(-2)!)).toBe(60_000);
  });

  it('refuses an end at or before its open start without changing the ledger', async () => {
    const root = await projectRoot();
    const T1 = 1_788_012_000_000;
    await dispatch(['node', 'conduct-ts', 'closeout-event', 'start', 'evaluator'], root, () => T1);
    const before = await readFile(join(root, '.pipeline/pipeline-events.jsonl'), 'utf8');
    const errors: string[] = [];

    await expect(dispatch(['node', 'conduct-ts', 'closeout-event', 'end', 'evaluator'], root, () => T1 - 1, errors)).resolves.toBe(1);

    await expect(readFile(join(root, '.pipeline/pipeline-events.jsonl'), 'utf8')).resolves.toBe(before);
    expect(errors).toEqual(['closeout-event: non-positive elapsed time for evaluator']);
  });
});
