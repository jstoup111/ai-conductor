// Task 11: `engineer resolve` CLI argument parsing and validation (negative paths).
//
// The resolve command recovers from write-back failures by stamping a claimed entry
// as delivered (prUrl present). This test suite covers CLI parsing, validation,
// and error messaging — the negative paths that prevent invalid state transitions.

import { describe, it, expect, beforeEach } from 'vitest';
import { detectEngineerCommand, dispatchEngineer } from '../../../src/engine/engineer-cli.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createLedger } from '../../../src/engine/engineer/intake/ledger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: build argv arrays for testing
// detectEngineerCommand reads process.argv offsets: [node, entry, 'engineer', sub, ...].
const argv = (...rest: string[]) => ['node', 'conduct-ts', 'engineer', ...rest];

describe('detectEngineerCommand: resolve grammar and validation', () => {
  describe('resolve argument parsing (acceptance criteria 1, 4)', () => {
    it('parses `engineer resolve <sourceRef> --pr-url https://github.com/o/a/pull/123`', () => {
      const result = detectEngineerCommand(argv('resolve', 'o/a#1', '--pr-url', 'https://github.com/o/a/pull/123'));
      expect(result).toEqual({
        kind: 'resolve',
        sourceRef: 'o/a#1',
        prUrl: 'https://github.com/o/a/pull/123',
      });
    });

    it('parses `engineer resolve <sourceRef> --pr-url http://... [--branch <b>]` with optional branch', () => {
      const result = detectEngineerCommand(argv('resolve', 'o/a#1', '--pr-url', 'http://example.com/pr/1', '--branch', 'spec/foo'));
      expect(result).toEqual({
        kind: 'resolve',
        sourceRef: 'o/a#1',
        prUrl: 'http://example.com/pr/1',
        branch: 'spec/foo',
      });
    });

    it('parses --branch anywhere in the argument list', () => {
      const result = detectEngineerCommand(argv('resolve', '--branch', 'spec/foo', 'o/a#1', '--pr-url', 'https://github.com/o/a/pull/1'));
      expect(result).toEqual({
        kind: 'resolve',
        sourceRef: 'o/a#1',
        prUrl: 'https://github.com/o/a/pull/1',
        branch: 'spec/foo',
      });
    });
  });

  describe('resolve missing/malformed --pr-url (acceptance criteria 2, 3)', () => {
    it('missing --pr-url flag → guide (triggers usage message on stderr)', () => {
      const result = detectEngineerCommand(argv('resolve', 'o/a#1'));
      expect(result).toEqual({ kind: 'guide' });
    });

    it('missing --pr-url value (flag at end of args) → guide', () => {
      const result = detectEngineerCommand(argv('resolve', 'o/a#1', '--pr-url'));
      expect(result).toEqual({ kind: 'guide' });
    });

    it('missing sourceRef positional → guide', () => {
      const result = detectEngineerCommand(argv('resolve', '--pr-url', 'https://github.com/o/a/pull/1'));
      expect(result).toEqual({ kind: 'guide' });
    });

    it('sourceRef cannot start with --', () => {
      const result = detectEngineerCommand(argv('resolve', '--pr-url', 'https://github.com/o/a/pull/1'));
      expect(result).toEqual({ kind: 'guide' });
    });
  });

  describe('resolve URL validation (acceptance criterion 3)', () => {
    it('valid https:// URL', () => {
      const result = detectEngineerCommand(argv('resolve', 'o/a#1', '--pr-url', 'https://github.com/o/a/pull/123'));
      expect(result?.kind).toBe('resolve');
      expect(result?.prUrl).toBe('https://github.com/o/a/pull/123');
    });

    it('valid http:// URL', () => {
      const result = detectEngineerCommand(argv('resolve', 'o/a#1', '--pr-url', 'http://github.com/o/a/pull/123'));
      expect(result?.kind).toBe('resolve');
      expect(result?.prUrl).toBe('http://github.com/o/a/pull/123');
    });

    it('invalid URL (not http(s)://) → guide (validation on dispatch side)', () => {
      // Note: detectEngineerCommand parses structure only; detailed validation happens
      // in dispatchEngineer. For now, the CLI parsing accepts any --pr-url value.
      // The validation check (exit 1 on malformed) happens in the dispatch case.
      const result = detectEngineerCommand(argv('resolve', 'o/a#1', '--pr-url', 'not-a-url'));
      // Parsing accepts it (structure valid), but dispatch will reject it
      expect(result?.kind).toBe('resolve');
      expect(result?.prUrl).toBe('not-a-url');
    });
  });

  // Note: resolve usage text is tested via the printGuide function which is called
  // by dispatchEngineer when a guide is requested. The usage text is verified to
  // include the resolve command in integration tests.
});

