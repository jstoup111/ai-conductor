// Covers: task:1
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Commit the golden fixtures were recorded from; every fixture header names it. */
export const BASE_SHA = '14a615c678ab0df4bb467fa0313bcb24434ef68f';

/** When '1', (re)write fixtures instead of comparing against them. */
export const RECORD = process.env.N1_GOLDEN_RECORD === '1';

export interface Cell {
  name: string;
  configYaml: string;
  planMd: string;
  coverageBinding?: 'done' | 'refused';
  complexityMd?: string;
  storiesFixture?: 'one' | 'two';
}

const UNSLICED_PLAN = `# Implementation Plan: n1-golden

### Task 1: Setup
**Story:** Story 1
**Dependencies:** none
**Done when:** Setup complete.

### Task 2: Implement
**Story:** Story 1
**Dependencies:** none
**Done when:** Implementation complete.

### Task 3: Verify
**Story:** Story 1
**Dependencies:** none
**Done when:** Verification complete.
`;

const SLICED_PLAN = `# Implementation Plan: n1-golden

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | First | 1 |
| 2 | Second | 2 |
| 3 | Third | 3 |

### Task 1: Setup
**Story:** Story 1
**Dependencies:** none
**Done when:** Setup complete.

### Task 2: Implement
**Story:** Story 1
**Dependencies:** Task 1
**Done when:** Implementation complete.

### Task 3: Verify
**Story:** Story 1
**Dependencies:** Task 2
**Done when:** Verification complete.
`;

const SINGLE_SLICE_PLAN = `# Implementation Plan: n1-golden

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Only | 1, 2, 3 |

### Task 1: Setup
**Story:** Story 1
**Dependencies:** none
**Done when:** Setup complete.

### Task 2: Implement
**Story:** Story 1
**Dependencies:** none
**Done when:** Implementation complete.

### Task 3: Verify
**Story:** Story 1
**Dependencies:** none
**Done when:** Verification complete.
`;

const INELIGIBLE_TWO_SLICE_PLAN = `# Implementation Plan: n1-golden

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | First | 1, 2 |
| 2 | Second | 3 |

### Task 1: Setup
**Story:** Story 1
**Dependencies:** none
**Done when:** Setup complete.

### Task 2: Implement
**Story:** Story 1
**Dependencies:** none
**Done when:** Implementation complete.

### Task 3: Verify
**Story:** Story 2
**Dependencies:** none
**Done when:** Verification complete.
`;

export const CELLS: Cell[] = [
  { name: 'flag-off-unsliced', configYaml: 'stacked_prs:\n  enabled: false\n', planMd: UNSLICED_PLAN },
  { name: 'flag-on-unsliced', configYaml: 'stacked_prs:\n  enabled: true\n', planMd: UNSLICED_PLAN },
  { name: 'flag-off-sliced', configYaml: 'stacked_prs:\n  enabled: false\n', planMd: SLICED_PLAN },
  {
    name: 'flag-on-single-slice',
    configYaml: 'stacked_prs:\n  enabled: true\n  max_slices: 2\n',
    planMd: SINGLE_SLICE_PLAN,
    coverageBinding: 'done',
    complexityMd: 'Tier: M\nStacked-Delivery: approved\n',
    storiesFixture: 'one',
  },
  {
    name: 'flag-on-ineligible',
    configYaml: 'stacked_prs:\n  enabled: true\n  max_slices: 2\n',
    planMd: INELIGIBLE_TWO_SLICE_PLAN,
    coverageBinding: 'refused',
    complexityMd: 'Tier: M\n',
    storiesFixture: 'two',
  },
];

/**
 * GB (golden byte-identity) comparison: write the fixture in RECORD mode,
 * otherwise assert the normalized `actual` matches the committed fixture byte
 * for byte, failing with the fixture name and the first differing line.
 */
export async function expectGolden(fixtureName: string, actual: string): Promise<void> {
  const fixturePath = join(import.meta.dirname, '..', 'fixtures', 'n1-golden', `${fixtureName}.golden`);
  if (RECORD) {
    await mkdir(join(import.meta.dirname, '..', 'fixtures', 'n1-golden'), { recursive: true });
    await writeFile(fixturePath, `<!-- Recorded from ${BASE_SHA} -->\n${actual}`);
    return;
  }
  const goldenRaw = await readFile(fixturePath, 'utf8');
  const golden = goldenRaw.replace(/^<!-- Recorded from [a-f0-9]+ -->\n/, '');
  const actualLines = actual.split('\n');
  const goldenLines = golden.split('\n');
  for (let i = 0; i < Math.max(actualLines.length, goldenLines.length); i++) {
    if (actualLines[i] !== goldenLines[i]) {
      throw new Error(`golden mismatch in ${fixtureName}: line ${i + 1}\n  expected: ${JSON.stringify(goldenLines[i])}\n  actual:   ${JSON.stringify(actualLines[i])}`);
    }
  }
}

const EPOCH_MS_KEYS = [
  'ts',
  'at',
  'checkedAt',
  'run_started_at',
  'session_started_at',
  'startedAtMs',
  'appliedAt',
  'committedAt',
] as const;

/**
 * Normalize ONLY: ISO-8601 timestamp strings, the epoch-ms keys above, and the
 * fixture root path (→ `<ROOT>`). Drop ONLY `observedIntervals`/`activeInterval`.
 * Never sort keys. (Execution ids are deterministic because the run's
 * `node:crypto.randomUUID` is mocked at the test boundary, not normalized here.)
 */
export function normalizeTimestamp(value: unknown, root: string): unknown {
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return '<TIMESTAMP>';
    }
    return value.replaceAll(root, '<ROOT>');
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeTimestamp(item, root));
    }
    const entries = Object.entries(value);
    if (entries.length === 0) return value;
    const result: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      if (k === 'observedIntervals' || k === 'activeInterval') continue;
      if ((EPOCH_MS_KEYS as readonly string[]).includes(k)) {
        result[k] = '<TIMESTAMP>';
      } else {
        result[k] = normalizeTimestamp(v, root);
      }
    }
    return result;
  }
  return value;
}

/** Read a state pipeline file and normalize it (single JSON doc or one JSON per line). */
export async function readAndNormalize(path: string, root: string): Promise<string> {
  const content = await readFile(path, 'utf8');
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(normalizeTimestamp(parsed, root), null, 2);
  } catch {
    const lines = content.split('\n').map((line) => line.replaceAll(root, '<ROOT>'));
    const jsonLines = lines.map((line) => {
      try {
        return JSON.stringify(normalizeTimestamp(JSON.parse(line), root));
      } catch {
        return line;
      }
    });
    return jsonLines.join('\n');
  }
}

/** Rendering-output normalization (rewind/stdout/dashboard/shipped-record texts). */
export function normalizeGolden(text: string, root: string): string {
  // Normalize ISO timestamps
  text = text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<TIMESTAMP>');
  // Normalize operator in rewind events
  text = text.replace(/"operator":"[^"]+"/g, '"operator":"<OPERATOR>"');
  // Normalize root path
  text = text.replaceAll(root, '<ROOT>');
  return text;
}
