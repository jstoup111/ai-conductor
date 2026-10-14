import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dispatchBuildTailCommand } from '../../src/engine/build-tail-cli.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

it('renders the build-tail entry point without a closeout segment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tail-acceptance-')); directories.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline/events.jsonl'), [
    { type: 'step_started', step: 'build', ts: 10 }, { type: 'build_progress', resolved: 0, total: 1, ts: 15 },
    { type: 'build_progress', resolved: 1, total: 1, ts: 20 },
    { type: 'step_completed', step: 'build', status: 'done', ts: 30 },
  ].map((event) => JSON.stringify(event)).join('\n'));
  const output: string[] = [];
  await dispatchBuildTailCommand({ kind: 'build-tail' }, { cwd: root, print: (line) => output.push(line) });
  expect(output[0]).toContain('Task execution: 10ms');
  expect(output[0]).not.toContain('Closeout:');
});
