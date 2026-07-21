/**
 * Tests for mergeable-sweep.ts (Tasks 12–14: watch registry + sweep decision tree).
 *
 * All gh interactions use fake runners; no real `gh` binary required.
 * Temp directories are created per-suite and cleaned up in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  enrollWatch,
  readWatch,
  rewriteWatch,
  sweepMergeableLabels,
} from '../../src/engine/mergeable-sweep.js';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the JSON payload that `prMergeState` receives from `gh pr view`.
 * Any field omitted means "not present" (omit from the JSON object entirely).
 */
function prViewJson(
  state: string,
  mergeable: string = 'MERGEABLE',
  checks: Array<{ status?: string; conclusion?: string }> = [],
  labels: string[] = [],
): { stdout: string } {
  return {
    stdout: JSON.stringify({
      state,
      mergeable,
      statusCheckRollup: checks,
      labels: labels.map((name) => ({ name })),
    }),
  };
}

/**
 * A per-call-recording fake GhRunner.
 *
 * `prStates` maps a PR URL to the response that should be returned when
 * `gh pr view <url>` is called.  A missing key returns an empty OPEN/MERGEABLE
 * state.  An Error value causes the call to throw (simulates network failure /
 * not-found error that prMergeState will catch internally).
 *
 * Label mutations (REST `gh api .../labels` add/remove) are recorded and
 * optionally update `currentLabels` (per-URL) when `trackLabelMutations` is true.
 */

/**
 * Reconstruct the canonical PR URL from a REST labels path
 * (`repos/<owner>/<repo>/issues/<n>/labels[/<name>]`) so label mutations key on
 * the same URL the sweep used for `gh pr view`.
 */
