// Covers: task:2
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = join(__dirname, '..');
const REPOSITORY_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const FORMAT_SCRIPT = join(CONDUCTOR_ROOT, 'scripts', 'format.mjs');
const repositories: string[] = [];

function git(repository: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
}

function write(repository: string, path: string, content: string): void {
  const target = join(repository, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commit(repository: string, message: string): void {
  git(repository, 'add', '.');
  git(repository, 'commit', '-m', message);
}

function createRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), 'format-script-'));
  repositories.push(repository);
  git(repository, 'init', '-b', 'main');
  git(repository, 'config', 'user.email', 'format-test@example.com');
  git(repository, 'config', 'user.name', 'Format test');
  cpSync(join(REPOSITORY_ROOT, '.prettierrc.json'), join(repository, '.prettierrc.json'));
  cpSync(join(REPOSITORY_ROOT, '.prettierignore'), join(repository, '.prettierignore'));
  write(repository, 'README.md', '# fixture\n');
  commit(repository, 'base');
  git(repository, 'checkout', '-b', 'feature');
  return repository;
}

function format(repository: string, ...args: string[]) {
  return spawnSync(process.execPath, [FORMAT_SCRIPT, '--check', '--base', 'main', ...args], {
    cwd: repository,
    encoding: 'utf8',
  });
}

function runFormat(repository: string, ...args: string[]) {
  return spawnSync(process.execPath, [FORMAT_SCRIPT, ...args], { cwd: repository, encoding: 'utf8' });
}

afterEach(() => {
  while (repositories.length > 0) rmSync(repositories.pop()!, { recursive: true, force: true });
});

