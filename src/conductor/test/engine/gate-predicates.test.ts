import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';

// Mirrors the real repo convention: **Status:**, ### Happy Path / ### Negative
// Paths headings with Given/When/Then bullets. See gate-audit-2026-06-23.md.

describe('engine/artifacts — stories predicate', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stories-pred-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function story(path: string, content: string) {
    const full = join(dir, '.docs/stories', path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  it('fails when no stories present', async () => {
    const r = await checkGateCompletion(dir, 'stories');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no \.docs\/stories/);
  });

  it('passes a single-story file with happy + negative paths', async () => {
    await story(
      'features/foo/ST-001-foo.md',
      `# Story: Foo\n**Status:** Accepted\n\n## Acceptance Criteria\n\n### Happy Path\n- Given x, when y, then z\n\n### Negative Paths\n- Given a, when b, then error\n`,
    );
    const r = await checkGateCompletion(dir, 'stories');
    expect(r.done).toBe(true);
  });

  it('fails a DRAFT story', async () => {
    await story(
      'features/ST-002.md',
      `# Story\n**Status:** DRAFT\n\n### Happy Path\n- Given x when y then z\n\n### Negative Paths\n- Given a when b then error\n`,
    );
    const r = await checkGateCompletion(dir, 'stories');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/DRAFT/);
  });

  it('fails when a story has no negative path', async () => {
    await story(
      'features/ST-003.md',
      `# Story\n**Status:** Accepted\n\n### Happy Path\n- Given x when y then z\n`,
    );
    const r = await checkGateCompletion(dir, 'stories');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/negative path/i);
  });

  it('names the specific story in a multi-story file lacking a negative path', async () => {
    await story(
      'wave.md',
      `# Stories\n**Status:** Accepted\n\n## Story 1-1: ok\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then error\n\n## Story 1-2: bad\n### Happy Path\n- Given x when y then z\n`,
    );
    const r = await checkGateCompletion(dir, 'stories');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/1-2/);
  });
});

describe('engine/artifacts — plan predicate (per path-type coverage)', () => {
  let dir: string;
  const STORY = `# Stories\n**Status:** Accepted\n\n## Story 3.2-1: foo\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then error\n`;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plan-pred-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function story(content: string) {
    const full = join(dir, '.docs/stories/wave.md');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  async function plan(content: string) {
    const full = join(dir, '.docs/plans/p.md');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  it('fails when no plan present', async () => {
    await story(STORY);
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no \.docs\/plans/);
  });

  it('passes when happy + negative both covered by path-typed tasks', async () => {
    await story(STORY);
    await plan(
      `### Task 1\n**Story:** 3.2-1 (happy path — foo)\n\n### Task 2\n**Story:** 3.2-1 (negative path — bar)\n`,
    );
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(true);
  });

  it('fails when the negative path is uncovered', async () => {
    await story(STORY);
    await plan(`### Task 1\n**Story:** 3.2-1 (happy path — foo)\n`);
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/3\.2-1 negative/);
  });

  it('story-level fallback: a bare **Story:** ref covers both paths', async () => {
    await story(STORY);
    await plan(`### Task 1\n**Story:** 3.2-1\n`);
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(true);
  });

  it('a Coverage Check table satisfies coverage', async () => {
    await story(STORY);
    await plan(
      `## Coverage Check\n| Story | Criterion | Task(s) |\n|---|---|---|\n| 3.2-1 happy | x | T1 |\n| 3.2-1 negative | y | T2 |\n`,
    );
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(true);
  });

  // Regression: the real generator emits `## Story 1:` headings (id `1`) and
  // tasks with `**Story:** Story 1 (FR-1, FR-2)` + a separate `**Type:**` line.
  // The old regex captured the literal word "Story" and read path type only
  // from the parens (which hold FR refs), so coverage never matched.
  it('covers the real `Story N` + `**Type:**` plan format', async () => {
    await story(
      `# Stories\n**Status:** Accepted\n\n` +
        `## Story 1: Shorten\n**Requirement:** FR-1, FR-2\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then error\n\n` +
        `## Story 2: Redirect\n**Requirement:** FR-3\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then error\n`,
    );
    await plan(
      `### Task 1: infra\n**Story:** prerequisite for all tasks\n**Type:** infrastructure\n\n` +
        `### Task 2: POST happy\n**Story:** Story 1 (FR-1, FR-2) — "..."\n**Type:** happy-path\n\n` +
        `### Task 3: POST negative\n**Story:** Story 1 (FR-4) — "..."\n**Type:** negative-path\n\n` +
        `### Task 4: GET happy\n**Story:** Story 2 (FR-3) — "..."\n**Type:** happy-path\n\n` +
        `### Task 5: GET negative\n**Story:** Story 2 (FR-6) — "..."\n**Type:** negative-path\n`,
    );
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(true);
  });
});
