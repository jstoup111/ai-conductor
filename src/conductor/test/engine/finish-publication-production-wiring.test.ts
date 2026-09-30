import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GhRunner } from '../../src/engine/pr-labels.js';

const machineOwner = vi.hoisted(() => ({ id: 'alice' }));
vi.mock('../../src/engine/owner-gate/machine-identity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/owner-gate/machine-identity.js')>();
  return {
    ...actual,
    readMachineOwnerConfig: vi.fn(async () => ({ spec_owner: machineOwner.id })),
  };
});

import { createProvenanceGuardedFinishPresentationRepair } from '../../src/engine/conductor.js';
import { advanceFinishPublication, type PublicationSnapshot } from '../../src/engine/finish-publication.js';

const engineTestDir = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(engineTestDir, '..', '..', 'src');
const REPOSITORY = 'acme/rocket';
const PR_URL = `https://github.com/${REPOSITORY}/pull/42`;
const OWNER = 'compliance-attest';
const CAPTURE = '\nAttested-By: security-bot\n';

function regionBody(contents: string): string {
  return `## Summary\n\n<!-- ai-conductor:step ${OWNER} -->${contents}<!-- /ai-conductor:step -->`;
}

type RepairFixtureOptions = {
  body?: string;
  persistRestore?: boolean;
  capture?: boolean;
};

function readySnapshot(): PublicationSnapshot {
  return {
    mode: 'daemon',
    intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
    implementationEvidence: 'valid',
    shipEvidence: 'valid',
    releaseReadiness: 'valid',
    branchPushed: 'valid',
    shippedRecord: 'valid',
    outcomeRecord: 'missing',
    pr: { identity: 'one', url: PR_URL, prose: 'accepted', ready: false },
  };
}

async function repairFixture(options: RepairFixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'finish-production-wiring-'));
  const calls: string[] = [];
  const pr = {
    title: 'feat: owned',
    body: options.body ?? regionBody('\nAttested-By: altered\n'),
    isDraft: true,
    labels: [] as string[],
    comments: [] as string[],
  };
  await mkdir(join(root, '.pipeline'), { recursive: true });
  if (options.capture !== false) {
    await writeFile(join(root, '.pipeline', 'pr-body-region-captures.json'), `${JSON.stringify({ [PR_URL]: { [OWNER]: CAPTURE } })}\n`);
  }
  const gh: GhRunner = vi.fn(async (args: string[]) => {
    if (args[0] === 'api' && args[1] === 'user') return { stdout: 'alice\n' };
    if (args[0] === 'pr' && args[1] === 'view') {
      const json = args[args.indexOf('--json') + 1];
      if (json === 'body') calls.push('body-read');
      return { stdout: JSON.stringify(pr) };
    }
    if (args[0] === 'pr' && args[1] === 'edit') {
      calls.push('restore');
      const body = args[args.indexOf('--body') + 1];
      if (!options.persistRestore) pr.body = body;
      return { stdout: '' };
    }
    if (args[0] === 'pr' && args[1] === 'ready') {
      calls.push('ready');
      pr.isDraft = false;
      return { stdout: '' };
    }
    throw new Error(`unexpected gh command: ${args.join(' ')}`);
  });
  const git = vi.fn(async (args: string[]) => {
    if (args.join(' ') === 'config --get remote.origin.url') return { stdout: `https://github.com/${REPOSITORY}.git\n` };
    if (args[0] === 'show') return { stdout: 'Owner: alice\n' };
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  });
  const repair = createProvenanceGuardedFinishPresentationRepair({
    projectRoot: root,
    git,
    gh,
    baseBranch: 'main',
  });
  return {
    root, calls, pr, gh, repair,
    request: { prUrl: PR_URL, state: { feature_desc: 'owned', worktree_branch: 'feat/owned' } },
  };
}

afterEach(() => { machineOwner.id = 'alice'; });

