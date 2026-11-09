// Covers: task:2
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BOUNDARY_REGISTRY } from './boundary-registry.js';
import { checkBoundaryRatchet, formatBoundaryViolations } from './boundary-ratchet.js';
import { readAllowlistEntries, readSourceTree } from './layer-ratchet.js';

const structuralDirectory = dirname(fileURLToPath(import.meta.url));
const boundaryAllowlistFile = join(structuralDirectory, 'boundary-allowlist.txt');

describe('structural: external boundary ratchet', () => {
  it('reports an unlisted node fs promises import with its file, line, and boundary', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', "import { readFile } from 'node:fs/promises';"]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result).toEqual({
      touches: [{ file: 'engine/a.ts', line: 1, boundary: 'filesystem', kind: 'specifier-import' }],
      violations: [{ kind: 'unlisted-touch', file: 'engine/a.ts', line: 1, boundary: 'filesystem' }],
    });
  });

  it.each([
    ['a bare fs import', "import fs from 'fs';", 'filesystem'],
    ['a dynamic child process import', "await import('node:child_process');", 'process'],
    ['an fs export-from', "export { readFile } from 'fs';", 'filesystem'],
    ['an OpenTelemetry import', "import { trace } from '@opentelemetry/api';", 'otel'],
  ])('reports %s as an unlisted %s boundary touch', (_description, source, boundary) => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', source]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.touches).toEqual([{ file: 'engine/a.ts', line: 1, boundary, kind: 'specifier-import' }]);
    expect(result.violations).toEqual([{ kind: 'unlisted-touch', file: 'engine/a.ts', line: 1, boundary }]);
  });

  it('does not classify type-only boundary imports as touches', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', [
        "import type { Stats } from 'node:fs';",
        "import { type Stats } from 'fs';",
      ].join('\n')]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result).toEqual({ touches: [], violations: [] });
  });

  it('allows a registered adapter to import its own boundary specifier', () => {
    const registry = {
      ...BOUNDARY_REGISTRY,
      filesystem: { ...BOUNDARY_REGISTRY.filesystem, adapterModules: ['execution/fs-adapter.ts'] },
    };
    const result = checkBoundaryRatchet({
      files: new Map([['execution/fs-adapter.ts', "import { readFile } from 'node:fs';"]]),
      allowlist: [],
      registry,
    });

    expect(result).toEqual({
      touches: [{ file: 'execution/fs-adapter.ts', line: 1, boundary: 'filesystem', kind: 'specifier-import' }],
      violations: [],
    });
  });

  it('allows a listed filesystem touch', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', "import { readFile } from 'fs/promises';"]]),
      allowlist: ['engine/a.ts -> filesystem'],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.violations).toEqual([]);
  });

  it('formats pending issues and ported adapter paths', () => {
    const filesystemViolation = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', "import { readFile } from 'fs';"]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    }).violations;
    const registryWithLlmSpecifier = {
      ...BOUNDARY_REGISTRY,
      llm: { ...BOUNDARY_REGISTRY.llm, specifiers: ['provider-sdk'] },
    };
    const llmViolation = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', "import { provider } from 'provider-sdk';"]]),
      allowlist: [],
      registry: registryWithLlmSpecifier,
    }).violations;

    expect(formatBoundaryViolations(filesystemViolation, BOUNDARY_REGISTRY)).toContain('pending #3636');
    const formattedLlm = formatBoundaryViolations(llmViolation, registryWithLlmSpecifier);
    expect(formattedLlm).toContain('execution/claude-provider.ts');
    expect(formattedLlm).toContain('execution/codex-provider.ts');
    expect(formattedLlm).toContain('execution/pi-provider.ts');
  });

  // Covers: task:3
  it('reports unlisted clock reads at their expression lines', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', [
        'Date.now();',
        'new Date();',
        'new Date;',
        'performance.now();',
      ].join('\n')]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result).toEqual({
      touches: [
        { file: 'engine/a.ts', line: 1, boundary: 'clock', kind: 'clock-read' },
        { file: 'engine/a.ts', line: 2, boundary: 'clock', kind: 'clock-read' },
        { file: 'engine/a.ts', line: 3, boundary: 'clock', kind: 'clock-read' },
        { file: 'engine/a.ts', line: 4, boundary: 'clock', kind: 'clock-read' },
      ],
      violations: [
        { kind: 'unlisted-touch', file: 'engine/a.ts', line: 1, boundary: 'clock' },
        { kind: 'unlisted-touch', file: 'engine/a.ts', line: 2, boundary: 'clock' },
        { kind: 'unlisted-touch', file: 'engine/a.ts', line: 3, boundary: 'clock' },
        { kind: 'unlisted-touch', file: 'engine/a.ts', line: 4, boundary: 'clock' },
      ],
    });
  });

  // Covers: task:3
  it('does not classify dated constructors as clock reads', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', [
        'new Date(timestamp);',
        "new Date('2026-01-01');",
      ].join('\n')]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.touches.filter((touch) => touch.boundary === 'clock')).toEqual([]);
  });

  // Covers: task:4
  it('attributes an execa git spawn to git and process', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', [
        "import { execa } from 'execa';",
        "execa('git', ['status']);",
      ].join('\n')]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.touches).toEqual([
      { file: 'engine/a.ts', line: 1, boundary: 'process', kind: 'specifier-import' },
      { file: 'engine/a.ts', line: 2, boundary: 'git', kind: 'command-literal' },
    ]);
    expect(result.violations).toEqual([
      { kind: 'unlisted-touch', file: 'engine/a.ts', line: 1, boundary: 'process' },
      { kind: 'unlisted-touch', file: 'engine/a.ts', line: 2, boundary: 'git' },
    ]);
  });

  // Covers: task:4
  it('attributes a child process namespace gh spawn to gh and process', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', [
        "import * as cp from 'node:child_process';",
        "cp.execFile('gh', []);",
      ].join('\n')]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.touches.map((touch) => [touch.line, touch.boundary, touch.kind])).toEqual([
      [1, 'process', 'specifier-import'],
      [2, 'gh', 'command-literal'],
    ]);
    expect(result.violations.map((violation) => [violation.line, violation.boundary])).toEqual([
      [1, 'process'],
      [2, 'gh'],
    ]);
  });

  // Covers: task:4
  it('attributes a named child process tmux spawn to tmux and process', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', [
        "import { spawnSync } from 'child_process';",
        "spawnSync('tmux', []);",
      ].join('\n')]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.touches.map((touch) => [touch.line, touch.boundary, touch.kind])).toEqual([
      [1, 'process', 'specifier-import'],
      [2, 'tmux', 'command-literal'],
    ]);
    expect(result.violations.map((violation) => [violation.line, violation.boundary])).toEqual([
      [1, 'process'],
      [2, 'tmux'],
    ]);
  });

  // Covers: task:4
  it('does not attribute a local execa function to git', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', "function execa(command: string) {}\nexeca('git');"]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.touches).toEqual([]);
  });

  // Covers: task:4
  it('reports only the process import for a nonliteral command', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', "import { execa } from 'execa';\nexeca(command);"]]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.touches).toEqual([
      { file: 'engine/a.ts', line: 1, boundary: 'process', kind: 'specifier-import' },
    ]);
  });

  // Covers: task:4, task:5
  it('attributes a top-level process adapter call to git', () => {
    const registry = {
      ...BOUNDARY_REGISTRY,
      process: { ...BOUNDARY_REGISTRY.process, adapterModules: ['execution/proc.ts'] },
    };
    const result = checkBoundaryRatchet({
      files: new Map([
        ['cli.ts', "import { run } from './execution/proc.js';\nrun('git', []);"],
        ['execution/proc.ts', 'export const run = undefined;'],
      ]),
      allowlist: [],
      registry,
    });

    expect(result.touches).toEqual([
      { file: 'cli.ts', line: 1, boundary: 'process', kind: 'adapter-import' },
      { file: 'cli.ts', line: 2, boundary: 'git', kind: 'command-literal' },
    ]);
    expect(result.violations).toEqual([
      { kind: 'unlisted-touch', file: 'cli.ts', line: 2, boundary: 'git' },
    ]);
  });

  // Covers: task:5
  it('allows a top-level entry root to value-import an llm adapter', () => {
    const registry = {
      ...BOUNDARY_REGISTRY,
      llm: { ...BOUNDARY_REGISTRY.llm, adapterModules: ['execution/claude-provider.ts'] },
    };
    const result = checkBoundaryRatchet({
      files: new Map([
        ['cli.ts', "import { ClaudeProvider } from './execution/claude-provider.js';"],
        ['execution/claude-provider.ts', 'export class ClaudeProvider {}'],
      ]),
      allowlist: [],
      registry,
    });

    expect(result).toEqual({
      touches: [{ file: 'cli.ts', line: 1, boundary: 'llm', kind: 'adapter-import' }],
      violations: [],
    });
  });

  // Covers: task:5
  it('rejects an unlisted engine value-import of an llm adapter with the composition-root rule', () => {
    const registry = {
      ...BOUNDARY_REGISTRY,
      llm: { ...BOUNDARY_REGISTRY.llm, adapterModules: ['execution/claude-provider.ts'] },
    };
    const result = checkBoundaryRatchet({
      files: new Map([
        ['engine/a.ts', "import { ClaudeProvider } from '../execution/claude-provider.js';"],
        ['execution/claude-provider.ts', 'export class ClaudeProvider {}'],
      ]),
      allowlist: [],
      registry,
    });

    expect(result).toEqual({
      touches: [{ file: 'engine/a.ts', line: 1, boundary: 'llm', kind: 'adapter-import' }],
      violations: [{ kind: 'unlisted-touch', file: 'engine/a.ts', line: 1, boundary: 'llm', touchKind: 'adapter-import' }],
    });
    expect(formatBoundaryViolations(result.violations, registry)).toContain('only composition roots import adapters');
  });

  // Covers: task:5
  it('does not classify a type-only engine import of an llm adapter', () => {
    const registry = {
      ...BOUNDARY_REGISTRY,
      llm: { ...BOUNDARY_REGISTRY.llm, adapterModules: ['execution/claude-provider.ts'] },
    };
    const result = checkBoundaryRatchet({
      files: new Map([
        ['engine/a.ts', "import type { ClaudeProvider } from '../execution/claude-provider.js';"],
        ['execution/claude-provider.ts', 'export class ClaudeProvider {}'],
      ]),
      allowlist: [],
      registry,
    });

    expect(result).toEqual({ touches: [], violations: [] });
  });

  // Covers: task:5
  it('rejects a nested entry-looking llm adapter importer', () => {
    const registry = {
      ...BOUNDARY_REGISTRY,
      llm: { ...BOUNDARY_REGISTRY.llm, adapterModules: ['execution/claude-provider.ts'] },
    };
    const result = checkBoundaryRatchet({
      files: new Map([
        ['engine/cli-entry.ts', "import { ClaudeProvider } from '../execution/claude-provider.js';"],
        ['execution/claude-provider.ts', 'export class ClaudeProvider {}'],
      ]),
      allowlist: [],
      registry,
    });

    expect(result.violations).toEqual([
      { kind: 'unlisted-touch', file: 'engine/cli-entry.ts', line: 1, boundary: 'llm', touchKind: 'adapter-import' },
    ]);
  });

  // Covers: task:5
  it('allows an allowlisted non-root llm adapter importer', () => {
    const registry = {
      ...BOUNDARY_REGISTRY,
      llm: { ...BOUNDARY_REGISTRY.llm, adapterModules: ['execution/claude-provider.ts'] },
    };
    const result = checkBoundaryRatchet({
      files: new Map([
        ['execution/provider-catalog.ts', "import { ClaudeProvider } from './claude-provider.js';"],
        ['execution/claude-provider.ts', 'export class ClaudeProvider {}'],
      ]),
      allowlist: ['execution/provider-catalog.ts -> llm'],
      registry,
    });

    expect(result.violations).toEqual([]);
  });

  // Covers: task:6
  it('reports a stale filesystem allowlist entry with no matching touch', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', 'export {};']]),
      allowlist: ['engine/a.ts -> filesystem'],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.violations).toEqual([{ kind: 'stale-entry', entry: 'engine/a.ts -> filesystem' }]);
    expect(formatBoundaryViolations(result.violations, BOUNDARY_REGISTRY)).toContain('stale-entry engine/a.ts -> filesystem');
  });

  // Covers: task:6
  it('reports an allowlist entry as stale when its file is the registered adapter', () => {
    const registry = {
      ...BOUNDARY_REGISTRY,
      filesystem: { ...BOUNDARY_REGISTRY.filesystem, adapterModules: ['execution/fs-adapter.ts'] },
    };
    const result = checkBoundaryRatchet({
      files: new Map([['execution/fs-adapter.ts', "import { readFile } from 'node:fs';"]]),
      allowlist: ['execution/fs-adapter.ts -> filesystem'],
      registry,
    });

    expect(result.touches).toEqual([
      { file: 'execution/fs-adapter.ts', line: 1, boundary: 'filesystem', kind: 'specifier-import' },
    ]);
    expect(result.violations).toEqual([{ kind: 'stale-entry', entry: 'execution/fs-adapter.ts -> filesystem' }]);
  });

  // Covers: task:6
  it.each([
    ['an unsorted entry', ['engine/b.ts -> clock', 'engine/a.ts -> clock'], 'engine/a.ts -> clock'],
    ['a duplicate entry', ['engine/a.ts -> clock', 'engine/a.ts -> clock'], 'engine/a.ts -> clock'],
    ['a missing separator', ['engine/a.ts filesystem'], 'engine/a.ts filesystem'],
    ['an empty file side', [' -> clock'], ' -> clock'],
    ['an empty boundary side', ['engine/a.ts -> '], 'engine/a.ts -> '],
  ])('reports %s as a malformed allowlist entry', (_description, allowlist, entry) => {
    const result = checkBoundaryRatchet({
      files: new Map(),
      allowlist,
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.violations).toContainEqual({ kind: 'malformed-entry', entry });
    expect(formatBoundaryViolations(result.violations, BOUNDARY_REGISTRY)).toContain(`malformed-entry ${entry}`);
  });

  // Covers: task:6
  it('reports an allowlist entry for an unregistered boundary', () => {
    const result = checkBoundaryRatchet({
      files: new Map(),
      allowlist: ['src/x.ts -> network'],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result.violations).toEqual([{ kind: 'unknown-boundary', entry: 'src/x.ts -> network' }]);
    expect(formatBoundaryViolations(result.violations, BOUNDARY_REGISTRY)).toContain('unknown-boundary src/x.ts -> network');
  });

  // Covers: task:6
  it('has no violations after a filesystem touch and its allowlist line are both removed', () => {
    const result = checkBoundaryRatchet({
      files: new Map([['engine/a.ts', 'export {};']]),
      allowlist: [],
      registry: BOUNDARY_REGISTRY,
    });

    expect(result).toEqual({ touches: [], violations: [] });
  });

  // Covers: task:7
  it('ratchets the real source tree against the committed boundary allowlist', async () => {
    const files = await readSourceTree();
    const entries = readAllowlistEntries(await readFile(boundaryAllowlistFile, 'utf8'));
    const result = checkBoundaryRatchet({ files, allowlist: entries, registry: BOUNDARY_REGISTRY });

    expect(files.size).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toEqual([...entries].sort());
    expect(new Set(entries).size).toBe(entries.length);
    expect(entries.every((entry) => {
      const parts = entry.split(' -> ');
      return parts.length === 2 && parts[0] !== '' && parts[1] !== '' && parts[1] in BOUNDARY_REGISTRY;
    })).toBe(true);
    expect(entries).toContain('execution/provider-catalog.ts -> llm');
    expect(result.violations.filter((violation) => violation.kind === 'stale-entry')).toEqual([]);
    expect(result.violations, formatBoundaryViolations(result.violations, BOUNDARY_REGISTRY)).toEqual([]);
  });
});
