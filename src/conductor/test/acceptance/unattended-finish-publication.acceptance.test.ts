/**
 * RED acceptance specs for coherent FINISH publication.
 *
 * Covers: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10,
 * FR-11, FR-12, FR-13.
 *
 * Stories: .docs/stories/unattended-finish-spends-minutes-before-determinis.md
 * Plan:    .docs/plans/unattended-finish-spends-minutes-before-determinis.md
 * ADR:     .docs/decisions/adr-2026-08-01-engine-owned-resumable-finish-publication.md
 *
 * Project shape: headless TypeScript CLI/daemon. These specs therefore drive
 * the public engine boundary rather than a UI. The GitHub and judgment
 * adapters below are faithful in-memory fakes for third-party boundaries; the
 * coordinator, transition selection, routing, and Conductor wiring remain the
 * real production subjects.
 *
 * Proposed seam where the plan deliberately leaves symbol names open:
 * `finish-publication.ts#advanceFinishPublication` performs one
 * observe-before-act, verify-after-write transition and returns a typed
 * disposition. The behavior and domain terms are pinned by the approved
 * stories/ADR; only this symbol name is proposed by the RED spec.
 *
 * Replacement-entry-point coverage:
 * `Conductor.run()` is exercised at the end of this file. It must select the
 * safe foreground-auto keep outcome without dispatching the legacy FINISH
 * judgment path. A coordinator that exists but is not wired into the real
 * loop therefore cannot make this suite green.
 *
 * Production call sites required by the approved plan:
 *   - src/conductor/src/engine/conductor.ts#run
 *   - src/conductor/src/engine/step-runners.ts#runDispatch
 */

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const FINISH_PUBLICATION_MODULE = '../../src/engine/finish-publication.js';
const PR_URL = 'https://github.com/acme/widget/pull/1172';

type EvidenceState = 'valid' | 'invalid' | 'indeterminate';
type PublicationMode = 'interactive' | 'foreground' | 'foreground-auto' | 'daemon';
type PublicationIntent = 'pr' | 'keep' | 'defer' | 'discard' | 'merge' | 'ambiguous';
type PrIdentity = 'missing' | 'one' | 'ambiguous' | 'conflict';
type ProseState = 'accepted' | 'placeholder' | 'halt' | 'stale' | 'malformed';

interface PublicationSnapshot {
  mode: PublicationMode;
  intent: PublicationIntent | null;
  implementationEvidence: EvidenceState;
  shipEvidence: EvidenceState;
  releaseReadiness: EvidenceState;
  branchPushed: EvidenceState;
  pr: {
    identity: PrIdentity;
    url?: string;
    prose: ProseState;
    ready: boolean;
  };
  shippedRecord: EvidenceState | 'missing' | 'mismatched';
  outcomeRecord: EvidenceState | 'missing';
}

interface PublicationCondition {
  code: string;
  message: string;
  nextAction: string;
}

type PublicationResult =
  | { kind: 'advanced'; transition: string }
  | { kind: 'publication_retry'; condition: PublicationCondition }
  | { kind: 'implementation_invalid'; condition: PublicationCondition; evidence: string }
  | { kind: 'human_required'; condition: PublicationCondition }
  | { kind: 'complete' };

interface FinishPublicationEffects {
  establishPr: {
    cwd: string;
    branch: string;
    baseBranch: string;
    git: (args: string[]) => Promise<{ stdout: string }>;
    gh: (args: string[]) => Promise<{ stdout: string }>;
  };
  createShippedRecord: () => Promise<void>;
  dispatchJudgment: () => Promise<{ kind: string; reason?: string }>;
  repairPresentation: () => Promise<void>;
  recordOutcome: () => Promise<void>;
}

interface AdvanceFinishPublicationInput {
  observe: () => Promise<PublicationSnapshot>;
  effects: FinishPublicationEffects;
}

