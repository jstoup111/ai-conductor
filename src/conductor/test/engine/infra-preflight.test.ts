import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInfraPreflight, PREFLIGHT_SCRIPT } from '../../src/engine/infra-preflight.js';

describe('engine/infra-preflight', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'infra-preflight-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeScript(body: string, mode = 0o755): Promise<void> {
    await mkdir(join(dir, 'bin'), { recursive: true });
    const path = join(dir, PREFLIGHT_SCRIPT);
    await writeFile(path, body, 'utf-8');
    await chmod(path, mode);
  }

  it('no-ops when the project ships no preflight script (opt-in)', async () => {
    // No bin/daemon-preflight at all → must resolve without throwing.
    await expect(runInfraPreflight(dir)).resolves.toBeUndefined();
  });

  it('runs bin/daemon-preflight in the worktree when present', async () => {
    // The script proves it ran AND that its cwd is the worktree by writing a
    // marker file relative to its working directory.
    await writeScript('#!/usr/bin/env bash\necho "infra up"\ntouch ran.marker\n');

    await runInfraPreflight(dir);

    const marker = await readFile(join(dir, 'ran.marker'), 'utf-8').then(
      () => true,
      () => false,
    );
    expect(marker).toBe(true);
  });

  it('passes the worktree path as cwd so the script can derive a namespace', async () => {
    // The script records its own $PWD; it must equal the worktree dir.
    await writeScript('#!/usr/bin/env bash\nbasename "$PWD" > ns.txt\n');

    await runInfraPreflight(dir);

    const ns = (await readFile(join(dir, 'ns.txt'), 'utf-8')).trim();
    expect(ns).toBe(dir.split('/').pop());
  });

  it('throws when the preflight script exits non-zero (do not build against broken infra)', async () => {
    await writeScript('#!/usr/bin/env bash\necho "pg not ready" >&2\nexit 7\n');

    await expect(runInfraPreflight(dir)).rejects.toThrow(/infra preflight/);
  });

  it('surfaces a present-but-non-executable script as an error, not a silent skip', async () => {
    // A script the user clearly intended to run but mis-permissioned should fail
    // loudly rather than be mistaken for "no infra".
    await writeScript('#!/usr/bin/env bash\nexit 0\n', 0o644);

    await expect(runInfraPreflight(dir)).rejects.toThrow(/infra preflight/);
  });

  it('forwards script output to the log sink', async () => {
    await writeScript('#!/usr/bin/env bash\necho "compose: started postgres"\n');
    const lines: string[] = [];

    await runInfraPreflight(dir, (m) => lines.push(m));

    expect(lines.some((l) => l.includes('compose: started postgres'))).toBe(true);
    expect(lines.some((l) => l.includes('ok'))).toBe(true);
  });
});
