// Covers: task:1
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  retainBuildReviewRejectedResponse,
} from '../../src/engine/build-review-rejection-retention.js';

describe('engine/build-review-rejection-retention', () => {
  it('keeps distinct attempts without overwriting the first rejected response', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-rejection-retention-'));
    try {
      const input = {
        pipelineDir: join(root, '.pipeline'),
        worktreeRoot: root,
        lapId: 'lap-a',
        rubric: 'eventSpine',
        rubricKind: 'builtin' as const,
        detail: 'The structured response is invalid.',
        rejection: {
          kind: 'explained' as const,
          problems: [{ field: 'findings', required: 'must be an array', detail: 'findings must be an array' }],
        },
        structuredResult: { findings: 'not-an-array' },
        output: 'Reviewer response',
      };

      const firstPath = await retainBuildReviewRejectedResponse(input);
      const firstBytes = await readFile(join(root, firstPath!));
      const secondPath = await retainBuildReviewRejectedResponse(input);

      expect({
        firstPath,
        secondPath,
        firstBytesUnchanged: (await readFile(join(root, firstPath!))).equals(firstBytes),
        first: JSON.parse(firstBytes.toString('utf8')),
        second: JSON.parse(await readFile(join(root, secondPath!), 'utf8')),
      }).toEqual({
        firstPath: '.pipeline/build-review-rejections/lap-a/eventSpine.1.json',
        secondPath: '.pipeline/build-review-rejections/lap-a/eventSpine.2.json',
        firstBytesUnchanged: true,
        first: {
          version: 1,
          rubric: 'eventSpine',
          rubricKind: 'builtin',
          lapId: 'lap-a',
          attempt: 1,
          reason: 'invalid-structured-result',
          detail: 'The structured response is invalid.',
          rejection: {
            kind: 'explained',
            problems: [{ field: 'findings', required: 'must be an array', detail: 'findings must be an array' }],
          },
          structuredResult: { findings: 'not-an-array' },
          output: 'Reviewer response',
          outputBytes: 17,
          outputTruncated: false,
        },
        second: {
          version: 1,
          rubric: 'eventSpine',
          rubricKind: 'builtin',
          lapId: 'lap-a',
          attempt: 2,
          reason: 'invalid-structured-result',
          detail: 'The structured response is invalid.',
          rejection: {
            kind: 'explained',
            problems: [{ field: 'findings', required: 'must be an array', detail: 'findings must be an array' }],
          },
          structuredResult: { findings: 'not-an-array' },
          output: 'Reviewer response',
          outputBytes: 17,
          outputTruncated: false,
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('caps output at a UTF-8 boundary while retaining the whole structured result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-rejection-retention-'));
    try {
      const output = `${'a'.repeat(1_048_575)}é`;
      const structuredResult = { payload: 's'.repeat(2 * 1_024 * 1_024) };
      const path = await retainBuildReviewRejectedResponse({
        pipelineDir: join(root, '.pipeline'),
        worktreeRoot: root,
        lapId: 'lap-a',
        rubric: 'eventSpine',
        rubricKind: 'custom',
        detail: 'The structured response is invalid.',
        structuredResult,
        output,
      });

      expect(JSON.parse(await readFile(join(root, path!), 'utf8'))).toMatchObject({
        output: 'a'.repeat(1_048_575),
        outputBytes: 1_048_577,
        outputTruncated: true,
        structuredResult,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns undefined when the retention directory is a regular file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-rejection-retention-'));
    try {
      const pipelineDir = join(root, '.pipeline');
      await mkdir(pipelineDir, { recursive: true });
      await writeFile(join(pipelineDir, 'build-review-rejections'), 'occupied');

      await expect(retainBuildReviewRejectedResponse({
        pipelineDir,
        worktreeRoot: root,
        lapId: 'lap-a',
        rubric: 'eventSpine',
        rubricKind: 'builtin',
        detail: 'The structured response is invalid.',
        structuredResult: null,
      })).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
