/**
 * The retained SHIP PR must be presentable BEFORE the first SHIP-phase step
 * that consumes it — whatever that step is.
 *
 * `openShipDraftPr` adopts any OPEN PR already on the branch, so a
 * `needs-remediation` placeholder left by an earlier HALT silently becomes the
 * retained SHIP PR. Every presentation repair used to be bound to the `finish`
 * step, which runs LAST, so a config-declared custom SHIP step scheduled before
 * finish was handed a placeholder it could only refuse.
 *
 * These are unit tests over `makeRetainedPrPresentable` and the registry-derived
 * `firstShipConsumer`. The GitHub boundary is a faithful in-memory PR fake —
 * mutations issued through the injected `gh` seam are applied to it and read
 * back, so idempotence is observed rather than asserted from call counts alone.
 * No real `gh` binary runs.
 */

import { describe, it, expect } from 'vitest';
import {
  makeRetainedPrPresentable,
  NEEDS_REMEDIATION_LABEL,
  NEEDS_REMEDIATION_TITLE_PREFIX,
  PR_BODY_FLOOR_MARKER,
  HALT_HISTORY_COMMENT_MARKER,
} from '../../src/engine/halt-pr-rehabilitation.js';
import {
  HALT_PR_BANNER_LINES,
  HALT_PR_BANNER_SENTINEL,
  NEEDS_REMEDIATION_BODY_MARKER,
  type GhRunner,
} from '../../src/engine/pr-labels.js';
import { buildStepRegistry, firstShipConsumer } from '../../src/engine/steps.js';
import type { HarnessConfig } from '../../src/types/index.js';

const PR_URL = 'https://github.com/acme/repo/pull/1292';
const CWD = '/repo';
const BRANCH = 'feat/daemon-mechanically-verify-llm-rebase-conflict-resolution';

interface FakePr {
  title: string;
  body: string;
  isDraft: boolean;
  labels: string[];
  comments: string[];
}

/** A `needs-remediation` halt placeholder, shaped exactly like PR #1292. */
function haltPlaceholder(): FakePr {
  return {
    title: `${NEEDS_REMEDIATION_TITLE_PREFIX} ${BRANCH} — manual remediation required`,
    body: [NEEDS_REMEDIATION_BODY_MARKER, '', ...HALT_PR_BANNER_LINES].join('\n'),
    isDraft: true,
    labels: [NEEDS_REMEDIATION_LABEL],
    comments: [],
  };
}

/**
 * Faithful fake of the `gh` surface these repairs use: `pr view --json`,
 * `pr edit --title/--body`, `pr ready`, `pr comment`, and the REST label
 * endpoints. Writes mutate the in-memory PR; reads reflect them.
 */
function fakeGitHub(pr: FakePr): { gh: GhRunner; calls: string[][]; pr: FakePr } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push([...args]);

    if (args[0] === 'pr' && args[1] === 'view') {
      const fields = (args[args.indexOf('--json') + 1] ?? '').split(',');
      const out: Record<string, unknown> = {};
      for (const field of fields) {
        if (field === 'title') out.title = pr.title;
        if (field === 'body') out.body = pr.body;
        if (field === 'isDraft') out.isDraft = pr.isDraft;
        if (field === 'labels') out.labels = pr.labels.map((name) => ({ name }));
        if (field === 'comments') out.comments = pr.comments.map((body) => ({ body }));
        if (field === 'url') out.url = PR_URL;
        if (field === 'state') out.state = 'OPEN';
      }
      return { stdout: JSON.stringify(out) };
    }

    if (args[0] === 'pr' && args[1] === 'edit') {
      const titleIdx = args.indexOf('--title');
      if (titleIdx >= 0) pr.title = args[titleIdx + 1];
      const bodyIdx = args.indexOf('--body');
      if (bodyIdx >= 0) pr.body = args[bodyIdx + 1];
      return { stdout: '' };
    }

    if (args[0] === 'pr' && args[1] === 'ready') {
      pr.isDraft = args.includes('--undo');
      return { stdout: '' };
    }

    if (args[0] === 'pr' && args[1] === 'comment') {
      pr.comments.push(args[args.indexOf('--body') + 1] ?? '');
      return { stdout: '' };
    }

    if (args[0] === 'api' && args[args.indexOf('--method') + 1] === 'DELETE') {
      const name = decodeURIComponent(String(args[3] ?? '').split('/labels/')[1] ?? '');
      pr.labels = pr.labels.filter((l) => l !== name);
      return { stdout: '' };
    }

    return { stdout: '' };
  };
  return { gh, calls, pr };
}

const repairDeps = (gh: GhRunner) => ({
  gh,
  cwd: CWD,
  prUrl: PR_URL,
  branch: BRANCH,
  featureDesc: 'mechanically verify llm rebase conflict resolution',
  sourceRef: 'acme/repo#77',
});

