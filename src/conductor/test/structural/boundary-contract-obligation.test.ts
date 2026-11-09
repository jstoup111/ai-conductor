// Covers: task:3
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  checkBoundaryContractObligations,
  type BoundaryContractViolation,
} from './boundary-contract-obligation.js';
import { BOUNDARY_REGISTRY, type BoundaryEntry } from './boundary-registry.js';

const CONDUCTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const adapter = 'execution/provider.ts';
const contractModule = 'test/contracts/provider.contract.ts';
const fake = 'test/fixtures/provider-fake.ts';
const fakeLeg = 'test/contracts/provider.contract.test.ts';
const realLeg = 'test/contracts/provider-provider.contract.smoke.test.ts';

function boundary(
  overrides: Partial<BoundaryEntry> = {},
): BoundaryEntry {
  return {
    name: 'llm',
    port: 'Provider',
    adapterModules: [adapter],
    specifiers: [],
    clockCalls: [],
    commandLiterals: [],
    contract: {
      module: contractModule,
      legs: [{ adapter, fake, fakeLeg, realLeg }],
    },
    status: { kind: 'ported' },
    ...overrides,
  };
}

function registry(entry: BoundaryEntry): Readonly<Record<string, BoundaryEntry>> {
  return { [entry.name]: entry };
}

function completeFiles(): ReadonlyMap<string, string> {
  return new Map([
    [adapter, 'export const provider = {};'],
    [contractModule, 'export const contract = {};'],
    [fake, 'export const fake = {};'],
    [fakeLeg, `import '${contractModule}';`],
    [realLeg, `import '${contractModule}';\nexport const smokeCapability = {};`],
  ]);
}

function check(entry: BoundaryEntry, files = completeFiles()): BoundaryContractViolation[] {
  return checkBoundaryContractObligations(registry(entry), files);
}

function filesNamedByContracts(
  entries: Readonly<Record<string, BoundaryEntry>>,
): ReadonlyMap<string, string> {
  const files = new Map<string, string>();

  for (const entry of Object.values(entries)) {
    if (entry.contract === null) continue;

    const paths = [entry.contract.module];
    for (const leg of entry.contract.legs) {
      paths.push(leg.adapter, leg.fake, leg.fakeLeg, leg.realLeg);
    }

    for (const path of paths) {
      const root = path.startsWith('execution/') ? resolve(CONDUCTOR_ROOT, 'src') : CONDUCTOR_ROOT;
      files.set(path, readFileSync(resolve(root, path), 'utf8'));
    }
  }

  return files;
}

function expectForPortedAndEarlyContract(
  entry: BoundaryEntry,
  expected: readonly BoundaryContractViolation[],
  files = completeFiles(),
): void {
  expect(check(entry, files)).toEqual(expected);
  expect(check({ ...entry, status: { kind: 'pending', issue: 1 } }, files)).toEqual(expected);
}

