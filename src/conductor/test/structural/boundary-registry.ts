export type BoundaryName =
  | 'llm'
  | 'git'
  | 'gh'
  | 'tmux'
  | 'process'
  | 'clock'
  | 'otel'
  | 'filesystem';

export type BoundaryStatus =
  | { readonly kind: 'ported' }
  | { readonly kind: 'pending'; readonly issue: number };

export interface BoundaryEntry {
  readonly name: BoundaryName;
  readonly port: string | null;
  readonly adapterModules: readonly string[];
  readonly specifiers: readonly string[];
  readonly clockCalls: readonly string[];
  readonly commandLiterals: readonly string[];
  readonly status: BoundaryStatus;
}

export interface BoundaryNameDifferences {
  readonly missing: readonly BoundaryName[];
  readonly extra: readonly string[];
}

export interface MissingAdapterPath {
  readonly boundary: string;
  readonly path: string;
}

const BOUNDARY_NAMES: readonly BoundaryName[] = [
  'llm',
  'git',
  'gh',
  'tmux',
  'process',
  'clock',
  'otel',
  'filesystem',
];
const BOUNDARY_NAME_SET = new Set<string>(BOUNDARY_NAMES);

export const BOUNDARY_REGISTRY: Readonly<Record<BoundaryName, BoundaryEntry>> = {
  llm: {
    name: 'llm',
    port: 'LLMProvider',
    adapterModules: [
      'execution/claude-provider.ts',
      'execution/codex-provider.ts',
      'execution/pi-provider.ts',
    ],
    specifiers: [],
    clockCalls: [],
    commandLiterals: [],
    status: { kind: 'ported' },
  },
  git: {
    name: 'git',
    port: null,
    adapterModules: [],
    specifiers: [],
    clockCalls: [],
    commandLiterals: ['git'],
    status: { kind: 'pending', issue: 3043 },
  },
  gh: {
    name: 'gh',
    port: null,
    adapterModules: [],
    specifiers: [],
    clockCalls: [],
    commandLiterals: ['gh'],
    status: { kind: 'pending', issue: 3637 },
  },
  tmux: {
    name: 'tmux',
    port: null,
    adapterModules: [],
    specifiers: [],
    clockCalls: [],
    commandLiterals: ['tmux'],
    status: { kind: 'pending', issue: 3639 },
  },
  process: {
    name: 'process',
    port: null,
    adapterModules: [],
    specifiers: ['child_process', 'execa'],
    clockCalls: [],
    commandLiterals: [],
    status: { kind: 'pending', issue: 3634 },
  },
  clock: {
    name: 'clock',
    port: null,
    adapterModules: [],
    specifiers: [],
    clockCalls: ['Date.now', 'new Date', 'performance.now'],
    commandLiterals: [],
    status: { kind: 'pending', issue: 3638 },
  },
  otel: {
    name: 'otel',
    port: null,
    adapterModules: [],
    specifiers: ['@opentelemetry/'],
    clockCalls: [],
    commandLiterals: [],
    status: { kind: 'pending', issue: 3635 },
  },
  filesystem: {
    name: 'filesystem',
    port: null,
    adapterModules: [],
    specifiers: ['fs', 'fs/promises', 'chokidar'],
    clockCalls: [],
    commandLiterals: [],
    status: { kind: 'pending', issue: 3636 },
  },
};

export function expectedBoundaryNames(
  registry: Readonly<Record<string, BoundaryEntry>>,
): BoundaryNameDifferences {
  const names = new Set(Object.keys(registry));
  return {
    missing: BOUNDARY_NAMES.filter((name) => !names.has(name)),
    extra: [...names].filter((name) => !BOUNDARY_NAME_SET.has(name)),
  };
}

export function missingAdapterPaths(
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
  files: ReadonlyMap<string, unknown>,
): MissingAdapterPath[] {
  const missing: MissingAdapterPath[] = [];
  for (const boundary of BOUNDARY_NAMES) {
    const entry = registry[boundary];
    for (const path of entry.adapterModules) {
      if (!files.has(path)) missing.push({ boundary, path });
    }
  }
  return missing;
}
