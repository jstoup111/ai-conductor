import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  dispatchShipmentEvidence,
} from '../../src/engine/shipment-evidence-cli.js';
import type {
  ShipmentEvidenceDependencies,
  ShipmentEvidenceInput,
} from '../../src/engine/shipment-evidence.js';

describe('shipment-evidence CLI', () => {
  it('passes an exactly associated PR with a valid immutable-head record', async () => {
    const evaluateEvidence = vi.fn(async (_input: ShipmentEvidenceInput, _deps: ShipmentEvidenceDependencies) => ({
      kind: 'valid' as const,
      slug: 'feature',
      pr: 'https://github.com/org/repo/pull/1',
      recordPath: '.docs/shipped/feature.md',
      hash: 'hash',
      commit: 'a'.repeat(40),
    }));
    const code = await dispatchShipmentEvidence(
      { kind: 'check', pr: 'https://github.com/org/repo/pull/1' },
      '/repo',
      {
        listPlanStems: async () => ['feature'],
        runGh: vi.fn(async () => ({
          stdout: JSON.stringify({
            url: 'https://github.com/org/repo/pull/1',
            body: 'Plan: `.docs/plans/feature.md`',
            files: [{ path: 'src/conductor/src/engine/feature.ts' }],
            headRefOid: 'a'.repeat(40),
          }),
        })),
        runGit: vi.fn(async () => ({ stdout: 'a'.repeat(40) })),
        evaluateEvidence,
      },
    );

    expect({
      code,
      input: evaluateEvidence.mock.calls[0]?.[0],
      binding: await evaluateEvidence.mock.calls[0]?.[1]?.githubRunner?.(
        'https://github.com/org/repo/pull/1',
      ),
    }).toEqual({
      code: 0,
      input: {
        repoDir: '/repo',
        slug: 'feature',
        implementationPr: 'https://github.com/org/repo/pull/1',
        candidateCommit: 'a'.repeat(40),
      },
      binding: {
        url: 'https://github.com/org/repo/pull/1',
        headRefOid: 'a'.repeat(40),
      },
    });
  });

  it('uses checked-out pull-request event and commit evidence without gh in CI mode', async () => {
    const pr = 'https://github.com/org/repo/pull/1';
    const head = 'a'.repeat(40);
    const base = 'b'.repeat(40);
    const eventDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-event-'));
    const eventPath = join(eventDir, 'event.json');
    await writeFile(eventPath, JSON.stringify({
      pull_request: {
        html_url: pr,
        body: 'Plan: `.docs/plans/feature.md`',
        base: { sha: base },
        head: { sha: head },
      },
    }));
    const runGh = vi.fn(async () => {
      throw new Error('gh must not run for checked-out event evidence');
    });
    const evaluateEvidence = vi.fn(async (_input: ShipmentEvidenceInput, _deps: ShipmentEvidenceDependencies) => ({
      kind: 'valid' as const,
      slug: 'feature',
      pr,
      recordPath: '.docs/shipped/feature.md',
      hash: 'hash',
      commit: head,
    }));

    try {
      const code = await dispatchShipmentEvidence(
        { kind: 'check', pr, eventPath },
        '/repo',
        {
          runGh,
          runGit: vi.fn(async (args: string[]) => {
            if (args[0] === 'diff') {
              expect(args).toEqual(['diff', '--name-only', `${base}...${head}`]);
              return { stdout: 'src/conductor/src/engine/feature.ts\n' };
            }
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: head };
            throw new Error(`unexpected git args: ${args.join(' ')}`);
          }),
          listPlanStems: async () => ['feature'],
          evaluateEvidence,
        },
      );

      expect({ code, ghCalls: runGh.mock.calls.length, input: evaluateEvidence.mock.calls[0]?.[0] }).toEqual({
        code: 0,
        ghCalls: 0,
        input: { repoDir: '/repo', slug: 'feature', implementationPr: pr, candidateCommit: head },
      });
    } finally {
      await rm(eventDir, { recursive: true, force: true });
    }
  });

  it('succeeds without evaluating a spec-only or docs-only PR', async () => {
    const evaluateEvidence = vi.fn();
    const code = await dispatchShipmentEvidence(
      { kind: 'check', pr: 'https://github.com/org/repo/pull/1' },
      '/repo',
      {
        listPlanStems: async () => ['feature'],
        runGh: vi.fn(async () => ({
          stdout: JSON.stringify({
            url: 'https://github.com/org/repo/pull/1',
            body: 'Plan: `.docs/plans/feature.md`',
            files: [{ path: '.docs/stories/feature.md' }],
            headRefOid: 'a'.repeat(40),
          }),
        })),
        evaluateEvidence,
      },
    );

    expect({ code, evaluateCalls: evaluateEvidence.mock.calls.length }).toEqual({
      code: 0,
      evaluateCalls: 0,
    });
  });

  it('fails an exactly associated PR whose immutable-head evidence is invalid', async () => {
    const code = await dispatchShipmentEvidence(
      { kind: 'check', pr: 'https://github.com/org/repo/pull/1' },
      '/repo',
      {
        listPlanStems: async () => ['feature'],
        runGh: vi.fn(async () => ({
          stdout: JSON.stringify({
            url: 'https://github.com/org/repo/pull/1',
            body: 'Plan: `.docs/plans/feature.md`',
            files: [{ path: 'src/conductor/src/engine/feature.ts' }],
            headRefOid: 'a'.repeat(40),
          }),
        })),
        runGit: vi.fn(async () => ({ stdout: 'a'.repeat(40) })),
        evaluateEvidence: vi.fn(async () => ({
          kind: 'refusal' as const,
          code: 'shipped-record-missing' as const,
          expected: '.docs/shipped/feature.md',
          observed: null,
        })),
      },
    );

    expect(code).toBe(1);
  });

  it('fails a proven implementation when strict verification cannot validate it', async () => {
    const errors: string[] = [];
    const code = await dispatchShipmentEvidence(
      { kind: 'check', pr: 'https://github.com/org/repo/pull/1' },
      '/repo',
      {
        listPlanStems: async () => ['feature'],
        runGh: vi.fn(async () => ({
          stdout: JSON.stringify({
            url: 'https://github.com/org/repo/pull/1',
            body: 'Plan: `.docs/plans/feature.md`',
            files: [{ path: 'src/conductor/src/engine/feature.ts' }],
            headRefOid: 'a'.repeat(40),
          }),
        })),
        runGit: vi.fn(async () => ({ stdout: 'a'.repeat(40) })),
        evaluateEvidence: vi.fn(async () => ({
          kind: 'not-applicable' as const,
          reason: 'strict verifier unavailable',
        })),
        reportError: (message) => errors.push(message),
      },
    );

    expect({ code, errors }).toEqual({
      code: 1,
      errors: ['shipped-record: strict verifier unavailable'],
    });
  });

  it('fails rather than guessing when PR classification inputs are unavailable', async () => {
    const errors: string[] = [];
    const code = await dispatchShipmentEvidence(
      { kind: 'check', pr: 'https://github.com/org/repo/pull/1' },
      '/repo',
      {
        runGh: vi.fn(async () => {
          throw new Error('PR metadata unavailable');
        }),
        reportError: (message) => errors.push(message),
      },
    );

    expect({ code, errors }).toEqual({
      code: 1,
      errors: ['shipped-record: PR metadata unavailable'],
    });
  });

  it('does not allow checkout or dependency setup failures to continue to a success context', async () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
    const workflow = await readFile(join(repoRoot, '.github/workflows/shipped-record.yml'), 'utf8');

    expect({
      checkout: workflow.includes('uses: actions/checkout@v4'),
      setup: workflow.includes('uses: actions/setup-node@v4'),
      dependencies: workflow.includes('- run: npm ci'),
      permitsFailure: /continue-on-error:\s*true|if:\s*always\(\)/.test(workflow),
    }).toEqual({
      checkout: true,
      setup: true,
      dependencies: true,
      permitsFailure: false,
    });
  });

  it('defines a path-filter-free stable shipped-record check for every PR update', async () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
    const workflow = await readFile(join(repoRoot, '.github/workflows/shipped-record.yml'), 'utf8');

    expect(workflow).toMatch(/name:\s*shipped-record[\s\S]*pull_request:[\s\S]*opened, reopened, synchronize[\s\S]*jobs:[\s\S]*shipment-evidence:[\s\S]*name:\s*shipped-record[\s\S]*node src\/conductor\/dist\/index\.js shipment-evidence/);
  });
});
