// Ledger.transition() writebackPending meta (#290).
// Covers: setting true, clearing (false), omission leaves existing flag untouched,
// and existing {branch, prUrl} meta behavior remains unchanged.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger } from '../../../../src/engine/engineer/intake/ledger.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ledger-writeback-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('transition() writebackPending marker (#290)', () => {
  it('persists writebackPending: true on the entry', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'done', { writebackPending: true });
    const entry = await l.get('github-issues', 'o/a#1');
    expect(entry?.writebackPending).toBe(true);
  });

  it('removes writebackPending when transitioned with false', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'done', { writebackPending: true });
    await l.transition('github-issues', 'o/a#1', 'done', { writebackPending: false });
    const entry = await l.get('github-issues', 'o/a#1');
    expect(entry?.writebackPending).toBeUndefined();
  });

  it('leaves an existing writebackPending flag untouched when omitted', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'done', { writebackPending: true });
    await l.transition('github-issues', 'o/a#1', 'done', {});
    const entry = await l.get('github-issues', 'o/a#1');
    expect(entry?.writebackPending).toBe(true);
  });

  it('keeps existing {branch, prUrl} meta behavior unchanged', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'claimed', { branch: 'feat/x' });
    await l.transition('github-issues', 'o/a#1', 'done', { prUrl: 'https://x/pr/1' });
    const entry = await l.get('github-issues', 'o/a#1');
    expect(entry?.branch).toBe('feat/x');
    expect(entry?.prUrl).toBe('https://x/pr/1');
  });
});

describe('Jira ref dedup (Story 3/5) — ledger key is opaque to ref shape', () => {
  it('recording the same (source, "PROJ-123") twice recognizes the duplicate', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    expect(await l.known('jira', 'PROJ-123')).toBe(false);
    await l.record({ source: 'jira', sourceRef: 'PROJ-123' });
    expect(await l.known('jira', 'PROJ-123')).toBe(true);

    // Recording again must not create a second entry or reset status/attempts.
    await l.transition('jira', 'PROJ-123', 'claimed');
    await l.record({ source: 'jira', sourceRef: 'PROJ-123' });
    const entry = await l.get('jira', 'PROJ-123');
    expect(entry?.status).toBe('claimed');

    const entries = await l.list();
    expect(entries.filter((e) => e.sourceRef === 'PROJ-123')).toHaveLength(1);
  });

  it('treats "acme/app#49" and "PROJ-49" from the same source as distinct entries', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'jira', sourceRef: 'acme/app#49' });
    await l.record({ source: 'jira', sourceRef: 'PROJ-49' });

    expect(await l.known('jira', 'acme/app#49')).toBe(true);
    expect(await l.known('jira', 'PROJ-49')).toBe(true);

    const entries = await l.list();
    const refs = entries.map((e) => e.sourceRef).sort();
    expect(refs).toEqual(['PROJ-49', 'acme/app#49']);
  });

  it('leaves existing GitHub dedup behavior unchanged alongside Jira refs', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    expect(await l.known('github-issues', 'o/a#1')).toBe(true);

    // Same sourceRef shape but from Jira source is distinct.
    await l.record({ source: 'jira', sourceRef: 'o/a#1' });
    const entries = await l.list();
    expect(entries.filter((e) => e.sourceRef === 'o/a#1')).toHaveLength(2);

    // Duplicate github-issues record is still a no-op.
    await l.transition('github-issues', 'o/a#1', 'done');
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    const ghEntry = await l.get('github-issues', 'o/a#1');
    expect(ghEntry?.status).toBe('done');
  });
});

describe('list() enumerator', () => {
  it('returns all LedgerEntry records regardless of status', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.record({ source: 'github-issues', sourceRef: 'o/a#2' });
    await l.transition('github-issues', 'o/a#2', 'done');
    await l.record({ source: 'github-issues', sourceRef: 'o/a#3' });
    await l.transition('github-issues', 'o/a#3', 'claimed');

    const entries = await l.list();

    expect(entries).toHaveLength(3);
    const statuses = entries.map((e) => e.status).sort();
    expect(statuses).toEqual(['claimed', 'done', 'pending']);
    const refs = entries.map((e) => e.sourceRef).sort();
    expect(refs).toEqual(['o/a#1', 'o/a#2', 'o/a#3']);
  });
});
