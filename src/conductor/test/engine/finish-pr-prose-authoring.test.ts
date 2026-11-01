// Covers: task:5, task:7
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import type { GithubOperationRequest, GithubOperationRunner, GithubPullRequestEditPayload } from '../../src/engine/github-operations.js';
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

function prEditOperations(onEdit: (payload: GithubPullRequestEditPayload) => void) {
  return {
    run: vi.fn(async (request: GithubOperationRequest) => {
      if (request.operation !== 'pull-request.edit') {
        throw new Error(`unexpected GitHub operation: ${request.operation}`);
      }
      onEdit(request.payload as GithubPullRequestEditPayload);
      return {};
    }),
  } satisfies GithubOperationRunner;
}

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
  continueToNextTransition = false,
): Promise<{ request: PrProseAuthoringRequest; judgmentDispatches: number }> {
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

    const dispatchJudgment = vi.fn(async () => ({ success: true }));
    const input = {
      state: {
        feature_desc: 'prose-guidance',
        worktree_branch: 'feat/prose-guidance',
        pr_url: PR_URL,
        build_review: 'done',
        test_suite: 'done',
        manual_test: 'done',
        architecture_review_as_built: 'done',
      } as ConductState,
      mode: 'auto' as const,
      daemon: true,
      dispatchJudgment,
      dispatchAuthoring,
      emit: async () => {},
    };
    await expect(coordinator.advance(input)).resolves.toEqual({
      kind: 'publication_progress', transition: 'author_pr_prose',
    });
    if (continueToNextTransition) await coordinator.advance(input);

    const request = dispatchAuthoring.mock.calls[0]?.[0];
    if (request === undefined) throw new Error('expected the authoring dispatch');
    return { request, judgmentDispatches: dispatchJudgment.mock.calls.length };
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
    const { request } = await dispatchPersistedRevisionAuthoring(
      'Explain the user-visible recovery behavior.',
    );

    expect(request).toEqual({
      kind: 'finish_pr_prose_authoring',
      pullRequestUrl: PR_URL,
      authoringScope: ['title', 'body'],
      maximumPasses: 1,
      revisionGuidance: 'Explain the user-visible recovery behavior.',
    });
  });

  it('re-judges the new revision after a persisted deficient verdict is authored', async () => {
    const result = await dispatchPersistedRevisionAuthoring(undefined, true);

    expect(result.judgmentDispatches).toBe(1);
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
    const { request } = await dispatchPersistedRevisionAuthoring(undefined);

    expect(request).toEqual({
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

  it('counts the N=1 authoring transition in the per-feature publication progress allowance', async () => {
    const mod = await import(FINISH_PUBLICATION_MODULE);
    expect(mod.publicationProgressAllowance(snapshot())).toBe(2 * 7);
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

describe('production FINISH authoring dispatch failure', () => {
  it('retries a failed authoring run instead of halting it as an unmoved transition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-authoring-failure-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      const body = '<!-- conductor:pr-body-floor -->\n## Why\n\nTBD\n';
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git: async (args) => args[0] === 'remote'
          ? { stdout: 'origin\n' }
          : { stdout: 'refs/remotes/origin/feat/prose-failure\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') {
            return { stdout: JSON.stringify({ url: PR_URL, title: 'feat: prose-failure', body, isDraft: true, labels: [] }) };
          }
          throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
        },
        observeReleaseReadiness: async () => 'present',
      });
      // The provider aborted: it returned a failed result and wrote nothing.
      const dispatchAuthoring = vi.fn(async () => ({ success: false }));

      const result = await coordinator.advance({
        state: {
          feature_desc: 'prose-failure',
          worktree_branch: 'feat/prose-failure',
          pr_url: PR_URL,
          build_review: 'done',
          test_suite: 'done',
          manual_test: 'done',
          architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'auto',
        daemon: true,
        dispatchJudgment: vi.fn(async () => ({ success: true })),
        dispatchAuthoring,
        emit: async () => {},
      });

      expect(dispatchAuthoring).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        kind: 'publication_retry',
        transition: 'author_pr_prose',
        reason: 'authoring_dispatch_failed',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('production FINISH invalid prose handoffs', () => {
  // Covers: task:5
  it.each([
    ['unparseable JSON', '{not JSON', 'could not be parsed'],
    ['an unsupported version', JSON.stringify({ version: 2, title: 'fix: title', body: 'Reader-facing body.' }), 'version'],
    ['a missing title', JSON.stringify({ version: 1, body: 'Reader-facing body.' }), 'title'],
    ['a missing body', JSON.stringify({ version: 1, title: 'fix: title' }), 'body'],
    ['a non-string title', JSON.stringify({ version: 1, title: 7, body: 'Reader-facing body.' }), 'title'],
    ['a non-string body', JSON.stringify({ version: 1, title: 'fix: title', body: 7 }), 'body'],
    ['a whitespace-only title', JSON.stringify({ version: 1, title: ' \t ', body: 'Reader-facing body.' }), 'title'],
    ['a whitespace-only body', JSON.stringify({ version: 1, title: 'fix: title', body: ' \n ' }), 'body'],
  ])('returns prose_invalid and never edits the PR for %s', async (_label, handoff, detail) => {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-invalid-handoff-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      const body = '<!-- conductor:pr-body-floor -->\n\n## Why\n\n_Not yet authored_\n';
      const operations = { run: vi.fn(async () => ({})) };
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git: async (args) => args[0] === 'remote'
          ? { stdout: 'origin\n' }
          : { stdout: 'refs/remotes/origin/feat/prose-invalid\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') {
            return { stdout: JSON.stringify({ url: PR_URL, title: 'fix: draft', body, isDraft: true, labels: [] }) };
          }
          throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
        },
        operations,
        observeReleaseReadiness: async () => 'present',
      });

      await expect(coordinator.advance({
        state: {
          feature_desc: 'prose-invalid', worktree_branch: 'feat/prose-invalid', pr_url: PR_URL,
          build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'auto', daemon: true,
        dispatchJudgment: async () => ({ success: true }),
        dispatchAuthoring: async () => {
          await writeFile(join(pipeline, 'finish-pr-prose.json'), handoff);
          return { success: true };
        },
        emit: async () => {},
      })).resolves.toEqual({
        kind: 'publication_retry', transition: 'author_pr_prose', reason: 'prose_invalid',
        detail: expect.stringContaining(detail),
      });
      expect(operations.run).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:5
  it('rejects an unchanged engine-floor handoff before it edits the retained PR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-placeholder-handoff-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      const body = '<!-- conductor:pr-body-floor -->\n\n## Why\n\n_Not yet authored_\n';
      const operations = { run: vi.fn(async () => ({})) };
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', operations,
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/prose-placeholder\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: PR_URL, title: 'fix: draft', body, isDraft: true, labels: [] }) };
          throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
        },
        observeReleaseReadiness: async () => 'present',
      });

      await expect(coordinator.advance({
        state: { feature_desc: 'prose-placeholder', worktree_branch: 'feat/prose-placeholder', pr_url: PR_URL, build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done' } as ConductState,
        mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }),
        dispatchAuthoring: async () => {
          await writeFile(join(pipeline, 'finish-pr-prose.json'), JSON.stringify({ version: 1, title: 'fix: draft', body }));
          return { success: true };
        },
        emit: async () => {},
      })).resolves.toEqual({
        kind: 'publication_retry', transition: 'author_pr_prose', reason: 'prose_invalid',
        detail: 'PR-prose handoff body is still placeholder.',
      });
      expect(operations.run).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:5
  it('rejects a handoff that loses the retained PR closing reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-closes-handoff-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      const currentBody = '<!-- conductor:pr-body-floor -->\n\n## Why\n\n_Not yet authored_\n\nCloses acme/widget#1364\n';
      const operations = { run: vi.fn(async () => ({})) };
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', operations,
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/prose-closes\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: PR_URL, title: 'fix: draft', body: currentBody, isDraft: true, labels: [] }) };
          throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
        },
        observeReleaseReadiness: async () => 'present',
      });

      await expect(coordinator.advance({
        state: { feature_desc: 'prose-closes', worktree_branch: 'feat/prose-closes', pr_url: PR_URL, build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done' } as ConductState,
        mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }),
        dispatchAuthoring: async () => {
          await writeFile(join(pipeline, 'finish-pr-prose.json'), JSON.stringify({ version: 1, title: 'fix: authored', body: '## Why\n\nReplacement prose.' }));
          return { success: true };
        },
        emit: async () => {},
      })).resolves.toEqual({
        kind: 'publication_retry', transition: 'author_pr_prose', reason: 'prose_invalid',
        detail: 'PR-prose handoff body must retain Closes acme/widget#1364.',
      });
      expect(operations.run).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:5
  it('publishes valid prose when neither retained nor returned body has a closing reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-no-closes-handoff-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      let title = 'fix: draft';
      let body = '<!-- conductor:pr-body-floor -->\n\n## Why\n\n_Not yet authored_\n';
      const operations = prEditOperations((payload) => {
        title = payload.title ?? title;
        body = payload.body ?? body;
      });
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', operations,
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/prose-no-closes\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: PR_URL, title, body, isDraft: true, labels: [] }) };
          throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
        },
        observeReleaseReadiness: async () => 'present',
      });

      await expect(coordinator.advance({
        state: { feature_desc: 'prose-no-closes', worktree_branch: 'feat/prose-no-closes', pr_url: PR_URL, build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done' } as ConductState,
        mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }),
        dispatchAuthoring: async () => {
          await writeFile(join(pipeline, 'finish-pr-prose.json'), JSON.stringify({ version: 1, title: 'fix: authored', body: '## Why\n\nReplacement prose.' }));
          return { success: true };
        },
        emit: async () => {},
      })).resolves.toEqual({ kind: 'publication_progress', transition: 'author_pr_prose' });
      expect(operations.run).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('production FINISH authoring retry guidance', () => {
  async function retryAfterHandoffFailure(firstHandoff: string | undefined, initialBody: string) {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-retry-guidance-'));
    const pipeline = join(root, '.pipeline');
    await mkdir(pipeline);
    await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
    let title = 'fix: draft';
    let body = initialBody;
    const operations = prEditOperations((payload) => {
      title = payload.title ?? title;
      body = payload.body ?? body;
    });
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', operations,
      git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/prose-retry-guidance\n' },
      gh: async (args) => {
        if (args[0] === 'auth') return { stdout: '' };
        if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: PR_URL, title, body, isDraft: true, labels: [] }) };
        throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
      },
      observeReleaseReadiness: async () => 'present',
    });
    let calls = 0;
    const dispatchAuthoring = vi.fn(async (_request: PrProseAuthoringRequest) => {
      calls++;
      if (calls === 1) {
        if (firstHandoff !== undefined) await writeFile(join(pipeline, 'finish-pr-prose.json'), firstHandoff);
      } else {
        await writeFile(join(pipeline, 'finish-pr-prose.json'), JSON.stringify({
          version: 1, title: 'fix: authored', body: '## Why\n\nThe retry returned valid prose.\n',
        }));
      }
      return { success: true };
    });
    const input = {
      state: {
        feature_desc: 'prose-retry-guidance', worktree_branch: 'feat/prose-retry-guidance', pr_url: PR_URL,
        build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done',
      } as ConductState,
      mode: 'auto' as const, daemon: true,
      dispatchJudgment: async () => ({ success: true }), dispatchAuthoring, emit: async () => {},
    };
    try {
      const first = await coordinator.advance(input);
      const second = await coordinator.advance(input);
      return { first, second, requests: dispatchAuthoring.mock.calls.map(([request]) => request), operations };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  // Covers: task:7
  it('carries an invalid handoff detail into the next authoring request', async () => {
    const result = await retryAfterHandoffFailure(
      JSON.stringify({ version: 1, title: 'fix: authored', body: '## Why\n\nThe closing reference is absent.\n' }),
      '<!-- conductor:pr-body-floor -->\n\n## Why\n\n_Not yet authored_\n\nCloses acme/widget#1364\n',
    );

    expect(result.requests[1]).toEqual(expect.objectContaining({
      revisionGuidance: 'PR-prose handoff body must retain Closes acme/widget#1364.',
    }));
  });

  // Covers: task:7
  it('tells the next authoring pass about a missing handoff and publishes its valid retry', async () => {
    const result = await retryAfterHandoffFailure(
      undefined,
      '<!-- conductor:pr-body-floor -->\n\n## Why\n\n_Not yet authored_\n',
    );

    expect(result.requests[1]).toEqual(expect.objectContaining({
      revisionGuidance: 'No PR-prose handoff was written to .pipeline/finish-pr-prose.json.',
    }));
    expect(result.second).toEqual({ kind: 'publication_progress', transition: 'author_pr_prose' });
    expect(result.operations.run).toHaveBeenCalledOnce();
  });

  // Covers: task:7
  it('publishes a persisted revision pass through the engine before re-judging it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-persisted-revision-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      let title = 'fix: needs a revision';
      let body = '## Why\n\nThe original prose omits reader evidence.\n';
      const initialRevision = `${PR_URL}\u0000${JSON.stringify([title, body])}`;
      const digest = createHash('sha256').update(initialRevision, 'utf8').digest('hex');
      await writeFile(join(pipeline, 'prose-judgment.json'), JSON.stringify({
        version: 1,
        records: { [digest]: { kind: 'revision_required', reason: 'structurally_incomplete', detail: 'Name the reader evidence.' } },
      }));
      const operations = prEditOperations((payload) => {
        title = payload.title ?? title;
        body = payload.body ?? body;
      });
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', operations,
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/persisted-revision\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: PR_URL, title, body, isDraft: true, labels: [] }) };
          throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
        },
        observeReleaseReadiness: async () => 'present',
      });
      const dispatchJudgment = vi.fn(async () => ({ success: true }));
      const input = {
        state: {
          feature_desc: 'persisted-revision', worktree_branch: 'feat/persisted-revision', pr_url: PR_URL,
          build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done',
        } as ConductState,
        mode: 'auto' as const, daemon: true, dispatchJudgment,
        dispatchAuthoring: async () => {
          await writeFile(join(pipeline, 'finish-pr-prose.json'), JSON.stringify({
            version: 1, title: 'fix: reader evidence', body: '## Why\n\nReaders can now verify the evidence.\n',
          }));
          return { success: true };
        },
        emit: async () => {},
      };

      await coordinator.advance(input);
      await coordinator.advance(input);

      expect({ edits: operations.run.mock.calls.length, judgments: dispatchJudgment.mock.calls.length }).toEqual({
        edits: 1, judgments: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('production FINISH engine-owned PR-prose edits', () => {
  // Covers: task:6
  it('halts with the failed guarded edit cause instead of an unmoved transition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-edit-failure-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      const body = '<!-- conductor:pr-body-floor -->\n\n## Why\n\n_Not yet authored_\n';
      const missingScope = 'missing read:org scope';
      const operations = { run: vi.fn(async () => { throw new Error(missingScope); }) };
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', operations,
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/prose-edit-failure\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: PR_URL, title: 'fix: draft', body, isDraft: true, labels: [] }) };
          throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
        },
        observeReleaseReadiness: async () => 'present',
      });

      await expect(coordinator.advance({
        state: { feature_desc: 'prose-edit-failure', worktree_branch: 'feat/prose-edit-failure', pr_url: PR_URL, build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done' } as ConductState,
        mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }),
        dispatchAuthoring: async () => {
          await writeFile(join(pipeline, 'finish-pr-prose.json'), JSON.stringify({ version: 1, title: 'fix: authored', body: '## Why\n\nPublished by the engine.' }));
          return { success: true };
        },
        emit: async () => {},
      })).resolves.toEqual({
        kind: 'human_required', reason: 'publication_operation_failed',
        detail: `pull-request.edit failed: guarded pull-request.edit failed: ${missingScope}`,
      });
      expect(operations.run).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:6
  it('halts with the guarded-edit refusal when no operation boundary is available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-edit-refusal-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      const body = '<!-- conductor:pr-body-floor -->\n\n## Why\n\n_Not yet authored_\n';
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main',
        // This deliberately does not provide `operations`; the fixture's
        // origin is not a GitHub repository, so production cannot derive one.
        git: async (args) => args[0] === 'remote'
          ? { stdout: 'origin\n' }
          : { stdout: 'not-a-github-origin\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: PR_URL, title: 'fix: draft', body, isDraft: true, labels: [] }) };
          throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
        },
        observeReleaseReadiness: async () => 'present',
      });

      await expect(coordinator.advance({
        state: { feature_desc: 'prose-edit-refusal', worktree_branch: 'feat/prose-edit-refusal', pr_url: PR_URL, build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done' } as ConductState,
        mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }),
        dispatchAuthoring: async () => {
          await writeFile(join(pipeline, 'finish-pr-prose.json'), JSON.stringify({ version: 1, title: 'fix: authored', body: '## Why\n\nPublished by the engine.' }));
          return { success: true };
        },
        emit: async () => {},
      })).resolves.toEqual({
        kind: 'human_required', reason: 'publication_operation_failed',
        detail: 'pull-request.edit failed: guarded pull-request.edit unavailable: missing feature operation boundary',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:6
  it('accepts a moved PR after the engine edit reports failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-edit-moved-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      const placeholder = '<!-- conductor:pr-body-floor -->\n\n## Why\n\n_Not yet authored_\n';
      let views = 0;
      const operations = { run: vi.fn(async () => { throw new Error('connection reset after edit'); }) };
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', operations,
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/prose-edit-moved\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') {
            views++;
            const body = views === 3 ? '## Why\n\nThe guarded request completed remotely.' : placeholder;
            return { stdout: JSON.stringify({ url: PR_URL, title: 'fix: authored', body, isDraft: true, labels: [] }) };
          }
          throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
        },
        observeReleaseReadiness: async () => 'present',
      });

      await expect(coordinator.advance({
        state: { feature_desc: 'prose-edit-moved', worktree_branch: 'feat/prose-edit-moved', pr_url: PR_URL, build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done' } as ConductState,
        mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }),
        dispatchAuthoring: async () => {
          await writeFile(join(pipeline, 'finish-pr-prose.json'), JSON.stringify({ version: 1, title: 'fix: authored', body: '## Why\n\nThe guarded request completed remotely.' }));
          return { success: true };
        },
        emit: async () => {},
      })).resolves.toEqual({ kind: 'publication_progress', transition: 'author_pr_prose' });
      expect(operations.run).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:6
  it('halts an executed edit that leaves the PR prose at the engine floor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-prose-edit-unmoved-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      await writeFile(join(pipeline, 'finish-choice'), 'pr\n');
      const body = '<!-- conductor:pr-body-floor -->\n\n## Why\n\n_Not yet authored_\n';
      const operations = { run: vi.fn(async () => ({})) };
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', operations,
        git: async (args) => args[0] === 'remote' ? { stdout: 'origin\n' } : { stdout: 'refs/remotes/origin/feat/prose-edit-unmoved\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ url: PR_URL, title: 'fix: draft', body, isDraft: true, labels: [] }) };
          throw new Error(`unexpected GitHub command: ${args.join(' ')}`);
        },
        observeReleaseReadiness: async () => 'present',
      });

      await expect(coordinator.advance({
        state: { feature_desc: 'prose-edit-unmoved', worktree_branch: 'feat/prose-edit-unmoved', pr_url: PR_URL, build_review: 'done', test_suite: 'done', manual_test: 'done', architecture_review_as_built: 'done' } as ConductState,
        mode: 'auto', daemon: true, dispatchJudgment: async () => ({ success: true }),
        dispatchAuthoring: async () => {
          await writeFile(join(pipeline, 'finish-pr-prose.json'), JSON.stringify({ version: 1, title: 'fix: authored', body: '## Why\n\nThe engine sent an edit.' }));
          return { success: true };
        },
        emit: async () => {},
      })).resolves.toEqual({
        kind: 'human_required', reason: 'publication_transition_unmoved',
        detail: 'The author_pr_prose transition left pr.prose unchanged at placeholder.',
      });
      expect(operations.run).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
