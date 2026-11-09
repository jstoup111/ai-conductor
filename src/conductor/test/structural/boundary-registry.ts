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

export interface BoundaryContractEntry {
  readonly module: string;
  readonly legs: readonly {
    readonly adapter: string;
    readonly fake: string;
    readonly fakeLeg: string;
    readonly realLeg: string;
  }[];
}

export interface BoundaryEntry {
  readonly name: BoundaryName;
  readonly port: string | null;
  readonly adapterModules: readonly string[];
  readonly specifiers: readonly string[];
  readonly clockCalls: readonly string[];
  readonly commandLiterals: readonly string[];
  readonly contract: BoundaryContractEntry | null;
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
    contract: {
      module: 'test/contracts/llm.contract.ts',
      legs: [
        {
          adapter: 'execution/claude-provider.ts',
          fake: 'test/fixtures/claude-provider-fake.ts',
          fakeLeg: 'test/contracts/llm.contract.test.ts',
          realLeg: 'test/contracts/llm-claude.contract.smoke.test.ts',
        },
        {
          adapter: 'execution/codex-provider.ts',
          fake: 'test/fixtures/codex-provider-fake.ts',
          fakeLeg: 'test/contracts/llm.contract.test.ts',
          realLeg: 'test/contracts/llm-codex.contract.smoke.test.ts',
        },
        {
          adapter: 'execution/pi-provider.ts',
          fake: 'test/fixtures/pi-provider-fake.ts',
          fakeLeg: 'test/contracts/llm.contract.test.ts',
          realLeg: 'test/contracts/llm-pi.contract.smoke.test.ts',
        },
      ],
    },
    status: { kind: 'ported' },
  },
  git: {
    name: 'git',
    port: null,
    adapterModules: [],
    specifiers: [],
    clockCalls: [],
    commandLiterals: ['git'],
    contract: null,
    status: { kind: 'pending', issue: 3043 },
  },
  gh: {
    name: 'gh',
    port: null,
    adapterModules: [],
    specifiers: [],
    clockCalls: [],
    commandLiterals: ['gh'],
    contract: null,
    status: { kind: 'pending', issue: 3637 },
  },
  tmux: {
    name: 'tmux',
    port: null,
    adapterModules: [],
    specifiers: [],
    clockCalls: [],
    commandLiterals: ['tmux'],
    contract: null,
    status: { kind: 'pending', issue: 3639 },
  },
  process: {
    name: 'process',
    port: null,
    adapterModules: [],
    specifiers: ['child_process', 'execa'],
    clockCalls: [],
    commandLiterals: [],
    contract: null,
    status: { kind: 'pending', issue: 3634 },
  },
  clock: {
    name: 'clock',
    port: null,
    adapterModules: [],
    specifiers: [],
    clockCalls: ['Date.now', 'new Date', 'performance.now'],
    commandLiterals: [],
    contract: null,
    status: { kind: 'pending', issue: 3638 },
  },
  otel: {
    name: 'otel',
    port: null,
    adapterModules: [],
    specifiers: ['@opentelemetry/'],
    clockCalls: [],
    commandLiterals: [],
    contract: null,
    status: { kind: 'pending', issue: 3635 },
  },
  filesystem: {
    name: 'filesystem',
    port: null,
    adapterModules: [],
    specifiers: ['fs', 'fs/promises', 'chokidar'],
    clockCalls: [],
    commandLiterals: [],
    contract: null,
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
