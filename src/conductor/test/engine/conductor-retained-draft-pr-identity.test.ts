/**
 * Retained SHIP-draft-PR identity resolution for the self-host release gate.
 *
 * `openShipDraftPr` is advisory and latched to one attempt per run, so a
 * transient `git push` failure on a run whose PR is already open leaves
 * `shipDraftPrUrl` unset and the fail-closed release gate halted the feature —
 * even though the branch's draft PR was open on origin the whole time. The gate
 * now resolves the identity from the durable branch instead.
 *
 * Seam: the private engine methods that own the behavior
 * (`readShipDraftReleaseMetadata` / `resolveRetainedShipDraftPrUrl`), driven
 * with an injected `gh` fake. No conductor run, no real `gh`, no network.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import {
  HALT_PR_BANNER_SENTINEL,
  NEEDS_REMEDIATION_BODY_MARKER,
} from '../../src/engine/pr-labels.js';

const BRANCH = 'feat/daemon-e2e-smoke-step';
const BASE = 'main';
const PR_URL = 'https://github.com/acme/repo/pull/1279';

const BODY = [
  'Release-Disposition: note',
  'Release-Category: Fixed',
  'Release-Semver: patch',
  'Release-Note: Resolve the retained draft PR from the branch.',
  '',
  '## Migration',
  '',
  'none',
].join('\n');

interface PrRow {
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
}

/**
 * A faithful `gh` fake: `pr list` answers only for the exact head+base it was
 * seeded for, mirroring the real `--head/--base` filter; `pr view` returns the
 * body of a PR it knows.
 */
function makeGh(rowsByQuery: Record<string, PrRow[]>): {
  gh: GhRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    if (args[1] === 'list') {
      const head = args[args.indexOf('--head') + 1];
      const base = args[args.indexOf('--base') + 1];
      return { stdout: JSON.stringify(rowsByQuery[`${head}->${base}`] ?? []) };
    }
    if (args[1] === 'view') {
      return { stdout: JSON.stringify({ body: BODY }) };
    }
    return { stdout: '{}' };
  };
  return { gh, calls };
}

function makeHaltedPrGh(): {
  gh: GhRunner;
  presentation: { title: string; labels: string[]; body: string };
} {
  const presentation = {
    title: 'needs-remediation: blocked implementation',
    labels: ['needs-remediation'],
    body: `${HALT_PR_BANNER_SENTINEL}\n${NEEDS_REMEDIATION_BODY_MARKER}`,
  };
  const gh: GhRunner = async (args) => {
    if (args[1] === 'list') {
      return { stdout: JSON.stringify([{ url: PR_URL, state: 'OPEN' }]) };
    }
    if (args[1] === 'view') {
      return {
        stdout: JSON.stringify({
          ...presentation,
          isDraft: true,
          labels: presentation.labels.map((name) => ({ name })),
          comments: [],
        }),
      };
    }
    if (args[0] === 'api' && args[2] === 'DELETE') {
      presentation.labels = presentation.labels.filter((label) => label !== 'needs-remediation');
    }
    if (args[1] === 'edit') {
      const titleIndex = args.indexOf('--title');
      const bodyIndex = args.indexOf('--body');
      if (titleIndex >= 0) presentation.title = args[titleIndex + 1]!;
      if (bodyIndex >= 0) presentation.body = args[bodyIndex + 1]!;
    }
    return { stdout: '{}' };
  };
  return { gh, presentation };
}

const noopRunner: StepRunner = { run: async (): Promise<StepRunResult> => ({ success: true }) };

