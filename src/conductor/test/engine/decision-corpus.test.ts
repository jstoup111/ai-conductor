// Covers: task:1
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { adrApprovalStatus } from '../../src/engine/artifacts.js';
import * as featureManifest from '../../src/engine/feature-manifest.js';
import { classifyKind, deriveDisposition, matchesKnownShape, readDecisionCorpus } from '../../src/engine/decision-corpus.js';

const fixtureRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createCorpusRoot(directory = featureManifest.MANIFEST_KIND_LOCATIONS.decision.directory): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'decision-corpus-'));
  fixtureRoots.push(root);
  await mkdir(join(root, directory), { recursive: true });
  return root;
}

async function writeCorpusRecord(root: string, filename: string, content: string, directory = featureManifest.MANIFEST_KIND_LOCATIONS.decision.directory): Promise<void> {
  await writeFile(join(root, directory, filename), content, 'utf8');
}

describe('decision corpus known shapes', () => {
  it('recognizes every known filename shape', () => {
    expect([
      matchesKnownShape('adr-2026-01-01-x.md'),
      matchesKnownShape('architecture-review-2026-01-01-x.md'),
      matchesKnownShape('review-x.md'),
      matchesKnownShape('technical-assessment-2026-01-01.md'),
      matchesKnownShape('api-response-contract.md'),
      matchesKnownShape('styleguide.md'),
      matchesKnownShape('notes.md'),
      matchesKnownShape('Styleguide.md'),
    ]).toEqual([true, true, true, true, true, true, false, false]);
  });

  it('classifies filename shapes before falling back to status-bearing content', () => {
    expect([
      classifyKind('adr-2026-01-01-x.md', '# Untitled'),
      classifyKind('architecture-review-2026-01-01-x.md', '**Status:** APPROVED'),
      classifyKind('review-x.md', '# Untitled'),
      classifyKind('technical-assessment-2026-01-01.md', '**Verdict:** APPROVED'),
      classifyKind('adr-2026-01-01-x.md', '**Verdict:** APPROVED'),
      classifyKind('review-x.md', '**Status:** APPROVED'),
      classifyKind('api-response-contract.md', '**Status:** APPROVED'),
      classifyKind('styleguide.md', '**Verdict:** APPROVED'),
      classifyKind('notes.md', '**Status:** APPROVED'),
      classifyKind('notes.md', '**Verdict:** APPROVED'),
    ]).toEqual([
      'decision',
      'review',
      'review',
      'assessment',
      'decision',
      'review',
      'reference',
      'reference',
      'decision',
      'review',
    ]);
  });

  it('rejects off-shape names despite status- or verdict-bearing content', () => {
    expect([
      matchesKnownShape('legacy-decision.md'),
      matchesKnownShape('legacy-review.md'),
      matchesKnownShape('notes.md'),
    ]).toEqual([false, false, false]);
    expect([
      classifyKind('legacy-decision.md', '**Status:** Accepted'),
      classifyKind('legacy-review.md', '**Verdict:** APPROVED'),
    ]).toEqual(['decision', 'review']);
  });

  it('classifies and retains an inline-bold declared verdict on a legacy record', () => {
    const content = '**Verdict: APPROVED**';

    expect(classifyKind('legacy-review.md', content)).toBe('review');
    expect(deriveDisposition(content)).toEqual({ disposition: 'other', declared: 'APPROVED' });
  });

  // Covers: task:2
  it('does not infer a kind from deprecated or fenced-only status markers', () => {
    expect(classifyKind('adr-2026-01-01-x.md', '**Verdict:** APPROVED')).toBe('decision');

    expect([
      matchesKnownShape('Styleguide.md'),
      matchesKnownShape('styleguide-v2.md'),
      classifyKind('Styleguide.md', '# Style guide'),
      classifyKind('styleguide-v2.md', '# Style guide'),
      classifyKind('notes.md', '```markdown\n**Status:** APPROVED\n```'),
      classifyKind('notes.md', '```markdown\n**Verdict:** APPROVED\n```'),
    ]).toEqual([false, false, 'unclassified', 'unclassified', 'unclassified', 'unclassified']);
  });

  // Covers: task:3
  it('derives approved and superseded dispositions from declared ADR statuses', () => {
    const approved = '**Status:** APPROVED';
    const operatorApproved = '**Status:** Approved (operator, 2026-09-28)';
    const superseded = '**Status:** SUPERSEDED by ADR-002';

    expect(deriveDisposition(approved)).toEqual({ disposition: 'approved', declared: 'APPROVED' });
    expect(deriveDisposition(operatorApproved)).toEqual({
      disposition: 'approved',
      declared: 'Approved (operator, 2026-09-28)',
    });
    expect(deriveDisposition(superseded)).toEqual({
      disposition: 'superseded',
      declared: 'SUPERSEDED by ADR-002',
    });
    expect(adrApprovalStatus(approved).approved).toBe(true);
    expect(adrApprovalStatus(operatorApproved).approved).toBe(true);
    expect(adrApprovalStatus(superseded).approved).toBe(true);
  });

  // Covers: task:3
  it('preserves declared statuses that are neither approved nor superseded', () => {
    expect(deriveDisposition('**Status:** Accepted')).toEqual({
      disposition: 'other',
      declared: 'Accepted',
    });
    expect(deriveDisposition('**Status:** ACTIVE')).toEqual({ disposition: 'other', declared: 'ACTIVE' });
    expect(deriveDisposition('**Status:** Proposed')).toEqual({ disposition: 'other', declared: 'Proposed' });
    expect(deriveDisposition('**Verdict:** APPROVED WITH CONDITIONS')).toEqual({
      disposition: 'other',
      declared: 'APPROVED WITH CONDITIONS',
    });
    expect(deriveDisposition('**Status:** Proposed\n\n**Verdict:** APPROVED')).toEqual({
      disposition: 'other',
      declared: 'Proposed',
    });
  });

  // Covers: task:3
  it('does not treat absent or fenced-only declarations as dispositions', () => {
    expect(deriveDisposition('# ADR without a declaration')).toEqual({
      disposition: 'undeclared',
      declared: null,
    });
    expect(deriveDisposition('```markdown\n**Status:** APPROVED\n```')).toEqual({
      disposition: 'undeclared',
      declared: null,
    });
  });

  // Covers: task:4
  it('enumerates regular Markdown records into complete index rows', async () => {
    const root = await createCorpusRoot();
    const directory = featureManifest.MANIFEST_KIND_LOCATIONS.decision.directory;
    await Promise.all([
      writeCorpusRecord(root, 'adr-2026-01-02-hello.md', '# Approve hello\n\n**Date:** 2026-01-02\n**Status:** APPROVED\n\n## Decision\n\nAdopt the hello approach.\n'),
      writeCorpusRecord(root, 'architecture-review-2026-01-03-layout.md', '# Layout review\n\n**Verdict:** APPROVED WITH CONDITIONS\n\n## Decision\n\nReview the layout.\n'),
      writeCorpusRecord(root, 'technical-assessment-2026-01-04.md', '# Technical assessment\n\n## Decision\n\nAssess the implementation.\n'),
      writeCorpusRecord(root, 'styleguide.md', '# Style guide\n\nA reference paragraph.\n'),
      writeCorpusRecord(root, 'notes.md', '# Notes\n\nA plain paragraph.\n'),
      writeFile(join(root, directory, 'image.png'), 'not markdown', 'utf8'),
      mkdir(join(root, directory, 'nested')),
    ]);

    await expect(readDecisionCorpus(root)).resolves.toEqual({
      rows: [
        {
          path: '.docs/decisions/adr-2026-01-02-hello.md',
          kind: 'decision',
          disposition: 'approved',
          declared: 'APPROVED',
          date: '2026-01-02',
          title: 'Approve hello',
          summary: 'Adopt the hello approach.',
        },
        {
          path: '.docs/decisions/architecture-review-2026-01-03-layout.md',
          kind: 'review',
          disposition: 'other',
          declared: 'APPROVED WITH CONDITIONS',
          date: '2026-01-03',
          title: 'Layout review',
          summary: 'Review the layout.',
        },
        {
          path: '.docs/decisions/notes.md',
          kind: 'unclassified',
          disposition: 'undeclared',
          declared: null,
          date: '',
          title: 'Notes',
          summary: 'A plain paragraph.',
        },
        {
          path: '.docs/decisions/styleguide.md',
          kind: 'reference',
          disposition: 'undeclared',
          declared: null,
          date: '',
          title: 'Style guide',
          summary: 'A reference paragraph.',
        },
        {
          path: '.docs/decisions/technical-assessment-2026-01-04.md',
          kind: 'assessment',
          disposition: 'undeclared',
          declared: null,
          date: '2026-01-04',
          title: 'Technical assessment',
          summary: 'Assess the implementation.',
        },
      ],
      errors: [],
    });
  });

  // Covers: task:4
  it('falls back to a filename title and empty date', async () => {
    const root = await createCorpusRoot();
    await writeCorpusRecord(root, 'adr-without-metadata.md', 'A plain paragraph.\n');

    await expect(readDecisionCorpus(root)).resolves.toMatchObject({
      rows: [expect.objectContaining({ title: 'adr-without-metadata', date: '' })],
      errors: [],
    });
  });

  // Covers: task:4
  it('truncates the decision summary to 160 characters', async () => {
    const root = await createCorpusRoot();
    const summary = 'a'.repeat(161);
    await writeCorpusRecord(root, 'adr-2026-01-08-long.md', `# Long\n\n## Decision\n\n${summary}\n`);

    await expect(readDecisionCorpus(root)).resolves.toMatchObject({
      rows: [expect.objectContaining({ summary: 'a'.repeat(160) })],
      errors: [],
    });
  });

  // Covers: task:4
  it('uses the first Decision-section line when the record has no trailing newline', async () => {
    const root = await createCorpusRoot();
    await writeCorpusRecord(root, 'adr-2026-01-09-final-line.md', '# Title\n\nIntroductory paragraph.\n\n## Decision\n\nChosen outcome.');

    await expect(readDecisionCorpus(root)).resolves.toMatchObject({
      rows: [expect.objectContaining({ summary: 'Chosen outcome.' })],
      errors: [],
    });
  });

  // Covers: task:4
  it('returns no rows when the corpus directory is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'decision-corpus-missing-'));
    fixtureRoots.push(root);

    await expect(readDecisionCorpus(root)).resolves.toEqual({ rows: [], errors: [] });
  });

  // Covers: task:4
  it('resolves the corpus directory through the decision kind location', async () => {
    const alternateDirectory = '.docs/adr-alt/';
    const root = await createCorpusRoot(alternateDirectory);
    await writeCorpusRecord(root, 'adr-2026-01-05-alt.md', '# Alternate\n\n## Decision\n\nUse the relocated corpus.\n', alternateDirectory);
    vi.spyOn(featureManifest, 'MANIFEST_KIND_LOCATIONS', 'get').mockReturnValue({
      ...featureManifest.MANIFEST_KIND_LOCATIONS,
      decision: { ...featureManifest.MANIFEST_KIND_LOCATIONS.decision, directory: alternateDirectory },
    });

    await expect(readDecisionCorpus(root)).resolves.toMatchObject({
      rows: [expect.objectContaining({ path: '.docs/adr-alt/adr-2026-01-05-alt.md', title: 'Alternate' })],
      errors: [],
    });
  });

  // Covers: task:4
  it.skipIf(process.getuid?.() === 0)('reports unreadable records while retaining readable rows', async () => {
    const root = await createCorpusRoot();
    const directory = featureManifest.MANIFEST_KIND_LOCATIONS.decision.directory;
    const unreadable = join(root, directory, 'adr-2026-01-06-private.md');
    await Promise.all([
      writeCorpusRecord(root, 'adr-2026-01-07-readable.md', '# Readable\n\n## Decision\n\nKeep this row.\n'),
      writeFile(unreadable, '# Private\n', 'utf8'),
    ]);
    await (await import('node:fs/promises')).chmod(unreadable, 0o000);

    const corpus = await readDecisionCorpus(root);
    expect(corpus.rows).toEqual([expect.objectContaining({ path: '.docs/decisions/adr-2026-01-07-readable.md' })]);
    expect(corpus.errors).toEqual([expect.objectContaining({ path: '.docs/decisions/adr-2026-01-06-private.md' })]);
  });
});
