import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  spliceGeneratedRegion,
  assertNoDuplicateRowNames,
  renderModelTable,
  buildEngineRows,
  buildExtraRows,
  stepDisplayName,
  runGenerateModelTable,
  runGenerateModelTableCli,
  unifiedDiff,
  parseCliArgs,
  buildPinsJson,
  MarkerError,
  BEGIN_MARKER,
  END_MARKER,
  EXIT_OK,
  EXIT_DRIFT,
  EXIT_ERROR,
  REMEDIATION_COMMAND,
  type CliIO,
} from '../src/tools/generate-model-table.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from '../src/engine/provider-model-policy.js';
import { DEFAULT_STEP_MODELS } from '../src/engine/resolved-config.js';
import { SKILL_STEP_MAP, PIN_EXEMPT_SKILLS } from '../src/engine/model-table-metadata.js';
import { STEP_RATIONALE } from '../src/engine/model-table-metadata.js';
import type { ComplexityTier, StepName } from '../src/types/steps.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED/GREEN specs for the pure marker-region splicer (.docs/stories/
// generated-model-table.md, TS-2 happy path 1; Task 6 of the implementation
// plan). spliceGeneratedRegion must be a pure function: no I/O, deterministic,
// replacing only the BEGIN/END marker region and leaving every other byte
// (prose, markers, interim-fallback blockquote) identical.
// ─────────────────────────────────────────────────────────────────────────────

const PROSE_BEFORE = '# Harness Behavioral Rules\n\nSome hand-authored prose above the table.\n\n';
const PROSE_AFTER =
  '\n\n> Interim fallback note (#186): survives byte-identical outside the region.\n' +
  '\nTwo enforcement paths: engine defaults and SKILL.md pins.\n';
const harnessRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const STALE_TABLE = '| Skill/Agent | Model | Effort | Why |\n|---|---|---|---|\n| stale | stale | stale | stale row from a previous run |';

const NEW_TABLE = '| Skill/Agent | Model | Effort | Why |\n|---|---|---|---|\n| plan | sonnet (S/M), fable (L) | medium (S) | because |';

function fixture(table: string): string {
  return (
    PROSE_BEFORE +
    BEGIN_MARKER +
    '\n' +
    table +
    '\n' +
    END_MARKER +
    PROSE_AFTER
  );
}