type AdvanceFinishPublication = (
  input: AdvanceFinishPublicationInput,
) => Promise<PublicationResult>;

async function loadAdvanceFinishPublication(): Promise<AdvanceFinishPublication> {
  const mod = (await import(FINISH_PUBLICATION_MODULE)) as Record<string, unknown>;
  const fn = mod.advanceFinishPublication;
  if (typeof fn !== 'function') {
    throw new Error(
      'expected export "advanceFinishPublication" to be a function (not yet implemented)',
    );
  }
  return fn as AdvanceFinishPublication;
}

function readySnapshot(overrides: Partial<PublicationSnapshot> = {}): PublicationSnapshot {
  const base: PublicationSnapshot = {
    mode: 'daemon',
    intent: 'pr',
    implementationEvidence: 'valid',
    shipEvidence: 'valid',
    releaseReadiness: 'valid',
    branchPushed: 'valid',
    pr: { identity: 'one', url: PR_URL, prose: 'placeholder', ready: false },
    shippedRecord: 'valid',
    outcomeRecord: 'missing',
  };
  return {
    ...base,
    ...overrides,
    pr: { ...base.pr, ...(overrides.pr ?? {}) },
  };
}

function makePublicationFixture(initial: PublicationSnapshot) {
  let snapshot = structuredClone(initial);
  const calls: string[] = [];
  const fail = new Map<string, Error>();
  const responseLost = new Set<string>();

  const mutate = async (name: string, action: () => void): Promise<void> => {
    calls.push(name);
    const error = fail.get(name);
    if (error) throw error;
    action();
    if (responseLost.has(name)) {
      responseLost.delete(name);
      throw new Error(`${name} response lost after write`);
    }
  };

  const effects: FinishPublicationEffects = {
    establishPr: {
      cwd: '/fixture',
      branch: 'feat/fixture',
      baseBranch: 'main',
      git: async (args) => {
        if (args[0] === 'rev-list') return { stdout: '1\n' };
        return { stdout: '' };
      },
      gh: async (args) => {
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === 'feat/fixture') {
          if (snapshot.pr.identity === 'one' && snapshot.pr.url) {
            return { stdout: JSON.stringify({ url: snapshot.pr.url, state: 'OPEN' }) };
          }
          throw new Error('no open PR');
        }
        if (args[0] === 'pr' && args[1] === 'create') {
          await mutate('establish-pr', () => {
            snapshot.pr.identity = 'one';
            snapshot.pr.url = PR_URL;
          });
          return { stdout: `${PR_URL}\n` };
        }
        return { stdout: '' };
      },
    },
    createShippedRecord: () =>
      mutate('create-shipped-record', () => {
        snapshot.shippedRecord = 'valid';
      }),
    dispatchJudgment: () =>
      mutate('dispatch-judgment', () => {
        snapshot.pr.prose = 'accepted';
      }).then(() => ({ kind: 'accepted' as const })),
    repairPresentation: () =>
      mutate('repair-presentation', () => {
        snapshot.pr.ready = true;
      }),
    recordOutcome: () =>
      mutate('record-outcome', () => {
        snapshot.outcomeRecord = 'valid';
      }),
  };

  return {
    calls,
    effects,
    fail,
    responseLost,
    observe: async () => structuredClone(snapshot),
    snapshot: () => structuredClone(snapshot),
    replace: (next: PublicationSnapshot) => {
      snapshot = structuredClone(next);
    },
  };
}

async function driveToTerminal(
  advance: AdvanceFinishPublication,
  fixture: ReturnType<typeof makePublicationFixture>,
): Promise<PublicationResult> {
  for (let count = 0; count < 12; count++) {
    const result = await advance({ observe: fixture.observe, effects: fixture.effects });
    if (result.kind !== 'advanced') return result;
  }
  throw new Error('publication did not converge within 12 transitions');
}

