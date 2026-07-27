import { copyFile, chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Copy the selected native Codex login as opaque bytes into a throwaway home. */
export async function copySelectedCodexLogin(args: {
  source: string;
  homeDir: string;
}): Promise<string> {
  const destination = join(args.homeDir, 'auth.json');
  await mkdir(args.homeDir, { recursive: true });
  await copyFile(args.source, destination);
  await chmod(destination, 0o600);
  return destination;
}
