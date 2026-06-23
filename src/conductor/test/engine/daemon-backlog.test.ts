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

  it('includes a feature whose plan + stories both exist (via **Stories:** ref)', async () => {
    await writeFile(
      join(dir, '.docs/plans/feature-a.md'),
      '# Plan\n**Stories:** .docs/stories/feature-a.md\n',
    );
    await writeFile(join(dir, '.docs/stories/feature-a.md'), '# Stories\n');

    const backlog = await discoverBacklog(dir);
    expect(backlog).toHaveLength(1);
    expect(backlog[0].slug).toBe('feature-a');
    expect(backlog[0].planPath).toContain('feature-a.md');
    expect(backlog[0].storiesPath).toContain('stories/feature-a.md');
  });

  it('falls back to a same-stem stories file when no **Stories:** line', async () => {
    await writeFile(join(dir, '.docs/plans/feature-b.md'), '# Plan (no stories ref)\n');
    await writeFile(join(dir, '.docs/stories/feature-b.md'), '# Stories\n');

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
      await writeFile(join(dir, `.docs/plans/${slug}.md`), '# Plan\n');
      await writeFile(join(dir, `.docs/stories/${slug}.md`), '# Stories\n');
    }
    const processed = new Set(['a']);
    const backlog = await discoverBacklog(dir, async (slug) => processed.has(slug));
    expect(backlog.map((b) => b.slug)).toEqual(['b']);
  });
});