describe('Story 1 — deterministic blockers precede judgment (FR-1, FR-2)', () => {
  it('reaches the prose boundary exactly once when every deterministic prerequisite is ready', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(readySnapshot());

    const result = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect(result).toEqual({ kind: 'advanced', transition: 'judge_pr_prose' });
    expect(fixture.calls).toEqual(['dispatch-judgment']);
  });

  it.each([
    ['invalid', 'release_readiness_invalid'],
    ['indeterminate', 'release_readiness_indeterminate'],
  ] as const)(
    'reports %s release readiness with an actionable typed condition and zero judgment dispatches',
    async (releaseReadiness, expectedCode) => {
      const advance = await loadAdvanceFinishPublication();
      const fixture = makePublicationFixture(readySnapshot({ releaseReadiness }));

      const result = await advance({ observe: fixture.observe, effects: fixture.effects });

      expect(result.kind).not.toBe('complete');
      expect('condition' in result && result.condition).toEqual(
        expect.objectContaining({
          code: expectedCode,
          message: expect.any(String),
          nextAction: expect.any(String),
        }),
      );
      expect(fixture.calls).toEqual([]);
    },
  );

  it('selects the same actionable blocker for the same multi-gap observation', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({ releaseReadiness: 'invalid', branchPushed: 'indeterminate' }),
    );

    const first = await advance({ observe: fixture.observe, effects: fixture.effects });
    const second = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect('condition' in first && first.condition.code).toBe(
      'condition' in second ? second.condition.code : undefined,
    );
    expect(fixture.calls).toEqual([]);
  });
});

describe('Story 2 — publication resumes without duplicate effects (FR-3, FR-4)', () => {
  it('starts at the first incomplete transition and retains verified prior effects after restart', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({
        pr: { identity: 'one', url: PR_URL, prose: 'accepted', ready: true },
        shippedRecord: 'missing',
      }),
    );

    const first = await advance({ observe: fixture.observe, effects: fixture.effects });
    const terminal = await driveToTerminal(advance, fixture);
    const afterRestart = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect(first).toEqual({ kind: 'advanced', transition: 'write_shipped_record' });
    expect(terminal).toEqual({ kind: 'complete' });
    expect(afterRestart).toEqual({ kind: 'complete' });
    expect(fixture.calls).toEqual(['create-shipped-record', 'record-outcome']);
  });

  it.each(['ambiguous'] as const)(
    'fails closed when authoritative PR identity is %s',
    async (identity) => {
      const advance = await loadAdvanceFinishPublication();
      const fixture = makePublicationFixture(
        readySnapshot({ pr: { identity, prose: 'accepted', ready: true } }),
      );

      const result = await advance({ observe: fixture.observe, effects: fixture.effects });

      expect(result.kind).toBe('human_required');
      expect(fixture.calls).toEqual([]);
    },
  );

  it('rediscovers a PR whose write succeeded after its response was lost', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({ pr: { identity: 'missing', prose: 'placeholder', ready: false } }),
    );
    fixture.responseLost.add('establish-pr');

    const first = await advance({ observe: fixture.observe, effects: fixture.effects });
    const terminal = await driveToTerminal(advance, fixture);

    expect(first).toEqual({ kind: 'advanced', transition: 'establish_pr' });
    expect(terminal.kind).toBe('complete');
    expect(fixture.calls.filter((call) => call === 'establish-pr')).toHaveLength(1);
    expect(fixture.snapshot().pr.url).toBe(PR_URL);
  });

  it('concurrent resume attempts converge on one observable PR and one final outcome', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({ pr: { identity: 'missing', prose: 'placeholder', ready: false } }),
    );

    await Promise.all([
      advance({ observe: fixture.observe, effects: fixture.effects }),
      advance({ observe: fixture.observe, effects: fixture.effects }),
    ]);
    const terminal = await driveToTerminal(advance, fixture);

    expect(terminal.kind).toBe('complete');
    expect(fixture.snapshot().pr.url).toBe(PR_URL);
    expect(fixture.snapshot().outcomeRecord).toBe('valid');
    expect(fixture.calls.filter((call) => call === 'record-outcome')).toHaveLength(1);
  });
});

