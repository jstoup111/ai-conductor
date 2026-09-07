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
}

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
    const { stdout } = await runner('git', ['cat-file', '--batch', '--buffer'], {
      cwd: projectRoot,
      encoding: 'buffer',
      input: batchPaths.map((path) => `${revision}:${path}`).join('\n') + '\n',
      maxBuffer: GIT_BATCH_MAX_BUFFER,
      stripFinalNewline: false,
    });
    const output = Buffer.from(stdout);
    let offset = 0;

    for (const path of batchPaths) {
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

  for (const path of individualPaths) {
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
