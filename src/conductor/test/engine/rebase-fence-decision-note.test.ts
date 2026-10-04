import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderRebaseFenceDecisionNote } from '../../src/engine/rebase-fence-decision-note.js';

// Covers: task:9

const temporaryDirectories: string[] = [];
const feature = { version: 'v1' as const, repository: 'acme/conductor', feature: 'rebase-fence' };

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rebase-fence-decision-note-'));
  temporaryDirectories.push(root);
  return root;
}

async function writeOffer(root: string): Promise<void> {
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'remediation-cases.json'), JSON.stringify({
    version: 'v2',
    feature,
    cases: [],
    prdWideningCases: [{
      id: 'case-nc-1',
      domain: 'prd_widening',
      offeredCriterion: 'NC.1',
      originalSources: [{ sourceId: 'prd-audit:NC.1', snapshot: 'Visible behavior outside the approved plan.' }],
      currentSources: [{ sourceId: 'prd-audit:NC.1', snapshot: 'Visible behavior outside the approved plan.', recordedAt: '2026-10-04T00:00:00.000Z' }],
      relationships: [],
    }],
    suppressions: [],
  }));
}

async function writeClearedDecision(root: string, decision: 'accept' | 'refuse'): Promise<void> {
  await writeFile(join(root, '.pipeline', 'HALT.cleared'), [
    'Operator decision',
    '',
    '```json over-scope-decisions',
    JSON.stringify([{
      criterion: 'NC.1',
      summary: 'Visible behavior outside the approved plan.',
      decision,
      rationale: 'Operator decision.',
    }]),
    '```',
  ].join('\n'));
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('renderRebaseFenceDecisionNote', () => {
  it('names an accept recorded in HALT.cleared', async () => {
    const root = await projectRoot();
    await writeOffer(root);
    await writeClearedDecision(root, 'accept');

    await expect(renderRebaseFenceDecisionNote(root)).resolves.toContain('NC.1 recorded as accept');
  });

  it('names a refusal recorded in HALT.cleared', async () => {
    const root = await projectRoot();
    await writeOffer(root);
    await writeClearedDecision(root, 'refuse');

    await expect(renderRebaseFenceDecisionNote(root)).resolves.toContain('NC.1 recorded as refuse');
  });

  it('names an offered criterion as awaiting a decision', async () => {
    const root = await projectRoot();
    await writeOffer(root);

    const note = await renderRebaseFenceDecisionNote(root);

    expect(note).toContain('NC.1 awaiting a decision');
    expect(note).toContain('ai-conductor halt clear');
  });

  it('returns an empty note without an offer or decision', async () => {
    await expect(renderRebaseFenceDecisionNote(await projectRoot())).resolves.toBe('');
  });

  it('reports an unreadable recorded-decision state without throwing', async () => {
    const root = await projectRoot();
    await writeOffer(root);
    await writeFile(join(root, '.pipeline', 'accepted-widenings.json'), '{not json');

    await expect(renderRebaseFenceDecisionNote(root)).resolves.toContain('recorded decision state could not be read');
  });
});
