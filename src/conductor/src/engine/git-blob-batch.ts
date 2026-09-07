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

  const runner = options.runner ?? execaCommand;
  const { stdout } = await runner('git', ['cat-file', '--batch', '--buffer'], {
    cwd: projectRoot,
    encoding: 'buffer',
    input: paths.map((path) => `${revision}:${path}`).join('\n') + '\n',
    maxBuffer: GIT_BATCH_MAX_BUFFER,
    stripFinalNewline: false,
  });
  const output = Buffer.from(stdout);
  const blobs = new Map<string, Buffer>();
  let offset = 0;

  for (const path of paths) {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = Buffer.from(output.subarray(offset, headerEnd)).toString('ascii').split(' ');
    const size = Number(header[2]);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;

    blobs.set(path, output.subarray(contentStart, contentEnd) as Buffer);
    offset = contentEnd + 1;
  }

  return blobs;
}
