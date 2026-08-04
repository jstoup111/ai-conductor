/**
 * Conductor wiring for the SHIP-phase-entry draft PR.
 *
 * The implementation PR must be opened as a DRAFT when the SHIP phase starts —
 * before the first SHIP step is dispatched — not at `finish`. Fakes are
 * injected at the `gh`/`git` boundary; no real binary runs.
 */

import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';
import {
  HALT_PR_BANNER_LINES,
  HALT_PR_BANNER_SENTINEL,
  NEEDS_REMEDIATION_BODY_MARKER,
} from '../../src/engine/pr-labels.js';
import { HALT_HISTORY_COMMENT_MARKER } from '../../src/engine/halt-pr-rehabilitation.js';
import type { StepName } from '../../src/types/index.js';

const PR_URL = 'https://github.com/acme/repo/pull/42';
const BRANCH = 'feat/widget-import';

function fakes() {
  const ghCalls: string[][] = [];
  const gitCalls: string[][] = [];
  const gh: GhRunner = async (args) => {
    ghCalls.push([...args]);
    if (args[1] === 'view') throw new Error('no pull requests found');
    if (args[1] === 'create') return { stdout: `${PR_URL}\n` };
    return { stdout: '' };
  };
  const git: GitRunner = async (args) => {
    gitCalls.push([...args]);
    if (args[0] === 'rev-list') return { stdout: '3\n' };
    return { stdout: '' };
  };
  return { gh, git, ghCalls, gitCalls };
}

describe('conductor opens a draft implementation PR at SHIP-phase start', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ship-draft-pr-'));
    statePath = join(dir, 'conduct-state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const buildDone = {
    acceptance_specs: 'done',
    build: 'done',
    build_review: 'done',
    wiring_check: 'done',
    test_suite: 'done',
    worktree_branch: BRANCH,
    feature_desc: 'widget import flow',
  };

  it('creates the PR with --draft BEFORE the first SHIP step is dispatched', async () => {
    await writeFile(statePath, JSON.stringify(buildDone), 'utf8');
    const { gh, git, ghCalls, gitCalls } = fakes();

    let ghCallsAtDispatch = 0;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === 'manual_test') ghCallsAtDispatch = ghCalls.length;
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'manual_test',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
    });

    await conductor.run();

    const create = ghCalls.find((c) => c[1] === 'create');
    expect(create).toBeDefined();
    expect(create).toContain('--draft');
    expect(create![create!.indexOf('--head') + 1]).toBe(BRANCH);
    expect(create![create!.indexOf('--base') + 1]).toBe('main');

    // Published before the SHIP step ran, and off a pushed branch.
    expect(ghCallsAtDispatch).toBeGreaterThan(0);
    expect(gitCalls).toContainEqual(['push', '-u', 'origin', BRANCH]);
  });

  it('publishes at most once per run — later SHIP steps do not re-push or re-open', async () => {
    await writeFile(statePath, JSON.stringify(buildDone), 'utf8');
    const { gh, git, ghCalls, gitCalls } = fakes();

    const runner: StepRunner = { run: async (): Promise<StepRunResult> => ({ success: true }) };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'manual_test',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
    });

    await conductor.run();

    expect(ghCalls.filter((c) => c[1] === 'create')).toHaveLength(1);
    expect(gitCalls.filter((c) => c[0] === 'push')).toHaveLength(1);
  });

  it('uses the daemon caller worktree branch when persisted state lacks it', async () => {
    await writeFile(
      statePath,
      JSON.stringify({
        acceptance_specs: 'done',
        build: 'done',
        build_review: 'done',
        wiring_check: 'done',
        test_suite: 'done',
        feature_desc: 'widget import flow',
      }),
      'utf8',
    );
    const { gh, git, ghCalls } = fakes();
    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => ({ success: false, output: 'stop after first SHIP dispatch' }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'manual_test',
      mode: 'default',
      daemon: true,
      gh,
      git,
      baseBranch: 'main',
      worktreeBranch: BRANCH,
      maxRetries: 1,
    });

    await conductor.run();

    const create = ghCalls.find((call) => call[1] === 'create');
    const head = create?.[create.indexOf('--head') + 1];
    expect(head).toBe(BRANCH);
  });

  it('persists the daemon caller worktree branch before the first SHIP dispatch', async () => {
    await writeFile(
      statePath,
      JSON.stringify({ ...buildDone, worktree_branch: 'feat/stale-branch' }),
      'utf8',
    );
    const { gh, git } = fakes();
    let persistedBranchAtDispatch: string | undefined;
    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => {
        const persistedState = JSON.parse(await readFile(statePath, 'utf8')) as {
          worktree_branch?: string;
        };
        persistedBranchAtDispatch = persistedState.worktree_branch;
        return { success: false, output: 'sentinel: stop after first SHIP dispatch' };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'manual_test',
      mode: 'default',
      daemon: true,
      gh,
      git,
      baseBranch: 'main',
      worktreeBranch: BRANCH,
      maxRetries: 1,
    });

    await conductor.run();

    expect(persistedBranchAtDispatch).toBe(BRANCH);
  });

  it('does not publish while the run is still in BUILD-phase steps', async () => {
    await writeFile(statePath, JSON.stringify({ plan: 'done', worktree_branch: BRANCH }), 'utf8');
    const { gh, git, ghCalls, gitCalls } = fakes();

    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> =>
        // Stop the loop at the end of BUILD so no SHIP step is reached.
        step === 'test_suite' ? { success: false, output: 'stop' } : { success: true },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'acceptance_specs',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
      maxRetries: 1,
    });

    await conductor.run();

    expect(ghCalls.filter((c) => c[1] === 'create')).toHaveLength(0);
    expect(gitCalls.filter((c) => c[0] === 'push')).toHaveLength(0);
  });

  it('is advisory: a gh failure at ship start does not stop the SHIP phase', async () => {
    await writeFile(statePath, JSON.stringify(buildDone), 'utf8');
    const gh: GhRunner = async () => {
      throw new Error('gh: not authenticated');
    };
    const git: GitRunner = async (args) =>
      args[0] === 'rev-list' ? { stdout: '3\n' } : { stdout: '' };

    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        dispatched.push(step);
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'manual_test',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
    });

    await expect(conductor.run()).resolves.not.toThrow();
    expect(dispatched).toContain('manual_test');
  });

  it('issues no presentation-repair mutation when the adopted PR is freshly created', async () => {
    await writeFile(statePath, JSON.stringify(buildDone), 'utf8');
    const { gh, git, ghCalls } = fakes();

    const runner: StepRunner = { run: async (): Promise<StepRunResult> => ({ success: true }) };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
      fromStep: 'manual_test',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
    });

    await conductor.run();

    // A brand-new draft carries no halt signal, so the repair must be a no-op:
    // no retitle, no body rewrite, no label REST call, no comment.
    expect(ghCalls.filter((c) => c[1] === 'edit')).toHaveLength(0);
    expect(ghCalls.filter((c) => c[1] === 'comment')).toHaveLength(0);
    expect(ghCalls.filter((c) => c[0] === 'api')).toHaveLength(0);
    expect(ghCalls.filter((c) => c[1] === 'ready')).toHaveLength(0);
  });
});

