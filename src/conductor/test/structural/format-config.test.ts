// Covers: task:1
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = join(__dirname, '..', '..');
const REPOSITORY_ROOT = join(CONDUCTOR_ROOT, '..', '..');

type Dependencies = Record<string, string | undefined>;

export function assertExactFormatterPin(dependencies: Dependencies, name: string): void {
  const version = dependencies[name];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`formatter dependency ${name} is not exact-pinned: ${version ?? '<missing>'}`);
  }
}

function packageJson(): { devDependencies: Dependencies } {
  return JSON.parse(readFileSync(join(CONDUCTOR_ROOT, 'package.json'), 'utf8')) as {
    devDependencies: Dependencies;
  };
}

function packageLock(): { packages: Record<string, { devDependencies?: Dependencies }> } {
  return JSON.parse(readFileSync(join(CONDUCTOR_ROOT, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { devDependencies?: Dependencies }>;
  };
}

describe('structural: format configuration', () => {
  it('exact-pins the formatter dependencies in the manifest and lockfile', () => {
    const dependencies = packageJson().devDependencies;
    const lockedDependencies = packageLock().packages[''].devDependencies ?? {};

    expect(dependencies.prettier).toBe('3.9.10');
    expect(dependencies['prettier-plugin-sh']).toBe('0.20.2');
    assertExactFormatterPin(dependencies, 'prettier');
    assertExactFormatterPin(dependencies, 'prettier-plugin-sh');
    expect(lockedDependencies.prettier).toBe('3.9.10');
    expect(lockedDependencies['prettier-plugin-sh']).toBe('0.20.2');
  });

  it.each([
    ['prettier', { prettier: '^3.9.10' }],
    ['prettier', { prettier: '~3.9.10' }],
    ['prettier-plugin-sh', { 'prettier-plugin-sh': '^0.20.2' }],
    ['prettier-plugin-sh', { 'prettier-plugin-sh': '~0.20.2' }],
  ] as const)('rejects a ranged %s dependency', (name, dependencies) => {
    expect(() => assertExactFormatterPin(dependencies, name)).toThrow(
      `formatter dependency ${name} is not exact-pinned`,
    );
  });

  it('declares the canonical formatter and editor settings', () => {
    const prettier = JSON.parse(readFileSync(join(REPOSITORY_ROOT, '.prettierrc.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const editorconfig = readFileSync(join(REPOSITORY_ROOT, '.editorconfig'), 'utf8');
    const prettierignore = readFileSync(join(REPOSITORY_ROOT, '.prettierignore'), 'utf8');

    expect(prettier).toMatchObject({
      printWidth: 120,
      tabWidth: 2,
      useTabs: false,
      singleQuote: true,
      semi: true,
      trailingComma: 'all',
      endOfLine: 'lf',
      spaceRedirects: false,
    });
    expect(prettier).not.toHaveProperty('plugins');
    expect(editorconfig).toMatch(/\[\*\.\{ts,mts,sh\}\]/);
    expect(editorconfig).toMatch(/indent_style = space/);
    expect(editorconfig).toMatch(/indent_size = 2/);
    expect(editorconfig).toMatch(/end_of_line = lf/);
    expect(editorconfig).toMatch(/insert_final_newline = true/);
    for (const ignoredPath of [
      'src/conductor/test/fixtures/',
      'src/conductor/test/types/fixtures/',
      'test/fixtures/',
      'examples/fixtures/',
      'node_modules/',
      'src/conductor/dist*/',
      '*.md',
      '*.json',
      '*.yml',
      '*.yaml',
    ]) {
      expect(prettierignore).toContain(ignoredPath);
    }
  });
});
