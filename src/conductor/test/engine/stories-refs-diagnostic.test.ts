// Covers: task:3

import { afterEach, describe, expect, it } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  buildFeatureManifest,
  renderFeatureManifest,
} from '../../src/engine/feature-manifest.js';
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
    expect(renderStoriesRefsReport(scan)).toEqual([]);
  });
});
