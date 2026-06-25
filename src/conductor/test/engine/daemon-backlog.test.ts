import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';

describe('engine/daemon-backlog — discoverBacklog', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-backlog-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when there is no plans dir', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'empty-'));
    expect(await discoverBacklog(empty)).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });

  // Eligible specs must be APPROVED (stories Status: Accepted) and well-formed
  // (plan declares a dependency tree). Helpers keep fixtures valid by default.
  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef?: string) =>
    `# Plan\n${storiesRef ? `**Stories:** ${storiesRef}\n` : ''}\n### Task 1\n**Dependencies:** none\n`;

  it('includes a feature whose plan + stories both exist (via **Stories:** ref)', async () => {
    await writeFile(
      join(dir, '.docs/plans/feature-a.md'),
      planWithDeps('.docs/stories/feature-a.md'),
    );
    await writeFile(join(dir, '.docs/stories/feature-a.md'), APPROVED_STORIES);

    const backlog = await discoverBacklog(dir);
    expect(backlog).toHaveLength(1);
    expect(backlog[0].slug).toBe('feature-a');
    expect(backlog[0].planPath).toContain('feature-a.md');
    expect(backlog[0].storiesPath).toContain('stories/feature-a.md');
  });

  it('falls back to a same-stem stories file when no **Stories:** line', async () => {
    await writeFile(join(dir, '.docs/plans/feature-b.md'), planWithDeps());
    await writeFile(join(dir, '.docs/stories/feature-b.md'), APPROVED_STORIES);

    const backlog = await discoverBacklog(dir);
    expect(backlog.map((b) => b.slug)).toEqual(['feature-b']);
  });

  it('excludes a plan with no matching stories (daemon never authors specs)', async () => {
    await writeFile(join(dir, '.docs/plans/orphan.md'), '# Plan with no stories\n');
    const backlog = await discoverBacklog(dir);
    expect(backlog).toEqual([]);
  });

  it('skips features already marked processed', async () => {
    for (const slug of ['a', 'b']) {
      await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps());
      await writeFile(join(dir, `.docs/stories/${slug}.md`), APPROVED_STORIES);
    }
    const processed = new Set(['a']);
    const backlog = await discoverBacklog(dir, async (slug) => processed.has(slug));
    expect(backlog.map((b) => b.slug)).toEqual(['b']);
  });

  it('skips an UNAPPROVED feature (stories not Accepted / DRAFT)', async () => {
    await writeFile(join(dir, '.docs/plans/draft.md'), planWithDeps());
    await writeFile(
      join(dir, '.docs/stories/draft.md'),
      '# Stories\n**Status:** DRAFT\n',
    );
    const logs: string[] = [];
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m));
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/draft.*not approved/i);
  });

  it('skips a plan with no dependency tree', async () => {
    await writeFile(
      join(dir, '.docs/plans/nodeps.md'),
      '# Plan\n**Stories:** .docs/stories/nodeps.md\n\n### Task 1\nDo the thing.\n',
    );
    await writeFile(join(dir, '.docs/stories/nodeps.md'), APPROVED_STORIES);
    const logs: string[] = [];
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m));
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/nodeps.*dependency tree/i);
  });
});
