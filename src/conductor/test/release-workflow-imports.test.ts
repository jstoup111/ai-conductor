import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(CONDUCTOR_ROOT, '..', '..');

export type WorkflowImport = {
  names: string[];
  specifier: string;
};

const workflowImportPattern = /const\s*{\s*([^}]+?)\s*}\s*=\s*await import\(`\$\{process\.env\.GITHUB_WORKSPACE}\/(src\/conductor\/dist\/[^`]+\.js)`\);/g;

export function extractBuiltWorkflowImports(source: string): WorkflowImport[] {
  return [...source.matchAll(workflowImportPattern)].map((match) => ({
    names: match[1].split(',').map((name) => name.trim()).filter(Boolean),
    specifier: match[2],
  }));
}

export function assertWorkflowImportsResolve(
  workflowFile: string,
  imports: readonly WorkflowImport[],
  entryExports: ReadonlyMap<string, readonly string[]>,
): void {
  for (const imported of imports) {
    const exported = entryExports.get(imported.specifier);
    if (!exported) {
      throw new Error(`${workflowFile}: ${imported.specifier} is not a bundler entry`);
    }
    for (const name of imported.names) {
      if (!exported.includes(name)) {
        throw new Error(`${workflowFile}: ${imported.specifier} does not export ${name}`);
      }
    }
  }
}

async function bundledEntryExports(): Promise<Map<string, string[]>> {
  const config = await readFile(resolve(CONDUCTOR_ROOT, 'tsup.config.ts'), 'utf8');
  const entries = [...config.matchAll(/'([^']+\.ts)'/g)].map((match) => match[1]);
  const result = new Map<string, string[]>();

  for (const entry of entries) {
    const source = await readFile(resolve(CONDUCTOR_ROOT, entry), 'utf8');
    const names = [...source.matchAll(/export\s*{\s*([^}]+)\s*}/g)]
      .flatMap((match) => match[1].split(','))
      .map((name) => name.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);
    result.set(
      `src/conductor/dist/${entry.replace(/^src\//, '').replace(/\.ts$/, '.js')}`,
      names,
    );
  }
  return result;
}

describe('release workflow imports', () => {
  const workflowFiles = [
    '.github/workflows/release-metadata.yml',
    '.github/workflows/release-pr.yml',
    '.github/workflows/release.yml',
  ];

  it('resolves every built-output import to its bundler entry exports', async () => {
    const entryExports = await bundledEntryExports();

    for (const workflowFile of workflowFiles) {
      const source = await readFile(resolve(REPO_ROOT, workflowFile), 'utf8');
      const imports = extractBuiltWorkflowImports(source);
      expect(imports, `${workflowFile} must import a built entry`).not.toEqual([]);
      assertWorkflowImportsResolve(workflowFile, imports, entryExports);
      expect(imports.map((item) => item.specifier)).not.toContain('src/conductor/dist/index.js');
    }
  });

  it('names the workflow and export when a workflow requests a missing name', () => {
    expect(() => assertWorkflowImportsResolve(
      'synthetic-release.yml',
      [{ specifier: 'src/conductor/dist/engine/self-host/release-actions.js', names: ['missingAction'] }],
      new Map([['src/conductor/dist/engine/self-host/release-actions.js', ['realAction']]]),
    )).toThrow(/synthetic-release\.yml[\s\S]*missingAction/);
  });
});
