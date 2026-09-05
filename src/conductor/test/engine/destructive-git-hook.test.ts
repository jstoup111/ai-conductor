// Covers: task:1
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '..', '..', '..', '..', 'hooks', 'claude', 'block-destructive-git.sh');

interface HookResult {
  status: number | null;
  stderr: string;
  calledGitOrGh: boolean;
  error: Error | undefined;
}

function denyIfCalledStub(name: 'git' | 'gh', markerPath: string): string {
  return `#!/usr/bin/env bash\nprintf '%s\\n' ${JSON.stringify(name)} >> ${JSON.stringify(markerPath)}\nexit 99\n`;
}

describe('block-destructive-git hook force-push protection', () => {
  const fixtureDirs: string[] = [];

  afterEach(() => {
    for (const fixtureDir of fixtureDirs.splice(0)) {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  function invoke(command: string): HookResult {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'destructive-git-hook-'));
    fixtureDirs.push(fixtureDir);
    const binDir = join(fixtureDir, 'bin');
    const markerPath = join(fixtureDir, 'git-or-gh-called');
    mkdirSync(binDir);

    for (const executable of ['git', 'gh'] as const) {
      const stubPath = join(binDir, executable);
      writeFileSync(stubPath, denyIfCalledStub(executable, markerPath), 'utf-8');
      chmodSync(stubPath, 0o755);
    }

    const result = spawnSync('bash', [HOOK_PATH], {
      cwd: fixtureDir,
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
      input: JSON.stringify({ tool_input: { command } }),
      timeout: 2_000,
    });

    return {
      status: result.status,
      stderr: result.stderr ?? '',
      calledGitOrGh: existsSync(markerPath),
      error: result.error,
    };
  }

  function expectForcePushDenied(command: string): void {
    const result = invoke(command);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.calledGitOrGh).toBe(false);

    const denial = JSON.parse(result.stderr) as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };
    expect(denial.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(denial.hookSpecificOutput?.permissionDecisionReason).toMatch(/force.*push/i);
  }

  const separators: Array<[string, string]> = [
    ['&&', ' && '],
    ['||', ' || '],
    ['semicolon', '; '],
    ['pipe', ' | '],
    ['ampersand', ' & '],
    ['newline', '\n'],
  ];

  it.each(separators)(
    'denies a bare --force after a lease push across %s',
    (_name, separator) => {
      expectForcePushDenied(
        `git push --force-with-lease origin a${separator}git push --force origin main`,
      );
    },
  );

  it.each(separators)(
    'denies a bare --force immediately before %s',
    (_name, separator) => {
      expectForcePushDenied(`git push origin main --force${separator}git status`);
    },
  );

  it.each(separators)(
    'denies a bare --force before a lease push across %s',
    (_name, separator) => {
      expectForcePushDenied(
        `git push --force origin main${separator}git push --force-with-lease origin a`,
      );
    },
  );

  it.each(separators)(
    'denies bare -f beside a lease push across %s',
    (_name, separator) => {
      expectForcePushDenied(
        `git push --force-with-lease origin a${separator}git push -f origin main`,
      );
    },
  );

  it.each(separators)(
    'denies bare -f before a lease push across %s',
    (_name, separator) => {
      expectForcePushDenied(
        `git push -f origin main${separator}git push --force-with-lease origin a`,
      );
    },
  );

  it('denies a bare --force alongside --force-with-lease in one push invocation', () => {
    expectForcePushDenied('git push --force-with-lease --force origin main');
  });

  it('denies bare -f alongside --force-with-lease in one push invocation', () => {
    expectForcePushDenied('git push --force-with-lease -f origin main');
  });

  it.each([
    'git push --force-with-lease origin a',
    'git push --force-with-lease=refs/heads/a:0123456789012345678901234567890123456789 origin a',
    'git push origin a',
    "echo 'git push --force origin main'",
    'git commit -m "git push --force origin main"',
  ])('allows safe or quoted command text: %s', (command) => {
    const result = invoke(command);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.calledGitOrGh).toBe(false);
    expect(result.stderr).not.toMatch(/force.*push/i);
  });
});