/**
 * Regression (#1292): a feature that HALTed earlier already has an OPEN
 * `needs-remediation` placeholder PR on its branch. `findOrCreatePr` adopts it
 * UNTOUCHED, so it becomes the retained SHIP PR. The presentation repair used to
 * be bound to the `finish` step — which runs LAST — so a config-declared custom
 * SHIP step scheduled before finish was handed the placeholder and could only
 * refuse.
 *
 * The contract these tests pin: the retained PR is presentable before the FIRST
 * SHIP-phase step that consumes it, whichever step the RESOLVED registry puts
 * first. Nothing keys off the literal names `release-disposition` or `finish`.
 */
describe('the retained SHIP PR is presentable before the first SHIP consumer', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'retained-ship-pr-'));
    statePath = join(dir, 'conduct-state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const buildDone = {
    acceptance_specs: 'done',
    build: 'done',
    build_review: 'done',
    wiring_check: 'done',
    test_suite: 'done',
    worktree_branch: BRANCH,
    feature_desc: 'widget import flow',
  };

  interface PrState {
    title: string;
    body: string;
    isDraft: boolean;
    labels: string[];
    comments: string[];
  }

  /** An OPEN halt placeholder for BRANCH, shaped exactly like PR #1292. */
  function haltPlaceholderPr(): PrState {
    return {
      title: `needs-remediation: ${BRANCH} — manual remediation required`,
      body: [NEEDS_REMEDIATION_BODY_MARKER, '', ...HALT_PR_BANNER_LINES].join('\n'),
      isDraft: true,
      labels: ['needs-remediation'],
      comments: [],
    };
  }

  /** Faithful in-memory GitHub: reads reflect the mutations writes applied. */
  function githubWithOpenPr(pr: PrState): { gh: GhRunner; git: GitRunner; ghCalls: string[][] } {
    const ghCalls: string[][] = [];
    const gh: GhRunner = async (args) => {
      ghCalls.push([...args]);
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
      if (args[0] === 'pr' && args[1] === 'list') {
        return { stdout: JSON.stringify([{ url: PR_URL, state: 'OPEN' }]) };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        const t = args.indexOf('--title');
        if (t >= 0) pr.title = args[t + 1];
        const b = args.indexOf('--body');
        if (b >= 0) pr.body = args[b + 1];
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
    const git: GitRunner = async (args) =>
      args[0] === 'rev-list' ? { stdout: '3\n' } : { stdout: '' };
    return { gh, git, ghCalls };
  }

  const customShipStep = (skill: string, after: string) => ({
    skill,
    after,
    enforcement: 'advisory' as const,
  });

  it('a custom SHIP step before finish sees a presentable PR, not the placeholder', async () => {
    await writeFile(statePath, JSON.stringify(buildDone), 'utf8');
    const pr = haltPlaceholderPr();
    const { gh, git } = githubWithOpenPr(pr);

    let seenByCustomStep: PrState | undefined;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === ('release-disposition' as StepName)) {
          seenByCustomStep = { ...pr, labels: [...pr.labels], comments: [...pr.comments] };
          return { success: false, output: 'sentinel: stop after the observation' };
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {
        steps: {
          'release-disposition': customShipStep(
            '.agents/skills/release-disposition/SKILL.md',
            'retro',
          ),
        },
      } as never,
      fromStep: 'manual_test',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
      maxRetries: 1,
    });

    await conductor.run();

    expect(seenByCustomStep).toBeDefined();
    expect(seenByCustomStep!.title).not.toContain('needs-remediation:');
    expect(seenByCustomStep!.title).toBe('feat: widget import flow');
    expect(seenByCustomStep!.labels).not.toContain('needs-remediation');
    expect(seenByCustomStep!.body).not.toContain(HALT_PR_BANNER_SENTINEL);
    // …and it is still a DRAFT: only finish may flip it ready-for-review.
    expect(seenByCustomStep!.isDraft).toBe(true);
  });

  it('generality: a second, differently-named custom SHIP step is covered too', async () => {
    await writeFile(statePath, JSON.stringify(buildDone), 'utf8');
    const pr = haltPlaceholderPr();
    const { gh, git } = githubWithOpenPr(pr);

    let seenByFirstConsumer: PrState | undefined;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        if (step === ('compliance-attest' as StepName)) {
          seenByFirstConsumer = { ...pr, labels: [...pr.labels], comments: [...pr.comments] };
          return { success: false, output: 'sentinel: stop after the observation' };
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {
        steps: {
          'compliance-attest': customShipStep('.agents/skills/compliance-attest/SKILL.md', 'retro'),
        },
      } as never,
      fromStep: 'manual_test',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
      maxRetries: 1,
    });

    await conductor.run();

    expect(seenByFirstConsumer).toBeDefined();
    expect(seenByFirstConsumer!.title).not.toContain('needs-remediation:');
    expect(seenByFirstConsumer!.labels).not.toContain('needs-remediation');
    expect(seenByFirstConsumer!.isDraft).toBe(true);
  });

  it('repairs exactly once at adoption — no doubled comment or title thrash', async () => {
    await writeFile(statePath, JSON.stringify(buildDone), 'utf8');
    const pr = haltPlaceholderPr();
    const { gh, git, ghCalls } = githubWithOpenPr(pr);

    const runner: StepRunner = { run: async (): Promise<StepRunResult> => ({ success: true }) };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {
        steps: {
          'release-disposition': customShipStep(
            '.agents/skills/release-disposition/SKILL.md',
            'retro',
          ),
        },
      } as never,
      fromStep: 'manual_test',
      mode: 'default',
      gh,
      git,
      baseBranch: 'main',
    });

    await conductor.run();

    expect(pr.comments.filter((c) => c.includes(HALT_HISTORY_COMMENT_MARKER))).toHaveLength(1);
    expect(pr.title).toBe('feat: widget import flow');
    expect(ghCalls.filter((c) => c[1] === 'edit' && c.includes('--title'))).toHaveLength(1);
  });
});