describe('Story 3 — recovery remains local to FINISH unless implementation proof is invalid (FR-5, FR-6)', () => {
  it('classifies a presentation outage as publication_retry without a BUILD or remediation effect', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({ pr: { identity: 'one', url: PR_URL, prose: 'accepted', ready: false } }),
    );
    fixture.fail.set('repair-presentation', new Error('GitHub unavailable'));

    const result = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect(result.kind).toBe('publication_retry');
    expect(fixture.calls).toEqual(['repair-presentation']);
    expect(fixture.snapshot().implementationEvidence).toBe('valid');
  });

  it.each(['invalid', 'indeterminate'] as const)(
    'routes %s implementation evidence to a typed non-success disposition with cited evidence',
    async (implementationEvidence) => {
      const advance = await loadAdvanceFinishPublication();
      const fixture = makePublicationFixture(readySnapshot({ implementationEvidence }));

      const result = await advance({ observe: fixture.observe, effects: fixture.effects });

      if (implementationEvidence === 'invalid') {
        expect(result.kind).toBe('implementation_invalid');
        expect('evidence' in result ? result.evidence : '').not.toBe('');
      } else {
        expect(result.kind).toBe('publication_retry');
      }
      expect(fixture.calls).toEqual([]);
    },
  );

  it('re-evaluates stale implementation proof even after publication effects completed', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({
        implementationEvidence: 'invalid',
        pr: { identity: 'one', url: PR_URL, prose: 'accepted', ready: true },
        outcomeRecord: 'missing',
      }),
    );

    const result = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect(result.kind).toBe('implementation_invalid');
    expect(fixture.calls).toEqual([]);
  });
});

describe('Story 4 — judgment is one bounded prose-quality pass (FR-7, FR-8)', () => {
  it('uses one judgment pass for placeholder prose and none after accepted content is observed', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({ pr: { identity: 'missing', prose: 'placeholder', ready: false } }),
    );

    const terminal = await driveToTerminal(advance, fixture);
    const retry = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect(terminal.kind).toBe('complete');
    expect(retry.kind).toBe('complete');
    expect(fixture.calls.filter((call) => call === 'dispatch-judgment')).toHaveLength(1);
  });

  it.each(['malformed', 'halt'] as const)(
    'does not record completion when the judgment result remains %s prose',
    async (prose) => {
      const advance = await loadAdvanceFinishPublication();
      const fixture = makePublicationFixture(readySnapshot());
      fixture.effects.dispatchJudgment = async () => {
        fixture.calls.push('dispatch-judgment');
        fixture.replace(readySnapshot({ pr: { identity: 'one', url: PR_URL, prose, ready: false } }));
        return {
          kind: 'revision_required',
          reason: prose === 'halt' ? 'halt' : 'structurally_incomplete',
        };
      };

      const result = await advance({ observe: fixture.observe, effects: fixture.effects });
      const next = await advance({ observe: fixture.observe, effects: fixture.effects });

      expect(result.kind).not.toBe('complete');
      expect(next.kind).not.toBe('complete');
      expect(fixture.snapshot().outcomeRecord).toBe('missing');
    },
  );

  it('preserves verified effects across provider failure and does not repeat accepted prose judgment', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(readySnapshot());
    fixture.fail.set('dispatch-judgment', new Error('provider timeout'));

    const failed = await advance({ observe: fixture.observe, effects: fixture.effects });
    fixture.fail.delete('dispatch-judgment');
    const terminal = await driveToTerminal(advance, fixture);
    const resumed = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect(failed.kind).toBe('publication_retry');
    expect(terminal.kind).toBe('complete');
    expect(resumed.kind).toBe('complete');
    expect(fixture.calls.filter((call) => call === 'dispatch-judgment')).toHaveLength(2);
  });
});