function restPathToPrUrl(path: string): string {
  const m = path.match(/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/labels/);
  if (!m) return path;
  return `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
}
function makeFakeGh(
  prStates: Record<string, { stdout: string } | Error> = {},
  opts: { trackLabelMutations?: boolean } = {},
): {
  gh: GhRunner;
  addLabelCalls: Array<{ prUrl: string; label: string }>;
  removeLabelCalls: Array<{ prUrl: string; label: string }>;
  ensureLabelCalls: Array<{ name: string; color: string }>;
  allArgs: string[][];
} {
  const addLabelCalls: Array<{ prUrl: string; label: string }> = [];
  const removeLabelCalls: Array<{ prUrl: string; label: string }> = [];
  const ensureLabelCalls: Array<{ name: string; color: string }> = [];
  const allArgs: string[][] = [];

  // mutable label sets per PR (only used when trackLabelMutations = true)
  const labelState: Record<string, string[]> = {};

  const gh: GhRunner = async (args, _opts) => {
    allArgs.push([...args]);

    // gh pr view <url> --json ...
    if (args[0] === 'pr' && args[1] === 'view' && args[3] === '--json') {
      const prUrl = args[2];
      const resp = prStates[prUrl];
      if (resp instanceof Error) throw resp;
      if (resp) {
        if (opts.trackLabelMutations) {
          // Merge the recorded label state into the returned JSON so subsequent
          // calls reflect mutations applied by addLabel / removeLabel.
          const parsed: { state: string; mergeable: string; statusCheckRollup: unknown[]; labels: Array<{ name: string }> } =
            JSON.parse(resp.stdout);
          const current = labelState[prUrl] ?? parsed.labels.map((l) => l.name);
          labelState[prUrl] = current;
          return {
            stdout: JSON.stringify({
              ...parsed,
              labels: current.map((n) => ({ name: n })),
            }),
          };
        }
        return resp;
      }
      return prViewJson('OPEN', 'MERGEABLE', [], labelState[prUrl] ?? []);
    }

    // gh api --method POST repos/<o>/<r>/issues/<n>/labels -f labels[]=<name>
    // (REST label-add — Projects-classic safe; replaces `gh pr edit --add-label`)
    if (args[0] === 'api' && args[2] === 'POST' && /\/labels$/.test(args[3] ?? '')) {
      const prUrl = restPathToPrUrl(args[3]);
      const label = (args[5] ?? '').replace(/^labels\[\]=/, '');
      addLabelCalls.push({ prUrl, label });
      if (opts.trackLabelMutations) {
        if (!labelState[prUrl]) labelState[prUrl] = [];
        if (!labelState[prUrl].includes(label)) labelState[prUrl].push(label);
      }
      return { stdout: '' };
    }

    // gh api --method DELETE repos/<o>/<r>/issues/<n>/labels/<name>
    // (REST label-remove — Projects-classic safe; replaces `gh pr edit --remove-label`)
    if (args[0] === 'api' && args[2] === 'DELETE' && /\/labels\//.test(args[3] ?? '')) {
      const prUrl = restPathToPrUrl(args[3]);
      const label = decodeURIComponent(args[3].replace(/^.*\/labels\//, ''));
      removeLabelCalls.push({ prUrl, label });
      if (opts.trackLabelMutations) {
        if (labelState[prUrl]) {
          labelState[prUrl] = labelState[prUrl].filter((l) => l !== label);
        }
      }
      return { stdout: '' };
    }

    // gh label create <name> --color <color> --force
    if (args[0] === 'label' && args[1] === 'create') {
      ensureLabelCalls.push({ name: args[2], color: args[4] });
      return { stdout: '' };
    }

    return { stdout: '' };
  };

  return { gh, addLabelCalls, removeLabelCalls, ensureLabelCalls, allArgs };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PR_URL = 'https://github.com/foo/bar/pull/42';
const PR_URL_2 = 'https://github.com/foo/bar/pull/43';

function entry(prUrl = PR_URL): WatchEntry {
  return { prUrl, slug: 'test-feature', repoCwd: '/fake/repo', resolveAttempts: 0, ciFixAttempts: 0 };
}

// ── Temp dir lifecycle ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mergeable-sweep-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Task 12: watch registry helpers ──────────────────────────────────────────

describe('enrollWatch / readWatch round-trip', () => {
  it('appends one entry and reads it back', async () => {
    await enrollWatch(tmpDir, entry());
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry());
  });

  it('appends multiple entries in order', async () => {
    const e1 = entry(PR_URL);
    const e2 = entry(PR_URL_2);
    await enrollWatch(tmpDir, e1);
    await enrollWatch(tmpDir, e2);
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(e1);
    expect(result[1]).toEqual(e2);
  });

  it('creates the .daemon directory if it does not exist', async () => {
    // tmpDir has no .daemon yet
    await enrollWatch(tmpDir, entry());
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
  });
});

describe('readWatch', () => {
  it('returns [] when the watch file does not exist', async () => {
    const result = await readWatch(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns [] for a completely empty file', async () => {
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    await writeFile(join(tmpDir, '.daemon', 'mergeable-watch.jsonl'), '');
    const result = await readWatch(tmpDir);
    expect(result).toEqual([]);
  });

  it('skips malformed lines without throwing and still returns valid entries', async () => {
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    const valid = JSON.stringify(entry());
    await writeFile(
      join(tmpDir, '.daemon', 'mergeable-watch.jsonl'),
      [valid, '{not valid json', valid].join('\n') + '\n',
    );
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(entry());
    expect(result[1]).toEqual(entry());
  });

  it('skips lines that are valid JSON but not WatchEntry shape', async () => {
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    await writeFile(
      join(tmpDir, '.daemon', 'mergeable-watch.jsonl'),
      JSON.stringify({ prUrl: 'u' }) + '\n' + // missing slug + repoCwd
        JSON.stringify(entry()) +
        '\n',
    );
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry());
  });

  it('parses a legacy entry (without resolution state fields) with zero-defaults', async () => {
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    // Legacy entry: only prUrl, slug, repoCwd
    const legacyEntry = { prUrl: PR_URL, slug: 'test-feature', repoCwd: '/fake/repo' };
    await writeFile(
      join(tmpDir, '.daemon', 'mergeable-watch.jsonl'),
      JSON.stringify(legacyEntry) + '\n',
    );
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
    // Legacy entries should have resolveAttempts = 0 and lastResolveAt = undefined
    expect(result[0].prUrl).toBe(PR_URL);
    expect(result[0].slug).toBe('test-feature');
    expect(result[0].repoCwd).toBe('/fake/repo');
    expect(result[0].resolveAttempts).toBe(0);
    expect(result[0].lastResolveAt).toBeUndefined();
  });

  it('round-trips an extended entry with resolution state fields unchanged', async () => {
    const extendedEntry = {
      prUrl: PR_URL,
      slug: 'test-feature',
      repoCwd: '/fake/repo',
      resolveAttempts: 3,
      lastResolveAt: '2026-07-04T10:30:00Z',
    };
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    await writeFile(
      join(tmpDir, '.daemon', 'mergeable-watch.jsonl'),
      JSON.stringify(extendedEntry) + '\n',
    );
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
    // Expected entry after normalization: legacy ciFix fields default to 0/undefined
    const expected = { ...extendedEntry, ciFixAttempts: 0 };
    expect(result[0]).toEqual(expected);
  });

  it('parses a legacy entry (without ciFix fields) with zero-defaults', async () => {
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    // Legacy entry: no ciFixAttempts or lastCiFixAt
    const legacyEntry = { prUrl: PR_URL, slug: 'test-feature', repoCwd: '/fake/repo' };
    await writeFile(
      join(tmpDir, '.daemon', 'mergeable-watch.jsonl'),
      JSON.stringify(legacyEntry) + '\n',
    );
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
    // Legacy entries should have ciFixAttempts = 0 and lastCiFixAt = undefined
    expect(result[0].prUrl).toBe(PR_URL);
    expect(result[0].ciFixAttempts).toBe(0);
    expect(result[0].lastCiFixAt).toBeUndefined();
  });

  it('round-trips an entry with ciFix state fields unchanged', async () => {
    const ciFix = {
      prUrl: PR_URL,
      slug: 'test-feature',
      repoCwd: '/fake/repo',
      ciFixAttempts: 1,
      lastCiFixAt: '2026-07-04T10:35:00Z',
    };
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    await writeFile(
      join(tmpDir, '.daemon', 'mergeable-watch.jsonl'),
      JSON.stringify(ciFix) + '\n',
    );
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
    // Expected entry after normalization: legacy resolve fields default to 0/undefined
    const expected = { ...ciFix, resolveAttempts: 0 };
    expect(result[0]).toEqual(expected);
  });

  it('round-trips a legacy entry (no ciFix fields) unchanged through rewriteWatch', async () => {
    await mkdir(join(tmpDir, '.daemon'), { recursive: true });
    const legacyEntry = { prUrl: PR_URL, slug: 'test-feature', repoCwd: '/fake/repo' };
    await writeFile(
      join(tmpDir, '.daemon', 'mergeable-watch.jsonl'),
      JSON.stringify(legacyEntry) + '\n',
    );
    const read = await readWatch(tmpDir);
    expect(read).toHaveLength(1);
    // Entry should be normalized with zero defaults
    expect(read[0].ciFixAttempts).toBe(0);
    expect(read[0].lastCiFixAt).toBeUndefined();
    // Round-trip through rewriteWatch
    await rewriteWatch(tmpDir, read);
    const reread = await readWatch(tmpDir);
    expect(reread).toHaveLength(1);
    // After round-trip, ciFixAttempts should still be 0 and lastCiFixAt should still be undefined
    expect(reread[0].ciFixAttempts).toBe(0);
    expect(reread[0].lastCiFixAt).toBeUndefined();
  });
});

describe('rewriteWatch', () => {
  it('overwrites the file with the given entries, replacing prior content', async () => {
    const e1 = entry(PR_URL);
    const e2 = entry(PR_URL_2);
    await enrollWatch(tmpDir, e1);
    await enrollWatch(tmpDir, e2);
    await rewriteWatch(tmpDir, [e1]); // drop e2
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(e1);
  });

  it('writes an empty file when entries is []', async () => {
    await enrollWatch(tmpDir, entry());
    await rewriteWatch(tmpDir, []);
    const result = await readWatch(tmpDir);
    expect(result).toEqual([]);
  });

  it('swallows a write failure without throwing (C3)', async () => {
    // Writing to a path whose parent directory does not exist must not throw.
    await expect(rewriteWatch('/no/such/directory/here', [])).resolves.toBeUndefined();
  });
});

// ── Task 13: sweep decision tree ──────────────────────────────────────────────

describe('sweepMergeableLabels — FR-13: MERGED / CLOSED / not-found → pruned', () => {
  it('prunes a MERGED PR from the registry', async () => {
    const { gh } = makeFakeGh({ [PR_URL]: prViewJson('MERGED', 'UNKNOWN', [], []) });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(await readWatch(tmpDir)).toHaveLength(0);
  });

  it('prunes a CLOSED PR from the registry', async () => {
    const { gh } = makeFakeGh({ [PR_URL]: prViewJson('CLOSED', 'UNKNOWN', [], []) });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(await readWatch(tmpDir)).toHaveLength(0);
  });

  it('prunes a not-found / gone PR (simulated as CLOSED) from the registry', async () => {
    // When `gh pr view` returns CLOSED it means the PR is gone; same as deleted.
    const { gh } = makeFakeGh({ [PR_URL]: prViewJson('CLOSED') });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(await readWatch(tmpDir)).toHaveLength(0);
  });

  it('prunes a PR whose gh runner throws a not-found-style error (FR-13 NOTFOUND)', async () => {
    // A genuinely deleted PR causes gh to throw with "not found" text.
    // prMergeState classifies this as NOTFOUND; sweep must prune it.
    const { gh } = makeFakeGh({
      [PR_URL]: new Error('could not resolve to a PullRequest'),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(await readWatch(tmpDir)).toHaveLength(0);
  });

  it('keeps entry when gh throws a DNS transient error "could not resolve host" (NOT pruned)', async () => {
    // "could not resolve host: github.com" is a network-level transient error,
    // NOT a genuine not-found signal. The entry must be kept so the next sweep
    // can retry — the PR has not been deleted.
    const { gh } = makeFakeGh({ [PR_URL]: new Error('could not resolve host: github.com') });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    const remaining = await readWatch(tmpDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].prUrl).toBe(PR_URL);
  });

  it('keeps entry and processes others when one PR throws a generic/transient error (FR-15)', async () => {
    // A transient error (e.g. network timeout) must NOT prune; the entry is kept
    // and the other entries in the registry must still be processed.
    const logs: string[] = [];
    const { gh, addLabelCalls } = makeFakeGh({
      [PR_URL]: new Error('connection reset by peer'),
      [PR_URL_2]: prViewJson('OPEN', 'MERGEABLE', [], []),
    });
    await enrollWatch(tmpDir, entry(PR_URL));
    await enrollWatch(tmpDir, entry(PR_URL_2));
    await expect(
      sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh, log: (m) => logs.push(m) }),
    ).resolves.toBeUndefined();
    const remaining = await readWatch(tmpDir);
    // Transient-error entry must be kept
    expect(remaining.some((e) => e.prUrl === PR_URL)).toBe(true);
    // Other entry must be processed
    expect(addLabelCalls.some((c) => c.prUrl === PR_URL_2 && c.label === 'mergeable')).toBe(true);
  });

  it('keeps other entries when one is pruned', async () => {
    const { gh } = makeFakeGh({
      [PR_URL]: prViewJson('MERGED'),
      [PR_URL_2]: prViewJson('OPEN', 'MERGEABLE', [], []),
    });
    await enrollWatch(tmpDir, entry(PR_URL));
    await enrollWatch(tmpDir, entry(PR_URL_2));
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    const remaining = await readWatch(tmpDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].prUrl).toBe(PR_URL_2);
  });
});

describe('sweepMergeableLabels — Task 1: MAX_WATCH_ENTRIES cap', () => {
  const MAX_WATCH_ENTRIES = 100;

  it('trims the registry to the last MAX_WATCH_ENTRIES entries, dropping the oldest', async () => {
    const total = MAX_WATCH_ENTRIES + 10;
    const urls = Array.from(
      { length: total },
      (_, i) => `https://github.com/foo/bar/pull/${i + 1}`,
    );
    const prStates: Record<string, { stdout: string }> = {};
    for (const url of urls) {
      prStates[url] = prViewJson('OPEN', 'MERGEABLE', [], []);
    }
    const { gh } = makeFakeGh(prStates);
    for (const url of urls) {
      await enrollWatch(tmpDir, entry(url));
    }
    const logs: string[] = [];
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh, log: (m) => logs.push(m) });
    const remaining = await readWatch(tmpDir);
    expect(remaining).toHaveLength(MAX_WATCH_ENTRIES);
    // The oldest (front) entries were dropped; survivors are the last
    // MAX_WATCH_ENTRIES of the seeded, append-ordered list.
    const expectedUrls = urls.slice(-MAX_WATCH_ENTRIES);
    expect(remaining.map((e) => e.prUrl)).toEqual(expectedUrls);
    // Every dropped entry must be logged (no silent truncation).
    const droppedUrls = urls.slice(0, urls.length - MAX_WATCH_ENTRIES);
    for (const url of droppedUrls) {
      expect(logs).toContainEqual(
        `[mergeable-sweep] registry cap: dropping ${url} (slug ${entry(url).slug}) — over MAX_WATCH_ENTRIES`,
      );
    }
  });

  it('does not drop any entries when under the cap', async () => {
    const total = MAX_WATCH_ENTRIES - 10;
    const urls = Array.from(
      { length: total },
      (_, i) => `https://github.com/foo/bar/pull/${i + 1}`,
    );
    const prStates: Record<string, { stdout: string }> = {};
    for (const url of urls) {
      prStates[url] = prViewJson('OPEN', 'MERGEABLE', [], []);
    }
    const { gh } = makeFakeGh(prStates);
    for (const url of urls) {
      await enrollWatch(tmpDir, entry(url));
    }
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    const remaining = await readWatch(tmpDir);
    expect(remaining).toHaveLength(total);
    expect(remaining.map((e) => e.prUrl)).toEqual(urls);
  });

  it('prunes gone PRs by state independently of the cap, and caps only the live survivors', async () => {
    // Two "gone" PRs (MERGED / CLOSED) plus a surplus of live entries beyond
    // MAX_WATCH_ENTRIES. The gone PRs must be pruned entirely (state-based
    // pruning, FR-13) and must not count against the cap — the persisted
    // registry should hold exactly MAX_WATCH_ENTRIES entries, all live.
    const liveTotal = MAX_WATCH_ENTRIES + 10;
    const liveUrls = Array.from(
      { length: liveTotal },
      (_, i) => `https://github.com/foo/bar/pull/live-${i + 1}`,
    );
    const goneMergedUrl = 'https://github.com/foo/bar/pull/gone-merged';
    const goneClosedUrl = 'https://github.com/foo/bar/pull/gone-closed';

    const prStates: Record<string, { stdout: string }> = {
      [goneMergedUrl]: prViewJson('MERGED', 'UNKNOWN', [], []),
      [goneClosedUrl]: prViewJson('CLOSED', 'UNKNOWN', [], []),
    };
    for (const url of liveUrls) {
      prStates[url] = prViewJson('OPEN', 'MERGEABLE', [], []);
    }
    const { gh } = makeFakeGh(prStates);

    // Enroll gone entries first, then the live surplus (append order).
    await enrollWatch(tmpDir, entry(goneMergedUrl));
    await enrollWatch(tmpDir, entry(goneClosedUrl));
    for (const url of liveUrls) {
      await enrollWatch(tmpDir, entry(url));
    }

    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });

    const remaining = await readWatch(tmpDir);
    // Gone PRs pruned entirely — not present at all.
    expect(remaining.some((e) => e.prUrl === goneMergedUrl)).toBe(false);
    expect(remaining.some((e) => e.prUrl === goneClosedUrl)).toBe(false);
    // Cap applies only to the live survivors.
    expect(remaining).toHaveLength(MAX_WATCH_ENTRIES);
    expect(remaining.map((e) => e.prUrl)).toEqual(liveUrls.slice(-MAX_WATCH_ENTRIES));
  });

  it('does not throw when rewriteWatch fails to persist an over-cap registry (best-effort)', async () => {
    const total = MAX_WATCH_ENTRIES + 10;
    const urls = Array.from(
      { length: total },
      (_, i) => `https://github.com/foo/bar/pull/${i + 1}`,
    );
    const prStates: Record<string, { stdout: string }> = {};
    for (const url of urls) {
      prStates[url] = prViewJson('OPEN', 'MERGEABLE', [], []);
    }
    const { gh } = makeFakeGh(prStates);
    for (const url of urls) {
      await enrollWatch(tmpDir, entry(url));
    }

    // Force rewriteWatch's write to fail: strip write permission on the
    // .daemon directory after the (already-persisted) entries have been
    // enrolled. readWatch (a read) still succeeds; the final rewriteWatch
    // (a write) fails and is swallowed (C3) — the sweep as a whole must not
    // throw.
    const daemonDir = join(tmpDir, '.daemon');
    await chmod(daemonDir, 0o555);
    try {
      await expect(
        sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh }),
      ).resolves.not.toThrow();
    } finally {
      // Restore permissions so afterEach's recursive rm can clean up.
      await chmod(daemonDir, 0o755);
    }
  });
});

