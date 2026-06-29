/**
 * Tests for mergeable-sweep.ts (Tasks 12–14: watch registry + sweep decision tree).
 *
 * All gh interactions use fake runners; no real `gh` binary required.
 * Temp directories are created per-suite and cleaned up in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
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
 * Label mutations (`--add-label`, `--remove-label`) are recorded and optionally
 * update `currentLabels` (per-URL) when `trackLabelMutations` is true.
 */
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

    // gh pr edit <url> --add-label <name>
    if (args[0] === 'pr' && args[1] === 'edit' && args[3] === '--add-label') {
      const prUrl = args[2];
      const label = args[4];
      addLabelCalls.push({ prUrl, label });
      if (opts.trackLabelMutations) {
        if (!labelState[prUrl]) labelState[prUrl] = [];
        if (!labelState[prUrl].includes(label)) labelState[prUrl].push(label);
      }
      return { stdout: '' };
    }

    // gh pr edit <url> --remove-label <name>
    if (args[0] === 'pr' && args[1] === 'edit' && args[3] === '--remove-label') {
      const prUrl = args[2];
      const label = args[4];
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
  return { prUrl, slug: 'test-feature', repoCwd: '/fake/repo' };
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