describe('Stories 5 and 6 — mode authority and safe unattended publication (FR-9–FR-12)', () => {
  it.each([
    ['interactive', null],
    ['interactive', 'defer'],
    ['daemon', 'ambiguous'],
    ['daemon', 'discard'],
    ['daemon', 'merge'],
  ] as const)('halts %s intent %s without synthesizing publication effects', async (mode, intent) => {
    const mod = await import(FINISH_PUBLICATION_MODULE);
    const result = mode === 'interactive'
      ? mod.resolveInteractivePublicationIntent(intent)
      : mod.resolveUnattendedPublicationIntent({
          mode: 'daemon',
          capabilities: { remote: 'configured', authentication: 'authenticated' },
          requestedOutcome: intent,
        });

    expect(result).toMatchObject({ kind: 'human_required' });
  });

  it('authorizes create/push/ready publication effects without exposing merge authority', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({ pr: { identity: 'missing', prose: 'placeholder', ready: false } }),
    );

    const terminal = await driveToTerminal(advance, fixture);

    expect(terminal.kind).toBe('complete');
    expect(fixture.calls).toEqual([
      'establish-pr',
      'dispatch-judgment',
      'repair-presentation',
      'record-outcome',
    ]);
    expect(fixture.calls.some((call) => /merge/i.test(call))).toBe(false);
  });

  it('keeps merge authority unreachable across production FINISH transitions and retries', async () => {
    conductorRoot = await mkdtemp(join(tmpdir(), 'finish-publication-no-merge-'));
    const pipeline = join(conductorRoot, '.pipeline');
    await mkdir(pipeline, { recursive: true });
    const prUrl = 'https://github.com/acme/widget/pull/1172';
    const githubCalls: string[][] = [];
    let pullRequest: { url: string; title: string; body: string; isDraft: boolean } | undefined;

    const rejectMergeAuthority = (args: string[]): void => {
      const command = args.join(' ').toLowerCase();
      if (
        (args[0] === 'pr' && args[1] === 'merge') ||
        command.includes('auto-merge') ||
        command.includes('enablepullrequestautomerge') ||
        command.includes('--auto')
      ) {
        throw new Error(`FINISH reached forbidden merge authority: gh ${args.join(' ')}`);
      }
    };
    const gh = vi.fn(async (args: string[]) => {
      rejectMergeAuthority(args);
      githubCalls.push([...args]);
      if (args[0] === 'auth' && args[1] === 'status') return { stdout: '' };
      if (args[0] === 'pr' && args[1] === 'view' && args[2] === 'feat/feature') {
        if (!pullRequest) throw new Error('no open PR');
        return { stdout: JSON.stringify({ url: pullRequest.url, state: 'OPEN' }) };
      }
      if (args[0] === 'pr' && args[1] === 'create') {
        pullRequest = {
          url: prUrl,
          title: 'feat: feature',
          body: '<!-- conductor:pr-body-floor -->\n\n## Summary\n\nfeature',
          isDraft: true,
        };
        return { stdout: `${prUrl}\n` };
      }
      if (args[0] === 'pr' && args[1] === 'view' && args[2] === prUrl && pullRequest) {
        return { stdout: JSON.stringify(pullRequest) };
      }
      if (args[0] === 'pr' && args[1] === 'ready' && args[2] === prUrl && pullRequest) {
        pullRequest.isDraft = false;
        return { stdout: '' };
      }
      throw new Error(`unexpected GitHub command: gh ${args.join(' ')}`);
    });
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'remote') return { stdout: 'origin\n' };
      if (args[0] === 'rev-list') return { stdout: '1\n' };
      if (args[0] === 'rev-parse') return { stdout: 'refs/remotes/origin/feat/feature\n' };
      if (args[0] === 'merge-base') return { stdout: '' };
      if (args[0] === 'push') return { stdout: '' };
      throw new Error(`unexpected git command: git ${args.join(' ')}`);
    });
    const state = {
      feature_desc: 'feature',
      worktree_branch: 'feat/feature',
      build_review: 'done',
      test_suite: 'done',
      manual_test: 'done',
      architecture_review_as_built: 'done',
    } as ConductState;
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot: conductorRoot,
      stateFilePath: join(pipeline, 'conduct-state.json'),
      baseBranch: 'main',
      git,
      gh,
      observeReleaseReadiness: async () => 'present',
      writeShippedRecord: async () => {
        await mkdir(join(conductorRoot!, '.docs', 'shipped'), { recursive: true });
        await writeFile(join(conductorRoot!, '.docs', 'shipped', 'feature.md'), 'shipped\n');
        return 0;
      },
      recordFinish: async () => {
        await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
        return 0;
      },
    });
    const transitions: string[] = [];
    let judgmentDispatches = 0;
    let terminal: Awaited<ReturnType<typeof coordinator.advance>> | undefined;

    for (let attempt = 0; attempt < 8; attempt++) {
      terminal = await coordinator.advance({
        state,
        mode: 'auto',
        daemon: true,
        dispatchJudgment: async (request) => {
          if (!pullRequest) throw new Error('judgment requires a PR');
          // Faithful provider fake: it sees only the coordinator's bounded
          // title/body contract, repairs those two fields, and returns the
          // structured result the production adapter decodes.
          expect(request).toEqual({
            kind: 'finish_pr_prose_quality',
            pullRequestUrl: prUrl,
            qualityScope: ['title', 'body'],
            maximumPasses: 1,
          });
          judgmentDispatches++;
          pullRequest.title = 'feat: publish coherent finish';
          pullRequest.body = 'A reader-facing summary of the completed change.';
          return { success: true, publicationDisposition: { kind: 'accepted' } };
        },
        emit: async (event) => {
          if (event.type === 'finish_publication_transition' && event.phase === 'completed') {
            transitions.push(event.transition);
          }
        },
      });
      if (terminal.kind === 'complete') break;
    }

    expect(terminal).toEqual({ kind: 'complete' });
    expect(transitions).toEqual([
      'establish_pr',
      'write_shipped_record',
      'judge_pr_prose',
      'ready_pr',
      'record_outcome',
    ]);
    expect(githubCalls.some((args) => args[0] === 'pr' && args[1] === 'merge')).toBe(false);
    expect(githubCalls.some((args) => /auto-merge|enablepullrequestautomerge|--auto/i.test(args.join(' ')))).toBe(false);
    expect(judgmentDispatches).toBe(1);
  });

  it('retains prior verified state when GitHub is unavailable during a load-bearing write', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({ pr: { identity: 'missing', prose: 'placeholder', ready: false } }),
    );
    fixture.fail.set('establish-pr', new Error('GitHub unavailable'));

    const result = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect(result.kind).not.toBe('complete');
    expect(fixture.snapshot().shippedRecord).toBe('valid');
    expect(fixture.snapshot().outcomeRecord).toBe('missing');
  });
});

