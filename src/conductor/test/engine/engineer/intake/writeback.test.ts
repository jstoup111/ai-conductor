// writeback.test.ts — shared intake write-back helpers (reportRouted / reportDone).
// One implementation backs both the test-only runEngineerMode loop and the live
// CLI primitives (`engineer land`/`handoff --source-ref`). These unit tests pin the
// contract: correct report status/meta, ledger transition, and ADVISORY semantics
// (a thrown port/ledger error is swallowed — write-back never aborts the caller).

import { describe, it, expect, vi } from 'vitest';
import { reportRouted, reportDone } from '../../../../src/engine/engineer/intake/writeback.js';
import type { IntakePort, EnvelopeStatus, ReportMeta } from '../../../../src/engine/engineer/intake/port.js';
import type { Ledger, LedgerStatus } from '../../../../src/engine/engineer/intake/ledger.js';

function fakePort(): { port: IntakePort; calls: Array<{ sourceRef: string; status: EnvelopeStatus; meta?: ReportMeta }> } {
  const calls: Array<{ sourceRef: string; status: EnvelopeStatus; meta?: ReportMeta }> = [];
  const port: IntakePort = {
    async report(sourceRef, status, meta) {
      calls.push({ sourceRef, status, meta });
    },
  };
  return { port, calls };
}

function fakeLedger(): { ledger: Ledger; transitions: Array<{ status: LedgerStatus; meta?: { branch?: string; prUrl?: string } }> } {
  const transitions: Array<{ status: LedgerStatus; meta?: { branch?: string; prUrl?: string } }> = [];
  const ledger: Ledger = {
    known: async () => true,
    record: async () => {},
    transition: async (_s, _r, status, meta) => {
      transitions.push({ status, meta });
    },
    get: async () => undefined,
    forget: async () => {},
    reopen: async () => {},
  };
  return { ledger, transitions };
}

describe('reportRouted', () => {
  it('reports routed with the resolved repo and transitions the ledger to routed', async () => {
    const { port, calls } = fakePort();
    const { ledger, transitions } = fakeLedger();
    await reportRouted({ source: 'github-issues', sourceRef: 'o/a#1', port, ledger }, 'target-repo');
    expect(calls).toEqual([{ sourceRef: 'o/a#1', status: 'routed', meta: { repo: 'target-repo' } }]);
    expect(transitions).toEqual([{ status: 'routed', meta: undefined }]);
  });

  it('is advisory: a throwing port does not abort, and the ledger still transitions', async () => {
    const port: IntakePort = { report: vi.fn().mockRejectedValue(new Error('gh down')) };
    const { ledger, transitions } = fakeLedger();
    await expect(
      reportRouted({ source: 'github-issues', sourceRef: 'o/a#1', port, ledger }, 'target-repo'),
    ).resolves.toBeUndefined();
    expect(transitions).toEqual([{ status: 'routed', meta: undefined }]);
  });

  it('is advisory: a throwing ledger transition is swallowed', async () => {
    const { port } = fakePort();
    const ledger: Ledger = {
      known: async () => false,
      record: async () => {},
      transition: vi.fn().mockRejectedValue(new Error('no entry')),
      get: async () => undefined,
      forget: async () => {},
      reopen: async () => {},
    };
    await expect(
      reportRouted({ source: 'github-issues', sourceRef: 'o/a#1', port, ledger }, 'target-repo'),
    ).resolves.toBeUndefined();
  });

  it('works with no port and no ledger (pure no-op)', async () => {
    await expect(reportRouted({ source: 'x', sourceRef: 'y' }, 'repo')).resolves.toBeUndefined();
  });
});

describe('reportDone', () => {
  it('reports done with the PR URL and transitions the ledger to done with prUrl+branch', async () => {
    const { port, calls } = fakePort();
    const { ledger, transitions } = fakeLedger();
    await reportDone({ source: 'github-issues', sourceRef: 'o/a#1', port, ledger }, 'https://x/pull/9', 'spec/foo');
    expect(calls).toEqual([{ sourceRef: 'o/a#1', status: 'done', meta: { prUrl: 'https://x/pull/9' } }]);
    expect(transitions).toEqual([{ status: 'done', meta: { prUrl: 'https://x/pull/9', branch: 'spec/foo' } }]);
  });

  it('omits branch from the transition meta when not provided', async () => {
    const { port } = fakePort();
    const { ledger, transitions } = fakeLedger();
    await reportDone({ source: 'github-issues', sourceRef: 'o/a#1', port, ledger }, 'https://x/pull/9');
    expect(transitions).toEqual([{ status: 'done', meta: { prUrl: 'https://x/pull/9' } }]);
  });

  it('is advisory: a throwing port never reverts a delivered PR', async () => {
    const port: IntakePort = { report: vi.fn().mockRejectedValue(new Error('gh down')) };
    const { ledger, transitions } = fakeLedger();
    await expect(
      reportDone({ source: 'github-issues', sourceRef: 'o/a#1', port, ledger }, 'https://x/pull/9'),
    ).resolves.toBeUndefined();
    expect(transitions).toEqual([{ status: 'done', meta: { prUrl: 'https://x/pull/9' } }]);
  });
});