describe('sweepMergeableLabels — FR-12: needs-remediation → mergeable must be absent', () => {
  it('removes mergeable when PR carries needs-remediation and mergeable is present', async () => {
    const { gh, removeLabelCalls, addLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [], ['needs-remediation', 'mergeable']),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(removeLabelCalls).toContainEqual({ prUrl: PR_URL, label: 'mergeable' });
    expect(addLabelCalls.filter((c) => c.label === 'mergeable')).toHaveLength(0);
  });

  it('does NOT add mergeable when PR carries needs-remediation (even if otherwise mergeable)', async () => {
    const { gh, addLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [], ['needs-remediation']),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(addLabelCalls.filter((c) => c.label === 'mergeable')).toHaveLength(0);
  });

  it('does not call removeLabel when needs-remediation present but mergeable already absent', async () => {
    const { gh, removeLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [], ['needs-remediation']),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(removeLabelCalls.filter((c) => c.label === 'mergeable')).toHaveLength(0);
  });
});

describe('sweepMergeableLabels — FR-10: green open PR → add mergeable label', () => {
  it('adds mergeable label to an open, conflict-free PR with passing checks', async () => {
    const { gh, addLabelCalls, ensureLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], []),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(ensureLabelCalls).toContainEqual({ name: 'mergeable', color: '0E8A16' });
    expect(addLabelCalls).toContainEqual({ prUrl: PR_URL, label: 'mergeable' });
  });

  it('adds mergeable label when there are no status checks (zero checks = green)', async () => {
    const { gh, addLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [], []),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(addLabelCalls).toContainEqual({ prUrl: PR_URL, label: 'mergeable' });
  });
});