describe('Story 7 — completion is a coherent commit point (FR-13)', () => {
  it.each([
    ['implementationEvidence', 'invalid'],
    ['shipEvidence', 'invalid'],
    ['releaseReadiness', 'invalid'],
    ['branchPushed', 'invalid'],
    ['shippedRecord', 'mismatched'],
  ] as const)('does not record an outcome while %s is %s', async (field, value) => {
    const advance = await loadAdvanceFinishPublication();
    const snapshot = readySnapshot({
      pr: { identity: 'one', url: PR_URL, prose: 'accepted', ready: true },
    });
    Object.assign(snapshot, { [field]: value });
    const fixture = makePublicationFixture(snapshot);

    const result = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect(result.kind).not.toBe('complete');
    expect(fixture.calls).not.toContain('record-outcome');
    expect(fixture.snapshot().outcomeRecord).toBe('missing');
  });

  it('revalidates an existing final marker instead of accepting marker presence alone', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({
        branchPushed: 'invalid',
        pr: { identity: 'one', url: PR_URL, prose: 'accepted', ready: true },
        outcomeRecord: 'valid',
      }),
    );

    const result = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect(result.kind).not.toBe('complete');
    expect(fixture.calls).toEqual([]);
  });

  it('recovers when the outcome write lands but its response is lost', async () => {
    const advance = await loadAdvanceFinishPublication();
    const fixture = makePublicationFixture(
      readySnapshot({ pr: { identity: 'one', url: PR_URL, prose: 'accepted', ready: true } }),
    );
    fixture.responseLost.add('record-outcome');

    const first = await advance({ observe: fixture.observe, effects: fixture.effects });
    const resumed = await advance({ observe: fixture.observe, effects: fixture.effects });

    expect(first.kind).toBe('complete');
    expect(resumed.kind).toBe('complete');
    expect(fixture.calls.filter((call) => call === 'record-outcome')).toHaveLength(1);
  });
});

