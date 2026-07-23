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

describe('requeueClaimed() — claimed to pending recovery (FR-1, FR-4, FR-11)', () => {
  it('moves a claimed entry to pending, preserves capturedAt, bumps attempts, refreshes lastSeenAt', async () => {
    const l = createLedger(join(dir, 'ledger.json'));
    await l.record({ source: 'github-issues', sourceRef: 'o/a#1' });
    await l.transition('github-issues', 'o/a#1', 'claimed');
    const before = await l.get('github-issues', 'o/a#1');

    await l.requeueClaimed('github-issues', 'o/a#1');

    const after = await l.get('github-issues', 'o/a#1');
    expect(after?.status).toBe('pending');
    expect(after?.capturedAt).toBe(before?.capturedAt);
    expect(after?.attempts).toBe((before?.attempts ?? 0) + 1);
    expect(after?.lastSeenAt).toBeDefined();
  });
});
