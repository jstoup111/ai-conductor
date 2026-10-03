import { execa as execaCommand } from 'execa';

const GIT_BATCH_MAX_BUFFER = 32 * 1024 * 1024;

export type GitBlobBatchRunner = (
  file: string,
  args: readonly string[],
  options: {
    cwd: string;
    encoding: 'buffer';
    input: string;
    maxBuffer: number;
    stripFinalNewline: false;
  },
) => Promise<{ stdout: Uint8Array }>;

export interface ReadGitBlobsOptions {
  runner?: GitBlobBatchRunner;
  /** Output-byte cap per `cat-file --batch` call; requests over it are split. */
  maxBatchBytes?: number;
}

// Per-blob header (`<oid> blob <size>\n`) plus the trailing newline, padded for SHA-256 oids.
const BATCH_ENTRY_OVERHEAD = 96;

export async function readGitBlobs(
  projectRoot: string,
  revision: string,
  paths: readonly string[],
  options: ReadGitBlobsOptions = {},
): Promise<Map<string, Buffer>> {
  if (paths.length === 0) return new Map();

  const blobs = new Map<string, Buffer>();
  const batchPaths = paths.filter((path) => path.length > 0 && !path.includes('\n'));
  const individualPaths = paths.filter((path) => path.length === 0 || path.includes('\n'));

  if (batchPaths.length > 0) {
    const runner = options.runner ?? execaCommand;
    const maxBatchBytes = options.maxBatchBytes ?? GIT_BATCH_MAX_BUFFER;
    const runBatch = async (mode: '--batch' | '--batch-check', chunk: readonly string[], maxBuffer: number) =>
      Buffer.from((await runner('git', ['cat-file', mode, '--buffer'], {
        cwd: projectRoot,
        encoding: 'buffer',
        input: chunk.map((path) => `${revision}:${path}`).join('\n') + '\n',
        maxBuffer,
        stripFinalNewline: false,
      })).stdout);

    // Size every entry first so no single `--batch` read can outgrow its buffer:
    // one oversized response used to fail the whole read (and every caller with it).
    const checkLines = (await runBatch('--batch-check', batchPaths, GIT_BATCH_MAX_BUFFER))
      .toString('utf8')
      .split('\n');
    const chunks: { paths: string[]; bytes: number }[] = [];
    let current: { paths: string[]; bytes: number } = { paths: [], bytes: 0 };
    batchPaths.forEach((path, index) => {
      const header = (checkLines[index] ?? '').split(' ');
      const size = Number(header[2]);
      if (header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0) return;
      const cost = size + BATCH_ENTRY_OVERHEAD;
      if (current.paths.length > 0 && current.bytes + cost > maxBatchBytes) {
        chunks.push(current);
        current = { paths: [], bytes: 0 };
      }
      current.paths.push(path);
      current.bytes += cost;
    });
    if (current.paths.length > 0) chunks.push(current);

    for (const chunk of chunks) {
      const output = await runBatch('--batch', chunk.paths, Math.max(maxBatchBytes, chunk.bytes));
      let offset = 0;

      for (const path of chunk.paths) {
        const headerEnd = output.indexOf(0x0a, offset);
        if (headerEnd === -1) throw new Error('Incomplete git cat-file batch response');
        const header = output.subarray(offset, headerEnd).toString('ascii').split(' ');
        offset = headerEnd + 1;
        const size = Number(header[2]);
        if (!Number.isSafeInteger(size) || size < 0) continue;

        const contentEnd = offset + size;
        if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
          throw new Error('Incomplete git cat-file batch response');
        }
        if (header[1] === 'blob') blobs.set(path, output.subarray(offset, contentEnd));
        offset = contentEnd + 1;
      }
    }
  }

  for (const path of individualPaths) {
    const type = await execaCommand('git', ['cat-file', '-t', `${revision}:${path}`], {
      cwd: projectRoot,
      reject: false,
    });
    if (type.exitCode !== 0 || type.stdout !== 'blob') continue;
    const result = await execaCommand('git', ['show', `${revision}:${path}`], {
      cwd: projectRoot,
      encoding: 'buffer',
      stripFinalNewline: false,
      reject: false,
    });
    if (result.exitCode === 0) blobs.set(path, Buffer.from(result.stdout));
  }

  return blobs;
}
