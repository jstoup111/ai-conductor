// Covers: task:1
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BOUNDARY_REGISTRY,
  expectedBoundaryNames,
  missingAdapterPaths,
  type BoundaryStatus,
} from './boundary-registry.js';

// @ts-expect-error Pending boundary statuses must name their follow-on issue.
const pendingStatusWithoutIssue: BoundaryStatus = { kind: 'pending' };
void pendingStatusWithoutIssue;

const structuralDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(structuralDirectory, '../../src');

async function sourceFiles(directory = sourceDirectory): Promise<Map<string, string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? new Map([[relative(sourceDirectory, path), '']]) : new Map();
  }));
  return new Map(nested.flatMap((files) => [...files]));
}

describe('structural: external boundary registry', () => {
  it('contains exactly the eight declared boundary names', () => {
    expect(Object.keys(BOUNDARY_REGISTRY)).toEqual([
      'llm', 'git', 'gh', 'tmux', 'process', 'clock', 'otel', 'filesystem',
    ]);
    expect(expectedBoundaryNames(BOUNDARY_REGISTRY)).toEqual({ missing: [], extra: [] });
  });

  it('reports fixture registries with missing or extra boundary names', () => {
    const { clock: _clock, ...withoutClock } = BOUNDARY_REGISTRY;
    const withNetwork = { ...BOUNDARY_REGISTRY, network: BOUNDARY_REGISTRY.llm };

    expect(expectedBoundaryNames(withoutClock)).toEqual({ missing: ['clock'], extra: [] });
    expect(expectedBoundaryNames(withNetwork)).toEqual({ missing: [], extra: ['network'] });
  });

  // Covers: task:2
  it('records llm as the ported LLMProvider boundary with its production adapters and contract', () => {
    expect(BOUNDARY_REGISTRY.llm).toEqual({
      name: 'llm',
      port: 'LLMProvider',
      adapterModules: [
        'execution/claude-provider.ts',
        'execution/codex-provider.ts',
        'execution/pi-provider.ts',
      ],
      specifiers: [],
      clockCalls: [],
      commandLiterals: [],
      contract: {
        module: 'test/contracts/llm.contract.ts',
        legs: [
          {
            adapter: 'execution/claude-provider.ts',
            fake: 'test/fixtures/claude-provider-fake.ts',
            fakeLeg: 'test/contracts/llm.contract.test.ts',
            realLeg: 'test/contracts/llm-claude.contract.smoke.test.ts',
          },
          {
            adapter: 'execution/codex-provider.ts',
            fake: 'test/fixtures/codex-provider-fake.ts',
            fakeLeg: 'test/contracts/llm.contract.test.ts',
            realLeg: 'test/contracts/llm-codex.contract.smoke.test.ts',
          },
          {
            adapter: 'execution/pi-provider.ts',
            fake: 'test/fixtures/pi-provider-fake.ts',
            fakeLeg: 'test/contracts/llm.contract.test.ts',
            realLeg: 'test/contracts/llm-pi.contract.smoke.test.ts',
          },
        ],
      },
      status: { kind: 'ported' },
    });
  });

  // Covers: task:2
  it('records the pending boundary issues and every D1 membership with no contract', () => {
    expect(BOUNDARY_REGISTRY).toEqual({
      llm: {
        name: 'llm', port: 'LLMProvider',
        adapterModules: ['execution/claude-provider.ts', 'execution/codex-provider.ts', 'execution/pi-provider.ts'],
        specifiers: [], clockCalls: [], commandLiterals: [], status: { kind: 'ported' },
        contract: {
          module: 'test/contracts/llm.contract.ts',
          legs: [
            { adapter: 'execution/claude-provider.ts', fake: 'test/fixtures/claude-provider-fake.ts', fakeLeg: 'test/contracts/llm.contract.test.ts', realLeg: 'test/contracts/llm-claude.contract.smoke.test.ts' },
            { adapter: 'execution/codex-provider.ts', fake: 'test/fixtures/codex-provider-fake.ts', fakeLeg: 'test/contracts/llm.contract.test.ts', realLeg: 'test/contracts/llm-codex.contract.smoke.test.ts' },
            { adapter: 'execution/pi-provider.ts', fake: 'test/fixtures/pi-provider-fake.ts', fakeLeg: 'test/contracts/llm.contract.test.ts', realLeg: 'test/contracts/llm-pi.contract.smoke.test.ts' },
          ],
        },
      },
      git: {
        name: 'git', port: null, adapterModules: [], specifiers: [], clockCalls: [], commandLiterals: ['git'],
        contract: null,
        status: { kind: 'pending', issue: 3043 },
      },
      gh: {
        name: 'gh', port: null, adapterModules: [], specifiers: [], clockCalls: [], commandLiterals: ['gh'],
        contract: null,
        status: { kind: 'pending', issue: 3637 },
      },
      tmux: {
        name: 'tmux', port: null, adapterModules: [], specifiers: [], clockCalls: [], commandLiterals: ['tmux'],
        contract: null,
        status: { kind: 'pending', issue: 3639 },
      },
      process: {
        name: 'process', port: null, adapterModules: [], specifiers: ['child_process', 'execa'], clockCalls: [], commandLiterals: [],
        contract: null,
        status: { kind: 'pending', issue: 3634 },
      },
      clock: {
        name: 'clock', port: null, adapterModules: [], specifiers: [], clockCalls: ['Date.now', 'new Date', 'performance.now'], commandLiterals: [],
        contract: null,
        status: { kind: 'pending', issue: 3638 },
      },
      otel: {
        name: 'otel', port: null, adapterModules: [], specifiers: ['@opentelemetry/'], clockCalls: [], commandLiterals: [],
        contract: null,
        status: { kind: 'pending', issue: 3635 },
      },
      filesystem: {
        name: 'filesystem', port: null, adapterModules: [], specifiers: ['fs', 'fs/promises', 'chokidar'], clockCalls: [], commandLiterals: [],
        contract: null,
        status: { kind: 'pending', issue: 3636 },
      },
    });
  });

  it('finds no missing real adapters and reports a missing fixture adapter by boundary and path', async () => {
    const files = await sourceFiles();
    const registryWithMissingAdapter = {
      ...BOUNDARY_REGISTRY,
      llm: { ...BOUNDARY_REGISTRY.llm, adapterModules: ['execution/missing.ts'] },
    };

    expect(missingAdapterPaths(BOUNDARY_REGISTRY, files)).toEqual([]);
    expect(missingAdapterPaths(registryWithMissingAdapter, files)).toEqual([
      { boundary: 'llm', path: 'execution/missing.ts' },
    ]);
  });
});