let conductorRoot: string | undefined;

afterEach(async () => {
  if (conductorRoot) {
    await rm(conductorRoot, { recursive: true, force: true });
    conductorRoot = undefined;
  }
});

describe('real entry point — Conductor.run mode convergence (FR-9, FR-11)', () => {
  it('foreground-auto with no publishable remote records keep without legacy FINISH judgment', async () => {
    conductorRoot = await mkdtemp(join(tmpdir(), 'finish-publication-conductor-'));
    await mkdir(join(conductorRoot, '.pipeline'), { recursive: true });
    const stateFilePath = join(conductorRoot, '.pipeline', 'conduct-state.json');
    const state: Record<string, unknown> = { feature_desc: 'coherent FINISH publication' };
    for (const step of ALL_STEPS) {
      if (step.name === 'finish') break;
      state[step.name] = 'done';
    }
    Object.assign(state, {
      complexity_tier: 'L',
      manual_test: 'done',
      prd_audit: 'skipped',
      architecture_review_as_built: 'done',
      retro: 'skipped',
      rebase: 'skipped',
      finish: 'pending',
    });
    await writeState(stateFilePath, state as ConductState);

    const runner: StepRunner = {
      run: vi.fn(async (_step: StepName) => ({ success: true, output: 'legacy finish ran' })),
    };
    const events = new ConductorEventEmitter();
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: runner,
      events,
      projectRoot: conductorRoot,
      mode: 'auto',
      daemon: false,
      fromStep: 'finish',
      verifyArtifacts: false,
      finishPublication: createProductionFinishPublicationCoordinator({
        projectRoot: conductorRoot,
        stateFilePath,
        baseBranch: 'main',
        git: async () => ({ stdout: '' }),
        gh: async () => {
          throw new Error('GitHub must not be called for safe keep');
        },
        observeReleaseReadiness: async () => 'present',
        recordFinish: async () => {
          await writeFile(join(conductorRoot!, '.pipeline', 'finish-choice'), 'keep\n');
          return 0;
        },
      }),
      git: async (args) => {
        if (args.includes('--symbolic-full-name')) throw new Error('no upstream');
        return { stdout: '' };
      },
      gh: async () => {
        throw new Error('GitHub must not be called for safe keep');
      },
    });

    await conductor.run();

    const finalState = await readState(stateFilePath);
    const choice = await readFile(join(conductorRoot, '.pipeline', 'finish-choice'), 'utf8');
    expect(runner.run).not.toHaveBeenCalledWith('finish', expect.anything(), expect.anything());
    expect(choice.trim()).toBe('keep');
    expect(finalState.ok && finalState.value.finish).toBe('done');
    await expect(access(join(conductorRoot, '.pipeline', 'HALT'))).rejects.toThrow();
  });
});
