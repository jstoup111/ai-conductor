// Covers: task:5
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import type { ConductState } from '../../src/types/index.js';

/**
 * FINISH must never reach its bounded prose judgment with an unauthored PR
 * body. The engine already observes a placeholder body deterministically
 * (`prProse` recognises the SHIP-entry body-floor marker), so selecting an
 * authoring pass is machinery — only the authoring itself needs a provider.
 *
 * These tests pin that guarantee at the narrowest seams: the deterministic
 * transition selector, the coordinator's authoring transition, the judgment
 * result routing, and the provider-response decoder.
 */
const FINISH_PUBLICATION_MODULE = '../../src/engine/finish-publication.js';

type PublicationSnapshot = import('../../src/engine/finish-publication.js').PublicationSnapshot;
type PublicationTransition = import('../../src/engine/finish-publication.js').PublicationTransition;
type AdvanceResult =
  import('../../src/engine/finish-publication.js').AdvanceFinishPublicationResult;
type PrProseAuthoringRequest =
  import('../../src/engine/finish-publication.js').PrProseAuthoringRequest;

const PR_URL = 'https://github.com/acme/widget/pull/1364';

function snapshot(overrides: Partial<PublicationSnapshot> = {}): PublicationSnapshot {
  return {
    mode: 'daemon',
    intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
    implementationEvidence: 'valid',
    shipEvidence: 'valid',
    releaseReadiness: 'valid',
    branchPushed: 'valid',
    pr: { identity: 'one', url: PR_URL, prose: 'accepted', ready: true },
    shippedRecord: 'valid',
    outcomeRecord: 'missing',
    ...overrides,
  } as PublicationSnapshot;
}

async function nextTransition(input: PublicationSnapshot): Promise<PublicationTransition> {
  const mod = await import(FINISH_PUBLICATION_MODULE);
  return mod.nextFinishPublicationTransition(input) as PublicationTransition;
}

async function advance(
  input: Parameters<
    typeof import('../../src/engine/finish-publication.js').advanceFinishPublication
  >[0],
): Promise<AdvanceResult> {
  const mod = await import(FINISH_PUBLICATION_MODULE);
  return mod.advanceFinishPublication(input) as Promise<AdvanceResult>;
}