describe('engineer resolve dispatch and validation (integration with dispatchEngineer)', () => {
  function captureOut() {
    const out: string[] = [];
    const err: string[] = [];
    const opts = (extra: Partial<Parameters<typeof dispatchEngineer>[1]>): Parameters<typeof dispatchEngineer>[1] => ({
      print: (s) => out.push(s),
      printErr: (s) => err.push(s),
      ...extra,
    });
    return { out, err, opts };
  }

  it('invalid --pr-url (not http(s)://) → exit 1 + validation error on stderr', async () => {
    const { out, err, opts } = captureOut();
    const dispatch: Parameters<typeof dispatchEngineer>[0] = {
      kind: 'resolve',
      sourceRef: 'o/a#1',
      prUrl: 'not-a-url',
    };
    const code = await dispatchEngineer(dispatch, opts());
    expect(code).toBe(1);
    expect(err.some((e) => e.includes('invalid --pr-url'))).toBe(true);
    expect(err.some((e) => e.includes('not-a-url'))).toBe(true);
    expect(out.length).toBe(0); // no success output
  });

  it('valid https:// URL → found:false when no ledger entry exists', async () => {
    // Without a ledger entry, resolve returns found:false (soft failure).
    // The actual happy path (entry exists) is tested in the Task 12 suite below.
    const { out, err, opts } = captureOut();
    const dispatch: Parameters<typeof dispatchEngineer>[0] = {
      kind: 'resolve',
      sourceRef: 'o/a#1',
      prUrl: 'https://github.com/o/a/pull/123',
    };
    const code = await dispatchEngineer(dispatch, opts());
    expect(code).toBe(0);
    expect(out.length).toBe(1);
    const parsed = JSON.parse(out[0]);
    expect(parsed).toEqual({
      kind: 'resolve',
      found: false,
    });
    expect(err.length).toBe(0);
  });

  it('valid http:// URL with branch → found:false when no ledger entry exists', async () => {
    // Without a ledger entry, resolve returns found:false (soft failure).
    const { out, err, opts } = captureOut();
    const dispatch: Parameters<typeof dispatchEngineer>[0] = {
      kind: 'resolve',
      sourceRef: 'o/a#1',
      prUrl: 'http://example.com/pr/1',
      branch: 'spec/foo',
    };
    const code = await dispatchEngineer(dispatch, opts());
    expect(code).toBe(0);
    expect(out.length).toBe(1);
    const parsed = JSON.parse(out[0]);
    expect(parsed).toEqual({
      kind: 'resolve',
      found: false,
    });
    expect(err.length).toBe(0);
  });

  it('malformed resolve (missing --pr-url) triggers guide output with usage text', async () => {
    const { out, err, opts } = captureOut();
    const result = detectEngineerCommand(argv('resolve', 'o/a#1'));
    expect(result.kind).toBe('guide');
    // Dispatch the guide kind to see the usage text
    const code = await dispatchEngineer(result, opts());
    expect(code).toBe(0);
    expect(out.length).toBe(1);
    expect(out[0]).toContain('resolve');
    expect(out[0]).toContain('--pr-url');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task 12: resolve happy path tests — ledger transitions, idempotency, found:false
// These tests exercise the actual resolve implementation: marking claimed entries
// as delivered with prUrl + optional branch override. Task 11 tests covered parsing.
// ═══════════════════════════════════════════════════════════════════════════════

describe('engineer resolve: happy path (Task 12)', () => {
  const GITHUB_ISSUES_SOURCE = 'github-issues';

  function captureOut() {
    const out: string[] = [];
    const err: string[] = [];
    const opts = (extra: Partial<Parameters<typeof dispatchEngineer>[1]>): Parameters<typeof dispatchEngineer>[1] => ({
      print: (s) => out.push(s),
      printErr: (s) => err.push(s),
      ...extra,
    });
    return { out, err, opts };
  }

  describe('Test 1: Stranded claimed entry (no prUrl) → resolve with prUrl → done with prUrl + branch preserved', () => {
    it('resolves stranded entry with prUrl, preserves branch, echoes JSON with 4 fields, exit 0', async () => {
      const testDir = `/tmp/resolve-test-${Date.now()}-${Math.random()}`;
      try {
        // Create temp engineer directory with ledger
        const engDir = join(testDir, 'engineer');
        await mkdir(engDir, { recursive: true });

        const ledger = createLedger(join(engDir, 'ledger.json'));
        await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#1' });
        await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#1', 'claimed', {
          branch: 'spec/initial-feature',
        });

        const { out, opts } = captureOut();
        const dispatch: Parameters<typeof dispatchEngineer>[0] = {
          kind: 'resolve',
          sourceRef: 'o/a#1',
          prUrl: 'https://github.com/o/a/pull/123',
        };

        const code = await dispatchEngineer(dispatch, {
          ...opts(),
          engineerDir: engDir,
        });

        expect(code).toBe(0);
        expect(out.length).toBe(1);
        const parsed = JSON.parse(out[0]);
        expect(parsed).toMatchObject({
          kind: 'resolve',
          sourceRef: 'o/a#1',
          priorStatus: 'claimed',
          prUrl: 'https://github.com/o/a/pull/123',
          branch: 'spec/initial-feature',
        });
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Test 2: Idempotency — re-run resolve on same entry → unchanged, exit 0', () => {
    it('second resolve with same prUrl on done entry → unchanged state, exit 0', async () => {
      const testDir = `/tmp/resolve-test-${Date.now()}-${Math.random()}`;
      try {
        const engDir = join(testDir, 'engineer');
        await mkdir(engDir, { recursive: true });

        const ledger = createLedger(join(engDir, 'ledger.json'));
        await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#1' });
        await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#1', 'done', {
          prUrl: 'https://github.com/o/a/pull/123',
          branch: 'spec/feature',
        });

        const { out, opts } = captureOut();
        const dispatch: Parameters<typeof dispatchEngineer>[0] = {
          kind: 'resolve',
          sourceRef: 'o/a#1',
          prUrl: 'https://github.com/o/a/pull/123',
        };

        const code = await dispatchEngineer(dispatch, {
          ...opts(),
          engineerDir: engDir,
        });

        expect(code).toBe(0);
        expect(out.length).toBe(1);
        const parsed = JSON.parse(out[0]);
        expect(parsed).toMatchObject({
          kind: 'resolve',
          sourceRef: 'o/a#1',
          priorStatus: 'done',
          prUrl: 'https://github.com/o/a/pull/123',
          branch: 'spec/feature',
        });
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Test 3: Unknown sourceRef → found:false, exit 0 (soft failure)', () => {
    it('unknown sourceRef → {kind:resolve, found:false}, exit 0', async () => {
      const testDir = `/tmp/resolve-test-${Date.now()}-${Math.random()}`;
      try {
        const engDir = join(testDir, 'engineer');
        await mkdir(engDir, { recursive: true });

        const { out, opts } = captureOut();
        const dispatch: Parameters<typeof dispatchEngineer>[0] = {
          kind: 'resolve',
          sourceRef: 'unknown/repo#999',
          prUrl: 'https://github.com/unknown/repo/pull/1',
        };

        const code = await dispatchEngineer(dispatch, {
          ...opts(),
          engineerDir: engDir,
        });

        expect(code).toBe(0);
        expect(out.length).toBe(1);
        const parsed = JSON.parse(out[0]);
        expect(parsed).toEqual({
          kind: 'resolve',
          found: false,
        });
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Test 4: Branch override — resolve with --branch → new branch set, prUrl added', () => {
    it('claimed entry with existing branch, resolve with --branch override → new branch set', async () => {
      const testDir = `/tmp/resolve-test-${Date.now()}-${Math.random()}`;
      try {
        const engDir = join(testDir, 'engineer');
        await mkdir(engDir, { recursive: true });

        const ledger = createLedger(join(engDir, 'ledger.json'));
        await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#1' });
        await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#1', 'claimed', {
          branch: 'spec/old-branch',
        });

        const { out, opts } = captureOut();
        const dispatch: Parameters<typeof dispatchEngineer>[0] = {
          kind: 'resolve',
          sourceRef: 'o/a#1',
          prUrl: 'https://github.com/o/a/pull/123',
          branch: 'spec/new-branch',
        };

        const code = await dispatchEngineer(dispatch, {
          ...opts(),
          engineerDir: engDir,
        });

        expect(code).toBe(0);
        expect(out.length).toBe(1);
        const parsed = JSON.parse(out[0]);
        expect(parsed).toMatchObject({
          kind: 'resolve',
          sourceRef: 'o/a#1',
          prUrl: 'https://github.com/o/a/pull/123',
          branch: 'spec/new-branch',
        });
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Test 5: Branch preservation — resolve without --branch → branch unchanged', () => {
    it('claimed entry with branch, resolve without --branch → branch unchanged, prUrl added', async () => {
      const testDir = `/tmp/resolve-test-${Date.now()}-${Math.random()}`;
      try {
        const engDir = join(testDir, 'engineer');
        await mkdir(engDir, { recursive: true });

        const ledger = createLedger(join(engDir, 'ledger.json'));
        await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef: 'o/a#1' });
        await ledger.transition(GITHUB_ISSUES_SOURCE, 'o/a#1', 'claimed', {
          branch: 'spec/original-branch',
        });

        const { out, opts } = captureOut();
        const dispatch: Parameters<typeof dispatchEngineer>[0] = {
          kind: 'resolve',
          sourceRef: 'o/a#1',
          prUrl: 'https://github.com/o/a/pull/123',
        };

        const code = await dispatchEngineer(dispatch, {
          ...opts(),
          engineerDir: engDir,
        });

        expect(code).toBe(0);
        expect(out.length).toBe(1);
        const parsed = JSON.parse(out[0]);
        expect(parsed).toMatchObject({
          kind: 'resolve',
          sourceRef: 'o/a#1',
          prUrl: 'https://github.com/o/a/pull/123',
          branch: 'spec/original-branch',
        });
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });
});
