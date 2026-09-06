// Covers: task:2, task:4
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

import {
  dispatchShipmentEvidence,
} from '../../src/engine/shipment-evidence-cli.js';
import type {
  ShipmentEvidenceDependencies,
  ShipmentEvidenceInput,
} from '../../src/engine/shipment-evidence.js';
import { evaluateShipmentEvidence } from '../../src/engine/shipment-evidence.js';

describe('shipment-evidence CLI', () => {
  it('does not bind a quoted plan path in an implementation PR body', async () => {
    const reports: string[] = [];
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
            body: '> Plan: `.docs/plans/feature.md`',
            files: [{ path: 'src/conductor/src/engine/feature.ts' }],
            headRefOid: 'a'.repeat(40),
          }),
        })),
        runGit: vi.fn(async () => ({ stdout: 'a'.repeat(40) })),
        evaluateEvidence,
        report: (message) => reports.push(message),
      },
    );

    expect({ code, evaluateCalls: evaluateEvidence.mock.calls.length, reports }).toEqual({
      code: 0,
      evaluateCalls: 0,
      reports: ['shipped-record: not applicable (zero-match)'],
    });
  });

  it('passes an exactly associated PR with a valid immutable-head record', async () => {
    const reports: string[] = [];
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
        report: (message) => reports.push(message),
      },
    );

    expect({
      code,
      input: evaluateEvidence.mock.calls[0]?.[0],
      binding: await evaluateEvidence.mock.calls[0]?.[1]?.githubRunner?.(
        'https://github.com/org/repo/pull/1',
      ),
      reports,
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
      reports: [
        'shipped-record: plan .docs/plans/feature.md basis=explicit-plan-declaration',
        'shipped-record: valid .docs/shipped/feature.md',
      ],
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

  it('does not bind a quoted corrected body after the same immutable event identity previously bound a plan', async () => {
    const pr = 'https://github.com/org/repo/pull/1';
    const base = 'b'.repeat(40);
    const head = 'a'.repeat(40);
    const eventDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-edited-event-'));
    const eventPath = join(eventDir, 'event.json');
    const reports: string[] = [];
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'diff') {
        expect(args).toEqual(['diff', '--name-only', `${base}...${head}`]);
        return { stdout: 'src/conductor/src/engine/feature.ts\n' };
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: head };
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    });
    const evaluateEvidence = vi.fn(async () => ({
      kind: 'valid' as const,
      slug: 'feature',
      pr,
      recordPath: '.docs/shipped/feature.md',
      hash: 'hash',
      commit: head,
    }));
    const runGh = vi.fn(async () => {
      throw new Error('gh must not run for checked-out edited event evidence');
    });

    try {
      await writeFile(eventPath, JSON.stringify({
        pull_request: {
          html_url: pr,
          body: 'Plan: `.docs/plans/feature.md`',
          base: { sha: base },
          head: { sha: head },
        },
      }));
      const originalCode = await dispatchShipmentEvidence(
        { kind: 'check', pr, eventPath },
        '/repo',
        { runGh, runGit, listPlanStems: async () => ['feature'], evaluateEvidence, report: (message) => reports.push(message) },
      );

      await writeFile(eventPath, JSON.stringify({
        pull_request: {
          html_url: pr,
          body: '> Plan: `.docs/plans/feature.md`',
          base: { sha: base },
          head: { sha: head },
        },
      }));
      const editedCode = await dispatchShipmentEvidence(
        { kind: 'check', pr, eventPath },
        '/repo',
        { runGh, runGit, listPlanStems: async () => ['feature'], evaluateEvidence, report: (message) => reports.push(message) },
      );

      expect({
        originalCode,
        editedCode,
        evaluateCalls: evaluateEvidence.mock.calls.length,
        ghCalls: runGh.mock.calls.length,
        diffCalls: runGit.mock.calls.filter(([args]) => args[0] === 'diff').map(([args]) => args),
        reports,
      }).toEqual({
        originalCode: 0,
        editedCode: 0,
        evaluateCalls: 1,
        ghCalls: 0,
        diffCalls: [
          ['diff', '--name-only', `${base}...${head}`],
          ['diff', '--name-only', `${base}...${head}`],
        ],
        reports: [
          'shipped-record: plan .docs/plans/feature.md basis=explicit-plan-declaration',
          'shipped-record: valid .docs/shipped/feature.md',
          'shipped-record: not applicable (zero-match)',
        ],
      });
    } finally {
      await rm(eventDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['URL', { body: 'Plan: `.docs/plans/feature.md`', base: { sha: 'b'.repeat(40) }, head: { sha: 'a'.repeat(40) } }],
    ['base SHA', { html_url: 'https://github.com/org/repo/pull/1', body: 'Plan: `.docs/plans/feature.md`', head: { sha: 'a'.repeat(40) } }],
    ['head SHA', { html_url: 'https://github.com/org/repo/pull/1', body: 'Plan: `.docs/plans/feature.md`', base: { sha: 'b'.repeat(40) } }],
  ])('fails closed when the pull-request event lacks its %s', async (_field, pullRequest) => {
    const eventDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-incomplete-event-'));
    const eventPath = join(eventDir, 'event.json');
    const errors: string[] = [];
    const evaluateEvidence = vi.fn();
    const runGh = vi.fn(async () => {
      throw new Error('gh must not run for incomplete event evidence');
    });
    try {
      await writeFile(eventPath, JSON.stringify({ pull_request: pullRequest }));
      const code = await dispatchShipmentEvidence(
        { kind: 'check', pr: 'https://github.com/org/repo/pull/1', eventPath },
        '/repo',
        { evaluateEvidence, runGh, reportError: (message) => errors.push(message) },
      );

      expect({ code, errors, evaluateCalls: evaluateEvidence.mock.calls.length, ghCalls: runGh.mock.calls.length }).toEqual({
        code: 1,
        errors: [`shipped-record: pull-request event lacks URL or commit identity: ${eventPath}`],
        evaluateCalls: 0,
        ghCalls: 0,
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

  it('reports its declaration basis before a real missing-record refusal', async () => {
    const reports: string[] = [];
    const errors: string[] = [];
    const code = await dispatchShipmentEvidence(
      { kind: 'check', pr: 'https://github.com/org/repo/pull/1' },
      '/repo',
      {
        listPlanStems: async () => ['feature'],
        runGh: vi.fn(async () => ({
          stdout: JSON.stringify({
            url: 'https://github.com/org/repo/pull/1',
            body: 'Plan: .docs/plans/feature.md',
            files: [{ path: 'src/conductor/src/engine/feature.ts' }],
            headRefOid: 'a'.repeat(40),
          }),
        })),
        runGit: vi.fn(async () => ({ stdout: 'a'.repeat(40) })),
        evaluateEvidence: (input, dependencies) => evaluateShipmentEvidence(input, {
          ...dependencies,
          readFile: async (path) => path === '.docs/plans/feature.md'
            ? Buffer.from('# Feature plan\n')
            : null,
        }),
        report: (message) => reports.push(message),
        reportError: (message) => errors.push(message),
      },
    );

    expect({ code, reports, errors }).toEqual({
      code: 1,
      reports: ['shipped-record: plan .docs/plans/feature.md basis=explicit-plan-declaration'],
      errors: ['shipped-record: shipped-record-missing'],
    });
  });

  it('reports multi-match without evaluating when multiple existing plans are declared', async () => {
    const reports: string[] = [];
    const evaluateEvidence = vi.fn();
    const code = await dispatchShipmentEvidence(
      { kind: 'check', pr: 'https://github.com/org/repo/pull/1' },
      '/repo',
      {
        listPlanStems: async () => ['feature', 'other-feature'],
        runGh: vi.fn(async () => ({
          stdout: JSON.stringify({
            url: 'https://github.com/org/repo/pull/1',
            body: 'Plan: .docs/plans/feature.md\nPlan: .docs/plans/other-feature.md',
            files: [{ path: 'src/conductor/src/engine/feature.ts' }],
            headRefOid: 'a'.repeat(40),
          }),
        })),
        evaluateEvidence,
        report: (message) => reports.push(message),
      },
    );

    expect({ code, evaluateCalls: evaluateEvidence.mock.calls.length, reports }).toEqual({
      code: 0,
      evaluateCalls: 0,
      reports: ['shipped-record: not applicable (multi-match)'],
    });
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
      checkout: /uses: actions\/checkout@v\d+/.test(workflow),
      setup: /uses: actions\/setup-node@v\d+/.test(workflow),
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
    const parsed = load(workflow) as {
      name: string;
      on: { pull_request: { types: string[] } };
      permissions: Record<string, string>;
      jobs: Record<string, {
        name?: string;
        if: string;
        permissions?: Record<string, string>;
        steps: Array<{ uses?: string; with?: Record<string, string>; run?: string }>;
      }>;
    };
    const shipmentEvidence = parsed.jobs['shipment-evidence'];
    const reconcile = parsed.jobs.reconcile;
    const checkout = shipmentEvidence.steps.find((step) => step.uses === 'actions/checkout@v5');
    const command = shipmentEvidence.steps.find((step) => step.run?.includes('shipment-evidence'));

    expect(parsed.name).toBe('shipped-record');
    expect(parsed.on.pull_request.types).toEqual(['opened', 'reopened', 'synchronize', 'edited', 'closed']);
    expect(parsed.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    expect(shipmentEvidence.name).toBe('shipped-record');
    expect(shipmentEvidence.if).toBe("github.event.action != 'closed'");
    expect(checkout?.with?.ref).toBe('${{ github.event.pull_request.head.sha }}');
    expect(command?.run).toBe('node src/conductor/dist/index.js shipment-evidence --pr "${{ github.event.pull_request.html_url }}" --event "$GITHUB_EVENT_PATH"');
    expect(reconcile.if).toBe("github.event.action == 'closed' && github.event.pull_request.merged == true");
    expect(reconcile.permissions).toEqual({ contents: 'write', 'pull-requests': 'write', statuses: 'write' });
  });
});
