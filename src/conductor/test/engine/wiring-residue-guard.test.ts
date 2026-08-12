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
  it('keeps removed wiring-contract terminology out of production sources', async () => {
    const findings = await Promise.all((await productionTypeScriptFiles(sourceRoot)).map(async (path) => {
      const source = await readFile(path, 'utf8');
      return forbiddenReferences
        .filter((reference) => source.includes(reference))
        .map((reference) => `${path.slice(sourceRoot.length + 1)}: ${reference}`);
    }));

    expect(findings.flat()).toEqual([]);
  });
});