describe('sweepMergeableLabels — FR-11: non-mergeable PR → remove mergeable if present', () => {
  it('removes mergeable from a PR with CONFLICTING status', async () => {
    const { gh, removeLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'CONFLICTING', [], ['mergeable']),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(removeLabelCalls).toContainEqual({ prUrl: PR_URL, label: 'mergeable' });
  });

  it('removes mergeable from a PR with failing checks', async () => {
    const { gh, removeLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson(
        'OPEN',
        'MERGEABLE',
        [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
        ['mergeable'],
      ),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(removeLabelCalls).toContainEqual({ prUrl: PR_URL, label: 'mergeable' });
  });

  it('removes mergeable from a PR with UNKNOWN mergeability', async () => {
    const { gh, removeLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'UNKNOWN', [], ['mergeable']),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(removeLabelCalls).toContainEqual({ prUrl: PR_URL, label: 'mergeable' });
  });
});

describe('sweepMergeableLabels — FR-15: per-PR failure → skip, continue others, no throw', () => {
  it('logs and skips an entry when prMergeState returns UNKNOWN (gh runner error)', async () => {
    // Runner throws for PR_URL → prMergeState returns sentinel (state='UNKNOWN') → skip.
    // PR_URL_2 is fine → should be processed (addLabel called).
    const logs: string[] = [];
    const { gh, addLabelCalls } = makeFakeGh({
      [PR_URL]: new Error('network timeout'),
      [PR_URL_2]: prViewJson('OPEN', 'MERGEABLE', [], []),
    });
    await enrollWatch(tmpDir, entry(PR_URL));
    await enrollWatch(tmpDir, entry(PR_URL_2));
    await expect(
      sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh, log: (m) => logs.push(m) }),
    ).resolves.toBeUndefined();
    // PR_URL is still in the registry (skipped, not pruned).
    const remaining = await readWatch(tmpDir);
    expect(remaining.some((e) => e.prUrl === PR_URL)).toBe(true);
    // PR_URL_2 was processed and got the mergeable label.
    expect(addLabelCalls.some((c) => c.prUrl === PR_URL_2 && c.label === 'mergeable')).toBe(true);
  });

  it('does not throw when the sweep encounters an unexpected error', async () => {
    // Even if everything fails, sweepMergeableLabels must resolve.
    const gh: GhRunner = async () => {
      throw new Error('catastrophic');
    };
    await enrollWatch(tmpDir, entry());
    await expect(sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh })).resolves.toBeUndefined();
  });
});

