// Covers: task:3, task:4, task:5, task:8

import { afterEach, describe, expect, it } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  buildFeatureManifest,
  renderFeatureManifest,
} from '../../src/engine/feature-manifest.js';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';
import { resolveDaemonBaseSha } from '../../src/engine/daemon-deps.js';
import { readPlanStoriesReferenceText } from '../../src/engine/plan-stories-reference.js';
import {
  renderStoriesRefsReport,
  scanStoriesRefs,
} from '../../src/engine/stories-refs-diagnostic.js';

const execFile = promisify(execFileCallback);
const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function plan(stories?: string): string {
  return `# Plan\n${stories === undefined ? '' : `**Stories:** ${stories}\n`}\n### Task 1\n**Dependencies:** none\n`;
}

async function writeFixture(root: string, files: Record<string, string>): Promise<void> {
  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }));
}

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'stories-refs-diagnostic-'));
  cleanupRoots.push(root);
  await execFile('git', ['init', '--initial-branch=main', '--quiet'], { cwd: root });
  await execFile('git', ['config', 'maintenance.auto', 'false'], { cwd: root });
  await execFile('git', ['config', 'gc.auto', '0'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'Stories refs fixture'], { cwd: root });
  await writeFixture(root, files);
  await execFile('git', ['add', '.'], { cwd: root });
  await execFile('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
  return root;
}

async function commit(root: string, message: string): Promise<void> {
  await execFile('git', ['add', '.'], { cwd: root });
  await execFile('git', ['commit', '--quiet', '-m', message], { cwd: root });
}

async function snapshotFiles(root: string, relative = ''): Promise<Map<string, Buffer>> {
  const directory = join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const snapshot = new Map<string, Buffer>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = relative === '' ? entry.name : join(relative, entry.name);
    if (entry.isDirectory()) {
      for (const [child, bytes] of await snapshotFiles(root, path)) snapshot.set(child, bytes);
    } else {
      snapshot.set(path, await readFile(join(root, path)));
    }
  }
  return snapshot;
}

async function gitOutput(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout;
}