async function dispatchPersistedRevisionAuthoring(
  detail: string | undefined,
): Promise<PrProseAuthoringRequest> {
  const root = await mkdtemp(join(tmpdir(), 'finish-prose-authoring-guidance-'));
  try {
    const pipeline = join(root, '.pipeline');
    await mkdir(pipeline);
    await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
    const title = 'fix: preserve authoring guidance';
    let body = '## Why\n\nThe original prose needs revision.\n';
    const revision = `${PR_URL}\u0000${JSON.stringify([title, body])}`;
    const digest = createHash('sha256').update(revision, 'utf8').digest('hex');
    await writeFile(join(pipeline, 'prose-judgment.json'), JSON.stringify({
      version: 1,
      records: {
        [digest]: {
          kind: 'revision_required',
          reason: 'structurally_incomplete',
          ...(detail === undefined ? {} : { detail }),
        },
      },
    }));

    const dispatchAuthoring = vi.fn(async (_request: PrProseAuthoringRequest) => {
      body = '## Why\n\nThe reader can now see the recovery path.\n';
      return { success: true };
    });
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot: root,
      stateFilePath: join(pipeline, 'conduct-state.json'),
      baseBranch: 'main',
      git: async (args) => args[0] === 'remote'
        ? { stdout: 'origin\n' }
        : { stdout: 'refs/remotes/origin/feat/prose-guidance\n' },
      gh: async (args) => {
        if (args[0] === 'auth') return { stdout: '' };
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ url: PR_URL, title, body, isDraft: true, labels: [] }) };
        }
        throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
      },
      observeReleaseReadiness: async () => 'present',
    });

    await expect(coordinator.advance({
      state: {
        feature_desc: 'prose-guidance',
        worktree_branch: 'feat/prose-guidance',
        pr_url: PR_URL,
        build_review: 'done',
        test_suite: 'done',
        manual_test: 'done',
        architecture_review_as_built: 'done',
      } as ConductState,
      mode: 'auto',
      daemon: true,
      dispatchJudgment: async () => ({ success: true }),
      dispatchAuthoring,
      emit: async () => {},
    })).resolves.toEqual({ kind: 'publication_progress', transition: 'author_pr_prose' });

    const request = dispatchAuthoring.mock.calls[0]?.[0];
    if (request === undefined) throw new Error('expected the authoring dispatch');
    return request;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('FINISH authors PR prose before it judges it', () => {
  it('selects the authoring transition for a deterministically unauthored body', async () => {
    await expect(
      nextTransition(snapshot({ pr: { identity: 'one', url: PR_URL, prose: 'placeholder', ready: false } })),
    ).resolves.toBe('author_pr_prose');
  });

  it.each(['stale', 'halt', 'indeterminate'] as const)(
    'still routes %s prose to judgment rather than authoring',
    async (prose) => {
      await expect(
        nextTransition(snapshot({ pr: { identity: 'one', url: PR_URL, prose, ready: false } })),
      ).resolves.toBe('judge_pr_prose');
    },
  );

  it('defers the shipped record until the prose is accepted', async () => {
    // The shipped record is the daemon-backlog dedup key: committing it before
    // prose is accepted makes a prose halt permanently un-redispatchable.
    await expect(
      nextTransition(
        snapshot({
          shippedRecord: 'missing',
          pr: { identity: 'one', url: PR_URL, prose: 'placeholder', ready: false },
        }),
      ),
    ).resolves.toBe('author_pr_prose');
    await expect(
      nextTransition(
        snapshot({
          shippedRecord: 'missing',
          pr: { identity: 'one', url: PR_URL, prose: 'stale', ready: false },
        }),
      ),
    ).resolves.toBe('judge_pr_prose');
    await expect(
      nextTransition(snapshot({ shippedRecord: 'missing' })),
    ).resolves.toBe('write_shipped_record');
  });

  it('dispatches authoring, never judgment, for an unauthored body and verifies by re-observation', async () => {
    let prose: 'placeholder' | 'accepted' = 'placeholder';
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' as const }));
    const createShippedRecord = vi.fn(async () => undefined);
    const authorProse = vi.fn(async () => {
      prose = 'accepted';
    });

    await expect(
      advance({
        observe: async () => snapshot({ pr: { identity: 'one', url: PR_URL, prose, ready: false } }),
        effects: { dispatchJudgment, authorProse, createShippedRecord },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'author_pr_prose' });

    expect(authorProse).toHaveBeenCalledWith({
      kind: 'finish_pr_prose_authoring',
      pullRequestUrl: PR_URL,
      authoringScope: ['title', 'body'],
      maximumPasses: 1,
    });
    expect(dispatchJudgment).not.toHaveBeenCalled();
    // A prose halt must stay recoverable: no dedup evidence is committed yet.
    expect(createShippedRecord).not.toHaveBeenCalled();
  });

  it('passes the persisted judge objection to the revision authoring pass', async () => {
    let prose: 'revision_required' | 'accepted' = 'revision_required';
    const authorProse = vi.fn(async () => {
      prose = 'accepted';
    });

    await expect(
      advance({
        observe: async () => snapshot({
          pr: {
            identity: 'one',
            url: PR_URL,
            prose,
            ready: false,
            revisionGuidance: 'Explain the user-visible recovery behavior.',
          },
        }),
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), authorProse },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'author_pr_prose' });

    expect(authorProse).toHaveBeenCalledWith({
      kind: 'finish_pr_prose_authoring',
      pullRequestUrl: PR_URL,
      authoringScope: ['title', 'body'],
      maximumPasses: 1,
      revisionGuidance: 'Explain the user-visible recovery behavior.',
    });
  });

  it('threads persisted verdict detail through the production observation boundary', async () => {
    await expect(
      dispatchPersistedRevisionAuthoring('Explain the user-visible recovery behavior.'),
    ).resolves.toEqual({
      kind: 'finish_pr_prose_authoring',
      pullRequestUrl: PR_URL,
      authoringScope: ['title', 'body'],
      maximumPasses: 1,
      revisionGuidance: 'Explain the user-visible recovery behavior.',
    });
  });

  it('still dispatches a detail-less revision authoring pass without guidance', async () => {
    let prose: 'revision_required' | 'accepted' = 'revision_required';
    const authorProse = vi.fn(async () => {
      prose = 'accepted';
    });

    await expect(
      advance({
        observe: async () => snapshot({
          pr: { identity: 'one', url: PR_URL, prose, ready: false },
        }),
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), authorProse },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'author_pr_prose' });

    expect(authorProse).toHaveBeenCalledWith({
      kind: 'finish_pr_prose_authoring',
      pullRequestUrl: PR_URL,
      authoringScope: ['title', 'body'],
      maximumPasses: 1,
    });
  });

  it('still dispatches an authoring pass when the persisted verdict has no detail', async () => {
    await expect(dispatchPersistedRevisionAuthoring(undefined)).resolves.toEqual({
      kind: 'finish_pr_prose_authoring',
      pullRequestUrl: PR_URL,
      authoringScope: ['title', 'body'],
      maximumPasses: 1,
    });
  });

  it('halts when a completed authoring pass left the body unauthored', async () => {
    const authorProse = vi.fn(async () => undefined);

    await expect(
      advance({
        observe: async () =>
          snapshot({ pr: { identity: 'one', url: PR_URL, prose: 'placeholder', ready: false } }),
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), authorProse },
      }),
    ).resolves.toEqual(expect.objectContaining({
      kind: 'human_required',
      reason: 'publication_transition_unmoved',
      detail: expect.stringContaining('author_pr_prose'),
    }));
    expect(authorProse).toHaveBeenCalledTimes(1);
  });

  it('reports an unwired authoring effect as a non-retryable publication reason', async () => {
    const mod = await import(FINISH_PUBLICATION_MODULE);

    await expect(
      advance({
        observe: async () =>
          snapshot({ pr: { identity: 'one', url: PR_URL, prose: 'placeholder', ready: false } }),
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }) },
      }),
    ).resolves.toEqual({
      kind: 'publication_retry',
      transition: 'author_pr_prose',
      reason: 'authoring_effect_unavailable',
    });
    expect(mod.nonRetryablePublicationReason('authoring_effect_unavailable')).toEqual(
      expect.stringContaining('not wired'),
    );
  });

  it('halts a failed authoring retry when fresh observation selects a different transition', async () => {
    let observation = 0;

    await expect(
      advance({
        observe: async () => {
          observation++;
          return snapshot({
            releaseReadiness: observation === 1 ? 'valid' : 'missing',
            pr: { identity: 'one', url: PR_URL, prose: 'placeholder', ready: false },
          });
        },
        effects: {
          dispatchJudgment: async () => ({ kind: 'accepted' }),
          authorProse: async () => { throw new Error('provider timeout'); },
        },
      }),
    ).resolves.toEqual(expect.objectContaining({
      kind: 'human_required',
      reason: 'publication_transition_unmoved',
      detail: expect.stringContaining('verify_release_readiness'),
    }));
  });

  it.each(['placeholder', 'structurally_incomplete'] as const)(
    'halts a %s judgment verdict when a fresh observation cannot select authoring',
    async (reason) => {
      const dispatchJudgment = vi.fn(async () => ({
        kind: 'revision_required' as const,
        reason,
      }));

      await expect(
        advance({
          observe: async () =>
            snapshot({ pr: { identity: 'one', url: PR_URL, prose: 'stale', ready: false } }),
          effects: { dispatchJudgment, authorProse: async () => undefined },
        }),
      ).resolves.toEqual(expect.objectContaining({
        kind: 'human_required',
        reason: 'publication_transition_unmoved',
        detail: expect.stringContaining('author_pr_prose'),
      }));
    },
  );

  it('keeps a halt-text verdict a human decision', async () => {
    await expect(
      advance({
        observe: async () =>
          snapshot({ pr: { identity: 'one', url: PR_URL, prose: 'stale', ready: false } }),
        effects: {
          dispatchJudgment: async () => ({ kind: 'revision_required', reason: 'halt' }),
          authorProse: async () => undefined,
        },
      }),
    ).resolves.toEqual({ kind: 'human_required', reason: 'judgment_halt_prose' });
  });

  it('separates an undecodable provider response from a genuine incompleteness verdict', async () => {
    const { decodePrProseJudgment } = await import('../../src/engine/finish-pr-prose-judgment.js');

    expect(decodePrProseJudgment({ success: true, output: 'I cannot repair this myself.' })).toEqual({
      kind: 'malformed_response',
    });
    expect(
      decodePrProseJudgment({
        success: true,
        publicationDisposition: { kind: 'revision_required', reason: 'structurally_incomplete' },
      }),
    ).toEqual({ kind: 'revision_required', reason: 'structurally_incomplete' });

    await expect(
      advance({
        observe: async () =>
          snapshot({ pr: { identity: 'one', url: PR_URL, prose: 'stale', ready: false } }),
        effects: {
          dispatchJudgment: async () => ({ kind: 'malformed_response' }),
          authorProse: async () => undefined,
        },
      }),
    ).resolves.toEqual({
      kind: 'publication_retry',
      transition: 'judge_pr_prose',
      reason: 'judgment_malformed_response',
    });
  });

  it('counts the authoring transition in the publication progress allowance', async () => {
    const mod = await import(FINISH_PUBLICATION_MODULE);
    expect(mod.FINISH_PUBLICATION_PROGRESS_ALLOWANCE).toBe(2 * 7);
  });

  it('accepts the authoring transition at the disposition routing boundary', async () => {
    const mod = await import(FINISH_PUBLICATION_MODULE);
    expect(
      mod.routeFinishPublicationDisposition({
        kind: 'publication_progress',
        transition: 'author_pr_prose',
      }),
    ).toEqual({ kind: 'progress_finish', transition: 'author_pr_prose' });
  });
});
