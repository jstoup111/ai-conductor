import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendBuildReviewAcceptedRisk,
  appendBuildReviewReducedCoverageEvidence,
  specHash,
  renderShippedRecord,
  renderShippedRecordWithCost,
  resolveEngineVersion,
  parseShippedRecord,
  writeShippedRecord,
  listShippedRecords,
  makeIsProcessed,
  appendTimingSection,
} from '../../src/engine/shipped-record.js';
import { parseCostBlock } from '../../src/engine/kpi-report.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import type { BuildReviewDispositionRecord } from '../../src/engine/build-review-dispositions.js';
import type { BacklogTreeSource } from '../../src/engine/daemon-backlog.js';
import type { CostRollup } from '../../src/engine/cost-rollup.js';
import type { TimingRollup } from '../../src/engine/timing-rollup.js';

/** Minimal fake tree source for exercising listShippedRecords in isolation. */
function fakeTreeSource(files: Record<string, string>): BacklogTreeSource & {
  listShippedFilesCallCount: number;
} {
  const state = {
    listShippedFilesCallCount: 0,
  };
  return {
    get listShippedFilesCallCount() {
      return state.listShippedFilesCallCount;
    },
    async listPlanFiles() {
      return [];
    },
    async listShippedFiles() {
      state.listShippedFilesCallCount += 1;
      return Object.keys(files);
    },
    async listAdrFiles() {
      return [];
    },
    async readFile(relPath: string) {
      const basename = relPath.replace(/^\.docs\/shipped\//, '');
      return Object.prototype.hasOwnProperty.call(files, basename)
        ? files[basename]
        : null;
    },
  };
}

describe('specHash', () => {
  it('is deterministic: same bytes produce identical digest', () => {
    const plan = Buffer.from('plan content here');
    const stories = Buffer.from('story content here');

    const first = specHash(plan, stories);
    const second = specHash(plan, stories);

    expect(first.digest).toBe(second.digest);
  });

  it('treats a trailing newline as equivalent (trims before hashing)', () => {
    const withNewline = specHash(Buffer.from('content\n'), null);
    const withoutNewline = specHash(Buffer.from('content'), null);

    expect(withNewline.digest).toBe(withoutNewline.digest);
  });

  it('is sensitive to a changed interior byte', () => {
    const original = specHash(Buffer.from('content-a-here'), null);
    const changed = specHash(Buffer.from('content-b-here'), null);

    expect(original.digest).not.toBe(changed.digest);
  });

  it('reports storiesIncluded: false when stories are null', () => {
    const result = specHash(Buffer.from('plan only'), null);

    expect(result.storiesIncluded).toBe(false);
  });

  it('does not treat CRLF as equivalent to LF (pinned behavior)', () => {
    const lf = specHash(Buffer.from('line1\nline2'), null);
    const crlf = specHash(Buffer.from('line1\r\nline2'), null);

    expect(lf.digest).not.toBe(crlf.digest);
  });
});

describe('renderShippedRecord', () => {
  it('emits correct frontmatter with all fields', () => {
    const body = renderShippedRecord({
      slug: 'billing-export',
      specHash: 'abc123',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-07-01',
    });

    expect(body).toBe(
      '---\n' +
        'slug: billing-export\n' +
        'spec_hash: abc123\n' +
        'pr: https://github.com/acme/repo/pull/42\n' +
        'shipped: 2026-07-01\n' +
        '---\n'
    );
  });

  it('emits engine_version when the engine version is supplied', () => {
    const body = renderShippedRecord({
      slug: 'billing-export',
      specHash: 'abc123',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-07-01',
      engineVersion: '20260727T234833Z-b5b34bb9f015',
    });

    expect(body).toBe(
      '---\n' +
        'slug: billing-export\n' +
        'spec_hash: abc123\n' +
        'pr: https://github.com/acme/repo/pull/42\n' +
        'shipped: 2026-07-01\n' +
        'engine_version: 20260727T234833Z-b5b34bb9f015\n' +
        '---\n'
    );
  });

  it('omits the engine_version line entirely when no version is supplied', () => {
    const body = renderShippedRecord({ slug: 'legacy', specHash: 'abc123' });

    expect(body).not.toContain('engine_version');
  });

  it('uses defaults when pr/shipped are missing', () => {
    const body = renderShippedRecord({ slug: 'no-defaults-yet', specHash: 'deadbeef' });

    expect(body).toContain('slug: no-defaults-yet\n');
    expect(body).toContain('spec_hash: deadbeef\n');
    expect(body).toMatch(/pr: https:\/\/github\.com\/.*\n/);
    expect(body).toMatch(/shipped: \d{4}-\d{2}-\d{2}\n/);
  });
});

describe('resolveEngineVersion', () => {
  it('extracts the published version id from a dist-versions engine dir', () => {
    expect(
      resolveEngineVersion(
        '/home/u/.local/share/ai-conductor/dist-versions/20260727T234833Z-b5b34bb9f015/engine'
      )
    ).toBe('20260727T234833Z-b5b34bb9f015');
  });

  it('reports dev for an unpublished source checkout', () => {
    expect(resolveEngineVersion('/home/u/code/ai-conductor/src/conductor/src/engine')).toBe('dev');
  });

  it('reports dev rather than throwing on an empty engine dir', () => {
    expect(resolveEngineVersion('')).toBe('dev');
  });
});

describe('parseShippedRecord', () => {
  it('adds cost-unmetered counts to Cost blocks without changing their frontmatter round trip', () => {
    const fields = {
      slug: 'billing-export',
      specHash: 'abc123',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-07-01',
    };
    const rollup: CostRollup = {
      tokens: { input: 1600, output: 360, cacheRead: 50, cacheCreation: 17 },
      costUsd: 0.15,
      dispatches: 3,
      retries: 1,
      halts: 0,
      unmetered: { count: 0, durationMs: 0 },
      costUnmetered: { count: 1 },
      providers: {
        claude: {
          tokens: { input: 1500, output: 300, cacheRead: 50, cacheCreation: 10 },
          costUsd: 0.15,
          dispatches: 2,
          unmetered: { count: 0, durationMs: 0 },
          costUnmetered: { count: 0 },
        },
        codex: {
          tokens: { input: 100, output: 60, cacheRead: 0, cacheCreation: 7 },
          costUsd: 0,
          dispatches: 1,
          unmetered: { count: 0, durationMs: 0 },
          costUnmetered: { count: 1 },
        },
      },
    };

    const rendered = renderShippedRecordWithCost(fields, rollup);

    expect(rendered).toBe(
      '---\n' +
        'slug: billing-export\n' +
        'spec_hash: abc123\n' +
        'pr: https://github.com/acme/repo/pull/42\n' +
        'shipped: 2026-07-01\n' +
        '---\n' +
        '\n' +
        '## Cost\n' +
        'input: 1600\n' +
        'output: 360\n' +
        'cache_read: 50\n' +
        'cache_creation: 17\n' +
        'cost_usd: 0.15\n' +
        'dispatches: 3\n' +
        'retries: 1\n' +
        'halts: 0\n' +
        'unmetered: count: 0, duration_ms: 0\n' +
        'cost_unmetered: count: 1\n' +
        'providers:\n' +
        '  claude: input: 1500, output: 300, cache_read: 50, cache_creation: 10, cost_usd: 0.15, dispatches: 2, cost_unmetered: 0\n' +
        '  codex: input: 100, output: 60, cache_read: 0, cache_creation: 7, cost_usd: 0, dispatches: 1, cost_unmetered: 1\n',
    );

    const parsed = parseShippedRecord(rendered);
    if ('malformed' in parsed) throw new Error('rendered Cost block must preserve valid frontmatter');
    expect(renderShippedRecordWithCost(parsed, rollup)).toBe(rendered);
  });

  it('round-trips engine_version when present', () => {
    const rendered = renderShippedRecord({
      slug: 'billing-export',
      specHash: 'abc123',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-07-01',
      engineVersion: '20260727T234833Z-b5b34bb9f015',
    });

    const parsed = parseShippedRecord(rendered);

    expect(parsed).toMatchObject({ engineVersion: '20260727T234833Z-b5b34bb9f015' });
  });

  it('parses a legacy record with no engine_version without malforming it', () => {
    const legacy =
      '---\n' +
      'slug: legacy-feat\n' +
      'spec_hash: abc123\n' +
      'pr: https://github.com/acme/repo/pull/1\n' +
      'shipped: 2026-07-01\n' +
      '---\n';

    const parsed = parseShippedRecord(legacy);

    expect(parsed).toMatchObject({ slug: 'legacy-feat', specHash: 'abc123' });
    expect(parsed).not.toHaveProperty('engineVersion', expect.anything());
  });

  it('round-trips a rendered record', () => {
    const rendered = renderShippedRecord({
      slug: 'billing-export',
      specHash: 'abc123',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-07-01',
    });

    const parsed = parseShippedRecord(rendered);

    expect(parsed).toEqual({
      slug: 'billing-export',
      specHash: 'abc123',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-07-01',
    });
  });

  it('round-trips frontmatter fields when a Cost block is appended (renderShippedRecordWithCost)', () => {
    const rollup: CostRollup = {
      tokens: { input: 1500, output: 300, cacheRead: 50, cacheCreation: 10 },
      costUsd: 0.15,
      dispatches: 2,
      retries: 1,
      halts: 0,
      unmetered: { count: 0, durationMs: 0 },
    };

    const rendered = renderShippedRecordWithCost(
      {
        slug: 'billing-export',
        specHash: 'abc123',
        pr: 'https://github.com/acme/repo/pull/42',
        shipped: '2026-07-01',
      },
      rollup,
    );

    expect(rendered).toMatch(/##\s*Cost/i);

    const parsed = parseShippedRecord(rendered);

    // Dedup/discovery only reads up to the closing frontmatter fence, so the
    // appended Cost block must not perturb the parsed frontmatter fields.
    expect(parsed).toEqual({
      slug: 'billing-export',
      specHash: 'abc123',
      pr: 'https://github.com/acme/repo/pull/42',
      shipped: '2026-07-01',
    });
  });

  it('returns {malformed: true} for malformed/invalid content', () => {
    const parsed = parseShippedRecord('# Not a shipped record\n\njust prose.\n');

    expect(parsed).toMatchObject({ malformed: true });
  });
});

describe('appendTimingSection', () => {
  const fields = {
    slug: 'billing-export',
    specHash: 'abc123',
    pr: 'https://github.com/acme/repo/pull/42',
    shipped: '2026-07-01',
  };
  const rollup: CostRollup = {
    tokens: { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 },
    costUsd: 0.01,
    dispatches: 1,
    retries: 0,
    halts: 0,
    unmetered: { count: 1, durationMs: 9876 },
    providers: {
      claude: {
        tokens: { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 },
        costUsd: 0.01,
        dispatches: 1,
        unmetered: { count: 1, durationMs: 9876 },
      },
    },
  };

  it.each([
    {
      state: 'measured',
      timing: {
        state: 'measured',
        activeMs: 100,
        providerActiveMs: 40,
        noProviderActiveMs: 60,
      } satisfies TimingRollup,
      expected:
        '## Time\n' +
        'state: measured\n' +
        'active_ms: 100\n' +
        'provider_active_ms: 40\n' +
        'no_provider_active_ms: 60\n',
    },
    {
      state: 'partial',
      timing: { state: 'partial', activeMs: 100 } satisfies TimingRollup,
      expected: '## Time\nstate: partial\nactive_ms: 100\n',
    },
    {
      state: 'unavailable',
      timing: { state: 'unavailable' } satisfies TimingRollup,
      expected: '## Time\nstate: unavailable\n',
    },
  ])('appends the explicit $state Time block', ({ timing, expected }) => {
    const rendered = appendTimingSection(
      renderShippedRecordWithCost(fields, rollup),
      timing,
    );

    expect(rendered.endsWith(`\n${expected}`)).toBe(true);
  });

  it('renders a partial reason on one parseable line beside active time', () => {
    const rendered = appendTimingSection(
      renderShippedRecordWithCost(fields, rollup),
      {
        state: 'partial',
        activeMs: 100,
        reason: 'open-executions:parallel:manual_test,step:build_review',
      },
    );

    expect(rendered.endsWith(
      '\n## Time\nstate: partial\nactive_ms: 100\nreason: open-executions:parallel:manual_test,step:build_review\n',
    )).toBe(true);
  });

  it('keeps every field recognized by earlier readers when adding a partial reason', () => {
    const before = renderShippedRecordWithCost(fields, rollup);
    const after = appendTimingSection(before, {
      state: 'partial',
      activeMs: 100,
      reason: 'provider-evidence-incomplete',
    });

    expect({
      shippedRecord: parseShippedRecord(after),
      cost: parseCostBlock(after),
    }).toEqual({
      shippedRecord: parseShippedRecord(before),
      cost: parseCostBlock(before),
    });
  });

  it('leaves frontmatter and Cost/provider-duration content byte-stable', () => {
    const before = renderShippedRecordWithCost(fields, rollup);
    const after = appendTimingSection(before, {
      state: 'measured',
      activeMs: 100,
      providerActiveMs: 40,
      noProviderActiveMs: 60,
    });

    expect({
      prefix: after.slice(0, before.length),
      parsed: parseShippedRecord(after),
      providerDuration: /unmetered: count: 1, duration_ms: 9876/.test(after),
    }).toEqual({
      prefix: before,
      parsed: parseShippedRecord(before),
      providerDuration: true,
    });
  });
});

describe('accepted build-review risk shipped projection', () => {
  it('reuses the deterministic accepted-risk section without changing frontmatter or cost blocks', () => {
    const finding = canonicalizeBuildReviewFindingIdentity({ rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change', anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'out-of-plan-change' } })!;
    const accepted: BuildReviewDispositionRecord = { version: 'v1', feature: { version: 'v1', repository: 'repo', feature: 'feature' }, finding, sourceLapId: parseBuildReviewLapId('lap-1')!, summary: 'summary', rationale: 'reason', operator: 'james', acceptedAt: '2026-08-14T12:00:00.000Z' };
    const body = '---\nslug: feature\n---\n\n## Cost\ninput: 1\n\n## Time\nstate: measured\n';

    const appended = appendBuildReviewAcceptedRisk(body, [accepted]);
    expect(appended).toContain('## Accepted build-review risk');
    expect(appended).toContain(`- Finding: \`${finding.id}\` — rubric: scope`);
    expect(appended).not.toContain('summary');
    expect(appended).not.toContain('reason');
    expect(appended).not.toContain('james');
    expect(appended).not.toContain('2026-08-14T12:00:00.000Z');
    expect(appendBuildReviewAcceptedRisk(body, [])).toBe(body);
    expect(() => appendBuildReviewAcceptedRisk(body, [{ ...accepted, rationale: '' }])).toThrow(/unrenderable/);
  });
});

describe('reduced build-review coverage shipped projection', () => {
  it('carries the engine-stamped shared lap section into the shipped record unchanged', () => {
    const section = [
      '## Reduced build-review coverage', '', '- Rubric: `tautology`', '  Cause: `provider-error`',
      '  Current diagnostic: provider unavailable', '  Operator: operator', '  Rationale: approved',
      '  Decision time: 2026-08-20T00:00:00.000Z',
    ].join('\n');
    const body = appendBuildReviewReducedCoverageEvidence('---\nslug: feature\n---\n', section);
    expect(body).toContain(section);
    expect(appendBuildReviewReducedCoverageEvidence(body, undefined)).toBe(body);
  });
});

describe('writeShippedRecord', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipped-record-writer-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the file at the correct path', async () => {
    const target = join(dir, '.docs/shipped/my-feat.md');
    const content = renderShippedRecord({ slug: 'my-feat', specHash: 'hash1' });

    await writeShippedRecord(target, content);

    const written = await readFile(target, 'utf8');
    expect(written).toBe(content);
  });

  it('is idempotent: writing identical content again does not error', async () => {
    const target = join(dir, '.docs/shipped/my-feat.md');
    const content = renderShippedRecord({ slug: 'my-feat', specHash: 'hash1' });

    await writeShippedRecord(target, content);
    await expect(writeShippedRecord(target, content)).resolves.toBeUndefined();

    const written = await readFile(target, 'utf8');
    expect(written).toBe(content);
  });

  it('overwrites the file when content differs', async () => {
    const target = join(dir, '.docs/shipped/my-feat.md');
    const first = renderShippedRecord({ slug: 'my-feat', specHash: 'hash1' });
    const second = renderShippedRecord({ slug: 'my-feat', specHash: 'hash2' });

    await writeShippedRecord(target, first);
    await writeShippedRecord(target, second);

    const written = await readFile(target, 'utf8');
    expect(written).toBe(second);
  });
});

describe('listShippedRecords', () => {
  it('returns records from .docs/shipped/ via the injected tree source', async () => {
    const rendered = renderShippedRecord({ slug: 'billing-export', specHash: 'abc123' });
    const tree = fakeTreeSource({ 'billing-export.md': rendered });

    const result = await listShippedRecords(tree);

    expect(result).toEqual([
      { stem: 'billing-export', record: parseShippedRecord(rendered) },
    ]);
  });

  it('reports malformed records as {malformed: true} rather than skipping them', async () => {
    const tree = fakeTreeSource({ 'bad-record.md': '# not frontmatter\n' });

    const result = await listShippedRecords(tree);

    expect(result).toEqual([{ stem: 'bad-record', record: { malformed: true } }]);
  });

  it('calls listShippedFiles exactly once, not once per file', async () => {
    const rendered1 = renderShippedRecord({ slug: 'feat-a', specHash: 'hash-a' });
    const rendered2 = renderShippedRecord({ slug: 'feat-b', specHash: 'hash-b' });
    const tree = fakeTreeSource({
      'feat-a.md': rendered1,
      'feat-b.md': rendered2,
    });

    await listShippedRecords(tree);

    expect(tree.listShippedFilesCallCount).toBe(1);
  });

  it('silently skips a basename whose file is missing from the tree source (working-tree-only records stay invisible)', async () => {
    const tree = fakeTreeSource({});
    // Simulate a basename listed but whose content vanished (readFile -> null)
    // by overriding listShippedFiles to report a name readFile won't resolve.
    const trickyTree: BacklogTreeSource = {
      ...tree,
      async listShippedFiles() {
        return ['ghost.md'];
      },
    };

    const result = await listShippedRecords(trickyTree);

    expect(result).toEqual([]);
  });
});

describe('makeIsProcessed', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipped-record-is-processed-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns true on a ledger hit (fast path), without needing a shipped record', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'billing-export'), '');
    const tree = fakeTreeSource({});

    const isProcessed = makeIsProcessed(dir, tree);

    expect(await isProcessed('billing-export')).toBe(true);
  });

  it('returns true on a shipped-record hit when the ledger has no entry', async () => {
    const rendered = renderShippedRecord({ slug: 'billing-export', specHash: 'abc123' });
    const tree = fakeTreeSource({ 'billing-export.md': rendered });

    const isProcessed = makeIsProcessed(dir, tree);

    expect(await isProcessed('billing-export')).toBe(true);
  });

  it('returns false when neither the ledger nor a shipped record has the slug', async () => {
    const tree = fakeTreeSource({});

    const isProcessed = makeIsProcessed(dir, tree);

    expect(await isProcessed('never-shipped')).toBe(false);
  });

  it('falls back to the shipped-record check when the ledger read errors (no throw)', async () => {
    // `dir` does not exist, so a ledger existence check will error (ENOENT on
    // the containing directory) rather than simply resolving false.
    const missingDir = join(dir, 'does', 'not', 'exist');
    const rendered = renderShippedRecord({ slug: 'billing-export', specHash: 'abc123' });
    const tree = fakeTreeSource({ 'billing-export.md': rendered });

    const isProcessed = makeIsProcessed(missingDir, tree);

    await expect(isProcessed('billing-export')).resolves.toBe(true);
  });

  it('caches the shipped-record list: multiple calls make only one listShippedFiles() call', async () => {
    const rendered = renderShippedRecord({ slug: 'billing-export', specHash: 'abc123' });
    const tree = fakeTreeSource({ 'billing-export.md': rendered });

    const isProcessed = makeIsProcessed(dir, tree);

    await isProcessed('billing-export');
    await isProcessed('never-shipped');
    await isProcessed('billing-export');

    expect(tree.listShippedFilesCallCount).toBe(1);
  });
});