describe('structural: boundary contract obligations', () => {
  // Covers: task:10
  it('accepts the real registry and rejects a ported git boundary without a contract', () => {
    const files = filesNamedByContracts(BOUNDARY_REGISTRY);

    expect(checkBoundaryContractObligations(BOUNDARY_REGISTRY, files)).toEqual([]);

    const registryWithPortedGit = {
      ...BOUNDARY_REGISTRY,
      git: {
        ...BOUNDARY_REGISTRY.git,
        contract: null,
        status: { kind: 'ported' as const },
      },
    };

    expect(checkBoundaryContractObligations(registryWithPortedGit, files)).toEqual([
      { boundary: 'git', rule: 'ported-without-contract' },
    ]);
  });

  it('accepts complete ported and early pending contracts, while ignoring null pending contracts', () => {
    const early = boundary({ name: 'gh', status: { kind: 'pending', issue: 1 } });
    const pendingWithoutContract = boundary({
      name: 'git',
      contract: null,
      status: { kind: 'pending', issue: 2 },
    });

    expect(checkBoundaryContractObligations({
      llm: boundary(),
      git: pendingWithoutContract,
      gh: early,
    }, completeFiles())).toEqual([]);
  });

  it('reports a ported boundary without a contract', () => {
    expect(check(boundary({ contract: null }))).toEqual([
      { boundary: 'llm', rule: 'ported-without-contract' },
    ]);
  });

  it('applies missing-leg checks to ported and early pending contracts', () => {
    const entry = boundary({ adapterModules: [adapter, 'execution/other-provider.ts'] });
    expectForPortedAndEarlyContract(entry, [
      { boundary: 'llm', rule: 'missing-leg', adapter: 'execution/other-provider.ts' },
    ]);
  });

  it('applies unregistered-adapter checks to ported and early pending contracts', () => {
    const entry = boundary({
      contract: {
        module: contractModule,
        legs: [{ adapter: 'execution/unknown-provider.ts', fake, fakeLeg, realLeg }],
      },
    });
    expectForPortedAndEarlyContract(entry, [
      { boundary: 'llm', rule: 'missing-leg', adapter },
      { boundary: 'llm', rule: 'unregistered-adapter', adapter: 'execution/unknown-provider.ts' },
    ]);
  });

  it.each([
    ['fake module', fake],
    ['fake leg', fakeLeg],
    ['real leg', realLeg],
    ['contract module', contractModule],
  ])('applies missing-file checks for a missing %s to ported and early pending contracts', (_kind, path) => {
    const files = completeFiles();
    const withoutPath = new Map(files);
    withoutPath.delete(path);
    expectForPortedAndEarlyContract(boundary(), [
      { boundary: 'llm', rule: 'missing-file', path },
    ], withoutPath);
  });

  it('applies fake-leg smoke checks to ported and early pending contracts', () => {
    const smokeFakeLeg = 'test/contracts/provider.contract.smoke.test.ts';
    const entry = boundary({
      contract: { module: contractModule, legs: [{ adapter, fake, fakeLeg: smokeFakeLeg, realLeg }] },
    });
    const files = new Map(completeFiles());
    files.delete(fakeLeg);
    files.set(smokeFakeLeg, `import '${contractModule}';`);
    expectForPortedAndEarlyContract(entry, [
      { boundary: 'llm', rule: 'fake-leg-is-smoke', path: smokeFakeLeg },
    ], files);
  });

  it('applies real-leg smoke checks to ported and early pending contracts', () => {
    const defaultRealLeg = 'test/contracts/provider-provider.contract.test.ts';
    const entry = boundary({
      contract: { module: contractModule, legs: [{ adapter, fake, fakeLeg, realLeg: defaultRealLeg }] },
    });
    const files = new Map(completeFiles());
    files.delete(realLeg);
    files.set(defaultRealLeg, `import '${contractModule}';\nexport const smokeCapability = {};`);
    expectForPortedAndEarlyContract(entry, [
      { boundary: 'llm', rule: 'real-leg-not-smoke', path: defaultRealLeg },
    ], files);
  });

  it('applies smoke-capability checks to ported and early pending contracts', () => {
    const files = new Map(completeFiles());
    files.set(realLeg, `import '${contractModule}';`);
    expectForPortedAndEarlyContract(boundary(), [
      { boundary: 'llm', rule: 'missing-capability', path: realLeg },
    ], files);
  });

  it.each([
    ['fake leg', fakeLeg],
    ['real leg', realLeg],
  ])('applies contract-import checks for a %s to ported and early pending contracts', (_kind, path) => {
    const files = new Map(completeFiles());
    files.set(path, path === realLeg ? 'export const smokeCapability = {};' : 'export const fakeLeg = {};');
    expectForPortedAndEarlyContract(boundary(), [
      { boundary: 'llm', rule: 'missing-contract-import', path, module: contractModule },
    ], files);
  });

  it('aggregates violations across boundaries', () => {
    const git = boundary({
      name: 'git',
      status: { kind: 'pending', issue: 2 },
      contract: { module: contractModule, legs: [{ adapter, fake, fakeLeg, realLeg: fakeLeg }] },
    });

    expect(checkBoundaryContractObligations({
      llm: boundary({ contract: null }),
      git,
    }, completeFiles())).toEqual([
      { boundary: 'llm', rule: 'ported-without-contract' },
      { boundary: 'git', rule: 'real-leg-not-smoke', path: fakeLeg },
      { boundary: 'git', rule: 'missing-capability', path: fakeLeg },
    ]);
  });
});