// ── Task 14: idempotency (C2) ─────────────────────────────────────────────────

describe('sweepMergeableLabels — C2: idempotency', () => {
  it('does NOT call addLabel when mergeable is already present on a green PR', async () => {
    const { gh, addLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [], ['mergeable']),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(addLabelCalls.filter((c) => c.label === 'mergeable')).toHaveLength(0);
  });

  it('does NOT call removeLabel when mergeable is already absent on a non-mergeable PR', async () => {
    const { gh, removeLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'CONFLICTING', [], []),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(removeLabelCalls.filter((c) => c.label === 'mergeable')).toHaveLength(0);
  });

  it('does not make redundant add/remove calls on a second sweep with unchanged state (C2)', async () => {
    // Use trackLabelMutations so the fake runner reflects state changes.
    const { gh, addLabelCalls, removeLabelCalls } = makeFakeGh(
      { [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [], []) },
      { trackLabelMutations: true },
    );
    await enrollWatch(tmpDir, entry());

    // First sweep: PR has no 'mergeable' → addLabel called once.
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(addLabelCalls.filter((c) => c.label === 'mergeable')).toHaveLength(1);

    // Second sweep: 'mergeable' is now present (tracked by fake runner) → no new calls.
    const addBeforeSecond = addLabelCalls.length;
    const removeBeforeSecond = removeLabelCalls.length;
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(addLabelCalls.length).toBe(addBeforeSecond);
    expect(removeLabelCalls.length).toBe(removeBeforeSecond);
  });
});

// ── Bonus: rewriteWatch failure is swallowed inside the sweep (C3) ────────────

describe('sweepMergeableLabels — C3: rewrite failure does not propagate', () => {
  it('resolves even when the registry cannot be rewritten', async () => {
    // Remove the .daemon directory mid-sweep to make rewriteWatch fail.
    const { gh } = makeFakeGh({
      [PR_URL]: prViewJson('MERGED'),
    });
    await enrollWatch(tmpDir, entry());
    // Remove the .daemon directory so the rewrite (via rewriteWatch) will fail.
    await rm(join(tmpDir, '.daemon'), { recursive: true, force: true });
    await expect(
      sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh }),
    ).resolves.toBeUndefined();
  });
});

// ── Task 6: sweep adds ci-failed label on failed rollup (idempotent) ───────

describe('sweepMergeableLabels — Task 6: ci-failed label on failed checks', () => {
  it('adds ci-failed label to a failed PR without the label', async () => {
    const { gh, addLabelCalls, ensureLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(ensureLabelCalls).toContainEqual({ name: 'ci-failed', color: 'E8451F' });
    expect(addLabelCalls).toContainEqual({ prUrl: PR_URL, label: 'ci-failed' });
  });

  it('does NOT call addLabel when ci-failed is already present on a failed PR', async () => {
    const { gh, addLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], ['ci-failed']),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(addLabelCalls.filter((c) => c.label === 'ci-failed')).toHaveLength(0);
  });
});

// ── Task 9: label operation error resilience ────────────────────────────

