import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { BuildReviewJudgedResultRejection } from './build-review-domain.js';

export const BUILD_REVIEW_REJECTION_DIRECTORY = '.pipeline/build-review-rejections';
export const BUILD_REVIEW_REJECTION_OUTPUT_LIMIT_BYTES = 1_048_576;

export interface BuildReviewRejectedResponseInput {
  readonly pipelineDir: string;
  readonly worktreeRoot: string;
  readonly lapId: string;
  readonly rubric: string;
  readonly rubricKind: 'builtin' | 'custom';
  readonly detail: string;
  readonly rejection?: BuildReviewJudgedResultRejection;
  readonly provider?: string;
  readonly model?: string;
  readonly structuredResult: unknown;
  readonly output?: string;
  readonly promptPath?: string;
  readonly promptSha256?: string;
  readonly regionComparison?: unknown;
}

export interface BuildReviewRejectedResponseRecord {
  readonly version: 1;
  readonly rubric: string;
  readonly rubricKind: 'builtin' | 'custom';
  readonly lapId: string;
  readonly attempt: number;
  readonly reason: 'invalid-structured-result';
  readonly detail: string;
  readonly rejection?: BuildReviewJudgedResultRejection;
  readonly provider?: string;
  readonly model?: string;
  readonly structuredResult: unknown;
  readonly output?: string;
  readonly outputBytes?: number;
  readonly outputTruncated?: boolean;
  readonly promptPath?: string;
  readonly promptSha256?: string;
  readonly regionComparison?: unknown;
}

function outputRecord(output: string): Pick<BuildReviewRejectedResponseRecord, 'output' | 'outputBytes' | 'outputTruncated'> {
  const bytes = Buffer.from(output, 'utf8');
  if (bytes.length <= BUILD_REVIEW_REJECTION_OUTPUT_LIMIT_BYTES) {
    return { output, outputBytes: bytes.length, outputTruncated: false };
  }
  let end = BUILD_REVIEW_REJECTION_OUTPUT_LIMIT_BYTES;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return { output: bytes.subarray(0, end).toString('utf8'), outputBytes: bytes.length, outputTruncated: true };
}

function nextAttempt(entries: readonly string[], rubric: string): number {
  const pattern = new RegExp(`^${rubric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)\\.json$`);
  return 1 + entries.reduce((highest, entry) => {
    const attempt = pattern.exec(entry)?.[1];
    return attempt === undefined ? highest : Math.max(highest, Number(attempt));
  }, 0);
}

/** Best-effort evidence retention for a response rejected by the rubric contract. */
export async function retainBuildReviewRejectedResponse(input: BuildReviewRejectedResponseInput): Promise<string | undefined> {
  try {
    const directory = join(input.pipelineDir, 'build-review-rejections', input.lapId);
    await mkdir(directory, { recursive: true });
    let attempt = nextAttempt(await readdir(directory), input.rubric);
    for (let retries = 0; retries < 8; retries += 1, attempt += 1) {
      const record: BuildReviewRejectedResponseRecord = {
        version: 1,
        rubric: input.rubric,
        rubricKind: input.rubricKind,
        lapId: input.lapId,
        attempt,
        reason: 'invalid-structured-result',
        detail: input.detail,
        ...(input.rejection === undefined ? {} : { rejection: input.rejection }),
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
        structuredResult: input.structuredResult,
        ...(input.output === undefined ? {} : outputRecord(input.output)),
        ...(input.promptPath === undefined ? {} : { promptPath: input.promptPath }),
        ...(input.promptSha256 === undefined ? {} : { promptSha256: input.promptSha256 }),
        ...(input.regionComparison === undefined ? {} : { regionComparison: input.regionComparison }),
      };
      const path = join(directory, `${input.rubric}.${attempt}.json`);
      try {
        await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
        return relative(input.worktreeRoot, path).split('\\').join('/');
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
