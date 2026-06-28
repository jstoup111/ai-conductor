import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareWorktree,
  sanitizeNamespace,
  SETUP_SCRIPT,
  NAMESPACE_VAR,
} from '../../src/engine/worktree-prepare.js';

describe('engine/worktree-prepare', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wt-prepare-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSetup(body: string, mode = 0o755): Promise<void> {
    await mkdir(join(dir, 'bin'), { recursive: true });
    const path = join(dir, SETUP_SCRIPT);
    await writeFile(path, body, 'utf-8');
    await chmod(path, mode);
  }

  describe('sanitizeNamespace', () => {
    it('reduces a worktree dir name to a DB-safe token', () => {
      expect(sanitizeNamespace('2026-06-27-add-foo')).toBe('2026_06_27_add_foo');
      expect(sanitizeNamespace('plain_slug')).toBe('plain_slug');
    });
  });

  it('writes WORKTREE_NAMESPACE into the worktree .env (derived from the dir name)', async () => {
    await prepareWorktree(dir);
    const env = await readFile(join(dir, '.env'), 'utf-8');
    expect(env).toContain(`${NAMESPACE_VAR}=${sanitizeNamespace(dir.split('/').pop()!)}`);
  });

  it('preserves existing .env entries and replaces (not duplicates) the namespace line', async () => {
    await writeFile(
      join(dir, '.env'),
      `SECRET=keep-me\n${NAMESPACE_VAR}=stale\nOTHER=x\n`,
      'utf-8',
    );
    await prepareWorktree(dir);

    const env = await readFile(join(dir, '.env'), 'utf-8');
    expect(env).toContain('SECRET=keep-me');
    expect(env).toContain('OTHER=x');
    // exactly one namespace line, and not the stale value
    const nsLines = env.split('\n').filter((l) => l.startsWith(`${NAMESPACE_VAR}=`));
    expect(nsLines).toHaveLength(1);
    expect(nsLines[0]).not.toContain('stale');
  });

  it('no-ops the setup step when the project ships no bin/setup (still writes the namespace)', async () => {
    // No bin/setup → must resolve without throwing, and .env is still written.
    await expect(prepareWorktree(dir)).resolves.toBeUndefined();
    await readFile(join(dir, '.env'), 'utf-8'); // exists
  });

  it('runs bin/setup in the worktree with CI=true and WORKTREE_NAMESPACE exported', async () => {
    // The script records the env it saw + proves cwd is the worktree.
    await writeSetup(
      `#!/usr/bin/env bash\necho "CI=$CI ${NAMESPACE_VAR}=$${NAMESPACE_VAR}" > setup-saw.txt\ntouch ran.marker\n`,
    );

    await prepareWorktree(dir);

    const saw = await readFile(join(dir, 'setup-saw.txt'), 'utf-8');
    expect(saw).toContain('CI=true');
    expect(saw).toContain(`${NAMESPACE_VAR}=${sanitizeNamespace(dir.split('/').pop()!)}`);
    await readFile(join(dir, 'ran.marker'), 'utf-8'); // ran in the worktree cwd
  });

  it('throws when bin/setup exits non-zero (do not build against a half-prepared env)', async () => {
    await writeSetup('#!/usr/bin/env bash\necho "db down" >&2\nexit 3\n');
    await expect(prepareWorktree(dir)).rejects.toThrow(/bin\/setup/);
  });

  it('surfaces a present-but-non-executable bin/setup as an error, not a silent skip', async () => {
    await writeSetup('#!/usr/bin/env bash\nexit 0\n', 0o644);
    await expect(prepareWorktree(dir)).rejects.toThrow(/bin\/setup/);
  });

  it('forwards setup output to the log sink', async () => {
    await writeSetup('#!/usr/bin/env bash\necho "== Preparing database =="\n');
    const lines: string[] = [];
    await prepareWorktree(dir, (m) => lines.push(m));
    expect(lines.some((l) => l.includes('Preparing database'))).toBe(true);
    expect(lines.some((l) => l.includes('ok'))).toBe(true);
  });
});