describe('sweepMergeableLabels — Task 9: label gh-error resilience', () => {
  it('handles GhRunner throw on label call: entry A stays in survivors, entry B processed, sweep resolves', async () => {
    // Fake runner that throws on label operations for entry A, but not for entry B.
    // Entry A is a green PR (will trigger mergeable label add).
    // Entry B is also a green PR.
    // GhRunner will throw when trying to add/remove/ensure labels for A,
    // but should work normally for B.
    let labelOpForA = false;
    const gh: GhRunner = async (args, _opts) => {
      // Detect if this is a label operation for PR_URL (entry A)
      const isLabelOp =
        (args[0] === 'api' && (args[2] === 'POST' || args[2] === 'DELETE') && /\/labels/.test(args[3] ?? '')) ||
        (args[0] === 'label' && args[1] === 'create');

      // Check if it's for PR_URL (the label path contains the PR number)
      if (isLabelOp && args[3]?.includes('/42/')) {
        labelOpForA = true;
      }

      if (labelOpForA && isLabelOp) {
        throw new Error('GitHub label operation failed: rate limit');
      }

      // Return normal responses for pr view
      if (args[0] === 'pr' && args[1] === 'view') {
        const prUrl = args[2];
        if (prUrl === PR_URL) {
          return prViewJson('OPEN', 'MERGEABLE', [], []);
        }
        if (prUrl === PR_URL_2) {
          return prViewJson('OPEN', 'MERGEABLE', [], []);
        }
      }

      // Return empty for label operations that don't throw
      return { stdout: '' };
    };

    const logs: string[] = [];
    await enrollWatch(tmpDir, entry(PR_URL));
    await enrollWatch(tmpDir, entry(PR_URL_2));

    // Sweep should not throw even though GhRunner throws on labels for A
    await expect(
      sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh, log: (m) => logs.push(m) }),
    ).resolves.toBeUndefined();

    // Both entries should remain in survivors
    const remaining = await readWatch(tmpDir);
    expect(remaining).toHaveLength(2);
    expect(remaining.some((e) => e.prUrl === PR_URL)).toBe(true);
    expect(remaining.some((e) => e.prUrl === PR_URL_2)).toBe(true);

    // Error should be logged
    expect(logs.some((l) => l.includes('error') && l.includes(PR_URL))).toBe(true);
  });
});

// ── Task 7: sweep removes ci-failed + resets attempts on green ───────────────

describe('sweepMergeableLabels — Task 7: green removes ci-failed label and resets attempts', () => {
  it('removes ci-failed label from a green PR that has the label', async () => {
    const { gh, removeLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], ['ci-failed']),
    });
    const greenEntry = { ...entry(), ciFixAttempts: 2 };
    await enrollWatch(tmpDir, greenEntry);
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(removeLabelCalls).toContainEqual({ prUrl: PR_URL, label: 'ci-failed' });
  });

  it('resets ciFixAttempts to 0 in the registry when a green PR has ci-failed label', async () => {
    const { gh } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], ['ci-failed']),
    });
    const greenEntry = { ...entry(), ciFixAttempts: 2 };
    await enrollWatch(tmpDir, greenEntry);
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].ciFixAttempts).toBe(0);
  });

  it('does NOT call removeLabel when ci-failed is already absent on a green PR', async () => {
    const { gh, removeLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], []),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(removeLabelCalls.filter((c) => c.label === 'ci-failed')).toHaveLength(0);
  });

  it('does NOT make unnecessary ci-failed removal calls on a second sweep when already removed', async () => {
    // Use trackLabelMutations so the fake runner reflects state changes.
    const { gh, removeLabelCalls } = makeFakeGh(
      { [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], ['ci-failed']) },
      { trackLabelMutations: true },
    );
    const greenEntry = { ...entry(), ciFixAttempts: 2 };
    await enrollWatch(tmpDir, greenEntry);

    // First sweep: green PR has 'ci-failed' → removeLabel called once.
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(removeLabelCalls.filter((c) => c.label === 'ci-failed')).toHaveLength(1);

    // Second sweep: 'ci-failed' is now absent (tracked by fake runner) → no new calls.
    const removeBeforeSecond = removeLabelCalls.length;
    await sweepMergeableLabels({ projectRoot: tmpDir, runGh: gh });
    expect(removeLabelCalls.length).toBe(removeBeforeSecond);
  });
});

// ── Task 10: CiFixDispatchOpts seam + disabled-config inertness ──────────────

describe('sweepMergeableLabels — Task 10: ciFix dispatch with disabled-config gating', () => {
  it('does not invoke dispatch when ciFix is absent and failed candidates present', async () => {
    const dispatchCalls: string[] = [];
    const { gh } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      // ciFix is absent
    });
    expect(dispatchCalls).toHaveLength(0);
  });

  it('does not invoke dispatch when ciFix.enabled is false and failed candidates present', async () => {
    const dispatchCalls: string[] = [];
    const { gh } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      ciFix: {
        enabled: false,
        isEligible: async () => ({ eligible: true }),
        dispatch: async () => {
          dispatchCalls.push('dispatched');
        },
      },
    });
    expect(dispatchCalls).toHaveLength(0);
  });

  it('registry writes are identical between ciFix absent and ciFix disabled runs', async () => {
    const { gh: gh1 } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []),
    });
    const { gh: gh2 } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []),
    });

    // First run: no ciFix option
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh1,
    });
    const registryWithoutCiFix = await readWatch(tmpDir);

    // Second run: ciFix disabled
    await rewriteWatch(tmpDir, [entry()]); // reset
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh2,
      ciFix: {
        enabled: false,
        isEligible: async () => ({ eligible: true }),
        dispatch: async () => {
          throw new Error('should not be called');
        },
      },
    });
    const registryWithCiFixDisabled = await readWatch(tmpDir);

    // Both registry writes should be identical
    expect(registryWithoutCiFix).toEqual(registryWithCiFixDisabled);
  });
});