describe('backfill (Story 6): one-time shipped-record generation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipped-backfill-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * Mirrors the one-time backfill script's per-stem logic: read plan/stories
   * bytes (or null if missing), compute specHash (or 'unknown' if the plan is
   * gone), and write the record via the real production helpers.
   */
  async function backfillStem(
    shippedDir: string,
    stem: string,
    opts: { planBytes: Buffer | null; storiesBytes?: Buffer | null; pr?: string; shipped?: string }
  ): Promise<string> {
    const hash =
      opts.planBytes === null
        ? 'unknown'
        : specHash(opts.planBytes, opts.storiesBytes ?? null).digest;
    const content = renderShippedRecord({
      slug: stem,
      specHash: hash,
      pr: opts.pr,
      shipped: opts.shipped,
    });
    const target = join(shippedDir, `${stem}.md`);
    await writeShippedRecord(target, content);
    return target;
  }

  it('generates a shipped record for every ledger entry (16-entry ledger fixture)', async () => {
    const shippedDir = join(dir, '.docs/shipped');
    const ledgerStems = Array.from({ length: 16 }, (_, i) => `ledger-spec-${i}`);

    for (const stem of ledgerStems) {
      await backfillStem(shippedDir, stem, {
        planBytes: Buffer.from(`plan body for ${stem}`),
        pr: 'https://github.com/acme/repo/pull/1',
      });
    }

    const files = await readdir(shippedDir);
    for (const stem of ledgerStems) {
      expect(files).toContain(`${stem}.md`);
    }
  });

  it('generates a shipped record for every known shipped-but-unmarked spec (the 7-spec ADR list)', async () => {
    const shippedDir = join(dir, '.docs/shipped');
    const knownSpecs = [
      'technical-assessment',
      'phase-2-language-evaluation',
      'pluggable-harness-architecture',
      'phase-9.3-engineer-redesign',
      'mermaid-renderer',
      'harness-self-host-guardrails',
      'multi-operator-ownership-hardening',
    ];

    for (const stem of knownSpecs) {
      await backfillStem(shippedDir, stem, { planBytes: Buffer.from(`plan for ${stem}`) });
    }

    const files = await readdir(shippedDir);
    for (const stem of knownSpecs) {
      expect(files).toContain(`${stem}.md`);
    }
  });

  it('stem-match dedup still works even when a backfilled record\'s hash has drifted from current content', async () => {
    const stem = 'drifted-spec';
    const shippedDir = join(dir, '.docs/shipped');

    // Backfilled at an older content snapshot.
    await backfillStem(shippedDir, stem, { planBytes: Buffer.from('old plan content') });
    const recordContent = await readFile(join(shippedDir, `${stem}.md`), 'utf8');
    const recorded = parseShippedRecord(recordContent);
    if ('malformed' in recorded) throw new Error('expected a parsed record');

    // Current base-branch content has since changed (drifted).
    const currentHash = specHash(Buffer.from('new plan content, changed since backfill'), null).digest;
    expect(recorded.specHash).not.toBe(currentHash);

    // isProcessed still resolves true by stem, ignoring the hash mismatch —
    // dedup keys off stem, not content identity (Story 3).
    const tree = fakeTreeSource({ [`${stem}.md`]: recordContent });
    const isProcessed = makeIsProcessed(join(dir, '.daemon-ledger-unused'), tree);

    expect(await isProcessed(stem)).toBe(true);
  });

  it('writes spec_hash: unknown when the ledger entry\'s plan no longer exists on the base branch', async () => {
    const shippedDir = join(dir, '.docs/shipped');
    const stem = 'deleted-plan-spec';

    const target = await backfillStem(shippedDir, stem, { planBytes: null });

    const written = await readFile(target, 'utf8');
    const parsed = parseShippedRecord(written);
    if ('malformed' in parsed) throw new Error('expected a parsed record');

    expect(parsed.slug).toBe(stem);
    expect(parsed.specHash).toBe('unknown');
  });
});