describe('makeRetainedPrPresentable', () => {
  it('turns an adopted needs-remediation placeholder into a presentable PR', async () => {
    const { gh, pr } = fakeGitHub(haltPlaceholder());

    const outcome = await makeRetainedPrPresentable(repairDeps(gh));

    expect(outcome).toBe('repaired');
    expect(pr.title).toBe('feat: mechanically verify llm rebase conflict resolution');
    expect(pr.title.startsWith(NEEDS_REMEDIATION_TITLE_PREFIX)).toBe(false);
    expect(pr.labels).not.toContain(NEEDS_REMEDIATION_LABEL);
    expect(pr.body).not.toContain(HALT_PR_BANNER_SENTINEL);
    expect(pr.body).not.toContain(NEEDS_REMEDIATION_BODY_MARKER);
    expect(pr.body).toContain('## Summary');
  });

  it('leaves the PR a DRAFT — the ready-for-review flip stays finish-only', async () => {
    const { gh, calls, pr } = fakeGitHub(haltPlaceholder());

    await makeRetainedPrPresentable(repairDeps(gh));

    expect(pr.isDraft).toBe(true);
    expect(calls.filter((c) => c[0] === 'pr' && c[1] === 'ready')).toHaveLength(0);
  });

  it('preserves the halt narrative as exactly one PR comment', async () => {
    const { gh, pr } = fakeGitHub(haltPlaceholder());

    await makeRetainedPrPresentable({ ...repairDeps(gh), haltReason: 'rebase conflict' });

    const history = pr.comments.filter((c) => c.includes(HALT_HISTORY_COMMENT_MARKER));
    expect(history).toHaveLength(1);
    expect(history[0]).toContain('rebase conflict');
  });

  it('injects the Closes reference once — safe at adoption, idempotent after', async () => {
    const { gh, pr } = fakeGitHub(haltPlaceholder());

    await makeRetainedPrPresentable(repairDeps(gh));
    await makeRetainedPrPresentable(repairDeps(gh));

    expect(pr.body.match(/Closes acme\/repo#77/g) ?? []).toHaveLength(1);
  });

  it('is idempotent: a second pass issues no mutation and leaves the PR correct', async () => {
    const { gh, pr } = fakeGitHub(haltPlaceholder());
    await makeRetainedPrPresentable(repairDeps(gh));
    const afterFirst = { ...pr, labels: [...pr.labels], comments: [...pr.comments] };

    const { gh: gh2, calls: calls2 } = fakeGitHub(pr);
    const outcome = await makeRetainedPrPresentable(repairDeps(gh2));

    expect(outcome).toBe('not-halt-pr');
    expect(calls2.filter((c) => c[1] === 'edit' || c[1] === 'comment' || c[0] === 'api')).toEqual(
      [],
    );
    expect(pr.title).toBe(afterFirst.title);
    expect(pr.body).toBe(afterFirst.body);
    expect(pr.comments).toEqual(afterFirst.comments);
    expect(pr.isDraft).toBe(true);
  });

  it('issues zero mutations against a clean, already-authored PR', async () => {
    const { gh, calls, pr } = fakeGitHub({
      title: 'feat: a real implementation PR',
      body: '## Why\n\nreal prose',
      isDraft: true,
      labels: [],
      comments: [],
    });

    const outcome = await makeRetainedPrPresentable(repairDeps(gh));

    expect(outcome).toBe('not-halt-pr');
    expect(calls.filter((c) => c[1] === 'edit' || c[1] === 'comment' || c[0] === 'api')).toEqual(
      [],
    );
    expect(pr.title).toBe('feat: a real implementation PR');
    expect(pr.body).toBe('## Why\n\nreal prose');
  });

  it('never throws when every gh call fails — the repair is advisory', async () => {
    const failing: GhRunner = async () => {
      throw new Error('gh: network unreachable');
    };

    await expect(makeRetainedPrPresentable(repairDeps(failing))).resolves.toBeDefined();
  });

  it('floors the body with the engine marker so finish still demands a /pr-authored body', async () => {
    const { gh, pr } = fakeGitHub(haltPlaceholder());

    await makeRetainedPrPresentable(repairDeps(gh));

    expect(pr.body).toContain(PR_BODY_FLOOR_MARKER);
  });
});

/**
 * Generality: the consumer is resolved from the step REGISTRY, so any custom
 * SHIP step inherits the contract — nothing keys off the name
 * `release-disposition` or `finish`.
 */
describe('firstShipConsumer (registry-derived)', () => {
  const customStep = (name: string, after: string) => ({
    skill: `.agents/skills/${name}/SKILL.md`,
    after,
    enforcement: 'gating' as const,
  });

  it('is a built-in SHIP step for a config with no custom steps', () => {
    const consumer = firstShipConsumer(buildStepRegistry({} as HarnessConfig));
    expect(consumer).toBeDefined();
    expect(consumer!.phase).toBe('SHIP');
  });

  it('resolves a config-declared custom SHIP step ahead of finish', () => {
    const config = {
      steps: { 'release-disposition': customStep('release-disposition', 'retro') },
    } as unknown as HarnessConfig;
    const steps = buildStepRegistry(config);

    const names: string[] = steps.map((s) => s.name);
    const custom = steps.find((s) => (s.name as string) === 'release-disposition');
    expect(custom?.phase).toBe('SHIP');
    expect(names.indexOf('release-disposition')).toBeLessThan(names.indexOf('finish'));
    // The retained PR's first consumer is a SHIP step, and it is NOT finish.
    expect(firstShipConsumer(steps)!.phase).toBe('SHIP');
    expect(firstShipConsumer(steps)!.name).not.toBe('finish');
  });

  it('a hypothetical ADDITIONAL custom SHIP step before finish is covered too', () => {
    const config = {
      steps: {
        'release-disposition': customStep('release-disposition', 'retro'),
        'compliance-attest': customStep('compliance-attest', 'release-disposition'),
      },
    } as unknown as HarnessConfig;
    const steps = buildStepRegistry(config);
    const names: string[] = steps.map((s) => s.name);

    expect(steps.find((s) => (s.name as string) === 'compliance-attest')?.phase).toBe('SHIP');
    expect(names.indexOf('compliance-attest')).toBeLessThan(names.indexOf('finish'));
    // Both customs sit strictly inside the SHIP tail the adoption repair precedes.
    const shipNames: string[] = steps.filter((s) => s.phase === 'SHIP').map((s) => s.name);
    expect(shipNames).toContain('release-disposition');
    expect(shipNames).toContain('compliance-attest');
    expect(firstShipConsumer(steps)!.name).toBe(shipNames[0]);
  });
});
