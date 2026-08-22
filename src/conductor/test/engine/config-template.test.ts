/**
 * Regression coverage for issue #1010: copying
 * templates/ai-conductor-config.yml.template produced an invalid
 * .ai-conductor/config.yml in two independent ways —
 *
 *   1. The commented `steps:` example configured `bootstrap`, an
 *      out-of-band step not in ALL_STEPS, which the validator classifies as
 *      a custom step and rejects for missing `after:`.
 *   2. `harness_version: ">=1.0.0"` was unsatisfiable by the repo's actual
 *      (pre-1.0) VERSION.
 *
 * This test reads the REAL template file from disk, mechanically uncomments
 * every commented-out YAML example block, and runs the result through the
 * real `loadConfig` path (the same validator + version-satisfaction check
 * `bin/conduct-ts` uses) — so any future regression in the template's
 * commented examples, or in its harness_version constraint, is caught here
 * rather than by an operator hitting a validation error after copying it.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { load as loadYaml } from 'js-yaml';
import { loadConfig } from '../../src/engine/config.js';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const TEMPLATE_PATH = join(REPO_ROOT, 'templates', 'ai-conductor-config.yml.template');
const PROJECT_TEMPLATE_PATH = join(REPO_ROOT, 'templates', 'project-config.yml.template');
const VERSION_PATH = join(REPO_ROOT, 'VERSION');

/**
 * Uncomment a line that is part of a commented-out YAML example block.
 * The template's convention is `#` + a single space + the original,
 * still-indented content (e.g. `#   command: npm test` was `  command: npm
 * test`). Strip exactly that prefix.
 */
function uncommentLine(line: string): string {
  if (line === '#') return '';
  if (line.startsWith('# ')) return line.slice(2);
  if (line.startsWith('#')) return line.slice(1);
  return line;
}

/**
 * Mechanically uncomment every commented-out YAML example block in the
 * template, without touching prose/header comments.
 *
 * A block starts on a line whose content (after stripping the `# ` /  `#`
 * comment prefix) is *exactly* a lowercase top-level config key followed by
 * a colon (e.g. `test_suite:`, `defaults:`, `phases:`, `steps:`,
 * `complexity:` — the known example keys in the template). Once a block
 * starts, every subsequent contiguous `#`-prefixed line is part of that
 * example and gets uncommented too, until a blank line or a non-comment
 * line ends the run. This deliberately leaves prose comments (including
 * decorative header lines and the `# Modes:` doc list, which is not a
 * top-level config key) untouched.
 */
function uncommentExamples(raw: string): string {
  const lines = raw.split('\n');
  const out: string[] = [];
  let inRun = false;

  const runStartPattern = /^[a-z][a-z0-9_]*:$/;

  for (const line of lines) {
    if (!inRun) {
      const isComment = line === '#' || line.startsWith('# ') || line.startsWith('#');
      const content = isComment ? uncommentLine(line) : undefined;
      if (isComment && content !== undefined && runStartPattern.test(content.trim())) {
        inRun = true;
        out.push(content);
        continue;
      }
      out.push(line);
    } else {
      if (line.startsWith('#')) {
        out.push(uncommentLine(line));
      } else {
        inRun = false;
        out.push(line);
      }
    }
  }

  return out.join('\n');
}

