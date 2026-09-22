import { copyFile, chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface CodexSelfHostAuthFs {
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

const realCodexSelfHostAuthFs: CodexSelfHostAuthFs = {
  // fs.mkdir resolves to the first created path; the seam only needs completion.
  mkdir: (path, options) => mkdir(path, options).then(() => undefined),
  copyFile,
  chmod,
};

/** Copy the selected native Codex login as opaque bytes into a throwaway home. */
export async function copySelectedCodexLogin(args: {
  source: string;
  homeDir: string;
  fs?: CodexSelfHostAuthFs;
}): Promise<string> {
  const fs = args.fs ?? realCodexSelfHostAuthFs;
  const destination = join(args.homeDir, 'auth.json');
  await fs.mkdir(args.homeDir, { recursive: true });
  await fs.copyFile(args.source, destination);
  await fs.chmod(destination, 0o600);
  return destination;
}