describe('retained SHIP draft PR identity', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'retained-draft-pr-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeConductor(gh: GhRunner, opts: { worktreeBranch?: string } = {}): Conductor {
    return new Conductor({
      stateFilePath: join(dir, 'conduct-state.json'),
      stepRunner: noopRunner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      baseBranch: BASE,
      config: {
        steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } },
      } as never,
      runGh: gh,
      gh,
      log: () => {},
      ...opts,
    });
  }

  type MetadataResult =
    | { ok: false; reason: string }
    | { ok: true; value: { disposition: string; category?: string } };

  const readMetadata = (conductor: Conductor, branch: string | undefined): Promise<MetadataResult> =>
    (conductor as unknown as {
      readShipDraftReleaseMetadata(branch: string | undefined): Promise<MetadataResult>;
    }).readShipDraftReleaseMetadata(branch);

  it('resolves the branch\'s open PR when the ship-entry push failed and no URL was retained', async () => {
    const { gh, calls } = makeGh({ [`${BRANCH}->${BASE}`]: [{ url: PR_URL, state: 'OPEN' }] });
    const conductor = makeConductor(gh);

    const result = await readMetadata(conductor, BRANCH);

    expect(result).toEqual({
      ok: true,
      value: {
        disposition: 'note',
        category: 'Fixed',
        semver: 'patch',
        note: 'Resolve the retained draft PR from the branch.',
      },
    });
    // The lookup is pinned to this branch, this base, and open PRs only.
    const list = calls.find((c) => c[1] === 'list')!;
    expect(list[list.indexOf('--head') + 1]).toBe(BRANCH);
    expect(list[list.indexOf('--base') + 1]).toBe(BASE);
    expect(list[list.indexOf('--state') + 1]).toBe('open');
    // The resolved PR is the one whose body was read.
    expect(calls.find((c) => c[1] === 'view')).toContain(PR_URL);
  });

  it('still HALTs, fail-closed, when the branch has no PR at all', async () => {
    const { gh } = makeGh({});
    const conductor = makeConductor(gh);

    const result = await readMetadata(conductor, BRANCH);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain(
      'retained draft PR identity is unavailable',
    );
    expect(result.ok === false && result.reason).toContain(BRANCH);
    const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain('retained draft PR identity is unavailable');
  });

  it('does not accept a CLOSED or MERGED PR as the retained draft', async () => {
    // A stale row survives the query (a merged PR for the same head): the
    // resolver must not treat it as the retained draft finish would flip.
    const { gh, calls } = makeGh({
      [`${BRANCH}->${BASE}`]: [
        { url: 'https://github.com/acme/repo/pull/900', state: 'MERGED' },
        { url: 'https://github.com/acme/repo/pull/901', state: 'CLOSED' },
      ],
    });
    const conductor = makeConductor(gh);

    const result = await readMetadata(conductor, BRANCH);

    expect(result.ok).toBe(false);
    expect(calls.some((c) => c[1] === 'view')).toBe(false);
  });

  it('does not repair CLOSED then MERGED PR rows while resolving a retained draft', async () => {
    const { gh, calls } = makeGh({
      [`${BRANCH}->${BASE}`]: [
        { url: 'https://github.com/acme/repo/pull/900', state: 'CLOSED' },
        { url: 'https://github.com/acme/repo/pull/901', state: 'MERGED' },
      ],
    });
    const conductor = makeConductor(gh, { worktreeBranch: BRANCH });
    const resolve = (conductor as unknown as {
      resolveRetainedShipDraftPrUrl(branch: string): Promise<string | undefined>;
    }).resolveRetainedShipDraftPrUrl.bind(conductor);

    await expect(resolve(BRANCH)).resolves.toBeUndefined();
    // The OPEN predicate must reject stale rows before rehabilitation can read or mutate either PR.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 2)).toEqual(['pr', 'list']);
  });

  it('does not pick up an open PR belonging to another branch', async () => {
    const { gh } = makeGh({ [`feat/unrelated->${BASE}`]: [{ url: PR_URL, state: 'OPEN' }] });
    const conductor = makeConductor(gh);

    const result = await readMetadata(conductor, BRANCH);

    expect(result.ok).toBe(false);
  });

  it('accepts an open PR that is already ready-for-review, not only a draft', async () => {
    // finish flips this same PR ready; a re-entered SHIP phase legitimately
    // sees a non-draft PR, and `gh pr list` reports no draft distinction here.
    const { gh } = makeGh({ [`${BRANCH}->${BASE}`]: [{ url: PR_URL, state: 'OPEN' }] });
    const conductor = makeConductor(gh);

    const result = await readMetadata(conductor, BRANCH);

    expect(result.ok).toBe(true);
  });

  it('repairs a retained placeholder before returning its resolved identity', async () => {
    const { gh, presentation } = makeHaltedPrGh();
    const conductor = makeConductor(gh, { worktreeBranch: BRANCH });

    const result = await (conductor as unknown as {
      resolveRetainedShipDraftPrUrl(branch: string): Promise<string | undefined>;
    }).resolveRetainedShipDraftPrUrl(BRANCH);

    expect(result).toBe(PR_URL);
    expect(presentation).toMatchObject({
      title: expect.stringMatching(/^feat:/),
      labels: [],
    });
    expect(presentation.body).not.toContain(NEEDS_REMEDIATION_BODY_MARKER);
    expect(presentation.body).not.toContain(HALT_PR_BANNER_SENTINEL);
  });

  it('reads a healthy retained PR once without mutations and memoizes its identity', async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push([...args]);
      if (args[1] === 'list') {
        return { stdout: JSON.stringify([{ url: PR_URL, state: 'OPEN' }]) };
      }
      if (args[1] === 'view') {
        return {
          stdout: JSON.stringify({
            title: 'feat: healthy retained PR',
            isDraft: true,
            labels: [],
            body: BODY,
            comments: [],
          }),
        };
      }
      return { stdout: '{}' };
    };
    const conductor = makeConductor(gh, { worktreeBranch: BRANCH });
    const resolve = (conductor as unknown as {
      resolveRetainedShipDraftPrUrl(branch: string): Promise<string | undefined>;
    }).resolveRetainedShipDraftPrUrl.bind(conductor);

    await expect(resolve(BRANCH)).resolves.toBe(PR_URL);
    await expect(resolve(BRANCH)).resolves.toBe(PR_URL);

    expect(calls.filter((call) => call[1] === 'view')).toHaveLength(1);
    expect(calls.filter((call) => call[1] !== 'list' && call[1] !== 'view')).toEqual([]);
  });

  it('falls back to the daemon-supplied worktree branch and resolves only once', async () => {
    const { gh, calls } = makeGh({ [`${BRANCH}->${BASE}`]: [{ url: PR_URL, state: 'OPEN' }] });
    const conductor = makeConductor(gh, { worktreeBranch: BRANCH });

    const first = await readMetadata(conductor, undefined);
    const second = await readMetadata(conductor, undefined);

    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(calls.filter((c) => c[1] === 'list')).toHaveLength(1);
  });

  it('HALTs rather than searching when the base branch is unresolved', async () => {
    const { gh, calls } = makeGh({ [`${BRANCH}->${BASE}`]: [{ url: PR_URL, state: 'OPEN' }] });
    const conductor = new Conductor({
      stateFilePath: join(dir, 'conduct-state.json'),
      stepRunner: noopRunner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      daemon: true,
      selfHost: true,
      config: {
        steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } },
      } as never,
      runGh: gh,
      gh,
      log: () => {},
    });

    const result = await readMetadata(conductor, BRANCH);

    expect(result.ok).toBe(false);
    expect(calls.some((c) => c[1] === 'list')).toBe(false);
  });

  it('prefers an already-retained identity over any branch lookup', async () => {
    const { gh, calls } = makeGh({ [`${BRANCH}->${BASE}`]: [{ url: PR_URL, state: 'OPEN' }] });
    const conductor = makeConductor(gh);
    (conductor as unknown as { shipDraftPrUrl?: string }).shipDraftPrUrl =
      'https://github.com/acme/repo/pull/7';

    const result = await readMetadata(conductor, BRANCH);

    expect(result.ok).toBe(true);
    expect(calls.some((c) => c[1] === 'list')).toBe(false);
    expect(calls.find((c) => c[1] === 'view')).toContain('https://github.com/acme/repo/pull/7');
  });
});
