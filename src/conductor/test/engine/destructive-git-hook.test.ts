// Covers: task:1, task:2, task:7, task:8, task:9, task:10, task:14, task:rem-as-built-rem-as-built-adr-d8-quote-removal-1
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

  function invoke(command: string, stubs: Partial<Record<'git' | 'gh', string>> = {}): HookResult {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'destructive-git-hook-'));
    fixtureDirs.push(fixtureDir);
    const binDir = join(fixtureDir, 'bin');
    const markerPath = join(fixtureDir, 'git-or-gh-called');
    mkdirSync(binDir);

    for (const executable of ['git', 'gh'] as const) {
      const stubPath = join(binDir, executable);
      writeFileSync(stubPath, stubs[executable] ?? denyIfCalledStub(executable, markerPath), 'utf-8');
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

  function branchCheckStub(mergedBranch: string): string {
    return `#!/usr/bin/env bash
if [[ "$1" == "symbolic-ref" ]]; then exit 1; fi
if [[ "$1" == "rev-parse" ]]; then printf '%s\\n' main; exit 0; fi
if [[ "$1" == "merge-base" && "$3" == ${JSON.stringify(mergedBranch)} ]]; then exit 0; fi
exit 1
`;
  }

  it('drops every heredoc body on a multi-heredoc command but scans later commands', () => {
    const allowed = invoke("cat <<A <<'B'\ngit reset --hard\nA\ngit push --force\nB");
    expect(allowed.status).toBe(0);
    const refused = invoke("cat <<A <<'B'\nignored\nA\nignored\nB\ngit reset --hard");
    expect(refused.status).toBe(2);
  });

  it('does not mistake a quoted heredoc-looking literal for an opener', () => {
    const result = invoke("echo '<<EOF'\ngit reset --hard");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('git reset --hard');
  });

  it.each(["cat <<\\EOF", 'cat <<E"OF"'])('removes shell quoting from the %s heredoc delimiter', (opener) => {
    const allowed = invoke(`${opener}\ngit reset --hard\nEOF`);
    expect(allowed.status).toBe(0);

    const refused = invoke(`${opener}\ngit reset --hard\nEOF\ngit reset --hard`);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('git reset --hard');
  });

  it('does not treat a heredoc-looking comment as an opener', () => {
    const result = invoke('# <<EOF\ngit reset --hard');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('git reset --hard');
  });

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
    'allows a lease push followed by a non-push --force token across %s',
    (_name, separator) => {
      const result = invoke(`git push --force-with-lease origin a${separator}echo --force`);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.calledGitOrGh).toBe(false);
      expect(result.stderr).not.toMatch(/force.*push/i);
    },
  );

  it.each(separators)(
    'allows a non-push --force token followed by a lease push across %s',
    (_name, separator) => {
      const result = invoke(`echo --force${separator}git push --force-with-lease origin a`);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.calledGitOrGh).toBe(false);
      expect(result.stderr).not.toMatch(/force.*push/i);
    },
  );

  it.each(separators)(
    'allows quoted --force data beside a lease push across %s',
    (_name, separator) => {
      const result = invoke(`git push --force-with-lease origin a${separator}echo '--force'`);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.calledGitOrGh).toBe(false);
      expect(result.stderr).not.toMatch(/force.*push/i);
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

  it('still blocks a hard reset beside a lease push', () => {
    const result = invoke('git push --force-with-lease origin a && git reset --hard');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.calledGitOrGh).toBe(false);
    expect(result.stderr).toMatch(/git reset --hard is destructive and irreversible/i);
  });

  it('keeps the existing reminder for an ordinary rebase beside a lease push', () => {
    const result = invoke('git push --force-with-lease origin a && git rebase main');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.calledGitOrGh).toBe(false);
    expect(result.stderr).toMatch(/git rebase.*allowed.*rare/i);
  });

  it('does not remind for a rebase continuation beside a lease push', () => {
    const result = invoke('git push --force-with-lease origin a && git rebase --continue');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.calledGitOrGh).toBe(false);
    expect(result.stderr).not.toMatch(/git rebase.*allowed.*rare/i);
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

  it.each([
    "cat <<'EOF'\ngit reset --hard\ngit push --force\nEOF",
    'cat <<EOF\ngit reset --hard\ngit push --force\nEOF',
  ])('allows destructive text contained only in a heredoc: %s', (command) => {
    const result = invoke(command);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.calledGitOrGh).toBe(false);
  });

  it.each([
    "cat <<  'EOF'\ngit reset --hard\nEOF",
    'cat <<\t"EOF"\ngit reset --hard\nEOF',
    "cat <<-   'EOF'\ngit reset --hard\nEOF",
  ])('allows destructive text in a spaced quoted heredoc opener: %s', (command) => {
    const result = invoke(command);
    expect(result.status).toBe(0);
    expect(result.calledGitOrGh).toBe(false);
  });

  it.each([
    "cat <<  'EOF'\ngit reset --hard\nEOF\ngit reset --hard",
    'cat <<\t"EOF"\ngit reset --hard\nEOF\ngit reset --hard',
    "cat <<-   'EOF'\ngit reset --hard\nEOF\ngit reset --hard",
  ])('denies a real hard reset after a spaced quoted heredoc opener: %s', (command) => {
    const result = invoke(command);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/git reset --hard is destructive and irreversible/i);
  });

  it('denies a real hard reset after a heredoc body', () => {
    const result = invoke("cat <<'EOF'\ngit reset --hard\nEOF\ngit reset --hard");

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.calledGitOrGh).toBe(false);
    expect(result.stderr).toMatch(/git reset --hard is destructive and irreversible/i);
  });

  it.each([
    ['a here-string', 'cat <<< "harmless input"\ngit reset --hard'],
    ['an arithmetic left shift', ': $((1 << 2))\ngit reset --hard'],
    ['a multiline arithmetic left shift', ': $((1\n<< 2))\ngit reset --hard'],
  ])('denies a real hard reset after %s', (_syntax, command) => {
    const result = invoke(command);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.calledGitOrGh).toBe(false);
    expect(result.stderr).toMatch(/git reset --hard is destructive and irreversible/i);
  });

  it.each([
    ['git clean -f', /git clean -f permanently removes untracked files/i],
    ['git branch -D unmerged', /force-delete UNMERGED branch/i],
    ['git checkout -- .', /discards all unstaged changes/i],
  ])('continues to deny %s', (command, refusal) => {
    const result = invoke(command);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(refusal);
  });

  it.each([
    'git branch -df b',
    'git -C . branch --delete --force b',
  ])('routes normalized force-delete spelling through the unmerged branch check: %s', (command) => {
    const result = invoke(command, { git: branchCheckStub('m'), gh: '#!/usr/bin/env bash\nexit 0\n' });

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/force-delete UNMERGED branch\(es\): b/i);
  });

  it('allows a normalized force-delete spelling when the branch is merged', () => {
    const result = invoke('git branch -df m', { git: branchCheckStub('m'), gh: '#!/usr/bin/env bash\nexit 0\n' });

    expect(result.status).toBe(0);
  });

  it.each([
    ['git reset --bogus', '--bogus'],
    ['git push --forc origin main', '--forc'],
    ['git --unknown-global reset HEAD', '--unknown-global'],
  ])('refuses an unresolvable git option without invoking git or gh: %s', (command, option) => {
    const result = invoke(command);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(option);
    expect(result.stderr).toMatch(/spell the option in full/i);
    expect(result.calledGitOrGh).toBe(false);
  });

  it('refuses an unparseable git command without invoking git or gh', () => {
    const result = invoke('git reset "--hard');

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/git command could not be parsed/i);
    expect(result.calledGitOrGh).toBe(false);
  });

  it.each([
    'git status --bogus',
    'git --unknown-global status',
    'echo "unterminated',
  ])('allows unresolvable or unparseable text without a guarded git command: %s', (command) => {
    const result = invoke(command);

    expect(result.status).toBe(0);
    expect(result.calledGitOrGh).toBe(false);
  });

  it.each([
    ['git push --force origin main', '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Force push blocked by harness. Use --force-with-lease instead, or ask the user for explicit confirmation."}}\n'],
    ['git push -f', '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Force push blocked by harness. Use --force-with-lease instead, or ask the user for explicit confirmation."}}\n'],
    ['git reset --hard', 'BLOCKED: git reset --hard is destructive and irreversible. Investigate the issue or ask the user before discarding work.\n'],
    ['git branch -D unmerged', 'BLOCKED: git branch -D would force-delete UNMERGED branch(es): unmerged. Use -d for a safe delete, or ask the user. (Merged or squash/rebase-merged branches are allowed for cleanup.)\n'],
    ['git clean -f', 'BLOCKED: git clean -f permanently removes untracked files. Ask the user before cleaning.\n'],
    ['git checkout -- .', 'BLOCKED: This discards all unstaged changes. Ask the user before reverting.\n'],
    ['git restore .', 'BLOCKED: This discards all unstaged changes. Ask the user before reverting.\n'],
  ])('keeps the canonical refusal message for %s', (command, message) => {
    const result = invoke(command);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe(message);
  });

  it('keeps rebase continuation silent', () => {
    const result = invoke('git rebase --continue');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('keeps the ordinary rebase reminder', () => {
    const result = invoke('git rebase main');

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("NOTE: 'git rebase' is allowed");
  });

  it.each([
    'make build | git clean -fd',
    'git -C /tmp/x reset --hard',
    'git -C "my dir" reset --hard',
    'git -c a=b push --force',
    'git --config-env=a.b=C reset --hard',
    'git --git-dir=.git reset --hard',
    'git reset --har',
    'git clean -xdf',
    'git clean --fo',
    'git push origin +main',
    'cd repo && git -C . reset --hard',
    'make build; git clean -fd & wait',
    'GIT_TRACE=1 git reset --hard',
    'sudo git reset --hard',
    'xargs git clean -f',
    'cat <<\\EOF\nignored\nEOF\ngit reset --hard',
    'cat <<E"OF"\nignored\nEOF\ngit reset --hard',
    '# <<EOF\ngit reset --hard',
  ])('denies normalized destructive invocation: %s', (command) => {
    const result = invoke(command);
    expect(result.status).toBe(2);
    expect(result.calledGitOrGh).toBe(false);
  });

  it.each([
    'git commit -m "undo reset --hard"',
    "cat <<'EOF'\ngit reset --hard\nEOF",
    '# git reset --hard',
    'git push --force-with-lease origin main',
    'git -C . push --force-with origin main',
    'git status',
    'git -C . log --oneline',
    'git reset --soft HEAD~1',
  ])('allows non-destructive normalized invocation without git or gh calls: %s', (command) => {
    const result = invoke(command);
    expect(result.status).toBe(0);
    expect(result.calledGitOrGh).toBe(false);
  });
});