describe('spliceGeneratedRegion (TS-2 happy path 1)', () => {
  it('replaces only the region between the BEGIN/END markers', () => {
    const doc = fixture(STALE_TABLE);
    const result = spliceGeneratedRegion(doc, NEW_TABLE);

    expect(result).toBe(fixture(NEW_TABLE));
    expect(result).toContain(NEW_TABLE);
    expect(result).not.toContain('stale row from a previous run');
  });

  it('preserves every byte outside the region — prose, markers, blockquote', () => {
    const doc = fixture(STALE_TABLE);
    const result = spliceGeneratedRegion(doc, NEW_TABLE);

    expect(result.startsWith(PROSE_BEFORE + BEGIN_MARKER + '\n')).toBe(true);
    expect(result.endsWith(END_MARKER + PROSE_AFTER)).toBe(true);
  });

  it('is pure: calling it twice with the same inputs yields identical output and does not mutate inputs', () => {
    const doc = fixture(STALE_TABLE);
    const docCopy = doc.slice();

    const first = spliceGeneratedRegion(doc, NEW_TABLE);
    const second = spliceGeneratedRegion(doc, NEW_TABLE);

    expect(first).toBe(second);
    expect(doc).toBe(docCopy);
  });

  it('is idempotent: splicing the already-regenerated doc with the same table is a no-op', () => {
    const once = spliceGeneratedRegion(fixture(STALE_TABLE), NEW_TABLE);
    const twice = spliceGeneratedRegion(once, NEW_TABLE);
    expect(twice).toBe(once);
  });

  describe('marker validation (edge cases)', () => {
    it('throws MarkerError when the BEGIN marker is missing', () => {
      const doc = PROSE_BEFORE + 'no begin marker here\n' + END_MARKER + PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('throws MarkerError when the END marker is missing', () => {
      const doc = PROSE_BEFORE + BEGIN_MARKER + '\n' + STALE_TABLE + '\nno end marker here' + PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('throws MarkerError when END appears before BEGIN', () => {
      const doc = PROSE_BEFORE + END_MARKER + '\n' + STALE_TABLE + '\n' + BEGIN_MARKER + PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('throws MarkerError on a duplicate BEGIN marker', () => {
      const doc =
        PROSE_BEFORE +
        BEGIN_MARKER +
        '\n' +
        STALE_TABLE +
        '\n' +
        BEGIN_MARKER +
        '\n' +
        END_MARKER +
        PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('throws MarkerError on a duplicate END marker', () => {
      const doc =
        PROSE_BEFORE +
        BEGIN_MARKER +
        '\n' +
        STALE_TABLE +
        '\n' +
        END_MARKER +
        '\n' +
        END_MARKER +
        PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('requires the BEGIN marker to be on its own line', () => {
      const doc = PROSE_BEFORE + 'prefix text ' + BEGIN_MARKER + '\n' + STALE_TABLE + '\n' + END_MARKER + PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('requires the END marker to be on its own line', () => {
      const doc = PROSE_BEFORE + BEGIN_MARKER + '\n' + STALE_TABLE + '\n' + END_MARKER + ' trailing text' + PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RED/GREEN specs for assertNoDuplicateRowNames (.docs/stories/
// generated-model-table.md, TS-1 negative path 3; Task 3 of the
// implementation plan).
// ─────────────────────────────────────────────────────────────────────────────

describe('assertNoDuplicateRowNames (TS-1 negative path 3)', () => {
  it('does not throw when all engine and extra row names are unique', () => {
    const engineRows = [{ name: 'plan' }, { name: 'stories' }];
    const extraRows = [{ name: 'pr' }, { name: 'conduct' }];
    expect(() => assertNoDuplicateRowNames(engineRows, extraRows)).not.toThrow();
  });

  it('throws when an extra row is named "plan", colliding with the engine row of the same name', () => {
    const engineRows = [{ name: 'plan' }, { name: 'stories' }];
    const extraRows = [{ name: 'plan' }, { name: 'conduct' }];
    expect(() => assertNoDuplicateRowNames(engineRows, extraRows)).toThrow(/plan/);
  });

  it('throws when two extra rows share the same name', () => {
    const engineRows = [{ name: 'plan' }];
    const extraRows = [{ name: 'pr' }, { name: 'pr' }];
    expect(() => assertNoDuplicateRowNames(engineRows, extraRows)).toThrow(/pr/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RED/GREEN specs for the pure renderer, renderModelTable() (.docs/stories/
// generated-model-table.md, TS-2 happy path 2; Task 5 of the implementation
// plan).
// ─────────────────────────────────────────────────────────────────────────────

describe('renderModelTable (TS-2 happy path 2)', () => {
  it('outputs the exact provider-labelled seven-column header', () => {
    const table = renderModelTable();
    expect(table.split('\n').slice(0, 2)).toEqual([
      '| Skill/Agent | Execution path | Claude model | Claude effort | Codex model | Codex effort | Why |',
      '|---|---|---|---|---|---|---|',
    ]);
  });

  it('renders all 24 autonomous engine rows from both provider policies, including every S/M/L variation', () => {
    const tiers: readonly ComplexityTier[] = ['S', 'M', 'L'];
    const renderPolicyField = (
      policy: ProviderModelPolicy,
      step: StepName,
      field: 'model' | 'effort',
    ): string => {
      const groups: Array<{ value: string; tiers: ComplexityTier[] }> = [];
      for (const tier of tiers) {
        const override = policy.stepTierOverrides[step]?.[tier]?.[field];
        const value =
          override ?? (field === 'model' ? policy.stepModels[step] : policy.stepEfforts[step]);
        const group = groups.find((candidate) => candidate.value === value);
        if (group) group.tiers.push(tier);
        else groups.push({ value, tiers: [tier] });
      }
      return groups.length === 1
        ? groups[0]!.value
        : groups.map((group) => `${group.value} (${group.tiers.join('/')})`).join(', ');
    };

    const expected = (Object.keys(STEP_RATIONALE) as StepName[]).map((step) => ({
      name: stepDisplayName(step),
      executionPath: 'autonomous engine',
      claudeModel: renderPolicyField(CLAUDE_MODEL_POLICY, step, 'model'),
      claudeEffort: renderPolicyField(CLAUDE_MODEL_POLICY, step, 'effort'),
      codexModel: renderPolicyField(CODEX_MODEL_POLICY, step, 'model'),
      codexEffort: renderPolicyField(CODEX_MODEL_POLICY, step, 'effort'),
      why: STEP_RATIONALE[step],
    }));

    expect(buildEngineRows()).toEqual(expected);
  });

  it('fails closed and identifies the provider, field, and step for every missing policy value', () => {
    const buildRowsWithPolicies = buildEngineRows as unknown as (
      claudePolicy: ProviderModelPolicy,
      codexPolicy: ProviderModelPolicy,
    ) => ReturnType<typeof buildEngineRows>;

    const withoutStepValue = (
      policy: ProviderModelPolicy,
      field: 'stepModels' | 'stepEfforts',
      step: StepName,
    ): ProviderModelPolicy => {
      const values = { ...policy[field] } as Record<string, unknown>;
      delete values[step];
      return { ...policy, [field]: values } as unknown as ProviderModelPolicy;
    };
    const cases = [
      {
        provider: 'Claude',
        field: 'model',
        claude: withoutStepValue(CLAUDE_MODEL_POLICY, 'stepModels', 'bootstrap'),
        codex: CODEX_MODEL_POLICY,
      },
      {
        provider: 'Claude',
        field: 'effort',
        claude: withoutStepValue(CLAUDE_MODEL_POLICY, 'stepEfforts', 'bootstrap'),
        codex: CODEX_MODEL_POLICY,
      },
      {
        provider: 'Codex',
        field: 'model',
        claude: CLAUDE_MODEL_POLICY,
        codex: withoutStepValue(CODEX_MODEL_POLICY, 'stepModels', 'bootstrap'),
      },
      {
        provider: 'Codex',
        field: 'effort',
        claude: CLAUDE_MODEL_POLICY,
        codex: withoutStepValue(CODEX_MODEL_POLICY, 'stepEfforts', 'bootstrap'),
      },
    ] as const;

    const messages = cases.map(({ claude, codex }) => {
      try {
        buildRowsWithPolicies(claude, codex);
        return '<no error>';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });

    expect(messages).toEqual(
      cases.map(({ provider, field }) =>
        expect.stringMatching(new RegExp(`missing.*${provider}.*${field}.*bootstrap`, 'i')),
      ),
    );
  });

  it('renders extra rows after all engine rows', () => {
    const table = renderModelTable();
    const lines = table.split('\n').slice(2); // skip header + separator
    const engineNames = buildEngineRows().map((r) => r.name);
    const extraNames = new Set(buildExtraRows().map((r) => r.name));

    const firstExtraIndex = lines.findIndex((line) =>
      [...extraNames].some((name) => line.startsWith(`| ${name} |`)),
    );
    expect(firstExtraIndex).toBeGreaterThan(-1);

    // Every line before the first extra row must be an engine row.
    for (let i = 0; i < firstExtraIndex; i++) {
      const matchesEngineRow = engineNames.some((name) => lines[i]!.startsWith(`| ${name} |`));
      expect(matchesEngineRow).toBe(true);
    }
  });

  it('labels every non-engine row as Claude interactive without invented effort or Codex values', () => {
    expect(
      buildExtraRows().map(
        ({ name, executionPath, claudeEffort, codexModel, codexEffort }) => ({
          name,
          executionPath,
          claudeEffort,
          codexModel,
          codexEffort,
        }),
      ),
    ).toEqual(
      buildExtraRows().map(({ name }) => ({
        name,
        executionPath: 'Claude interactive',
        claudeEffort: '',
        codexModel: '',
        codexEffort: '',
      })),
    );
  });

  it('maps display names: snake_case -> kebab-case, build -> pipeline, worktree -> worktree-manager, acceptance_specs -> writing-system-tests', () => {
    expect(stepDisplayName('architecture_diagram')).toBe('architecture-diagram');
    expect(stepDisplayName('build')).toBe('pipeline');
    expect(stepDisplayName('worktree')).toBe('worktree-manager');
    expect(stepDisplayName('acceptance_specs')).toBe('writing-system-tests');
  });

  it('does not produce duplicate row names (e.g. acceptance_specs renamed to writing-system-tests)', () => {
    expect(() => renderModelTable()).not.toThrow();
    const names = [...buildEngineRows(), ...buildExtraRows()].map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RED/GREEN specs for the CLI write mode + idempotency (.docs/stories/
// generated-model-table.md, TS-2 happy paths 1 & 3, TS-2 negative path 1;
// Task 8 of the implementation plan). The CLI is invoked in-process against
// a real temp-dir HARNESS.md fixture via the injectable CliIO — no shelling
// out to the bin/ wrapper (that real-binary smoke test is Task 11).
// ─────────────────────────────────────────────────────────────────────────────

const nodeIO: CliIO = {
  readFile: (path: string) => readFile(path, 'utf8'),
  writeFile: (path: string, data: string) => writeFile(path, data, 'utf8'),
};

describe('runGenerateModelTable — CLI write mode + idempotency', () => {
  let dir: string;
  let harnessPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'generate-model-table-'));
    harnessPath = join(dir, 'HARNESS.md');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parseCliArgs: no flags -> write, --check -> check, --pins -> pins', () => {
    expect(parseCliArgs([])).toBe('write');
    expect(parseCliArgs(['--check'])).toBe('check');
    expect(parseCliArgs(['--pins'])).toBe('pins');
  });

  it('write mode (default) rewrites the region and returns 0 (TS-2 happy path 1)', async () => {
    await writeFile(harnessPath, fixture(STALE_TABLE), 'utf8');

    const exitCode = await runGenerateModelTable([], nodeIO, harnessPath);
    expect(exitCode).toBe(EXIT_OK);

    const after = await readFile(harnessPath, 'utf8');
    expect(after).toContain(renderModelTable());
    expect(after).not.toContain('stale row from a previous run');
    expect(after.startsWith(PROSE_BEFORE + BEGIN_MARKER + '\n')).toBe(true);
    expect(after.endsWith(END_MARKER + PROSE_AFTER)).toBe(true);
  });

  it('write then check is idempotent: check exits 0 with no further changes (TS-2 happy path 3)', async () => {
    await writeFile(harnessPath, fixture(STALE_TABLE), 'utf8');

    const writeExit = await runGenerateModelTable([], nodeIO, harnessPath);
    expect(writeExit).toBe(EXIT_OK);

    const afterWrite = await readFile(harnessPath, 'utf8');

    const checkExit = await runGenerateModelTable(['--check'], nodeIO, harnessPath);
    expect(checkExit).toBe(EXIT_OK);

    const afterCheck = await readFile(harnessPath, 'utf8');
    expect(afterCheck).toBe(afterWrite);
  });

  it('on a marker error, exits 2 and leaves the fixture file byte-identical (TS-2 negative path 1)', async () => {
    const brokenDoc = PROSE_BEFORE + 'no begin marker here\n' + END_MARKER + PROSE_AFTER;
    await writeFile(harnessPath, brokenDoc, 'utf8');

    const exitCode = await runGenerateModelTable([], nodeIO, harnessPath);
    expect(exitCode).toBe(EXIT_ERROR);

    const after = await readFile(harnessPath, 'utf8');
    expect(after).toBe(brokenDoc);
  });

  it('on a marker error in --check mode, also exits 2 and leaves the file untouched', async () => {
    const brokenDoc =
      PROSE_BEFORE + END_MARKER + '\n' + STALE_TABLE + '\n' + BEGIN_MARKER + PROSE_AFTER;
    await writeFile(harnessPath, brokenDoc, 'utf8');

    const exitCode = await runGenerateModelTable(['--check'], nodeIO, harnessPath);
    expect(exitCode).toBe(EXIT_ERROR);

    const after = await readFile(harnessPath, 'utf8');
    expect(after).toBe(brokenDoc);
  });

  it('write mode is a no-op write when the file already matches the generated output', async () => {
    await writeFile(harnessPath, fixture(renderModelTable()), 'utf8');

    const exitCode = await runGenerateModelTable([], nodeIO, harnessPath);
    expect(exitCode).toBe(EXIT_OK);

    const after = await readFile(harnessPath, 'utf8');
    expect(after).toBe(fixture(renderModelTable()));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildPinsJson (TS-4 happy path 1, Task 10): --pins mode's JSON emission.
// Every mapped skill -> { expected: <untiered engine default> }; every exempt
// skill -> { exempt: true }.
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPinsJson', () => {
  it('derives mapped pins from the supplied Claude policy', () => {
    const buildPinsForClaudePolicy = buildPinsJson as unknown as (
      claudePolicy: ProviderModelPolicy,
    ) => ReturnType<typeof buildPinsJson>;
    const claudePolicy = {
      ...CLAUDE_MODEL_POLICY,
      stepModels: { ...CLAUDE_MODEL_POLICY.stepModels, rebase: 'opus' },
    };

    expect(buildPinsForClaudePolicy(claudePolicy).rebase).toEqual({ expected: 'opus' });
  });

  it('does not let a synthetic Codex-only model difference affect Claude pins', async () => {
    vi.resetModules();
    vi.doMock('../src/engine/provider-model-policy.js', async () => {
      const actual = await vi.importActual<typeof import('../src/engine/provider-model-policy.js')>(
        '../src/engine/provider-model-policy.js',
      );
      return {
        ...actual,
        CODEX_MODEL_POLICY: {
          ...actual.CODEX_MODEL_POLICY,
          stepModels: { ...actual.CODEX_MODEL_POLICY.stepModels, assess: 'sol' },
        },
      };
    });

    try {
      const mod = await import('../src/tools/generate-model-table.js');
      expect(mod.buildPinsJson().assess).toEqual({
        expected: CLAUDE_MODEL_POLICY.stepModels.assess,
      });
    } finally {
      vi.doUnmock('../src/engine/provider-model-policy.js');
      vi.resetModules();
    }
  });

  it('emits an entry for every mapped skill with the untiered engine-default model', () => {
    const pins = buildPinsJson();

    for (const [skill, step] of Object.entries(SKILL_STEP_MAP)) {
      expect(pins[skill]).toEqual({ expected: DEFAULT_STEP_MODELS[step] });
    }
  });

  it('emits { exempt: true } for every exempt skill', () => {
    const pins = buildPinsJson();

    for (const skill of PIN_EXEMPT_SKILLS) {
      expect(pins[skill]).toEqual({ exempt: true });
    }
  });

  it('emits exactly one entry per mapped/exempt skill, no extras', () => {
    const pins = buildPinsJson();
    const expectedKeys = new Set([...Object.keys(SKILL_STEP_MAP), ...PIN_EXEMPT_SKILLS]);

    expect(new Set(Object.keys(pins))).toEqual(expectedKeys);
  });

  it('a known mapped skill (rebase) resolves to its DEFAULT_STEP_MODELS value', () => {
    const pins = buildPinsJson();
    expect(pins['rebase']).toEqual({ expected: 'fable' });
    expect(DEFAULT_STEP_MODELS.rebase).toBe('fable');
  });

  it('a known exempt skill (code-review) is marked exempt, not expected', () => {
    const pins = buildPinsJson();
    expect(pins['code-review']).toEqual({ exempt: true });
  });
});

describe('harness integrity pin mismatch boundary', () => {
  it('fails nonzero and names the Claude skill whose seeded pin disagrees', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'harness-pin-mismatch-'));
    const fixtureSkillsDir = join(dir, 'skills');
    const assessDir = join(fixtureSkillsDir, 'assess');
    const assessSkillPath = join(harnessRoot, 'skills', 'assess', 'SKILL.md');

    try {
      await mkdir(assessDir, { recursive: true });
      const assessSkill = await readFile(assessSkillPath, 'utf8');
      await writeFile(
        join(assessDir, 'SKILL.md'),
        assessSkill.replace(/^model:\s*sonnet$/m, 'model: opus'),
        'utf8',
      );

      const result = spawnSync('bash', [join(harnessRoot, 'test', 'test_harness_integrity.sh')], {
        cwd: harnessRoot,
        env: {
          ...process.env,
          HARNESS_INTEGRITY_TEST_SKILLS_DIR: fixtureSkillsDir,
          HARNESS_INTEGRITY_TEST_PINS_JSON: JSON.stringify(buildPinsJson()),
        },
        encoding: 'utf8',
      });
      const output = `${result.stdout}${result.stderr}`;

      expect({
        failed: result.status !== 0,
        namesAffectedSkill: output.includes(
          "assess — pin/expected disagreement: pinned='opus' expected='sonnet'",
        ),
      }).toEqual({ failed: true, namesAffectedSkill: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('runGenerateModelTable --pins mode', () => {
  it('writes valid JSON matching buildPinsJson to stdout and exits 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'generate-model-table-pins-'));
    const harnessPath = join(dir, 'HARNESS.md');
    try {
      let written = '';
      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: unknown) => {
          written += String(chunk);
          return true;
        });

      const exitCode = await runGenerateModelTable(['--pins'], nodeIO, harnessPath);

      spy.mockRestore();

      expect(exitCode).toBe(EXIT_OK);
      expect(JSON.parse(written)).toEqual(buildPinsJson());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RED/GREEN specs for --check drift detection (.docs/stories/
// generated-model-table.md, TS-3 all criteria; Task 9 of the implementation
// plan). Every scenario also proves the before/after byte-identity invariant
// (check mode never writes, including on the exit-1 branch).
// ─────────────────────────────────────────────────────────────────────────────

describe('runGenerateModelTable --check mode — drift detection (TS-3)', () => {
  let dir: string;
  let harnessPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'generate-model-table-check-'));
    harnessPath = join(dir, 'HARNESS.md');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('clean region (matches generated output) -> exit 0, file untouched', async () => {
    const clean = fixture(renderModelTable());
    await writeFile(harnessPath, clean, 'utf8');
    const before = await readFile(harnessPath, 'utf8');

    const exitCode = await runGenerateModelTable(['--check'], nodeIO, harnessPath);
    expect(exitCode).toBe(EXIT_OK);

    const after = await readFile(harnessPath, 'utf8');
    expect(after).toBe(before);
  });

  it('in-region hand-edit (sonnet -> opus) -> exit 1, unified diff + remediation command printed, file untouched', async () => {
    const clean = fixture(renderModelTable());
    const handEdited = clean.replace('sonnet', 'opus');
    // Sanity: the edit actually landed inside the generated region.
    expect(handEdited).not.toBe(clean);
    await writeFile(harnessPath, handEdited, 'utf8');
    const before = await readFile(harnessPath, 'utf8');

    let stderrOut = '';
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrOut += String(chunk);
      return true;
    });

    const exitCode = await runGenerateModelTable(['--check'], nodeIO, harnessPath);

    spy.mockRestore();

    expect(exitCode).toBe(EXIT_DRIFT);
    expect(stderrOut).toContain('-');
    expect(stderrOut).toContain('+');
    expect(stderrOut).toContain(REMEDIATION_COMMAND);

    const after = await readFile(harnessPath, 'utf8');
    expect(after).toBe(before);
  });

  it('changed engine default (e.g. stories model flipped) -> exit 1, diff shows the stale row, file untouched', async () => {
    vi.resetModules();
    vi.doMock('../src/engine/provider-model-policy.js', async () => {
      const actual = await vi.importActual<typeof import('../src/engine/provider-model-policy.js')>(
        '../src/engine/provider-model-policy.js',
      );
      return {
        ...actual,
        CLAUDE_MODEL_POLICY: {
          ...actual.CLAUDE_MODEL_POLICY,
          stepModels: { ...actual.CLAUDE_MODEL_POLICY.stepModels, stories: 'fable' },
        },
      };
    });

    try {
      const mod = await import('../src/tools/generate-model-table.js');
      const cleanForOldDefaults = ((): string => {
        // Build a fixture against the ORIGINAL (unmocked) renderer so the
        // on-disk table reflects the pre-change engine defaults.
        const original = renderModelTable();
        return fixture(original);
      })();

      await writeFile(harnessPath, cleanForOldDefaults, 'utf8');
      const before = await readFile(harnessPath, 'utf8');

      const exitCode = await mod.runGenerateModelTable(['--check'], mod.nodeIO, harnessPath);
      expect(exitCode).toBe(EXIT_DRIFT);

      const after = await readFile(harnessPath, 'utf8');
      expect(after).toBe(before);
    } finally {
      vi.doUnmock('../src/engine/provider-model-policy.js');
      vi.resetModules();
    }
  });

  it('trailing-whitespace corruption inside the region -> exit 1 (exact byte compare, not normalized)', async () => {
    const clean = fixture(renderModelTable());
    const corrupted = clean.replace(BEGIN_MARKER + '\n', BEGIN_MARKER + '\n' + '   \n');
    // Insert a line of pure trailing whitespace right after BEGIN — this is
    // still "inside the region" and must not be normalized away.
    await writeFile(harnessPath, corrupted, 'utf8');
    const before = await readFile(harnessPath, 'utf8');

    const exitCode = await runGenerateModelTable(['--check'], nodeIO, harnessPath);
    expect(exitCode).toBe(EXIT_DRIFT);

    const after = await readFile(harnessPath, 'utf8');
    expect(after).toBe(before);
  });

  it('CRLF corruption inside the region -> exit 1 (exact byte compare, not normalized)', async () => {
    const clean = fixture(renderModelTable());
    const beginIdx = clean.indexOf(BEGIN_MARKER);
    const endIdx = clean.indexOf(END_MARKER);
    const regionInner = clean.slice(beginIdx + BEGIN_MARKER.length, endIdx);
    const crlfInner = regionInner.replace(/\n/g, '\r\n');
    const corrupted =
      clean.slice(0, beginIdx + BEGIN_MARKER.length) + crlfInner + clean.slice(endIdx);
    await writeFile(harnessPath, corrupted, 'utf8');
    const before = await readFile(harnessPath, 'utf8');

    const exitCode = await runGenerateModelTable(['--check'], nodeIO, harnessPath);
    expect(exitCode).toBe(EXIT_DRIFT);

    const after = await readFile(harnessPath, 'utf8');
    expect(after).toBe(before);
  });

  it('drift diff/message is also surfaced via runGenerateModelTableCli without writing', async () => {
    const clean = fixture(renderModelTable());
    const handEdited = clean.replace('sonnet', 'opus');
    await writeFile(harnessPath, handEdited, 'utf8');
    const before = await readFile(harnessPath, 'utf8');

    const result = await runGenerateModelTableCli({ harnessMdPath: harnessPath, mode: 'check' });

    expect(result.exitCode).toBe(EXIT_DRIFT);
    expect(result.diff).toBeDefined();
    expect(result.diff).toContain('-');
    expect(result.diff).toContain('+');
    expect(result.message).toContain(REMEDIATION_COMMAND);

    const after = await readFile(harnessPath, 'utf8');
    expect(after).toBe(before);
  });

  it('clean region via runGenerateModelTableCli -> exit 0, no diff', async () => {
    const clean = fixture(renderModelTable());
    await writeFile(harnessPath, clean, 'utf8');

    const result = await runGenerateModelTableCli({ harnessMdPath: harnessPath, mode: 'check' });
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.diff).toBeUndefined();
  });
});

describe('unifiedDiff', () => {
  it('returns empty string for identical texts', () => {
    expect(unifiedDiff('a\nb\nc', 'a\nb\nc')).toBe('');
  });

  it('produces a unified diff with -/+ markers for a single-line change', () => {
    const diff = unifiedDiff('one\ntwo\nthree', 'one\nTWO\nthree');
    expect(diff).toContain('--- a/HARNESS.md');
    expect(diff).toContain('+++ b/HARNESS.md');
    expect(diff).toContain('-two');
    expect(diff).toContain('+TWO');
  });
});
