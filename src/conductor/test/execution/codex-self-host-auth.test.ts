import { describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copySelectedCodexLogin } from '../../src/execution/codex-self-host-auth.js';

describe('copySelectedCodexLogin', () => {
  it('copies exactly the selected native auth artifact opaquely with restrictive mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-auth-'));
    const source = join(root, 'live-auth.json');
    const home = join(root, 'isolated');
    await writeFile(source, 'CANARY_SECRET_OPAQUE_CREDENTIAL');
    await chmod(source, 0o644);
    try {
      const destination = await copySelectedCodexLogin({ source, homeDir: home });
      expect(destination).toBe(join(home, 'auth.json'));
      expect(await readFile(destination, 'utf8')).toBe('CANARY_SECRET_OPAQUE_CREDENTIAL');
      expect((await stat(destination)).mode & 0o777).toBe(0o600);
      expect(await readFile(source, 'utf8')).toBe('CANARY_SECRET_OPAQUE_CREDENTIAL');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
