import { posix } from 'node:path';

import type { BoundaryEntry } from './boundary-registry.js';

export type BoundaryContractViolation =
  | { readonly boundary: string; readonly rule: 'ported-without-contract' }
  | { readonly boundary: string; readonly rule: 'missing-leg' | 'unregistered-adapter'; readonly adapter: string }
  | { readonly boundary: string; readonly rule: 'missing-file' | 'fake-leg-is-smoke' | 'real-leg-not-smoke' | 'missing-capability'; readonly path: string }
  | { readonly boundary: string; readonly rule: 'missing-contract-import'; readonly path: string; readonly module: string };

function importsModule(source: string, importer: string, module: string): boolean {
  const modulePath = posix.resolve('/', module);
  const importPattern = /\bimport\s*(?:[^'\"]*?\s+from\s*)?['\"]([^'\"]+)['\"]/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier === module) return true;
    if (!specifier.startsWith('.')) continue;

    const resolved = posix.resolve('/', posix.dirname(importer), specifier)
      .replace(/\.js$/, '.ts');
    if (resolved === modulePath) return true;
  }

  return false;
}

export function checkBoundaryContractObligations(
  registry: Readonly<Record<string, BoundaryEntry>>,
  files: ReadonlyMap<string, string>,
): BoundaryContractViolation[] {
  const violations: BoundaryContractViolation[] = [];

  for (const entry of Object.values(registry)) {
    const contractRequired = entry.status.kind === 'ported';
    const contractActive = contractRequired || entry.contract !== null;
    if (!contractActive) continue;

    if (entry.contract === null) {
      violations.push({ boundary: entry.name, rule: 'ported-without-contract' });
      continue;
    }

    const { contract } = entry;
    for (const adapter of entry.adapterModules) {
      if (!contract.legs.some((leg) => leg.adapter === adapter)) {
        violations.push({ boundary: entry.name, rule: 'missing-leg', adapter });
      }
    }

    for (const leg of contract.legs) {
      if (!entry.adapterModules.includes(leg.adapter)) {
        violations.push({ boundary: entry.name, rule: 'unregistered-adapter', adapter: leg.adapter });
      }

      for (const path of [leg.fake, leg.fakeLeg, leg.realLeg, contract.module]) {
        if (!files.has(path)) {
          violations.push({ boundary: entry.name, rule: 'missing-file', path });
        }
      }

      if (leg.fakeLeg.endsWith('.smoke.test.ts')) {
        violations.push({ boundary: entry.name, rule: 'fake-leg-is-smoke', path: leg.fakeLeg });
      }
      if (!leg.realLeg.endsWith('.smoke.test.ts')) {
        violations.push({ boundary: entry.name, rule: 'real-leg-not-smoke', path: leg.realLeg });
      }

      const realLegSource = files.get(leg.realLeg);
      if (realLegSource !== undefined && !realLegSource.includes('smokeCapability')) {
        violations.push({ boundary: entry.name, rule: 'missing-capability', path: leg.realLeg });
      }

      for (const path of [leg.fakeLeg, leg.realLeg]) {
        const source = files.get(path);
        if (source !== undefined && !importsModule(source, path, contract.module)) {
          violations.push({
            boundary: entry.name,
            rule: 'missing-contract-import',
            path,
            module: contract.module,
          });
        }
      }
    }
  }

  return violations;
}