describe('templates/ai-conductor-config.yml.template (issue #1010)', () => {
  it('defaults updates to stable', async () => {
    const raw = await readFile(TEMPLATE_PATH, 'utf8');
    const authoredConfig = loadYaml(raw) as {
      conductor?: { update_channel?: unknown };
    };

    expect(authoredConfig.conductor?.update_channel).toBe('stable');
  });

  it('mechanically uncomments only the intended YAML example blocks', async () => {
    const raw = await readFile(TEMPLATE_PATH, 'utf8');
    const uncommented = uncommentExamples(raw);

    // The commented examples became live keys.
    expect(uncommented).toContain('\ntest_suite:\n');
    expect(uncommented).toContain('\ndefaults:\n');
    expect(uncommented).toContain('\nphases:\n');
    expect(uncommented).toContain('\nsteps:\n');
    expect(uncommented).toContain('\ncomplexity:\n');

    // Prose/header comments were left alone.
    expect(uncommented).toContain('# --- Per-step overrides (optional)');
    expect(uncommented).toContain('# Modes:');
    expect(uncommented).toContain('# Harness config —');
  });

  it('validates once every commented example is uncommented', async () => {
    const [raw, versionRaw] = await Promise.all([
      readFile(TEMPLATE_PATH, 'utf8'),
      readFile(VERSION_PATH, 'utf8'),
    ]);
    const uncommented = uncommentExamples(raw);
    const installedVersion = versionRaw.trim();

    const tmpDir = await mkdtemp(join(tmpdir(), 'config-template-test-'));
    try {
      await mkdir(join(tmpDir, '.ai-conductor'), { recursive: true });
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), uncommented, 'utf8');

      const result = await loadConfig(tmpDir, installedVersion);

      if (!result.ok) {
        throw new Error(
          `Fully-uncommented template failed to validate against installed ` +
            `version ${installedVersion}: [${result.error.type}] ${result.error.message}\n\n` +
            `--- uncommented config ---\n${uncommented}`,
        );
      }
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([]);

      // The bootstrap-step regression: the illustrative steps.* example
      // must name a real ALL_STEPS entry, not an out-of-band step.
      expect(result.config.steps).toHaveProperty('explore');

      // The harness_version regression: the constraint in the template must
      // be satisfiable by the repo's actual (pre-1.0) VERSION.
      expect(result.config.harness_version).toBe('>=0.99.0');
      expect(raw).toMatch(/testQuality:\n\s+enabled: false/);
      expect(raw).not.toMatch(/\b(?:tautology|scope|rootCause|completeness)\b/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not regress to an unsatisfiable harness_version constraint', async () => {
    const raw = await readFile(TEMPLATE_PATH, 'utf8');
    const match = raw.match(/^harness_version:\s*"(.+)"\s*$/m);
    expect(match).not.toBeNull();
    const constraint = match?.[1] ?? '';

    // The constraint must not require a not-yet-released major version;
    // the repo is locked pre-1.0 (see CLAUDE.md: "Version locked until v1").
    expect(constraint).not.toMatch(/>=\s*1\./);
  });
});

describe('templates/project-config.yml.template', () => {
  it('is a valid project seed without user or self-host configuration', async () => {
    const raw = await readFile(PROJECT_TEMPLATE_PATH, 'utf8');
    const authoredConfig = loadYaml(raw);
    expect(authoredConfig).toBeTypeOf('object');
    expect(authoredConfig).not.toBeNull();

    const authoredKeys = Object.keys(authoredConfig as Record<string, unknown>);
    expect(authoredKeys).not.toEqual(
      expect.arrayContaining([
        'conductor',
        'markdown_viewer',
        'harness_self_host',
        'owner_gate_cutover',
        'auto_restart_on_stale_engine',
        'attribution_audit_sample_pct',
        'wiring',
        'manual_test',
      ]),
    );

    const tmpDir = await mkdtemp(join(tmpdir(), 'project-config-template-test-'));

    try {
      await mkdir(join(tmpDir, '.ai-conductor'), { recursive: true });
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), raw, 'utf8');

      const result = await loadConfig(tmpDir, '0.99.0');
      if (!result.ok) {
        throw new Error(
          `Project template failed to load: [${result.error.type}] ${result.error.message}`,
        );
      }

      expect(result.config.harness_version).toBe('>=0.99.0');
      expect(raw).toMatch(/testQuality:\n\s+enabled: false/);
      expect(raw).not.toMatch(/\b(?:tautology|scope|rootCause|completeness)\b/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
