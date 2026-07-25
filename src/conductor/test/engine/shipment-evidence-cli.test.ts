import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  dispatchShipmentEvidence,
} from '../../src/engine/shipment-evidence-cli.js';

describe('shipment-evidence CLI', () => {
  it('passes an exactly associated PR with a valid immutable-head record', async () => {
    const evaluateEvidence = vi.fn(async () => ({
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

  it('defines a path-filter-free stable shipped-record check for every PR update', async () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
    const workflow = await readFile(join(repoRoot, '.github/workflows/shipped-record.yml'), 'utf8');

    expect(workflow).toMatch(/name:\s*shipped-record[\s\S]*pull_request:[\s\S]*opened, reopened, synchronize[\s\S]*jobs:[\s\S]*shipment-evidence:[\s\S]*name:\s*shipped-record[\s\S]*node src\/conductor\/dist\/index\.js shipment-evidence/);
  });
});
