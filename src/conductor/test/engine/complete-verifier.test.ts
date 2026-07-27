import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  verifyCompleteState,
  formatGapReport,
} from '../../src/engine/complete-verifier.js';
import type { FullSuiteInspectionResult } from '../../src/engine/full-suite-verifier.js';
import type { ShipmentEvidenceResult } from '../../src/engine/shipment-evidence.js';

const evaluateShipmentEvidenceSpy = vi.fn(async (input: {
  slug: string;
  implementationPr: string;
  candidateCommit: string;
}): Promise<ShipmentEvidenceResult> => ({
  kind: 'valid' as const,
  slug: input.slug,
  pr: input.implementationPr,
  recordPath: `.docs/shipped/${input.slug}.md`,
  hash: 'test-hash',
  commit: input.candidateCommit,
}));

vi.mock('../../src/engine/shipment-evidence.js', () => ({
  evaluateShipmentEvidence: (...args: Parameters<typeof evaluateShipmentEvidenceSpy>) =>
    evaluateShipmentEvidenceSpy(...args),
}));

describe('engine/complete-verifier', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'verify-test-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    evaluateShipmentEvidenceSpy.mockClear();
    evaluateShipmentEvidenceSpy.mockImplementation(async (input) => ({
      kind: 'valid' as const,
      slug: input.slug,
      pr: input.implementationPr,
      recordPath: `.docs/shipped/${input.slug}.md`,
      hash: 'test-hash',
      commit: input.candidateCommit,
    }));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeState(state: Record<string, unknown>) {
    await writeFile(
      join(dir, '.pipeline/conduct-state.json'),
      JSON.stringify(state),
    );
  }

  async function verifyWithCurrentSuite() {
    return verifyCompleteState(dir, {
      fullSuiteInspect: async () =>
        ({ status: 'CURRENT', evidence: {} } as FullSuiteInspectionResult),
    });
  }

  it('reports ok when all SHIP-phase artifacts are present and consistent', async () => {
    await writeState({
      feature_status: 'complete',
      feature_desc: 'add foo',
      pr_url: 'https://github.com/x/y/pull/1',
    });
    await mkdir(join(dir, '.docs/retros'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/manual-test-results.md'),
      '| Story | Result |\n|---|---|\n| foo | PASS |\n',
    );
    await writeFile(join(dir, '.docs/retros/2026-05-01-add-foo.md'), '# Retro\n');
    await writeFile(join(dir, '.pipeline/finish-choice'), 'keep');

    const result = await verifyWithCurrentSuite();
    expect(result.ok).toBe(true);
  });

  it('reports a finish gap when fresh PR markers lack durable shipment evidence', async () => {
    await writeState({
      feature_status: 'complete',
      feature_desc: 'add-foo',
      pr_url: 'https://github.com/x/y/pull/1',
    });
    await mkdir(join(dir, '.docs/retros'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/manual-test-results.md'),
      '| Story | Result |\n|---|---|\n| foo | PASS |\n',
    );
    await writeFile(join(dir, '.docs/retros/2026-05-01-add-foo.md'), '# Retro\n');
    await writeFile(join(dir, '.pipeline/finish-choice'), 'pr');

    evaluateShipmentEvidenceSpy.mockResolvedValueOnce({
      kind: 'refusal',
      code: 'shipped-record-missing',
      expected: '.docs/shipped/add-foo.md',
      observed: null,
    });

    const result = await verifyWithCurrentSuite();

    expect(result).toMatchObject({ ok: false, failedSteps: ['finish'] });
  });

  it('reports gaps when manual_test, retro, and finish artifacts are all missing', async () => {
    await writeState({
      feature_status: 'complete',
      feature_desc: 'add foo',
    });

    const result = await verifyWithCurrentSuite();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedSteps).toEqual(['manual_test', 'retro', 'finish']);
      expect(result.reasons).toHaveLength(3);
      expect(result.reasons[0]).toMatch(/manual-test-results\.md/);
      expect(result.reasons[1]).toMatch(/retros/);
      expect(result.reasons[2]).toMatch(/finish-choice/);
    }
  });

  it('reports test_suite as stale-complete when its PASS is no longer current', async () => {
    await writeState({
      feature_status: 'complete',
      feature_desc: 'add foo',
      pr_url: 'https://github.com/x/y/pull/1',
    });
    await mkdir(join(dir, '.docs/retros'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/manual-test-results.md'),
      '| Story | Result |\n|---|---|\n| foo | PASS |\n',
    );
    await writeFile(join(dir, '.docs/retros/2026-05-01-add-foo.md'), '# Retro\n');
    await writeFile(join(dir, '.pipeline/finish-choice'), 'pr');

    const result = await verifyCompleteState(dir, {
      fullSuiteInspect: async () => ({ status: 'STALE', reason: 'source_changed' }),
    });

    expect(result).toEqual({
      ok: false,
      failedSteps: ['test_suite'],
      reasons: ['full-suite PASS evidence is stale: source_changed'],
    });
  });

  it('reports manual_test gap when results contain a FAIL row', async () => {
    await writeState({
      feature_status: 'complete',
      feature_desc: 'add foo',
      pr_url: 'https://github.com/x/y/pull/1',
    });
    await mkdir(join(dir, '.docs/retros'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/manual-test-results.md'),
      '| Story | Result |\n|---|---|\n| foo | FAIL |\n',
    );
    await writeFile(join(dir, '.docs/retros/2026-05-01-add-foo.md'), '# Retro\n');
    await writeFile(join(dir, '.pipeline/finish-choice'), 'pr');

    const result = await verifyWithCurrentSuite();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedSteps).toContain('manual_test');
      expect(result.reasons[0]).toMatch(/FAIL/);
    }
  });

  it('returns gap when finish-choice="pr" but no pr_url in state', async () => {
    await writeState({
      feature_status: 'complete',
      feature_desc: 'add foo',
    });
    await mkdir(join(dir, '.docs/retros'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/manual-test-results.md'),
      '| Story | Result |\n|---|---|\n| foo | PASS |\n',
    );
    await writeFile(join(dir, '.docs/retros/2026-05-01-add-foo.md'), '# Retro\n');
    await writeFile(join(dir, '.pipeline/finish-choice'), 'pr');

    const result = await verifyWithCurrentSuite();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedSteps).toEqual(['finish']);
      expect(result.reasons[0]).toMatch(/pr_url/);
    }
  });

  it('formatGapReport mentions every failed step and the worktree path', () => {
    const report = formatGapReport('add foo', '/tmp/wt', {
      ok: false,
      failedSteps: ['manual_test', 'finish'],
      reasons: ['no results file', 'no marker'],
    });
    expect(report).toContain('add foo');
    expect(report).toContain('/tmp/wt');
    expect(report).toContain('manual_test: no results file');
    expect(report).toContain('finish: no marker');
  });
});
