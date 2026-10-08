// Covers: task:2, task:12
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buildRetryHint } from '../../src/engine/remediation-hints.js';
import { findResumeIndex } from '../../src/engine/resume-entry.js';
import { recordActivePlanPath } from '../../src/engine/artifact-approvals.js';
import { toSpotAuditVerifierResult } from '../../src/engine/step-runner-types.js';
import * as conductor from '../../src/engine/conductor.js';

interface ExportSurface {
  exports: string[];
  nonExportedAtBase: string[];
}

const CONDUCTOR_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CONDUCTOR_SOURCE = join(CONDUCTOR_ROOT, 'src/engine/conductor.ts');
const inventory = JSON.parse(
  await readFile(new URL('./conductor-exports.json', import.meta.url), 'utf8'),
) as ExportSurface;

export function diffExportSurface(expected: readonly string[], actual: readonly string[]): {
  missing: string[];
  extra: string[];
} {
  const actualNames = new Set(actual);
  const expectedNames = new Set(expected);
  return {
    missing: [...expectedNames].filter((name) => !actualNames.has(name)).sort(),
    extra: [...actualNames].filter((name) => !expectedNames.has(name)).sort(),
  };
}

function checkerExports(): string[] {
  const config = ts.readConfigFile(join(CONDUCTOR_ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, CONDUCTOR_ROOT);
  const program = ts.createProgram({ rootNames: [CONDUCTOR_SOURCE], options: parsed.options });
  const source = program.getSourceFile(CONDUCTOR_SOURCE);
  const module = source && program.getTypeChecker().getSymbolAtLocation(source);
  if (!module) throw new Error('conductor.ts module not found');
  return program.getTypeChecker().getExportsOfModule(module).map((symbol) => symbol.name).sort();
}

describe('conductor.js export surface', () => {
  it('reports a dropped export', () => {
    expect(diffExportSurface(['X'], [])).toEqual({ missing: ['X'], extra: [] });
  });

  it('reports an added export', () => {
    expect(diffExportSurface([], ['Y'])).toEqual({ missing: [], extra: ['Y'] });
  });

  it('matches the checker-resolved export inventory', () => {
    expect(diffExportSurface(inventory.exports, checkerExports())).toEqual({ missing: [], extra: [] });
  });

  it('does not expose base-private module declarations', () => {
    const exports = new Set(checkerExports());
    expect(inventory.nonExportedAtBase.filter((name) => exports.has(name))).toEqual([]);
  });

  it('re-exports moved values with their original object identities', async () => {
    expect(conductor.buildRetryHint).toBe(buildRetryHint);
    expect(conductor.findResumeIndex).toBe(findResumeIndex);
    expect(conductor.recordActivePlanPath).toBe(recordActivePlanPath);

    const dynamicallyImportedConductor = await import('../../src/engine/conductor.js');
    expect(dynamicallyImportedConductor.toSpotAuditVerifierResult).toBe(toSpotAuditVerifierResult);
  });
});
