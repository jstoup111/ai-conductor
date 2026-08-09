import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  detectCloseoutEventCommand,
  dispatchCloseoutEventCommand,
} from '../src/engine/closeout-cli.js';

describe('closeout-event CLI', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true,
    })));
  });

  it('appends a valid obligation timing through the closeout appender', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'closeout-cli-'));
    directories.push(projectRoot);

    const command = detectCloseoutEventCommand([
      'node',
      'conduct-ts',
      'closeout-event',
      'evaluator',
      '100',
      '140',
    ]);

    expect(command).toEqual({
      kind: 'closeout-event',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
    });
    await expect(dispatchCloseoutEventCommand(command!, projectRoot, () => 140)).resolves.toBe(0);
    await expect(readFile(join(projectRoot, '.pipeline/pipeline-events.jsonl'), 'utf8'))
      .resolves.toBe(
        '{"type":"pipeline_closeout","obligation":"evaluator","startedAt":100,"endedAt":140,"ts":140}\n',
      );
  });
});
