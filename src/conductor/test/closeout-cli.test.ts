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

  it.each(['not-a-closeout-obligation', ''])(
    'rejects the %j obligation before either ledger is written',
    async (obligation) => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'closeout-cli-'));
      directories.push(projectRoot);
      const errors: string[] = [];

      const result = await dispatchCloseoutEventCommand({
        kind: 'closeout-event',
        obligation,
        startedAt: 100,
        endedAt: 140,
      }, projectRoot, () => 140, (message) => errors.push(message));

      expect({ result, errors }).toEqual({
        result: 1,
        errors: [
          'closeout-event: obligation must be one of evaluator, simplify, architecture-diagram, micro-retro, memory, summary',
        ],
      });
      await expect(readFile(join(projectRoot, '.pipeline/pipeline-events.jsonl'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(projectRoot, '.pipeline/events.jsonl'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
