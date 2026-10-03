// Covers: task:29 — PRD-audit's typed verdict/report are one disposable
// evidence family; widening authority remains durable across cleanup.
import { mkdir, mkdtemp, readFile, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConductState } from '../../src/types/index.js';
import { sweepStaleReviewArtifacts } from '../../src/engine/artifacts.js';
import { ACCEPTED_WIDENINGS_PATH } from '../../src/engine/accepted-widenings.js';
import { PRD_AUDIT_REPORT_PATH, PRD_AUDIT_VERDICT_PATH } from '../../src/engine/prd-audit-verdict-store.js';
import { dispatchRewindCommand } from '../../src/engine/rewind.js';

const completeState: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
  architecture_diagram: 'done', architecture_review: 'done', stories: 'done',
  conflict_check: 'done', plan: 'done', coherence_check: 'done', acceptance_specs: 'done',
  build: 'done', test_suite: 'done', build_review: 'done',
  manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
  rebase: 'done', finish: 'done', last_step: 'finish',
};

const VERDICT = '{ "attemptId": "attempt-1", "complete": true }\n';
const REPORT = '# PRD audit\n\nS1.1: PASS\n';
const WIDENINGS = '{ "decisions": [{ "id": "decision-original" }] }\n';
const ORIGINAL_OFFERS = '{ "prdWideningCases": [{ "id": "offer-original" }] }\n';
const REMEDIATION_CASES_PATH = '.pipeline/remediation-cases.json';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rewind-prd-audit-pair-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline/gates'), { recursive: true });
  await writeFile(join(root, '.pipeline/conduct-state.json'), JSON.stringify(completeState));
  await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
  await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');
  await writeFile(join(root, PRD_AUDIT_VERDICT_PATH), VERDICT);
  await writeFile(join(root, PRD_AUDIT_REPORT_PATH), REPORT);
  await writeFile(join(root, ACCEPTED_WIDENINGS_PATH), WIDENINGS);
  await writeFile(join(root, REMEDIATION_CASES_PATH), ORIGINAL_OFFERS);
  return root;
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(() => true, () => false);
}

async function expectDurableWideningHistory(root: string): Promise<void> {
  await expect(readFile(join(root, ACCEPTED_WIDENINGS_PATH), 'utf-8')).resolves.toBe(WIDENINGS);
  await expect(readFile(join(root, REMEDIATION_CASES_PATH), 'utf-8')).resolves.toBe(ORIGINAL_OFFERS);
}

describe('PRD-audit evidence-family cleanup', () => {
  it('stale sweep removes the typed verdict and derived report but preserves widening authority', async () => {
    const root = await fixture();
    const sessionStart = Date.now();
    const stale = new Date(sessionStart - 60_000);
    await utimes(join(root, PRD_AUDIT_VERDICT_PATH), stale, stale);
    await utimes(join(root, PRD_AUDIT_REPORT_PATH), stale, stale);

    const removed = await sweepStaleReviewArtifacts(root, 'prd_audit', sessionStart, {
      gate_code_validity: { enabled: false },
    });

    expect(removed).toEqual([
      join(root, PRD_AUDIT_VERDICT_PATH),
      join(root, PRD_AUDIT_REPORT_PATH),
    ]);
    expect(await exists(join(root, PRD_AUDIT_VERDICT_PATH))).toBe(false);
    expect(await exists(join(root, PRD_AUDIT_REPORT_PATH))).toBe(false);
    await expectDurableWideningHistory(root);
  });

  it('rewind removes the same evidence family but preserves widening authority and original offers', async () => {
    const root = await fixture();

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root)).resolves.toBe(0);

    expect(await exists(join(root, PRD_AUDIT_VERDICT_PATH))).toBe(false);
    expect(await exists(join(root, PRD_AUDIT_REPORT_PATH))).toBe(false);
    expect((await readdir(join(root, '.pipeline'))).some((entry) => entry.includes('.rewind-clearing'))).toBe(false);
    await expectDurableWideningHistory(root);
  });

  it('restores both evidence files and state bytes when rewind fails after staging them', async () => {
    const root = await fixture();
    const statePath = join(root, '.pipeline/conduct-state.json');
    const originalState = JSON.parse(await readFile(statePath, 'utf-8'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, {
      markerFilesystem: {
        rename,
        remove: async () => { throw new Error('halt removal failed'); },
        readFile: (path) => readFile(path, 'utf-8'),
        restoreHalt: (cwd, body) => writeFile(join(cwd, '.pipeline/HALT'), body, 'utf-8'),
        writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
      },
    })).resolves.toBe(1);

    await expect(readFile(join(root, PRD_AUDIT_VERDICT_PATH), 'utf-8')).resolves.toBe(VERDICT);
    await expect(readFile(join(root, PRD_AUDIT_REPORT_PATH), 'utf-8')).resolves.toBe(REPORT);
    await expect(readFile(statePath, 'utf-8')).resolves.toEqual(JSON.stringify(originalState, null, 2) + '\n');
    expect((await readdir(join(root, '.pipeline'))).some((entry) => entry.includes('.rewind-clearing'))).toBe(false);
    await expectDurableWideningHistory(root);
    expect(error.mock.calls).toEqual([['rewind: halt removal failed']]);
  });

  it('reports the staging failure before a subsequent state-rollback failure', async () => {
    const root = await fixture();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rollbackFailingStore = {
      async apply() { return { kind: 'applied' as const }; },
      async applyBatch(batch: { name: string }) {
        return batch.name === 'operator rewind state'
          ? { kind: 'applied' as const }
          : { kind: 'persistence' as const, message: 'rollback write failed' };
      },
      async replace() { return { kind: 'applied' as const }; },
    };

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, {
      store: rollbackFailingStore,
      markerFilesystem: {
        rename,
        remove: async () => { throw new Error('halt removal failed'); },
        readFile: (path) => readFile(path, 'utf-8'),
        restoreHalt: (cwd, body) => writeFile(join(cwd, '.pipeline/HALT'), body, 'utf-8'),
        writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
      },
    })).resolves.toBe(1);

    await expect(readFile(join(root, PRD_AUDIT_VERDICT_PATH), 'utf-8')).resolves.toBe(VERDICT);
    await expect(readFile(join(root, PRD_AUDIT_REPORT_PATH), 'utf-8')).resolves.toBe(REPORT);
    expect(error.mock.calls).toEqual([
      ['rewind: halt removal failed'],
      ['rewind: rollback failed: Operator rewind rollback failed (persistence): rollback write failed'],
    ]);
  });
});
