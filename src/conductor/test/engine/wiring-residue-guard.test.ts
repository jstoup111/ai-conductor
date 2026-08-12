import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../src');
const forbiddenReferences = [
  'Wired-into',
  'wiredInto',
  'orphanBackstop',
  'checkExportReachability',
  'evaluatePlanWiringDisposition',
  'WiringEvidence',
  'wiringProbe',
  'Layer 2',
  'wiring-reachability gaps found',
  "sourceGate === 'wiring_check'",
];

function occurrenceCount(source: string, reference: string): number {
  return source.split(reference).length - 1;
}

function withoutRetiredMetadataCompatibilityBlock(path: string, source: string): string {
  if (path !== 'engine/plan-task-parse.ts') return source;

  const lines = source.split('\n');
  const declarationIndexes = lines.flatMap((line, index) => (
    /^\s*const RETIRED_WIRED_INTO_METADATA_LINE\s*=\s*\/.*\\\*\\\*Wired-into.*\/i;\s*$/.test(line)
      ? [index]
      : []
  ));
  if (declarationIndexes.length !== 1) return source;

  const declarationIndex = declarationIndexes[0];
  const compatibilityBlock = lines.slice(declarationIndex - 3, declarationIndex + 1);
  const compatibilitySource = compatibilityBlock.join('\n');
  if (
    compatibilityBlock.length !== 4
    || !/^\s*\/\/ Retired \*\*Wired-into:\*\* metadata must remain excluded from legacy fallback\s*$/.test(compatibilityBlock[0])
    || !compatibilityBlock.slice(1, 3).every((line) => (
      /^\s*\/\//.test(line) && occurrenceCount(line, 'Wired-into') === 0
    ))
    || occurrenceCount(compatibilitySource, 'Wired-into') !== 2
    || forbiddenReferences.some((reference) => (
      reference !== 'Wired-into' && occurrenceCount(compatibilitySource, reference) > 0
    ))
  ) return source;

  lines.splice(declarationIndex - 3, 4);
  return lines.join('\n');
}

async function productionTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

describe('wiring residue guard', () => {
  it('permits only the exact retired plan metadata compatibility block in production sources', async () => {
    const findings = await Promise.all((await productionTypeScriptFiles(sourceRoot)).map(async (path) => {
      const source = await readFile(path, 'utf8');
      const relativePath = path.slice(sourceRoot.length + 1);
      const guardedSource = withoutRetiredMetadataCompatibilityBlock(relativePath, source);
      return forbiddenReferences.flatMap((reference) => (
        Array.from(
          { length: occurrenceCount(guardedSource, reference) },
          () => `${relativePath}: ${reference}`,
        )
      ));
    }));

    expect(findings.flat()).toEqual([]);
  });
});