async function addAheadOrigin(root: string, files: Record<string, string>): Promise<string> {
  const origin = await mkdtemp(join(tmpdir(), 'stories-refs-origin-'));
  const updater = await mkdtemp(join(tmpdir(), 'stories-refs-updater-'));
  cleanupRoots.push(origin, updater);
  await execFile('git', ['init', '--bare', '--initial-branch=main', '--quiet', origin]);
  await execFile('git', ['remote', 'add', 'origin', origin], { cwd: root });
  await execFile('git', ['push', '--quiet', '-u', 'origin', 'main'], { cwd: root });
  await execFile('git', ['clone', '--quiet', origin, updater]);
  await execFile('git', ['config', 'user.email', 'fixture@example.test'], { cwd: updater });
  await execFile('git', ['config', 'user.name', 'Stories refs fixture'], { cwd: updater });
  await writeFixture(updater, files);
  await commit(updater, 'fix on origin main');
  await execFile('git', ['push', '--quiet', 'origin', 'main'], { cwd: updater });
  await execFile('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: root });
  return (await execFile('git', ['rev-parse', 'origin/main'], { cwd: root })).stdout.trim();
}

function renderedManifest(slug: string, files: readonly string[]): string {
  return renderFeatureManifest(buildFeatureManifest(slug, files, []));
}

function finding(scan: Awaited<ReturnType<typeof scanStoriesRefs>>, slug: string) {
  if (scan.kind !== 'ok') throw new Error(`fixture scan failed: ${scan.reason}`);
  const result = scan.broken.find((entry) => entry.slug === slug);
  expect(result, `finding for ${slug}`).toBeDefined();
  return result!;
}

describe('engine/stories-refs-diagnostic', () => {
  it('agrees with discovery at origin/main and excludes local, staged, untracked, branch, and worktree-only plans', async () => {
    const root = await createFixture({
      '.docs/plans/unresolvable.md': plan('/outside/stories.md'),
      '.docs/plans/missing.md': plan('.docs/stories/missing.md'),
      '.docs/malformed/manifest.json': '{ not JSON',
      '.docs/manifest-missing/manifest.json': renderedManifest('manifest-missing', [
        '.docs/plans/manifest-missing.md', '.docs/stories/manifest-missing.md',
      ]),
      '.docs/plans/manifest-missing.md': plan(),
      '.docs/plans/resolved.md': plan('.docs/stories/resolved.md'),
      '.docs/stories/resolved.md': '# Stories',
      '.docs/plans/processed.md': plan('.docs/stories/processed.md'),
      '.daemon/processed/processed': '',
    });
    const remoteSha = await addAheadOrigin(root, { '.docs/stories/missing.md': '# Stories' });

    await execFile('git', ['checkout', '--quiet', '-b', 'spec/branch-only'], { cwd: root });
    await writeFixture(root, { '.docs/plans/branch-only.md': plan('.docs/stories/branch-only.md') });
    await execFile('git', ['add', '.docs/plans/branch-only.md'], { cwd: root });
    await execFile('git', ['commit', '--quiet', '-m', 'broken plan on spec branch'], { cwd: root });
    await execFile('git', ['checkout', '--quiet', 'main'], { cwd: root });
    await writeFixture(root, {
      '.docs/plans/untracked.md': plan('.docs/stories/untracked.md'),
      '.docs/plans/staged.md': plan('.docs/stories/staged.md'),
      '.docs/plans/resolved.md': plan('.docs/stories/now-missing.md'),
    });
    await execFile('git', ['add', '.docs/plans/staged.md'], { cwd: root });

    const baseSha = await resolveDaemonBaseSha(root, 'main');
    expect(baseSha).toBe(remoteSha);
    if (!baseSha) throw new Error('fixture origin/main did not resolve');
    const discovery = await discoverBacklog(root, async (slug) => slug === 'processed', () => {}, {
      baseBranch: baseSha, writeBlockedSnapshot: async () => {},
    });
    const scan = await scanStoriesRefs(root);
    const report = renderStoriesRefsReport(scan);
    const visible = scan.kind === 'ok'
      ? scan.broken.filter((entry) => entry.state === 'actionable' || entry.state === 'halted')
      : [];
    const blocked = discovery.blocked.filter(({ reason }) => [
      'unresolvable-stories-ref', 'stories-missing', 'malformed-manifest',
    ].includes(reason));

    expect(scan).toMatchObject({ kind: 'ok', baseSha: remoteSha });
    expect(report[0]).toBe(`stories-refs: scanned 6 specs at origin/main (${remoteSha.slice(0, 9)})`);
    expect(visible.map(({ slug, kind }) => [slug, kind]).sort()).toEqual([
      ['malformed', 'malformed-manifest'],
      ['manifest-missing', 'missing'],
      ['unresolvable', 'unresolvable'],
    ]);
    expect(blocked.map(({ slug, reason }) => [slug, reason]).sort()).toEqual([
      ['malformed', 'malformed-manifest'],
      ['manifest-missing', 'stories-missing'],
      ['unresolvable', 'unresolvable-stories-ref'],
    ]);
    expect(scan.kind === 'ok' ? scan.broken.map(({ slug }) => slug) : []).not.toEqual(expect.arrayContaining([
      'missing', 'untracked', 'staged', 'branch-only', 'resolved',
    ]));
  });

  it('uses local main in the scan header when origin/main is unavailable', async () => {
    const root = await createFixture({ '.docs/plans/missing.md': plan('.docs/stories/missing.md') });

    const localSha = await resolveDaemonBaseSha(root, 'main');
    const scan = await scanStoriesRefs(root);

    expect(scan).toMatchObject({ kind: 'ok', baseSha: localSha });
    expect(renderStoriesRefsReport(scan)[0]).toBe(
      `stories-refs: scanned 1 specs at main (${localSha?.slice(0, 9)})`,
    );
  });

  it('reports a legacy missing Stories file with its raw reference and attempted path', async () => {
    const storiesReference = '.docs/stories/absent.md';
    const planContent = plan(storiesReference);
    const root = await createFixture({
      '.docs/plans/absent.md': planContent,
    });

    const scan = await scanStoriesRefs(root);
    expect(scan).toMatchObject({ kind: 'ok', specCount: 1 });
    expect(finding(scan, 'absent')).toMatchObject({
      plan: '.docs/plans/absent.md',
      reference: readPlanStoriesReferenceText(planContent),
      attempted: [storiesReference],
      kind: 'missing',
      state: 'actionable',
    });
    expect(renderStoriesRefsReport(scan)).toContain(
      `  • .docs/plans/absent.md — actionable — missing — reference: ${storiesReference} — attempted: ${storiesReference}`,
    );
  });

  it('reports unresolvable legacy references and the absent same-stem fallback', async () => {
    const absolute = '/outside/stories.md';
    const escaping = '../../outside.md';
    const nonMarkdown = '.docs/stories/not-markdown.txt';
    const root = await createFixture({
      '.docs/plans/absolute.md': plan(absolute),
      '.docs/plans/escaping.md': plan(escaping),
      '.docs/plans/non-markdown.md': plan(nonMarkdown),
      '.docs/plans/fallback.md': plan(),
    });

    const scan = await scanStoriesRefs(root);
    for (const [slug, reference] of [
      ['absolute', absolute],
      ['escaping', escaping],
      ['non-markdown', nonMarkdown],
    ] as const) {
      expect(finding(scan, slug)).toMatchObject({
        plan: `.docs/plans/${slug}.md`, reference, attempted: [], kind: 'unresolvable',
      });
      expect(renderStoriesRefsReport(scan)).toContain(
        `  • .docs/plans/${slug}.md — actionable — unresolvable — reference: ${reference} — attempted: none`,
      );
    }
    expect(finding(scan, 'fallback')).toMatchObject({
      plan: '.docs/plans/fallback.md', reference: null,
      attempted: ['.docs/stories/fallback.md'], kind: 'missing',
    });
    expect(renderStoriesRefsReport(scan)).toContain(
      '  • .docs/plans/fallback.md — actionable — missing — reference: (no Stories line; same-stem fallback) — attempted: .docs/stories/fallback.md',
    );
  });

  it('reports missing, empty, and malformed manifest-backed stories resolutions', async () => {
    const missing = 'manifest-missing';
    const empty = 'manifest-empty';
    const malformed = 'manifest-malformed';
    const root = await createFixture({
      [`.docs/${missing}/manifest.json`]: renderedManifest(missing, [
        `.docs/plans/${missing}.md`, `.docs/stories/${missing}.md`,
      ]),
      [`.docs/plans/${missing}.md`]: plan('/outside/ignored.md'),
      [`.docs/${empty}/manifest.json`]: renderedManifest(empty, [`.docs/plans/${empty}.md`]),
      [`.docs/plans/${empty}.md`]: plan('.docs/stories/ignored.md'),
      [`.docs/${malformed}/manifest.json`]: '{ invalid JSON',
    });

    const scan = await scanStoriesRefs(root);
    expect(finding(scan, missing)).toMatchObject({
      plan: `.docs/plans/${missing}.md`, reference: `manifest .docs/${missing}/manifest.json`,
      attempted: [`.docs/stories/${missing}.md`], kind: 'missing',
    });
    expect(finding(scan, empty)).toMatchObject({
      plan: `.docs/plans/${empty}.md`, reference: `manifest .docs/${empty}/manifest.json`,
      attempted: [], kind: 'missing',
    });
    expect(finding(scan, malformed)).toMatchObject({
      plan: null, attempted: [], kind: 'malformed-manifest',
      reference: expect.stringMatching(/^manifest \.docs\/manifest-malformed\/manifest\.json: /),
    });
    const report = renderStoriesRefsReport(scan).join('\n');
    expect(report).toContain(`reference: manifest .docs/${missing}/manifest.json — attempted: .docs/stories/${missing}.md`);
    expect(report).toContain(`reference: manifest .docs/${empty}/manifest.json — attempted: none`);
    expect(report).toContain('• (unresolved plan) — actionable — malformed-manifest — reference: manifest .docs/manifest-malformed/manifest.json:');
  });

  it('omits resolving legacy and manifest-backed candidates, including an absent listed plan', async () => {
    const inline = 'inline-accepted';
    const sameStem = 'same-stem';
    const manifestResolved = 'manifest-resolved';
    const manifestNoPlan = 'manifest-no-plan';
    const root = await createFixture({
      [`.docs/plans/${inline}.md`]: plan('`.docs/stories/inline-accepted.md` (Accepted)'),
      '.docs/stories/inline-accepted.md': '# Stories',
      [`.docs/plans/${sameStem}.md`]: plan(),
      [`.docs/stories/${sameStem}.md`]: '# Stories',
      [`.docs/${manifestResolved}/manifest.json`]: renderedManifest(manifestResolved, [
        `.docs/plans/${manifestResolved}.md`, `.docs/stories/${manifestResolved}.md`,
      ]),
      [`.docs/plans/${manifestResolved}.md`]: plan('/outside/ignored.md'),
      [`.docs/stories/${manifestResolved}.md`]: '# Stories',
      [`.docs/${manifestNoPlan}/manifest.json`]: renderedManifest(manifestNoPlan, [
        `.docs/plans/${manifestNoPlan}.md`, `.docs/stories/${manifestNoPlan}.md`,
      ]),
      [`.docs/stories/${manifestNoPlan}.md`]: '# Stories',
    });

    const scan = await scanStoriesRefs(root);
    expect(scan).toMatchObject({ kind: 'ok', specCount: 4, broken: [] });
    if (scan.kind !== 'ok') throw new Error(`fixture scan failed: ${scan.reason}`);
    expect(renderStoriesRefsReport(scan)).toEqual([
      `stories-refs: scanned 4 specs at main (${scan.baseSha.slice(0, 9)})`,
    ]);
  });

  it('labels broken plans by lifecycle state and summarizes every state', async () => {
    const root = await createFixture({
      '.docs/plans/processed.md': plan('.docs/stories/processed.md'),
      '.docs/plans/shipped.md': plan('.docs/stories/shipped.md'),
      '.docs/plans/parked.md': plan('.docs/stories/parked.md'),
      '.docs/plans/halted.md': plan('.docs/stories/halted.md'),
      '.docs/plans/actionable.md': plan('.docs/stories/actionable.md'),
      '.docs/shipped/shipped.md': '# Shipped\n',
    });
    await writeFixture(root, {
      '.daemon/processed/processed': '',
      '.daemon/parked/parked': '',
      '.worktrees/halted/.pipeline/HALT': '',
    });

    const scan = await scanStoriesRefs(root);
    expect(finding(scan, 'processed').state).toBe('processed');
    expect(finding(scan, 'shipped').state).toBe('shipped');
    expect(finding(scan, 'parked').state).toBe('parked');
    expect(finding(scan, 'halted').state).toBe('halted');
    expect(finding(scan, 'actionable').state).toBe('actionable');
    expect(renderStoriesRefsReport(scan)).toContain(
      'stories-refs: 5 broken (actionable 1, halted 1, parked 1, shipped 1, processed 1)',
    );
  });

  it('uses lifecycle ordering and does not treat a completed halt as halted', async () => {
    const root = await createFixture({
      '.docs/plans/processed-and-parked.md': plan('.docs/stories/processed-and-parked.md'),
      '.docs/plans/shipped-parked-halted.md': plan('.docs/stories/shipped-parked-halted.md'),
      '.docs/plans/parked-halted.md': plan('.docs/stories/parked-halted.md'),
      '.docs/plans/done-halt.md': plan('.docs/stories/done-halt.md'),
      '.docs/shipped/shipped-parked-halted.md': '# Shipped\n',
    });
    await writeFixture(root, {
      '.daemon/processed/processed-and-parked': '',
      '.daemon/parked/processed-and-parked': '',
      '.daemon/parked/shipped-parked-halted': '',
      '.daemon/parked/parked-halted': '',
      '.worktrees/shipped-parked-halted/.pipeline/HALT': '',
      '.worktrees/parked-halted/.pipeline/HALT': '',
      '.worktrees/done-halt/.pipeline/HALT': '',
      '.worktrees/done-halt/.pipeline/DONE': '',
    });

    const scan = await scanStoriesRefs(root);
    expect(finding(scan, 'processed-and-parked').state).toBe('processed');
    expect(finding(scan, 'shipped-parked-halted').state).toBe('shipped');
    expect(finding(scan, 'parked-halted').state).toBe('parked');
    expect(finding(scan, 'done-halt').state).toBe('actionable');
  });

  it('resolves processed and parked markers from the main root when scanning a linked worktree', async () => {
    const root = await createFixture({
      '.docs/plans/processed.md': plan('.docs/stories/processed.md'),
      '.docs/plans/parked.md': plan('.docs/stories/parked.md'),
    });
    const worktree = join(root, '.worktrees', 'linked');
    await mkdir(dirname(worktree), { recursive: true });
    await execFile('git', ['worktree', 'add', '--quiet', '-b', 'linked', worktree, 'main'], { cwd: root });
    await writeFixture(root, {
      '.daemon/processed/processed': '',
      '.daemon/parked/parked': '',
    });

    const scan = await scanStoriesRefs(worktree);
    expect(finding(scan, 'processed').state).toBe('processed');
    expect(finding(scan, 'parked').state).toBe('parked');
  });

  it('leaves daemon state, checkout, and refs unchanged while reporting shipped broken specs', async () => {
    const root = await createFixture({
      '.docs/plans/actionable.md': plan('.docs/stories/actionable.md'),
      '.docs/plans/shipped.md': plan('.docs/stories/shipped.md'),
      '.docs/shipped/shipped.md': '# Shipped\n',
    });
    await writeFixture(root, {
      '.daemon/blocked.json': '{"existing":true}\n',
      '.daemon/warned/actionable': 'already warned\n',
      '.daemon/processed/other': 'already processed\n',
    });

    const before = {
      daemon: await snapshotFiles(join(root, '.daemon')),
      status: await gitOutput(root, ['status', '--porcelain']),
      refs: await gitOutput(root, ['for-each-ref', '--format=%(refname)%00%(objectname)']),
    };
    const scan = await scanStoriesRefs(root);
    const after = {
      daemon: await snapshotFiles(join(root, '.daemon')),
      status: await gitOutput(root, ['status', '--porcelain']),
      refs: await gitOutput(root, ['for-each-ref', '--format=%(refname)%00%(objectname)']),
    };

    expect(scan.kind === 'ok' && finding(scan, 'shipped').state).toBe('shipped');
    expect(after).toEqual(before);
    await expect(readFile(join(root, '.daemon', 'processed', 'shipped'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not include mutation helpers or git fetch in the diagnostic source', async () => {
    const source = await readFile(
      new URL('../../src/engine/stories-refs-diagnostic.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/\b(?:fastForwardRoot|writeBlockedSnapshot|markWarned|repairProcessed|discoverBacklog|fetch)\b/);
  });
});