// ── Task 11: bump-before-dispatch persistence ────────────────────────────

describe('sweepMergeableLabels — Task 11: bump-before-dispatch crash safety', () => {
  it('rewrites registry with bumped attempts and timestamp when dispatch resolves', async () => {
    const dispatchCalls: WatchEntry[] = [];
    const { gh } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []),
    });
    const testEntry = { ...entry(), ciFixAttempts: 0 };
    await enrollWatch(tmpDir, testEntry);

    const now = new Date('2026-07-08T12:00:00Z');
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (updated) => {
          dispatchCalls.push(updated);
          return { kind: 'green-verified' as const };
        },
        now: () => now,
      },
    });

    // Dispatch should have been called with bumped entry
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].ciFixAttempts).toBe(1);
    expect(dispatchCalls[0].lastCiFixAt).toBe('2026-07-08T12:00:00.000Z');

    // Registry should reflect bumped values (reset because dispatch returned 'green-verified')
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].ciFixAttempts).toBe(0); // reset because of green-verified outcome
  });

  it('rewrites registry with bumped attempts and timestamp even when dispatch throws', async () => {
    const { gh } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []),
    });
    const testEntry = { ...entry(), ciFixAttempts: 1 };
    await enrollWatch(tmpDir, testEntry);

    const now = new Date('2026-07-08T12:15:00Z');
    const logs: string[] = [];
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      log: (msg) => logs.push(msg),
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async () => {
          throw new Error('dispatch failed');
        },
        now: () => now,
      },
    });

    // Error should be logged
    expect(logs.some((l) => l.includes('dispatch failed'))).toBe(true);

    // Registry should still have bumped values (not reset because dispatch threw)
    const result = await readWatch(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].ciFixAttempts).toBe(2);
    expect(result[0].lastCiFixAt).toBe('2026-07-08T12:15:00.000Z');
  });

  it('does not propagate dispatch throw to caller', async () => {
    const { gh } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []),
    });
    await enrollWatch(tmpDir, entry());

    const sweepPromise = sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async () => {
          throw new Error('catastrophic failure');
        },
      },
    });

    // Should not throw
    await expect(sweepPromise).resolves.toBeUndefined();
  });
});

// ── Task 12: one dispatch per tick ───────────────────────────────────────

describe('sweepMergeableLabels — Task 12: one dispatch per tick', () => {
  it('dispatches exactly once when two failed eligible entries are present, defers the second with a logged reason, and does not bump its counter', async () => {
    const dispatchCalls: WatchEntry[] = [];
    const logs: string[] = [];
    const { gh } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []),
      [PR_URL_2]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []),
    });
    await enrollWatch(tmpDir, entry(PR_URL));
    await enrollWatch(tmpDir, entry(PR_URL_2));

    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      log: (msg) => logs.push(msg),
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (updated) => {
          dispatchCalls.push(updated);
        },
      },
    });

    // AC1: exactly one dispatch call
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].prUrl).toBe(PR_URL);

    // AC2: second entry gets a defer log line
    expect(logs.some((l) => l.includes(PR_URL_2) && l.includes('deferring'))).toBe(true);

    // AC3: second entry's counter is NOT bumped
    const result = await readWatch(tmpDir);
    const second = result.find((e) => e.prUrl === PR_URL_2);
    expect(second?.ciFixAttempts).toBe(0);
    expect(second?.lastCiFixAt).toBeUndefined();

    // First entry's counter IS bumped
    const first = result.find((e) => e.prUrl === PR_URL);
    expect(first?.ciFixAttempts).toBe(1);
  });
});

// ── Task 8: pending no-op + transition-only event emission ────────────────

describe('sweepMergeableLabels — Task 8: pending no-op and transition-only event emission', () => {
  it('pending entry produces zero label mutations and no events', async () => {
    const events: Array<{ type: string; phase?: string }> = [];
    const { gh, addLabelCalls, removeLabelCalls } = makeFakeGh({
      [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'RUNNING' }], []),
    });
    await enrollWatch(tmpDir, entry());
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      onEvent: (e) => events.push(e as any),
    });
    // No ci-failed label mutations for pending
    expect(addLabelCalls.filter((c) => c.label === 'ci-failed')).toHaveLength(0);
    expect(removeLabelCalls.filter((c) => c.label === 'ci-failed')).toHaveLength(0);
    // No ci_failed events emitted for pending
    expect(events.filter((e) => e.type === 'ci_failed')).toHaveLength(0);
  });

  it('ci_failed event emitted only on label-absent→present transition', async () => {
    const events: Array<{ type: string; phase?: string }> = [];
    const { gh } = makeFakeGh(
      { [PR_URL]: prViewJson('OPEN', 'MERGEABLE', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], []) },
      { trackLabelMutations: true },
    );
    await enrollWatch(tmpDir, entry());

    // First sweep: failed PR without ci-failed label → event emitted with phase='detected'
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      onEvent: (e) => events.push(e as any),
    });
    const ciFailedEvents = events.filter((e) => e.type === 'ci_failed');
    expect(ciFailedEvents).toHaveLength(1);
    expect((ciFailedEvents[0] as any).phase).toBe('detected');

    // Second sweep: same failed PR but ci-failed label now present → no new event
    const eventCountBeforeSecond = events.length;
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      onEvent: (e) => events.push(e as any),
    });
    const newCiFailedEvents = events.slice(eventCountBeforeSecond).filter((e) => e.type === 'ci_failed');
    expect(newCiFailedEvents).toHaveLength(0);
  });
});

// ── Task 21: exhaustion — escalation exactly once ──────────────────────────

