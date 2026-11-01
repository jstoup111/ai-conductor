// Covers: task:1
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HANDOFF_FILE = 'finish-pr-prose.json';

async function loadHandoff() {
  return import('../../src/engine/finish-pr-prose-handoff.js');
}

describe('FINISH PR-prose handoff', () => {
  let projectRoot: string;
  let pipelineDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'finish-pr-prose-handoff-'));
    pipelineDir = join(projectRoot, '.pipeline');
    await mkdir(pipelineDir);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeHandoff(value: unknown): Promise<void> {
    await writeFile(join(pipelineDir, HANDOFF_FILE), JSON.stringify(value));
  }

  it('returns not_returned when no handoff was written', async () => {
    const { readPrProseHandoff } = await loadHandoff();

    await expect(readPrProseHandoff(pipelineDir)).resolves.toEqual({ kind: 'not_returned' });
  });

  it('rejects unparsable JSON', async () => {
    await writeFile(join(pipelineDir, HANDOFF_FILE), '{not json');
    const { readPrProseHandoff } = await loadHandoff();

    await expect(readPrProseHandoff(pipelineDir)).resolves.toEqual({
      kind: 'invalid',
      detail: expect.stringContaining('handoff could not be parsed'),
    });
  });

  it.each([
    ['version', { version: 2, title: 'Title', body: 'Body' }],
    ['title', { version: 1, body: 'Body' }],
    ['body', { version: 1, title: 'Title' }],
    ['title', { version: 1, title: 42, body: 'Body' }],
    ['body', { version: 1, title: 'Title', body: 42 }],
    ['title', { version: 1, title: ' \t ', body: 'Body' }],
    ['body', { version: 1, title: 'Title', body: ' \n ' }],
  ])('rejects an invalid %s field', async (field, handoff) => {
    await writeHandoff(handoff);
    const { readPrProseHandoff } = await loadHandoff();

    await expect(readPrProseHandoff(pipelineDir)).resolves.toEqual({
      kind: 'invalid',
      detail: expect.stringContaining(field),
    });
  });

  it('returns a trimmed title and preserves the body bytes', async () => {
    const body = 'First line.  \n\nSecond line.\n';
    await writeHandoff({ version: 1, title: '  A reader-facing title  ', body });
    const { PR_PROSE_HANDOFF_PATH, readPrProseHandoff } = await loadHandoff();

    expect(PR_PROSE_HANDOFF_PATH).toBe('.pipeline/finish-pr-prose.json');
    await expect(readPrProseHandoff(pipelineDir)).resolves.toEqual({
      kind: 'returned',
      prose: { title: 'A reader-facing title', body },
    });
  });

  it('clears an existing handoff and ignores an absent handoff', async () => {
    await writeHandoff({ version: 1, title: 'Title', body: 'Body' });
    const { clearPrProseHandoff } = await loadHandoff();

    await clearPrProseHandoff(pipelineDir);
    await expect(access(join(pipelineDir, HANDOFF_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(clearPrProseHandoff(pipelineDir)).resolves.toBeUndefined();
  });
});
