// Covers: task:2
import { describe, expect, it } from 'vitest';

import { BOUNDARY_REGISTRY } from './boundary-registry.js';
import { checkBoundaryRatchet, formatBoundaryViolations } from './boundary-ratchet.js';

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
});
