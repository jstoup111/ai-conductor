// Covers: task:18
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
import {
  CONFIG_CONSUMER_KEY_SETS,
  loadConfig,
  satisfiesVersion,
  validateConfig,
} from '../../src/engine/config.js';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const TEMPLATE_PATH = join(REPO_ROOT, 'templates', 'ai-conductor-config.yml.template');
const PROJECT_TEMPLATE_PATH = join(REPO_ROOT, 'templates', 'project-config.yml.template');
const VERSION_PATH = join(REPO_ROOT, 'VERSION');

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

    // Prose/header comments were left alone.
    expect(uncommented).toContain('# --- Per-step overrides (optional)');
    expect(uncommented).toContain('# Modes:');
    expect(uncommented).toContain('# Harness config —');
  });

  it('validates as a user config once every commented example is uncommented', async () => {
    const [raw, versionRaw] = await Promise.all([
      readFile(TEMPLATE_PATH, 'utf8'),
      readFile(VERSION_PATH, 'utf8'),
    ]);
    const uncommented = uncommentExamples(raw);
    const installedVersion = versionRaw.trim();

    // This template is deliberately user-level-shaped: it contains the
    // `conductor` block that loadConfig() must reject in a project file.
    // Validate its parsed content through the same shared schema under the
    // merged/user source, then separately assert its version floor.
    const result = validateConfig(loadYaml(uncommented));

    if (!result.ok) {
      throw new Error(
        `Fully-uncommented user template failed to validate against installed ` +
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
    expect(satisfiesVersion(installedVersion, result.config.harness_version ?? '')).toBe(true);
    expect(raw).toMatch(/testQuality:\n\s+enabled: false/);
    expect(raw).toMatch(/adjudication:\n\s+enabled: true/);
    expect(raw).not.toMatch(/\b(?:tautology|scope|rootCause|completeness)\b/);
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
  const walkthroughKeys = new Set([
    'test_suite.verification.mode',
    'test_suite.verification.drift_budget',
    'test_suite.command',
  ]);
  const registryRoots: Record<string, string> = {
    harness_self_host_build_auth: 'harness_self_host.build_auth',
  };

  function expectedDocumentedKeys(): Set<string> {
    const keys = new Set<string>(
      CONFIG_CONSUMER_KEY_SETS.top.filter((key) => key !== 'conductor' && key !== 'spec_owner'),
    );
    for (const [block, children] of Object.entries(CONFIG_CONSUMER_KEY_SETS)) {
      if (block === 'top' || block === 'conductor') continue;
      const root = registryRoots[block] ?? block;
      for (const child of children as readonly string[]) {
        const key = `${root}.${child}`;
        if (!walkthroughKeys.has(key)) keys.add(key);
      }
    }
    return keys;
  }

  function documentedKeys(raw: string): Set<string> {
    return new Set(Array.from(raw.matchAll(/^# Controls: ([^,\s]+)/gm), ([, key]) => key));
  }

  const PLACEHOLDER_PHRASES = [
    'a value accepted by the configuration validator',
    'use the harness default',
    'changes this setting for the project',
  ];
  const REFERENCE_URL = 'https://jstoup111.github.io/ai-conductor/reference/configuration';

  function topLevelKeys(): string[] {
    return Array.from(expectedDocumentedKeys()).filter((key) => !key.includes('.'));
  }

  function completeBlockPattern(key: string): RegExp {
    return new RegExp(
      `^# Controls: ${escapeRegex(key)}[ ,].*\\n# Allowed: \\S.*\\n# Default: \\S.*\\n# Changing it: \\S.*$`,
      'm',
    );
  }

  /** Keys whose `Controls:` line is not followed by the three guidance lines. */
  function incompleteBlocks(raw: string): string[] {
    return Array.from(documentedKeys(raw)).filter((key) => !completeBlockPattern(key).test(raw));
  }

  /** Top-level sections whose block carries the docs link and the agent offer. */
  function referencedSections(raw: string): Set<string> {
    const sections = new Set<string>();
    const lines = raw.split('\n');
    lines.forEach((line, index) => {
      const key = /^# Controls: ([^,\s]+)/.exec(line)?.[1];
      if (key === undefined || key.includes('.')) return;
      const reference = lines[index + 4] ?? '';
      if (
        reference.startsWith('# Reference: ') &&
        reference.includes(REFERENCE_URL) &&
        /ai-conductor agent can set the value on request/.test(reference)
      ) {
        sections.add(key);
      }
    });
    return sections;
  }

  /** Coverage violations: rejected keys with a block, accepted keys with no explanation path. */
  function coverageViolations(raw: string): { rejected: string[]; uncovered: string[] } {
    const expectedKeys = expectedDocumentedKeys();
    const documented = documentedKeys(raw);
    const referenced = referencedSections(raw);
    return {
      rejected: Array.from(documented).filter((key) => !expectedKeys.has(key)),
      uncovered: Array.from(expectedKeys).filter(
        (key) => !documented.has(key) && !(key.includes('.') && referenced.has(key.split('.')[0])),
      ),
    };
  }

  it('gives every top-level project-settable key an authored explanation with no placeholder text', async () => {
    const raw = await readFile(PROJECT_TEMPLATE_PATH, 'utf8');
    for (const phrase of PLACEHOLDER_PHRASES) {
      expect(raw).not.toContain(phrase);
    }
    const keys = topLevelKeys();
    expect(keys).toContain('test_suite');
    expect(keys).not.toContain('conductor');
    expect(keys).not.toContain('spec_owner');
    expect(keys.filter((key) => !completeBlockPattern(key).test(raw))).toEqual([]);
  });

  it('restores the key-specific blocks beside the values they explain', async () => {
    const raw = await readFile(PROJECT_TEMPLATE_PATH, 'utf8');
    const restoredDefaults: Record<string, string> = {
      harness_version: '">=0.99.0".',
      'build_review.rubrics.enabled': 'false.',
      'test_suite.working_directory': '`.` (the project root).',
      'test_suite.timeout_seconds': '1800.',
      'otel.worker_name': "this machine's hostname.",
    };
    for (const [key, value] of Object.entries(restoredDefaults)) {
      expect(raw, key).toMatch(new RegExp(
        `^# Controls: ${escapeRegex(key)} .*\\n# Allowed: .+\\n# Default: ${escapeRegex(value)}$`,
        'm',
      ));
    }
    expect(documentedKeys(raw)).toContain('steps.model');
    expect(documentedKeys(raw)).toContain('steps.effort');
  });

  it('leaves no explanation block incomplete at any depth', async () => {
    const raw = await readFile(PROJECT_TEMPLATE_PATH, 'utf8');
    expect(documentedKeys(raw).size).toBeGreaterThan(topLevelKeys().length);
    expect(incompleteBlocks(raw)).toEqual([]);
    expect(incompleteBlocks('# Controls: defaults — routing.\n# Allowed: an object.\n# Changing it: x.\n'))
      .toEqual(['defaults']);
  });

  it('never explains the keys the bootstrap walkthrough asks about', async () => {
    const raw = await readFile(PROJECT_TEMPLATE_PATH, 'utf8');
    const documented = documentedKeys(raw);
    for (const key of walkthroughKeys) {
      expect(documented, key).not.toContain(key);
    }
  });

  it('covers every validator-accepted key with a block or its section reference, and no rejected key', async () => {
    const raw = await readFile(PROJECT_TEMPLATE_PATH, 'utf8');
    expect(coverageViolations(raw)).toEqual({ rejected: [], uncovered: [] });
    expect(raw).toContain('\n# CONFIG_INIT_TEST_SUITE_VERIFICATION\n');
  });

  it('fails coverage for a rejected key, and for an accepted key with neither a block nor a section reference', async () => {
    const raw = await readFile(PROJECT_TEMPLATE_PATH, 'utf8');

    const withRejectedKey = `${raw}\n# Controls: not_a_real_setting — nothing.\n`;
    expect(coverageViolations(withRejectedKey).rejected).toEqual(['not_a_real_setting']);

    const withoutReferences = raw
      .split('\n')
      .filter((line) => !line.startsWith('# Reference: '))
      .join('\n');
    const { uncovered } = coverageViolations(withoutReferences);
    expect(uncovered).toContain('test_suite.verification');
    expect(uncovered).toContain('harness_self_host.build_auth.mode');
    expect(uncovered).not.toContain('defaults.model');

    const wrongOffer = raw.replaceAll('the ai-conductor agent can set the value on request', 'see the docs');
    expect(coverageViolations(wrongOffer).uncovered).toContain('steps.by_tier.effort');
  });

  it('keeps the documented template config valid through the shared validator', async () => {
    const raw = await readFile(PROJECT_TEMPLATE_PATH, 'utf8');
    const result = validateConfig(loadYaml(raw), undefined, { materializeDefaults: false });
    expect(result.ok).toBe(true);
  });

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
      expect(raw).toMatch(/adjudication:\n\s+enabled: true/);
      expect(raw).not.toMatch(/\b(?:tautology|scope|rootCause|completeness)\b/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
