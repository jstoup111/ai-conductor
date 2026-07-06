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