describe('production FINISH coordinator wiring', () => {
  it('constructs the coordinator at both foreground and daemon composition roots', async () => {
    const [foreground, daemon] = await Promise.all([
      readFile(join(sourceRoot, 'index.ts'), 'utf8'),
      readFile(join(sourceRoot, 'daemon-cli.ts'), 'utf8'),
    ]);

    for (const source of [foreground, daemon]) {
      expect(source).toContain('createProductionFinishPublicationCoordinator');
      expect(source).toContain('createProvenanceGuardedFinishPresentationRepair');
      expect(source).toMatch(/new Conductor\(\{[\s\S]*?finishPublication:\s*createProductionFinishPublicationCoordinator\(/);
      expect(source).toMatch(
        /repairPresentation:\s*createProvenanceGuardedFinishPresentationRepair\(\{[\s\S]*?git:\s*finishPublicationGit,[\s\S]*?gh:\s*finishPublicationGh/,
      );
    }

    expect(foreground).toMatch(
      /const finishPublicationBaseBranch\s*=\s*\(await originDefaultBranch\(makeGitRunner\(projectRoot\)\)\) \?\? 'main';/,
    );
    expect(foreground).toMatch(
      /finishPublication:\s*createProductionFinishPublicationCoordinator\(\{[\s\S]*?baseBranch:\s*finishPublicationBaseBranch/,
    );
    expect(daemon).toMatch(
      /finishPublication:\s*createProductionFinishPublicationCoordinator\(\{[\s\S]*?baseBranch,/
    );

    for (const source of [foreground, daemon]) {
      expect(source).toMatch(
        /finishPublication:\s*createProductionFinishPublicationCoordinator\(\{[\s\S]*?prTemplateBytes:\s*config\?\.pr_template_bytes/,
      );
    }
  });

  it('routes both production ready paths through the capture-verifying repair before ready', async () => {
    const [foreground, daemon, conductor] = await Promise.all([
      readFile(join(sourceRoot, 'index.ts'), 'utf8'),
      readFile(join(sourceRoot, 'daemon-cli.ts'), 'utf8'),
      readFile(join(sourceRoot, 'engine', 'conductor.ts'), 'utf8'),
    ]);

    for (const source of [foreground, daemon]) {
      expect(source).toContain('repairPresentation: createProvenanceGuardedFinishPresentationRepair');
    }

    const repairStart = conductor.indexOf('export function createFinishPresentationRepair');
    const restore = conductor.indexOf('const captures = await readRegionCaptures', repairStart);
    const verify = conductor.indexOf("new RegionRestoreError('mismatch', [key])", restore);
    const ready = conductor.indexOf('const outcome = await ensureShipReady', verify);
    expect(repairStart).toBeGreaterThanOrEqual(0);
    expect(restore).toBeGreaterThan(repairStart);
    expect(verify).toBeGreaterThan(restore);
    expect(ready).toBeGreaterThan(verify);
  });

  it.each(['foreground', 'daemon'] as const)('uses the %s production repair shape to verify an intact capture before ready', async () => {
    const fixture = await repairFixture({ body: regionBody(CAPTURE) });
    try {
      await expect(fixture.repair(fixture.request)).resolves.toBeUndefined();
      // One body-only read is the pre-existing body-floor repair. The intact
      // capture path then reads once to compare and once to verify.
      expect(fixture.calls.filter((call) => call === 'body-read')).toHaveLength(3);
      expect(fixture.calls).toContain('ready');
      expect(fixture.calls).not.toContain('restore');
      expect(fixture.calls.lastIndexOf('body-read')).toBeLessThan(fixture.calls.indexOf('ready'));
      expect(fixture.pr.isDraft).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('uses the production repair composition to restore, re-read, and then ready an edited region', async () => {
    const fixture = await repairFixture();
    try {
      await expect(fixture.repair(fixture.request)).resolves.toBeUndefined();
      const restore = fixture.calls.indexOf('restore');
      const verificationRead = fixture.calls.lastIndexOf('body-read');
      expect(restore).toBeGreaterThanOrEqual(0);
      expect(verificationRead).toBeGreaterThan(restore);
      expect(fixture.calls.indexOf('ready')).toBeGreaterThan(verificationRead);
      expect(fixture.pr.isDraft).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('keeps the draft and names the owner when the production guard refuses a restore', async () => {
    const fixture = await repairFixture();
    machineOwner.id = 'bob';
    try {
      await expect(fixture.repair(fixture.request)).rejects.toThrow(`guarded region restore refused for ${OWNER}`);
      expect(fixture.pr.isDraft).toBe(true);
      expect(fixture.calls).not.toContain('ready');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('halts the real FINISH coordinator with the owner and guarded-edit refusal', async () => {
    const fixture = await repairFixture();
    machineOwner.id = 'bob';
    try {
      const result = await advanceFinishPublication({
        observe: async () => readySnapshot(),
        effects: {
          dispatchJudgment: async () => ({ kind: 'accepted' }),
          repairPresentation: () => fixture.repair(fixture.request),
        },
      });
      expect(result).toMatchObject({
        kind: 'human_required', reason: 'region_restore_refused', detail: expect.stringContaining(OWNER),
      });
      expect((result as { detail: string }).detail).toContain('refused');
      expect(fixture.pr.isDraft).toBe(true);
      expect(fixture.calls).not.toContain('ready');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('keeps the draft on a persistent region verification mismatch', async () => {
    const fixture = await repairFixture({ persistRestore: true });
    try {
      await expect(fixture.repair(fixture.request)).rejects.toThrow(`region verification mismatch for ${OWNER}`);
      expect(fixture.pr.isDraft).toBe(true);
      expect(fixture.calls).not.toContain('ready');
      expect(fixture.calls.slice(-3)).toEqual(['body-read', 'restore', 'body-read']);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('halts the real FINISH coordinator with the owner and verification mismatch', async () => {
    const fixture = await repairFixture({ persistRestore: true });
    try {
      const result = await advanceFinishPublication({
        observe: async () => readySnapshot(),
        effects: {
          dispatchJudgment: async () => ({ kind: 'accepted' }),
          repairPresentation: () => fixture.repair(fixture.request),
        },
      });
      expect(result).toMatchObject({
        kind: 'human_required', reason: 'region_verification_mismatch', detail: expect.stringContaining(OWNER),
      });
      expect((result as { detail: string }).detail).toContain('verification mismatch');
      expect(fixture.pr.isDraft).toBe(true);
      expect(fixture.calls).not.toContain('ready');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('keeps the exact capture-free operation sequence and skips region verification', async () => {
    const fixture = await repairFixture({
      body: '## Summary\n\nNo project-owned regions.',
      capture: false,
    });
    try {
      await expect(fixture.repair(fixture.request)).resolves.toBeUndefined();
      // The body-floor repair's one read is pre-existing; no capture means the
      // production wrapper adds no region-verification read.
      expect(fixture.calls).toEqual(['body-read', 'ready']);
      expect(fixture.pr.isDraft).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
