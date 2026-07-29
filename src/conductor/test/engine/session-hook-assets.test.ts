import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PRE_DISPATCH_HOOK,
  DOCS_GUARD_HOOK,
} from '../../src/engine/session-hook-assets.js';

function assertValidBash(name: string, script: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'session-hook-assets-'));
  try {
    const file = join(dir, name);
    writeFileSync(file, script, 'utf-8');
    // Throws if bash -n reports a syntax error.
    execFileSync('bash', ['-n', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type RunResult = { status: number; stderr: string; stdout: string };

function runDocsGuardHook(opts: { markerContent?: string; payload?: unknown }): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'docs-guard-hook-'));
  try {
    const scriptPath = join(dir, 'docs-guard.sh');
    writeFileSync(scriptPath, DOCS_GUARD_HOOK, 'utf-8');
    mkdirSync(join(dir, '.pipeline'), { recursive: true });
    if (opts.markerContent !== undefined) {
      writeFileSync(join(dir, '.pipeline', 'phase-active'), opts.markerContent, 'utf-8');
    }
    const input = opts.payload === undefined
      ? undefined
      : typeof opts.payload === 'string'
        ? opts.payload
        : JSON.stringify(opts.payload);
    try {
      const stdout = execFileSync('bash', [scriptPath], {
        cwd: dir,
        input,
        timeout: 5000,
        stdio: 'pipe',
      });
      return { status: 0, stderr: '', stdout: stdout.toString('utf-8') };
    } catch (err) {
      const result = err as { status?: number; stderr?: Buffer; stdout?: Buffer };
      return {
        status: result.status ?? -1,
        stderr: (result.stderr ?? Buffer.from('')).toString('utf-8'),
        stdout: (result.stdout ?? Buffer.from('')).toString('utf-8'),
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('session-hook-assets', () => {
  const hooks: Array<[string, string]> = [
    ['PRE_DISPATCH_HOOK', PRE_DISPATCH_HOOK],
    ['DOCS_GUARD_HOOK', DOCS_GUARD_HOOK],
  ];

  it.each(hooks)('%s is a non-empty string', (_name, script) => {
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it.each(hooks)('%s starts with a bash shebang', (_name, script) => {
    expect(script.startsWith('#!/bin/bash')).toBe(true);
  });

  it.each(hooks)('%s passes bash -n syntax check', (name, script) => {
    expect(() => assertValidBash(name, script)).not.toThrow();
  });

  const staleEngineReferencePatterns = [/dist\//, /conduct-ts/, /require\(['"]\.\//];

  it.each(hooks)(
    '%s contains no stale dynamic-module references (dist/, conduct-ts, require(\'./)',
    (_name, script) => {
      for (const pattern of staleEngineReferencePatterns) {
        expect(script).not.toMatch(pattern);
      }
    },
  );
});

describe('DOCS_GUARD_HOOK', () => {
  it('exits 0 with no stdin read when the phase-active marker is absent', () => {
    // No `input` provided at all — if the script attempted to read stdin
    // before checking the marker, execFileSync would block until the
    // 5s timeout and this test would fail/hang rather than return quickly.
    const result = runDocsGuardHook({});
    expect(result.status).toBe(0);
  });

  it('passes through a non-.docs Edit target when the marker is present', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\nallow: .docs/plans/foo.md\n',
      payload: { tool_name: 'Edit', tool_input: { file_path: 'src/foo.ts' } },
    });
    expect(result.status).toBe(0);
  });

  it.each([
    '.docs/plans/x.md',
    '.docs/stories/x.md',
    '.docs/specs/x.md',
    '.docs/decisions/adr-x.md',
    '.docs/future-artifact-type/x.md',
  ])(
    'blocks a write to %s during BUILD with no allowlist (default-deny)',
    (target) => {
      const result = runDocsGuardHook({
        markerContent: 'step: build\nphase: BUILD\n',
        payload: { tool_name: 'Edit', tool_input: { file_path: target } },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/BUILD/);
      expect(result.stderr).toMatch(/build/);
      expect(result.stderr).toMatch(/\.pipeline\/phase-active/);
      expect(result.stderr).toMatch(/rm \.pipeline\/phase-active/);
    }
  );

  it('allows a write to an allowlisted retro prefix', () => {
    const result = runDocsGuardHook({
      markerContent:
        'step: retro\nphase: SHIP\nallow: .docs/retros/\nallow: .docs/stories/\nallow: .docs/release-waivers/\n',
      payload: { tool_name: 'Write', tool_input: { file_path: '.docs/retros/x.md' } },
    });
    expect(result.status).toBe(0);
  });

  it('allows a write to an allowlisted stories prefix', () => {
    const result = runDocsGuardHook({
      markerContent:
        'step: retro\nphase: SHIP\nallow: .docs/retros/\nallow: .docs/stories/\nallow: .docs/release-waivers/\n',
      payload: { tool_name: 'Write', tool_input: { file_path: '.docs/stories/y.md' } },
    });
    expect(result.status).toBe(0);
  });

  it('blocks an Edit to a non-allowlisted plan path even with other allow prefixes present', () => {
    const result = runDocsGuardHook({
      markerContent:
        'step: retro\nphase: SHIP\nallow: .docs/retros/\nallow: .docs/stories/\nallow: .docs/release-waivers/\n',
      payload: { tool_name: 'Edit', tool_input: { file_path: '.docs/plans/z.md' } },
    });
    expect(result.status).toBe(2);
  });

  it('allows a write to the always-allowed release-waivers prefix during BUILD with no per-step allows', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\nallow: .docs/release-waivers/\n',
      payload: { tool_name: 'Write', tool_input: { file_path: '.docs/release-waivers/stem.md' } },
    });
    expect(result.status).toBe(0);
  });

  it('does not match a boundary-unsafe sibling directory (.docs/retros-evil/) against the .docs/retros/ allow prefix', () => {
    const result = runDocsGuardHook({
      markerContent:
        'step: retro\nphase: SHIP\nallow: .docs/retros/\nallow: .docs/stories/\nallow: .docs/release-waivers/\n',
      payload: { tool_name: 'Write', tool_input: { file_path: '.docs/retros-evil/x.md' } },
    });
    expect(result.status).toBe(2);
  });

  it('does not match a boundary-unsafe sibling directory (.docs/release-waivers-evil/) against the .docs/release-waivers/ allow prefix', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\nallow: .docs/release-waivers/\n',
      payload: { tool_name: 'Write', tool_input: { file_path: '.docs/release-waivers-evil/x.md' } },
    });
    expect(result.status).toBe(2);
  });

  it('blocks a .docs write with a generic reason when the marker is malformed/empty (no step/phase lines)', () => {
    const result = runDocsGuardHook({
      markerContent: 'garbage not a marker\n',
      payload: { tool_name: 'Edit', tool_input: { file_path: '.docs/plans/x.md' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/unknown/);
    expect(result.stderr).not.toMatch(/phase:\s*$/m);
  });

  it('blocks a .docs write with a generic reason when the marker file is empty', () => {
    const result = runDocsGuardHook({
      markerContent: '',
      payload: { tool_name: 'Edit', tool_input: { file_path: '.docs/plans/x.md' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/unknown/);
  });

  it('fails closed (exit 2) when the marker is active but the payload is unparseable JSON', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\n',
      payload: '{ this is not valid json',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/could not be determined/);
  });

  it('fails closed (exit 2) when the marker is active but the payload carries no path', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\n',
      payload: { tool_name: 'Edit', tool_input: {} },
    });
    expect(result.status).toBe(2);
  });

  it('blocks a NotebookEdit targeting a .docs notebook via notebook_path with no matching allow', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\n',
      payload: {
        tool_name: 'NotebookEdit',
        tool_input: { notebook_path: '.docs/plans/x.ipynb' },
      },
    });
    expect(result.status).toBe(2);
  });
});
