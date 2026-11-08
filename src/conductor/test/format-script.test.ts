// Covers: task:2
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