describe('sweepMergeableLabels — Task 21: exhaustion escalation exactly once', () => {
  it('failed entry with ciFixAttempts:2 → ensures+adds needs-remediation, upserts escalation comment, emits ci_failed(exhausted); repeat sweep is a no-op', async () => {
    const events: Array<{ type: string; phase?: string; attempts?: number }> = [];
    const { gh, addLabelCalls, ensureLabelCalls, allArgs } = makeFakeGh(
      {
        [PR_URL]: prViewJson(
          'OPEN',
          'MERGEABLE',
          [{ status: 'COMPLETED', conclusion: 'FAILURE', name: 'build' } as any],
          [],
        ),
      },
      { trackLabelMutations: true },
    );
    await enrollWatch(tmpDir, { ...entry(), ciFixAttempts: 2 });

    // First sweep: attempts exhausted → escalate exactly once.
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      onEvent: (e) => events.push(e as any),
    });

    // AC1: needs-remediation label ensured + added.
    expect(ensureLabelCalls.some((c) => c.name === 'needs-remediation')).toBe(true);
    expect(
      addLabelCalls.some((c) => c.prUrl === PR_URL && c.label === 'needs-remediation'),
    ).toBe(true);

    // AC2: escalation comment upserted, content includes failing check name + attempt history.
    const commentCall = allArgs.find(
      (a) => a[0] === 'pr' && a[1] === 'comment' && a[2] === PR_URL,
    );
    expect(commentCall).toBeDefined();
    const commentBody = commentCall![4];
    expect(commentBody).toContain('build');
    expect(commentBody).toMatch(/2/);

    // AC3: ci_failed(exhausted) HALT-grade event emitted.
    const exhaustedEvents = events.filter(
      (e) => e.type === 'ci_failed' && e.phase === 'exhausted',
    );
    expect(exhaustedEvents).toHaveLength(1);

    // AC4: next sweep with the label present → zero new gh mutations or events (sticky suppression).
    const argsCountBefore = allArgs.length;
    const eventsCountBefore = events.length;
    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: gh,
      onEvent: (e) => events.push(e as any),
    });
    // The only permitted new gh calls are read-only (pr view); no new label/comment mutations.
    const newMutationArgs = allArgs.slice(argsCountBefore).filter(
      (a) =>
        (a[0] === 'api' && (a[2] === 'POST' || a[2] === 'PATCH' || a[2] === 'DELETE')) ||
        (a[0] === 'label' && a[1] === 'create') ||
        (a[0] === 'pr' && a[1] === 'comment'),
    );
    expect(newMutationArgs).toHaveLength(0);
    const newEvents = events.slice(eventsCountBefore);
    expect(newEvents.filter((e) => e.type === 'ci_failed' && e.phase === 'exhausted')).toHaveLength(0);
  });
});

// ── Task 22: exhaustion — failure and race negatives ───────────────────────

describe('sweepMergeableLabels — Task 22: exhaustion failure and race negatives', () => {
  it('escalation comment call throws → needs-remediation label is still applied, error logged, sweep does not throw', async () => {
    const logs: string[] = [];
    const { gh, addLabelCalls, ensureLabelCalls } = makeFakeGh(
      {
        [PR_URL]: prViewJson(
          'OPEN',
          'MERGEABLE',
          [{ status: 'COMPLETED', conclusion: 'FAILURE', name: 'build' } as any],
          [],
        ),
      },
      { trackLabelMutations: true },
    );
    // Wrap the fake runner so the escalation `pr comment` call always throws,
    // simulating a hard gh CLI failure that bypasses upsertComment's own
    // internal try/catch (e.g. an unexpected crash rather than a normal
    // gh-exit-code failure).
    const throwingGh: GhRunner = async (args, opts) => {
      if (args[0] === 'pr' && args[1] === 'comment') {
        throw new Error('gh: connection reset');
      }
      return gh(args, opts);
    };

    await enrollWatch(tmpDir, { ...entry(), ciFixAttempts: 2 });

    await expect(
      sweepMergeableLabels({
        projectRoot: tmpDir,
        runGh: throwingGh,
        log: (msg) => logs.push(msg),
      }),
    ).resolves.toBeUndefined();

    expect(ensureLabelCalls.some((c) => c.name === 'needs-remediation')).toBe(true);
    expect(
      addLabelCalls.some((c) => c.prUrl === PR_URL && c.label === 'needs-remediation'),
    ).toBe(true);
    expect(logs.some((l) => l.includes('gh: connection reset') || l.toLowerCase().includes('error'))).toBe(
      true,
    );
  });

  it('PR merged between detection and escalation → entry pruned, no escalation comment call made', async () => {
    let viewCount = 0;
    const commentCalls: string[][] = [];
    const raceGh: GhRunner = async (args, _opts) => {
      if (args[0] === 'pr' && args[1] === 'view' && args[3] === '--json') {
        viewCount += 1;
        // First read (detection, at top of sweep loop): still OPEN + failing.
        // Second read (escalation re-check, right before commenting): MERGED.
        if (viewCount === 1) {
          return prViewJson(
            'OPEN',
            'MERGEABLE',
            [{ status: 'COMPLETED', conclusion: 'FAILURE', name: 'build' } as any],
            [],
          );
        }
        return prViewJson('MERGED', 'UNKNOWN', [], []);
      }
      if (args[0] === 'pr' && args[1] === 'comment') {
        commentCalls.push([...args]);
      }
      return { stdout: '' };
    };

    await enrollWatch(tmpDir, { ...entry(), ciFixAttempts: 2 });

    await sweepMergeableLabels({
      projectRoot: tmpDir,
      runGh: raceGh,
    });

    expect(commentCalls).toHaveLength(0);
    const survivors = await readWatch(tmpDir);
    expect(survivors.some((e) => e.prUrl === PR_URL)).toBe(false);
  });
});
