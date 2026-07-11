/**
 * Tests for halt-pr-reconciliation.ts (Task 15: reconcileHaltPrs).
 *
 * All gh interactions use fake runners; no real `gh` binary required.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { reconcileHaltPrs } from '../../src/engine/halt-pr-reconciliation.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const NEEDS_REMEDIATION_BODY_MARKER = '<!-- conductor:needs-remediation -->';
const PR_URL_BROKEN = 'https://github.com/owner/repo/pull/301';
const PR_URL_CONFORMING = 'https://github.com/owner/repo/pull/302';
const PR_URL_UNMARKED = 'https://github.com/owner/repo/pull/303';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * In-memory PR store for testing reconcileHaltPrs.
 * Tracks calls and mutates PR state in response to gh commands.
 */
interface FakePr {
  number: number;
  url: string;
  isDraft: boolean;
  labels: string[];
  body: string;
}

function makeFakeGhForReconciliation(prs: FakePr[]) {
  const calls: string[][] = [];
  const byUrl = new Map(prs.map((p) => [p.url, p]));

  const find = (url: string): FakePr => {
    const pr = byUrl.get(url);
    if (!pr) throw new Error(`fake gh: unknown PR ${url}`);
    return pr;
  };

  const gh: GhRunner = async (args: string[]) => {
    calls.push([...args]);

    // `gh pr list --json number,url,body,isDraft,labels --state open ...`
    if (args[0] === 'pr' && args[1] === 'list') {
      return {
        stdout: JSON.stringify(
          prs.map((p) => ({
            number: p.number,
            url: p.url,
            body: p.body,
            isDraft: p.isDraft,
            labels: p.labels.map((name) => ({ name })),
          })),
        ),
      };
    }

    // `gh pr view <url> --json isDraft,labels,body`
    if (args[0] === 'pr' && args[1] === 'view') {
      const url = args[2];
      const pr = find(url);
      return {
        stdout: JSON.stringify({
          isDraft: pr.isDraft,
          labels: pr.labels.map((name) => ({ name })),
          body: pr.body,
        }),
      };
    }

    // `gh pr ready --undo <url>` (convert to draft)
    if (args[0] === 'pr' && args[1] === 'ready' && args.includes('--undo')) {
      const url = args[args.length - 1];
      const pr = find(url);
      pr.isDraft = true;
      return { stdout: '' };
    }

    // REST label add: `gh api --method POST repos/OWNER/REPO/issues/N/labels -f labels[]=<name>`
    if (args[0] === 'api' && args[2] === 'POST' && /\/labels$/.test(args[3] ?? '')) {
      const match = args[3]?.match(/issues\/(\d+)\//);
      const number = match ? Number(match[1]) : undefined;
      const pr = prs.find((p) => p.number === number);
      if (pr) {
        const label = (args[5] ?? '').replace(/^labels\[\]=/, '');
        if (!pr.labels.includes(label)) {
          pr.labels.push(label);
        }
      }
      return { stdout: '' };
    }

    // `gh pr edit <url> --body <body>` — body marker add
    if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
      const url = args[2];
      const pr = find(url);
      pr.body = args[args.indexOf('--body') + 1];
      return { stdout: '' };
    }

    return { stdout: '' };
  };

  return { gh, calls, prs, byUrl, get: (url: string) => find(url) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('reconcileHaltPrs (Task 15)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'halt-pr-reconcile-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should heal a marked-broken PR (missing label or draft), leave conforming marked PR untouched, and skip unmarked PR', async () => {
    // Arrange: three PRs with different states
    const broken: FakePr = {
      number: 301,
      url: PR_URL_BROKEN,
      isDraft: false, // drifted: should be draft
      labels: [], // drifted: label lost
      body: `Halt body.\n\n${NEEDS_REMEDIATION_BODY_MARKER}`,
    };
    const conforming: FakePr = {
      number: 302,
      url: PR_URL_CONFORMING,
      isDraft: true,
      labels: ['needs-remediation'],
      body: `Halt body.\n\n${NEEDS_REMEDIATION_BODY_MARKER}`,
    };
    const unmarkedReady: FakePr = {
      number: 303,
      url: PR_URL_UNMARKED,
      isDraft: false,
      labels: [],
      body: 'A completely normal feature PR description.',
    };

    const { gh, calls } = makeFakeGhForReconciliation([broken, conforming, unmarkedReady]);

    // Act
    await reconcileHaltPrs({ projectRoot: tempDir, runGh: gh });

    // Assert: broken PR is healed
    expect(broken.isDraft).toBe(true);
    expect(broken.labels).toContain('needs-remediation');

    // Assert: conforming PR receives NO mutating calls
    const mutatesPr302 = calls.filter(
      (c) =>
        (c[0] === 'pr' && (c[1] === 'ready' || c[1] === 'edit') && c.includes(PR_URL_CONFORMING)) ||
        (c[0] === 'api' && c.some((a) => a.includes('/302/'))),
    );
    expect(mutatesPr302).toHaveLength(0);

    // Assert: unmarked ready PR is never touched
    expect(unmarkedReady.isDraft).toBe(false);
    expect(unmarkedReady.labels).not.toContain('needs-remediation');
    const mutatesPr303 = calls.filter(
      (c) =>
        (c[0] === 'pr' && (c[1] === 'ready' || c[1] === 'edit') && c.includes(PR_URL_UNMARKED)) ||
        (c[0] === 'api' && c.some((a) => a.includes('/303/'))),
    );
    expect(mutatesPr303).toHaveLength(0);
  });

  it('should gracefully handle gh pr list throwing an error and return without throwing', async () => {
    // Arrange: fake gh that throws on pr list
    const failingGh: GhRunner = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'list') {
        throw new Error('network error: connection timeout');
      }
      return { stdout: '' };
    };

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Act & Assert: should not throw
    await expect(
      reconcileHaltPrs({ projectRoot: tempDir, runGh: failingGh, log }),
    ).resolves.toBeUndefined();

    // Assert: error was logged
    expect(logs.some((msg) => msg.includes('failed to enumerate PRs'))).toBe(true);
  });

  it('should gracefully handle gh pr list returning empty array and no-op', async () => {
    // Arrange: fake gh that returns empty PR list
    const emptyGh: GhRunner = async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'list') {
        return { stdout: '[]' };
      }
      return { stdout: '' };
    };

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Act: should not throw and should be a no-op
    await expect(
      reconcileHaltPrs({ projectRoot: tempDir, runGh: emptyGh, log }),
    ).resolves.toBeUndefined();

    // Assert: enumeration happened but found 0 PRs, and found 0 marked PRs
    expect(logs.some((msg) => msg.includes('enumerated 0 open PRs, found 0 marked'))).toBe(true);
  });

  it('(Task 16) should heal marked PR missing only label (already draft) → adds label only, no draft conversion', async () => {
    // Arrange: marked PR already in draft but missing the needs-remediation label
    const missingLabelOnly: FakePr = {
      number: 304,
      url: 'https://github.com/owner/repo/pull/304',
      isDraft: true, // already draft ✓
      labels: [], // missing needs-remediation label ✗
      body: `Halt body.\n\n${NEEDS_REMEDIATION_BODY_MARKER}`,
    };

    const { gh, calls } = makeFakeGhForReconciliation([missingLabelOnly]);

    // Act
    await reconcileHaltPrs({ projectRoot: tempDir, runGh: gh });

    // Assert: label should be added
    expect(missingLabelOnly.labels).toContain('needs-remediation');

    // Assert: no draft conversion should happen (no --undo call)
    const undoCalls = calls.filter(
      (c) => c[0] === 'pr' && c[1] === 'ready' && c.includes('--undo'),
    );
    expect(undoCalls).toHaveLength(0);

    // Assert: it should still be draft (idempotence: not converted to ready)
    expect(missingLabelOnly.isDraft).toBe(true);
  });

  it('(Task 16) should heal marked PR missing only draft (already labeled) → converts to draft only, no redundant label add', async () => {
    // Arrange: marked PR has the label but is not in draft
    const missingDraftOnly: FakePr = {
      number: 305,
      url: 'https://github.com/owner/repo/pull/305',
      isDraft: false, // not draft ✗
      labels: ['needs-remediation'], // already labeled ✓
      body: `Halt body.\n\n${NEEDS_REMEDIATION_BODY_MARKER}`,
    };

    const { gh, calls } = makeFakeGhForReconciliation([missingDraftOnly]);

    // Act
    await reconcileHaltPrs({ projectRoot: tempDir, runGh: gh });

    // Assert: should be converted to draft
    expect(missingDraftOnly.isDraft).toBe(true);

    // Assert: label should still be present (not removed)
    expect(missingDraftOnly.labels).toContain('needs-remediation');

    // Assert: verify at least one --undo call was made for draft conversion
    const undoCalls = calls.filter(
      (c) =>
        c[0] === 'pr' && c[1] === 'ready' && c.includes('--undo') &&
        c.includes(missingDraftOnly.url),
    );
    expect(undoCalls.length).toBeGreaterThan(0);
  });

  it('(Task 20) should NOT re-halt a finished PR after marker is stripped by cleanup (D5 negative path)', async () => {
    // Arrange: PR was previously marked (had label + draft + body marker),
    // but Task 19 cleanup has removed all three. The PR is now "finished" and
    // should remain unhalted across reconciliation sweeps.
    const finishedPr: FakePr = {
      number: 306,
      url: 'https://github.com/owner/repo/pull/306',
      isDraft: false, // cleanup converted back to ready ✓
      labels: [], // cleanup removed label ✓
      body: 'A clean feature PR description.\n\n', // cleanup stripped marker ✓
      // NOTE: marker is completely absent; this is the key condition
    };

    const { gh, calls } = makeFakeGhForReconciliation([finishedPr]);

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Act: run the reconciliation sweep
    await reconcileHaltPrs({ projectRoot: tempDir, runGh: gh, log });

    // Assert 1: PR should NOT be enumerated as marked because body marker is gone
    const log_foundMarked = logs.find((msg) => msg.includes('found 0 marked'));
    expect(log_foundMarked).toBeTruthy();

    // Assert 2: no mutating calls should be made to the finished PR
    // (no draft conversion, no label adds)
    const mutatesPr306 = calls.filter(
      (c) =>
        (c[0] === 'pr' && (c[1] === 'ready' || c[1] === 'edit') && c.includes(finishedPr.url)) ||
        (c[0] === 'api' && c.some((a) => a.includes('/306/'))),
    );
    expect(mutatesPr306).toHaveLength(0);

    // Assert 3: PR state unchanged (no re-halting)
    expect(finishedPr.isDraft).toBe(false); // still ready
    expect(finishedPr.labels).not.toContain('needs-remediation'); // no re-label
    expect(finishedPr.body).not.toContain(NEEDS_REMEDIATION_BODY_MARKER); // marker still gone
  });
});
