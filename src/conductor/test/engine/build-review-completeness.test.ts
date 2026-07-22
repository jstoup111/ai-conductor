// Regression tests: build_review's existing fail-closed predicate (checkGateCompletion
// -> checkStepCompletion's build_review branch in src/engine/artifacts.ts) correctly
// covers the completeness rubric dimension added alongside tautology/scope/rootCause.
// No new production behavior is expected here — this locks in that the pre-existing
// missing/stale/malformed/FAIL handling also applies when completeness is the sole
// FAIL-triggering rubric item.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';

describe('engine/artifacts — build_review predicate (completeness-driven, fail-closed)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-completeness-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function verdict(obj: unknown) {
    const full = join(dir, '.pipeline/build-review.json');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(obj));
    return full;
  }

  it('fails when no verdict artifact is present at all', async () => {
    const r = await checkGateCompletion(dir, 'build_review');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no build-review verdict/i);
    expect(r.routeClass).toBe('absent');
  });

  it('fails when the verdict artifact predates the current session (stale)', async () => {
    const full = await verdict({
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
    });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(full, old, old);
    const sessionStartedAt = Date.now();
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no fresh verdict/i);
    expect(r.routeClass).toBe('absent');
  });

  it('fails on malformed JSON without crashing', async () => {
    const full = join(dir, '.pipeline/build-review.json');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, '{ not valid json');
    const sessionStartedAt = Date.now() - 1000;
    await expect(checkGateCompletion(dir, 'build_review', { sessionStartedAt })).resolves.toMatchObject({
      done: false,
      routeClass: 'absent',
    });
  });

  it('fails validateBuildReviewVerdict (e.g. missing rubric) without crashing', async () => {
    await verdict({ verdict: 'PASS' });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.routeClass).toBe('absent');
  });

  it('fails and arms kickback when only rubric.completeness is FAIL (all other rubric items PASS)', async () => {
    await verdict({
      verdict: 'FAIL',
      reasons: ['implementation addresses only part of the declared scope — missing negative-path handling'],
      rubric: { tautology: false, scope: false, rootCause: false, completeness: true },
    });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/implementation addresses only part of the declared scope/);
    expect(r.routeClass).toBe('named-route');
  });

  it('passes on a fresh valid PASS verdict that includes completeness: false', async () => {
    await verdict({
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
    });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(true);
    expect(r.routeClass).toBeUndefined();
  });
});