describe('format script check mode', () => {
  it('accepts a canonical changed TypeScript file', () => {
    const repository = createRepository();
    write(repository, 'src/conductor/src/a.ts', "export const a = 'canonical';\n");

    const result = format(repository);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('reports each non-canonical changed in-scope file', () => {
    const repository = createRepository();
    write(repository, 'src/conductor/src/a.ts', 'export const a="not canonical"\n');
    write(repository, 'test/x.sh', 'if true;then echo x;fi\n');
    write(repository, 'bin/tool', '#!/bin/bash\nif true;then echo x;fi\n');
    write(repository, 'plugins/p/index.ts', 'export const p="not canonical"\n');

    const result = format(repository);

    expect(result.status).toBe(1);
    for (const path of ['src/conductor/src/a.ts', 'test/x.sh', 'bin/tool', 'plugins/p/index.ts']) {
      expect(result.stdout).toContain(`not canonical: ${path}`);
    }
  });

  it('ignores changed Markdown, JSON, and YAML files', () => {
    const repository = createRepository();
    write(repository, 'README.md', '# altered\n');
    write(repository, 'data.json', '{"not":"canonical"}\n');
    write(repository, 'cfg.yml', 'answer:   no\n');

    const result = format(repository);

    expect(result.status).toBe(0);
    for (const path of ['README.md', 'data.json', 'cfg.yml']) expect(result.stdout).not.toContain(path);
  });

  it('ignores files covered by .prettierignore', () => {
    const repository = createRepository();
    write(repository, 'src/conductor/test/fixtures/f.ts', 'export const f="not canonical"\n');

    const result = format(repository);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('src/conductor/test/fixtures/f.ts');
  });
});

describe('format script base resolution', () => {
  it('does not inspect unchanged or deleted files', () => {
    const repository = createRepository();
    git(repository, 'checkout', 'main');
    write(repository, 'src/conductor/src/old.ts', 'export const old="not canonical"\n');
    write(repository, 'src/conductor/src/deleted.ts', 'export const deleted="not canonical"\n');
    commit(repository, 'old files');
    git(repository, 'checkout', 'feature');
    git(repository, 'merge', '--no-ff', 'main', '-m', 'merge main');
    git(repository, 'rm', 'src/conductor/src/deleted.ts');
    write(repository, 'src/conductor/src/a.ts', "export const a = 'canonical';\n");

    const result = format(repository);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('old.ts');
    expect(result.stdout).not.toContain('deleted.ts');
  });

  it('uses the merge-base when main advances after the branch point', () => {
    const repository = createRepository();
    write(repository, 'src/conductor/src/mine.ts', 'export const mine="not canonical"\n');
    commit(repository, 'branch change');
    git(repository, 'checkout', 'main');
    write(repository, 'src/conductor/src/later.ts', 'export const later="not canonical"\n');
    commit(repository, 'main change');
    git(repository, 'checkout', 'feature');
    git(repository, 'merge', '--no-ff', 'main', '-m', 'merge main');

    const result = format(repository);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('not canonical: src/conductor/src/mine.ts');
    expect(result.stdout).not.toContain('later.ts');
  });

  it('honors an explicit base reference and succeeds for an empty changed set', () => {
    const repository = createRepository();
    write(repository, 'src/conductor/src/first.ts', 'export const first="not canonical"\n');
    commit(repository, 'first');
    const first = git(repository, 'rev-parse', 'HEAD').trim();
    write(repository, 'src/conductor/src/second.ts', 'export const second="not canonical"\n');
    commit(repository, 'second');

    const changed = runFormat(repository, '--check', '--base', first);
    expect(changed.status).toBe(1);
    expect(changed.stdout).toContain('second.ts');
    expect(changed.stdout).not.toContain('first.ts');

    const clean = createRepository();
    expect(format(clean).status).toBe(0);
    expect(format(clean).stdout).not.toContain('not canonical');
  });
});

describe('format script errors', () => {
  it('reports syntax errors without treating them as canonical', () => {
    const repository = createRepository();
    write(repository, 'src/conductor/src/bad.ts', 'const = ;\n');

    const result = format(repository);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('syntax error: src/conductor/src/bad.ts:');
  });

  it('fails before reading files when its base cannot be resolved', () => {
    const repository = createRepository();
    write(repository, 'src/conductor/src/a.ts', 'export const a="not canonical"\n');

    const implicit = runFormat(repository, '--check');
    expect(implicit.status).toBe(1);
    expect(implicit.stderr).toContain('format: cannot resolve base reference "origin/main"');
    expect(implicit.stdout).toBe('');

    const explicit = runFormat(repository, '--check', '--base', 'no-such-ref');
    expect(explicit.status).toBe(1);
    expect(explicit.stderr).toContain('format: cannot resolve base reference "no-such-ref"');
  });
});

describe('format script write mode', () => {
  it('formats every parseable in-scope tracked file with --all', () => {
    const repository = createRepository();
    write(
      repository,
      'src/conductor/src/a.ts',
      'export function greeting() {\r\n    const message="not canonical"\r\n    return buildGreeting(message, "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen")\r\n}\r\n',
    );
    write(repository, 'test/x.sh', "if true;then\r\n    echo 'not canonical'\r\nfi\r\n");
    git(repository, 'add', '.');
    commit(repository, 'non-canonical in-scope files');

    expect(runFormat(repository, '--write', '--all').status).toBe(0);

    const typescript = readFileSync(join(repository, 'src/conductor/src/a.ts'), 'utf8');
    const shell = readFileSync(join(repository, 'test/x.sh'), 'utf8');
    for (const content of [typescript, shell]) {
      expect(content).not.toContain('\r');
      expect(content.split('\n').every((line) => line.length <= 120)).toBe(true);
      expect(content).not.toMatch(/"[^"\n]*"/);
      expect(content).toContain("'");
      expect(content).toContain(';');
      expect(content).toMatch(/\n {2}\S/);
    }
    expect(shell).toContain('if true; then');
    expect(runFormat(repository, '--check', '--all').status).toBe(0);
  });

  it('rewrites changed files, leaves untouched files alone, and is idempotent', () => {
    const repository = createRepository();
    git(repository, 'checkout', 'main');
    write(repository, 'src/conductor/src/untouched.ts', 'export const untouched="not canonical"\n');
    commit(repository, 'untouched file');
    git(repository, 'checkout', 'feature');
    git(repository, 'merge', '--no-ff', 'main', '-m', 'merge main');
    const untouched = readFileSync(join(repository, 'src/conductor/src/untouched.ts'), 'utf8');
    write(repository, 'src/conductor/src/a.ts', 'export const a="not canonical"\n');
    write(repository, 'test/x.sh', 'if true;then echo x;fi\n');

    expect(runFormat(repository, '--write', '--base', 'main').status).toBe(0);
    expect(format(repository).status).toBe(0);
    expect(readFileSync(join(repository, 'src/conductor/src/untouched.ts'), 'utf8')).toBe(untouched);
    const first = readFileSync(join(repository, 'src/conductor/src/a.ts'), 'utf8');
    expect(first).toContain("'not canonical'");
    expect(first).toContain(';');
    expect(runFormat(repository, '--write', '--base', 'main').status).toBe(0);
    expect(readFileSync(join(repository, 'src/conductor/src/a.ts'), 'utf8')).toBe(first);
  });

  it('formats all in-scope files but never rewrites ignored or unsafe files', () => {
    const repository = createRepository();
    write(repository, 'src/conductor/src/a.ts', 'export const a="not canonical"\n');
    write(repository, 'src/conductor/src/bad.ts', 'const = ;\n');
    write(repository, 'src/conductor/test/fixtures/f.ts', 'export const f="not canonical"\n');
    write(repository, 'README.md', '# not canonical\n');
    git(repository, 'add', '.');
    const ignored = readFileSync(join(repository, 'src/conductor/test/fixtures/f.ts'), 'utf8');
    const readme = readFileSync(join(repository, 'README.md'), 'utf8');

    const result = runFormat(repository, '--write', '--all');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('syntax error: src/conductor/src/bad.ts:');
    expect(readFileSync(join(repository, 'src/conductor/src/bad.ts'), 'utf8')).toBe('const = ;\n');
    expect(readFileSync(join(repository, 'src/conductor/test/fixtures/f.ts'), 'utf8')).toBe(ignored);
    expect(readFileSync(join(repository, 'README.md'), 'utf8')).toBe(readme);
    expect(runFormat(repository, '--check', '--all').status).toBe(1);
  });
});
