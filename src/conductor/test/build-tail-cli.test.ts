import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchBuildTailCommand } from '../src/engine/build-tail-cli.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

it('reports execution and ticks without a closeout duration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'build-tail-cli-')); directories.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline/events.jsonl'), [
    { type: 'step_started', step: 'build', ts: 10 }, { type: 'build_progress', resolved: 0, total: 1, ts: 15 },
    { type: 'build_progress', resolved: 1, total: 1, ts: 20 }, { type: 'build_progress', resolved: 1, total: 1, ts: 30 },
    { type: 'step_completed', step: 'build', status: 'done', ts: 40 },
  ].map((event) => JSON.stringify(event)).join('\n'));
  const output: string[] = [];
  await dispatchBuildTailCommand({ kind: 'build-tail' }, { cwd: root, print: (line) => output.push(line) });
  expect(output[0]).toContain('Task execution: 10ms');
  expect(output[0]).toContain('Post-resolution ticks: remediation=0, closeout=1');
  expect(output[0]).not.toContain('Closeout:');
});
