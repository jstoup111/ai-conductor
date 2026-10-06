import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import { bumpKickbackGateInLedger } from '../../src/engine/kickback-ledger.js';
import { runTaskStart } from '../../src/engine/task-cli.js';
import { loadConfig } from '../../src/engine/config.js';

const execFile = promisify(execFileCb);

interface Cell {
  name: string;
  configYaml: string;
  planMd: string;
}

const CELLS: Cell[] = [
  {
    name: 'flag-off-unsliced',
    configYaml: 'stacked_prs:\n  enabled: false\n',
    planMd: `# Implementation Plan: n1-golden

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
`,
  },
  {
    name: 'flag-on-unsliced',
    configYaml: 'stacked_prs:\n  enabled: true\n',
    planMd: `# Implementation Plan: n1-golden

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
`,
  },
  {
    name: 'flag-off-sliced',
    configYaml: 'stacked_prs:\n  enabled: false\n',
    planMd: `# Implementation Plan: n1-golden

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
`,
  },
];

const BASE_SHA = '14a615c678ab0df4bb467fa0313bcb24434ef68f';
const RECORD = process.env.N1_GOLDEN_RECORD === '1';

async function expectGolden(fixtureName: string, actual: string): Promise<void> {
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

describe('N=1 golden state', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('self-tests expectGolden against a one-byte-altered fixture', async () => {
    if (RECORD) return;
    const fixtureName = 'flag-off-unsliced-current-task';
    const fixturePath = join(import.meta.dirname, '..', 'fixtures', 'n1-golden', `${fixtureName}.golden`);
    const goldenRaw = await readFile(fixturePath, 'utf8');
    const golden = goldenRaw.replace(/^<!-- Recorded from [a-f0-9]+ -->\n/, '');
    const altered = `${golden}X`;
    await expect(expectGolden(fixtureName, altered)).rejects.toThrow(`golden mismatch in ${fixtureName}: line`);
  });

  it.each(CELLS)('matches golden for $name', async (cell) => {
    const root = await mkdtemp(join(tmpdir(), `n1-golden-${cell.name}-`));
    roots.push(root);

    // Setup fixture root
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'), cell.configYaml);
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'n1-golden.md'), cell.planMd);

    // Git init with pinned identity and dates
    await execFile('git', ['init', '-b', 'main', '-q'], { cwd: root });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: root });
    await writeFile(join(root, 'README.md'), '# n1-golden\n');
    await writeFile(join(root, '.gitignore'), '.pipeline/\n');
    await execFile('git', ['add', 'README.md', '.gitignore', '.docs/plans/n1-golden.md', '.ai-conductor/config.yml'], { cwd: root });
    const env = {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      USER: 'test-user',
    };
    await execFile('git', ['commit', '-m', 'init'], { cwd: root, env });

    // Seed conduct-state: every step before acceptance_specs is done
    const pipeline = join(root, '.pipeline');
    await mkdir(pipeline, { recursive: true });
    const statePath = join(pipeline, 'conduct-state.json');
    const state = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      coherence_check: 'done',
      coverage_binding: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      prd: 'done',
      prd_audit: 'done',
      acceptance_specs: 'pending',
      build: 'pending',
      test_suite: 'pending',
      build_review: 'pending',
      manual_test: 'pending',
      architecture_review_as_built: 'pending',
      finish: 'pending',
      complexity_tier: 'S',
      track: 'technical',
      feature_desc: 'n1-golden',
    };
    await writeState(statePath, state as any);

    // Setup EventPersister with fixed clock
    const events = new ConductorEventEmitter();
    const ledgerPath = join(pipeline, 'events.jsonl');
    let now = 1_000;
    const persister = new EventPersister(ledgerPath, events, { nowMs: () => now });
    persister.start();

    // Track completed region steps for park boundary
    const completedSteps = new Set<string>();

    // Mocked step runner
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'acceptance_specs' || step === 'build' || step === 'test_suite' || step === 'build_review') {
          completedSteps.add(step);
          return { success: true };
        }
        throw new Error(`sentinel failure at ${step}`);
      },
    };

    const configResult = await loadConfig(root);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: root,
      fromStep: 'acceptance_specs',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      featureSlug: 'n1-golden',
      baseBranch: 'main',
      operatorParkBoundary: async () => completedSteps.has('build_review'),
      config: configResult.ok ? configResult.config : undefined,
    });

    try {
      await conductor.run();
    } catch {
      // expected sentinel failure
    }
    persister.stop();

    // Bump kickback ledger and start task 2
    await bumpKickbackGateInLedger(root, 'build_review', {
      treeHash: '0123456789abcdef0123456789abcdef01234567',
      resolvedCount: 1,
      reason: 'fixture bump',
    });
    await runTaskStart(root, '2');

    // Normalize and compare files
    function normalizeTimestamp(value: unknown): unknown {
      if (typeof value === 'string') {
        if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
          return '<TIMESTAMP>';
        }
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          return '<UUID>';
        }
        return value.replaceAll(root, '<ROOT>');
      }
      if (typeof value === 'number' && value > 946684800000) {
        return '<EPOCH>';
      }
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          return value.map(normalizeTimestamp);
        }
        const entries = Object.entries(value);
        if (entries.length === 0) return value;
        const result: Record<string, unknown> = {};
        for (const [k, v] of entries) {
          if (k === 'observedIntervals' || k === 'activeInterval') continue;
          if (['ts', 'at', 'checkedAt', 'run_started_at', 'session_started_at', 'startedAtMs', 'appliedAt', 'committedAt'].includes(k)) {
            result[k] = '<TIMESTAMP>';
          } else if (k === 'executionId') {
            result[k] = '<UUID>';
          } else {
            result[k] = normalizeTimestamp(v);
          }
        }
        return result;
      }
      return value;
    }

    async function readAndNormalize(path: string): Promise<string> {
      const content = await readFile(path, 'utf8');
      try {
        const parsed = JSON.parse(content);
        return JSON.stringify(normalizeTimestamp(parsed), null, 2);
      } catch {
        let lines = content.split('\n');
        // Normalize root path in text files
        lines = lines.map((l) => l.replaceAll(root, '<ROOT>'));
        // Try to parse JSON lines (events.jsonl)
        const jsonLines = lines.map((line) => {
          try {
            const parsed = JSON.parse(line);
            return JSON.stringify(normalizeTimestamp(parsed));
          } catch {
            return line;
          }
        });
        return jsonLines.join('\n');
      }
    }

    // Compare state files
    const stateContent = await readAndNormalize(statePath);
    await expectGolden(`${cell.name}-conduct-state`, stateContent);

    const taskStatusPath = join(pipeline, 'task-status.json');
    const taskStatusContent = await readAndNormalize(taskStatusPath);
    await expectGolden(`${cell.name}-task-status`, taskStatusContent);

    const currentTaskPath = join(pipeline, 'current-task');
    const currentTaskContent = await readFile(currentTaskPath, 'utf8');
    await expectGolden(`${cell.name}-current-task`, currentTaskContent);

    // Gate verdicts
    const gateDir = join(pipeline, 'gates');
    let gatePaths: string[] = [];
    try {
      const entries = await readdir(gateDir);
      gatePaths = entries.filter((e) => e.endsWith('.json')).sort();
    } catch {
      // no gates dir
    }
    const gateContents = await Promise.all(
      gatePaths.map(async (p) => {
        const content = await readAndNormalize(join(gateDir, p));
        return `--- ${p} ---\n${content}`;
      }),
    );
    await expectGolden(`${cell.name}-gate-paths`, gatePaths.join('\n'));
    for (let i = 0; i < gatePaths.length; i++) {
      await expectGolden(`${cell.name}-gate-${gatePaths[i].replace('.json', '')}`, gateContents[i]);
    }

    const eventsContent = await readAndNormalize(ledgerPath);
    await expectGolden(`${cell.name}-events`, eventsContent);

    const kickbackPath = join(pipeline, 'kickback-ledger.json');
    const kickbackContent = await readAndNormalize(kickbackPath);
    await expectGolden(`${cell.name}-kickback-ledger`, kickbackContent);

    // Assert no children directory and no "child" in events
    const pipelineEntries = await readdir(pipeline);
    if (pipelineEntries.includes('children')) {
      const childrenEntries = await readdir(join(pipeline, 'children')).catch(() => []);
      throw new Error(`.pipeline/children exists: ${childrenEntries.map((e) => `.pipeline/children/${e}`).join(', ')}`);
    }
    expect(eventsContent).not.toContain('"child"');
  });
});
