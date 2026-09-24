// Covers: task:8
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectDaemonExitWitnessCommand,
  dispatchDaemonExitWitness,
  runExitWitness,
} from '../../src/engine/daemon-exit-witness.js';

describe('runExitWitness', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'daemon-exit-witness-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('records a SIGKILL status in the dedicated exit ledger', async () => {
    const code = runExitWitness({ root, pid: 42, status: 137 });

    expect(code).toBe(0);
    const [line] = (await readFile(join(root, '.daemon', 'exit-events.jsonl'), 'utf8')).trim().split('\n');
    expect(JSON.parse(line!)).toMatchObject({
      type: 'daemon_exited', pid: 42, code: null, signal: 'SIGKILL',
    });
    expect(new Date(JSON.parse(line!).at).toISOString()).toBe(JSON.parse(line!).at);
  });

  it('retains a non-zero abort code while naming SIGABRT', async () => {
    runExitWitness({ root, pid: 42, status: 134 });

    const record = JSON.parse((await readFile(join(root, '.daemon', 'exit-events.jsonl'), 'utf8')).trim());
    expect(record).toMatchObject({ pid: 42, code: 134, signal: 'SIGABRT' });
  });

  it('records a normal exit code without a signal', async () => {
    runExitWitness({ root, pid: 42, status: 0 });

    const record = JSON.parse((await readFile(join(root, '.daemon', 'exit-events.jsonl'), 'utf8')).trim());
    expect(record).toMatchObject({ pid: 42, code: 0, signal: null });
  });

  it('never opens the event spine ledger', () => {
    const paths: string[] = [];
    runExitWitness({ root, pid: 42, status: 0 }, { append: (path) => paths.push(path) });

    expect(paths).toEqual([join(root, '.daemon', 'exit-events.jsonl')]);
  });

  it('rejects missing pid or status before it writes a ledger', async () => {
    const messages: string[] = [];
    const missingPid = detectDaemonExitWitnessCommand(['node', 'conduct', 'daemon', 'exit-witness', '--status', '0']);
    const missingStatus = detectDaemonExitWitnessCommand(['node', 'conduct', 'daemon', 'exit-witness', '--pid', '1']);

    expect(dispatchDaemonExitWitness(missingPid!, root, (line) => messages.push(line))).toBe(1);
    expect(dispatchDaemonExitWitness(missingStatus!, root, (line) => messages.push(line))).toBe(1);
    expect(messages).toEqual([
      'Usage: ai-conductor daemon exit-witness --pid <pid> --status <status>',
      'Usage: ai-conductor daemon exit-witness --pid <pid> --status <status>',
    ]);
    await expect(access(join(root, '.daemon', 'exit-events.jsonl'))).rejects.toThrow();
  });

  it('dispatches a valid daemon exit-witness command to the writer', async () => {
    const command = detectDaemonExitWitnessCommand([
      'node', 'conduct', 'daemon', 'exit-witness', '--pid', '1', '--status', '0',
    ]);

    expect(dispatchDaemonExitWitness(command!, root)).toBe(0);
    expect(JSON.parse((await readFile(join(root, '.daemon', 'exit-events.jsonl'), 'utf8')).trim()))
      .toMatchObject({ type: 'daemon_exited', pid: 1, code: 0, signal: null });
  });

  it('falls back to daemon.log with the same record when its ledger write fails', async () => {
    const code = runExitWitness(
      { root, pid: 42, status: 137 },
      { append: (path, line) => {
        if (path.endsWith('exit-events.jsonl')) throw new Error('read-only');
        appendFileSync(path, line, 'utf8');
      } },
    );

    expect(code).toBe(1);
    const record = JSON.parse((await readFile(join(root, '.daemon', 'daemon.log'), 'utf8')).trim());
    expect(record).toMatchObject({ type: 'daemon_exited', pid: 42, code: null, signal: 'SIGKILL' });
  });
});
