// Covers: task:9
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { buildCodexReadOnlyProducerRootPolicyArgs } from '../../src/engine/build-review-read-only-capability.js';

const available = (() => {
  try {
    execFileSync('which', ['codex'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!available)('Codex read-only review policy against the installed CLI grammar', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-read-only-policy-'));
  const worktree = join(root, 'worktree');
  const producerRoot = join(root, 'producer');
  mkdirSync(worktree);
  mkdirSync(producerRoot);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    ['with', producerRoot],
    ['without', undefined],
  ])('codex exec accepts the launch policy %s a producer root', (_case, root) => {
    const result = spawnSync('codex', [
      'exec', ...buildCodexReadOnlyProducerRootPolicyArgs(root, 'exec'), '--help',
    ], { encoding: 'utf8' });
    expect(result.stderr).not.toMatch(/unexpected argument/);
    expect(result.status).toBe(0);
  });

  it('codex sandbox grants only the producer-root write under the same profile', () => {
    const result = spawnSync('codex', [
      'sandbox', ...buildCodexReadOnlyProducerRootPolicyArgs(producerRoot, 'sandbox'), '--',
      '/bin/sh', '-c', 'printf x > "$1/ok"; printf x > "$2/bad"; exit 0', 'probe', producerRoot, worktree,
    ], { cwd: worktree, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(existsSync(join(producerRoot, 'ok'))).toBe(true);
    expect(existsSync(join(worktree, 'bad'))).toBe(false);
  });
});
