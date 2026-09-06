// Covers: task:1, task:2
import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
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

function runDocsGuardHook(opts: {
  markerContent?: string;
  payload?: unknown | ((dir: string) => unknown);
  setup?: (dir: string) => void;
  cleanup?: (dir: string) => void;
  env?: NodeJS.ProcessEnv;
}): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'docs-guard-hook-'));
  try {
    const scriptPath = join(dir, 'docs-guard.sh');
    writeFileSync(scriptPath, DOCS_GUARD_HOOK, 'utf-8');
    mkdirSync(join(dir, '.pipeline'), { recursive: true });
    if (opts.markerContent !== undefined) {
      writeFileSync(join(dir, '.pipeline', 'phase-active'), opts.markerContent, 'utf-8');
    }
    opts.setup?.(dir);
    const payload = typeof opts.payload === 'function' ? opts.payload(dir) : opts.payload;
    const input = payload === undefined
      ? undefined
      : typeof payload === 'string'
        ? payload
        : JSON.stringify(payload);
    try {
      const stdout = execFileSync('bash', [scriptPath], {
        cwd: dir,
        input,
        env: { ...process.env, ...opts.env },
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
    opts.cleanup?.(dir);
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

  it('blocks an absolute protected target through an alternate root alias that is neither PWD nor the physical root', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\n',
      setup: (dir) => {
        mkdirSync(join(dir, '.docs', 'plans'), { recursive: true });
        symlinkSync('.', join(dir, 'alternate-root'));
      },
      payload: (dir: string) => ({
        tool_name: 'Edit',
        tool_input: { file_path: join(dir, 'alternate-root', '.docs', 'plans', 'x.md') },
      }),
    });
    expect(result.status).toBe(2);
  });

  it.each(['BUILD', 'SHIP'])(
    'blocks physical, logical, alternate, traversal, and new-path spellings during %s',
    (phase) => {
      const result = runDocsGuardHook({
        markerContent: `step: build\nphase: ${phase}\n`,
        setup: (dir: string) => {
          mkdirSync(join(dir, '.docs', 'plans'), { recursive: true });
          symlinkSync('.', join(dir, 'alternate-root'));
        },
        payload: (dir: string) => ({
          tool_name: 'Write',
          tool_input: {
            file_path: join(
              dir,
              'alternate-root',
              '.docs',
              'plans',
              'missing-parent',
              '..',
              'new leaf.md',
            ),
          },
        }),
        env: { PWD: '/unrelated-logical-spelling' },
      });
      expect(result.status).toBe(2);
    },
  );

  it('keeps metacharacter path bytes literal while classifying a protected alias target', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\n',
      setup: (dir) => {
        mkdirSync(join(dir, '.docs', 'plans'), { recursive: true });
        symlinkSync('.', join(dir, 'alternate-root'));
      },
      payload: (dir: string) => ({
        tool_name: 'Write',
        tool_input: {
          file_path: join(dir, 'alternate-root', '.docs', 'plans', 'a $(not-run) ; & [x].md'),
        },
      }),
    });
    expect(result.status).toBe(2);
  });

  it('retains a protected suffix beneath an alternate root alias when an inner link resolves outside', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\n',
      setup: (dir: string) => {
        mkdirSync(join(dir, '.docs', 'plans'), { recursive: true });
        mkdirSync(join(dir, 'outside'));
        symlinkSync('.', join(dir, 'alternate-root'));
        symlinkSync(join(dir, 'outside'), join(dir, '.docs', 'plans', 'outward-link'));
      },
      payload: (dir: string) => ({
        tool_name: 'Write',
        tool_input: {
          file_path: join(dir, 'alternate-root', '.docs', 'plans', 'outward-link', 'x.md'),
        },
      }),
    });
    expect(result.status).toBe(2);
  });

  it('does not let an inner root-returning link erase a protected requested suffix', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\n',
      setup: (dir: string) => {
        mkdirSync(join(dir, '.docs', 'plans'), { recursive: true });
        symlinkSync(dir, join(dir, '.docs', 'plans', 'link-to-root'));
      },
      payload: (dir: string) => ({
        tool_name: 'Write',
        tool_input: { file_path: join(dir, '.docs', 'plans', 'link-to-root', 'README.md') },
      }),
    });
    expect(result.status).toBe(2);
  });

  it.each(['broken-link', 'link-cycle'])('fails closed for an unresolvable %s', (kind) => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\n',
      setup: (dir: string) => {
        if (kind === 'broken-link') symlinkSync('does-not-exist', join(dir, kind));
        else symlinkSync(kind, join(dir, kind));
      },
      payload: (dir: string) => ({
        tool_name: 'Write',
        tool_input: { file_path: join(dir, kind, 'x.md') },
      }),
    });
    expect(result.status).toBe(2);
  });

  it.skipIf(process.getuid?.() === 0)('fails closed for an unreadable path component', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\n',
      setup: (dir: string) => {
        const unreadable = join(dir, 'unreadable');
        mkdirSync(unreadable);
        chmodSync(unreadable, 0o000);
      },
      cleanup: (dir: string) => chmodSync(join(dir, 'unreadable'), 0o700),
      payload: (dir: string) => ({
        tool_name: 'Write',
        tool_input: { file_path: join(dir, 'unreadable', 'x.md') },
      }),
    });
    expect(result.status).toBe(2);
  });

  it('passes conclusive outside-project and .docs-like sibling targets', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\n',
      payload: { tool_name: 'Write', tool_input: { file_path: '.docs-archive/x.md' } },
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


  it('allows a write to the always-allowed release-waivers prefix during BUILD with no per-step allows', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\nallow: .docs/release-waivers/\n',
      payload: { tool_name: 'Write', tool_input: { file_path: '.docs/release-waivers/stem.md' } },
    });
    expect(result.status).toBe(0);
  });


  it('does not match a boundary-unsafe sibling directory (.docs/release-waivers-evil/) against the .docs/release-waivers/ allow prefix', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\nallow: .docs/release-waivers/\n',
      payload: { tool_name: 'Write', tool_input: { file_path: '.docs/release-waivers-evil/x.md' } },
    });
    expect(result.status).toBe(2);
  });

  it.each([
    ['an ordinary allowed target', (dir: string) => join(dir, '.docs', 'release-waivers', 'ordinary.md'), 0],
    ['an ordinary allowed target through an alternate root alias', (dir: string) => join(dir, 'alternate-root', '.docs', 'release-waivers', 'ordinary.md'), 0],
    ['an allowed requested path whose destination is protected', (dir: string) => join(dir, '.docs', 'release-waivers', 'to-plans', 'x.md'), 2],
    ['a protected requested path whose destination is outside', (dir: string) => join(dir, '.docs', 'plans', 'outward-link', 'x.md'), 2],
    ['a protected requested path whose destination is allowed', (dir: string) => join(dir, '.docs', 'plans', 'to-waivers', 'x.md'), 2],
    ['an unprotected requested path whose destination is protected', (dir: string) => join(dir, 'unprotected-to-plans', 'x.md'), 2],
  ] as const)(
    'requires both requested and resolved paths to permit %s',
    (_description, target, expectedStatus) => {
      const result = runDocsGuardHook({
        markerContent: 'step: build\nphase: BUILD\nallow: .docs/release-waivers/\n',
        setup: (dir: string) => {
          mkdirSync(join(dir, '.docs', 'plans'), { recursive: true });
          mkdirSync(join(dir, '.docs', 'release-waivers'));
          mkdirSync(join(dir, 'outside'));
          symlinkSync('.', join(dir, 'alternate-root'));
          symlinkSync(join(dir, '.docs', 'plans'), join(dir, '.docs', 'release-waivers', 'to-plans'));
          symlinkSync(join(dir, 'outside'), join(dir, '.docs', 'plans', 'outward-link'));
          symlinkSync(join(dir, '.docs', 'release-waivers'), join(dir, '.docs', 'plans', 'to-waivers'));
          symlinkSync(join(dir, '.docs', 'plans'), join(dir, 'unprotected-to-plans'));
        },
        payload: (dir: string) => ({ tool_name: 'Write', tool_input: { file_path: target(dir) } }),
      });
      expect(result.status).toBe(expectedStatus);
    },
  );

  it('blocks a protected outward link through an alternate root alias and preserves refusal context', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\nallow: .docs/release-waivers/\n',
      setup: (dir: string) => {
        mkdirSync(join(dir, '.docs', 'plans'), { recursive: true });
        mkdirSync(join(dir, 'outside'));
        symlinkSync('.', join(dir, 'alternate-root'));
        symlinkSync(join(dir, 'outside'), join(dir, '.docs', 'plans', 'outward-link'));
      },
      payload: (dir: string) => ({
        tool_name: 'Write',
        tool_input: { file_path: join(dir, 'alternate-root', '.docs', 'plans', 'outward-link', 'x.md') },
      }),
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/BUILD.*build/);
    expect(result.stderr).toMatch(/\.pipeline\/phase-active/);
    expect(result.stderr).toMatch(/rm \.pipeline\/phase-active/);
  });

  it.each([
    ['normalizes an allow-prefix traversal before matching', '.docs/release-waivers/../plans/x.md', 2],
    ['keeps a similarly named sibling outside the allow prefix', '.docs/release-waivers-sibling/x.md', 2],
  ] as const)('%s', (_description, filePath, expectedStatus) => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\nallow: .docs/release-waivers/\n',
      payload: { tool_name: 'Write', tool_input: { file_path: filePath } },
    });
    expect(result.status).toBe(expectedStatus);
  });

  it('uses filesystem semantics for a symlink followed by parent traversal', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\nallow: .docs/release-waivers/\n',
      setup: (dir: string) => {
        mkdirSync(join(dir, '.docs', 'plans'), { recursive: true });
        mkdirSync(join(dir, '.docs', 'release-waivers'));
        mkdirSync(join(dir, 'outside', 'nested'), { recursive: true });
        symlinkSync(join(dir, 'outside', 'nested'), join(dir, '.docs', 'release-waivers', 'link'));
        symlinkSync(join(dir, '.docs', 'plans'), join(dir, 'outside', 'plans'));
      },
      payload: { tool_name: 'Write', tool_input: { file_path: '.docs/release-waivers/link/../plans/x.md' } },
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
