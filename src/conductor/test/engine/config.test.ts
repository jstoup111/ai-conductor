import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  validateConfig,
  disabledStepNames,
  customStepEntries,
} from '../../src/engine/config.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'config-test-'));
    await mkdir(join(tmpDir, '.harness'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('returns error with migration message when config missing', async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), 'config-missing-'));
      try {
        const result = await loadConfig(emptyDir);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.type).toBe('missing');
        expect(result.error.message).toContain('Run bin/migrate');
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('reports parse error with line number for malformed YAML', async () => {
      const badYaml = `harness_version: ">=1.0.0"
steps:
  bootstrap:
    model: haiku
  bad_indent
    : broken
`;
      await writeFile(join(tmpDir, '.harness', 'config.yml'), badYaml);

      const result = await loadConfig(tmpDir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('parse_error');
      expect(result.error.message).toMatch(/line \d+/i);
    });

    it('accepts config when harness version satisfies constraint', async () => {
      const configYaml = `harness_version: ">=1.0.0"\n`;
      await writeFile(join(tmpDir, '.harness', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');
      expect(result.ok).toBe(true);
    });

    it('rejects config when version too low', async () => {
      const configYaml = `harness_version: ">=2.0.0"\n`;
      await writeFile(join(tmpDir, '.harness', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('version_mismatch');
      expect(result.error.message).toContain('1.0.0');
      expect(result.error.message).toContain('>=2.0.0');
    });

    it('parses valid .harness/config.yml (new flat schema)', async () => {
      const configYaml = `
harness_version: ">=1.0.0"
defaults:
  model: sonnet
  effort: medium
phases:
  UNDERSTAND:
    effort: low
steps:
  bootstrap:
    model: haiku
  architecture_diagram:
    disable: true
  retro:
    skill: custom-retro-skill
complexity:
  default_tier: M
`;
      await writeFile(join(tmpDir, '.harness', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.harness_version).toBe('>=1.0.0');
      expect(result.config.defaults?.model).toBe('sonnet');
      expect(result.config.defaults?.effort).toBe('medium');
      expect(result.config.phases?.UNDERSTAND?.effort).toBe('low');
      expect(result.config.steps?.bootstrap?.model).toBe('haiku');
      expect(result.config.steps?.architecture_diagram?.disable).toBe(true);
      expect(result.config.steps?.retro?.skill).toBe('custom-retro-skill');
      expect(result.config.complexity?.default_tier).toBe('M');
      expect(result.warnings).toEqual([]);
    });
  });

  describe('validateConfig', () => {
    it('rejects steps.<name> if not an object', () => {
      const result = validateConfig({
        steps: { bootstrap: 'haiku' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('steps.bootstrap');
    });

    it('rejects disabling a gating step', () => {
      const result = validateConfig({
        steps: { stories: { disable: true } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/gating/i);
      expect(result.error.message).toContain('stories');
    });

    it('rejects disabling a structural step', () => {
      const result = validateConfig({
        steps: { build: { disable: true } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('build');
    });

    it('rejects invalid effort value', () => {
      const result = validateConfig({
        steps: { bootstrap: { effort: 'exhaustive' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/low\|medium\|high\|xhigh\|max/);
    });

    it('rejects invalid max_retries type', () => {
      const result = validateConfig({
        steps: { bootstrap: { max_retries: 'three' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/number/i);
    });

    it('warns on unknown top-level keys but does not fail', () => {
      const result = validateConfig({
        harness_version: '>=1.0.0',
        unknown_key: 'value',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.includes('unknown_key'))).toBe(true);
    });

    it('warns on unknown step-level keys but does not fail', () => {
      const result = validateConfig({
        steps: { bootstrap: { model: 'haiku', bogus_key: 1 } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.includes('bogus_key'))).toBe(true);
    });

    it('rejects invalid phase name', () => {
      const result = validateConfig({
        phases: { NONEXISTENT: { effort: 'medium' } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.includes('NONEXISTENT'))).toBe(true);
    });

    it('rejects custom step with missing SKILL.md', () => {
      const result = validateConfig(
        {
          steps: {
            lint: { after: 'build', skill: 'nonexistent-skill', enforcement: 'gating' },
          },
        },
        tmpDir,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      expect(result.error.message).toContain('nonexistent-skill');
    });

    it('rejects custom step with unknown after target', () => {
      const result = validateConfig({
        steps: {
          lint: { after: 'nonexistent_step', skill: 'custom-lint', enforcement: 'gating' },
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('nonexistent_step');
    });

    it('rejects custom step without after', () => {
      const result = validateConfig({
        steps: { lint: { skill: 'custom-lint' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/after/);
    });

    it('accepts custom step with valid after target and existing SKILL.md', async () => {
      await mkdir(join(tmpDir, 'skills', 'custom-lint'), { recursive: true });
      await writeFile(
        join(tmpDir, 'skills', 'custom-lint', 'SKILL.md'),
        '---\nname: custom-lint\n---\n',
      );

      const result = validateConfig(
        {
          steps: {
            lint: {
              after: 'build',
              skill: 'skills/custom-lint/SKILL.md',
              enforcement: 'gating',
            },
          },
        },
        tmpDir,
      );

      expect(result.ok).toBe(true);
    });

    it('warns when built-in step sets `after` (ignored)', () => {
      const result = validateConfig({
        steps: { bootstrap: { after: 'memory' } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.includes('after'))).toBe(true);
    });
  });

  describe('adapters', () => {
    it('disabledStepNames returns names whose block has disable=true', () => {
      expect(
        disabledStepNames({
          steps: {
            architecture_diagram: { disable: true },
            architecture_review: { disable: true },
            brainstorm: { model: 'opus' }, // not disabled
          },
        }),
      ).toEqual(expect.arrayContaining(['architecture_diagram', 'architecture_review']));
    });

    it('customStepEntries returns only non-built-in entries with after+skill', () => {
      const entries = customStepEntries({
        steps: {
          bootstrap: { model: 'haiku' }, // built-in — skip
          lint: { after: 'build', skill: 'custom-lint', enforcement: 'gating' },
          deploy: { after: 'build', skill: 'custom-deploy' }, // default enforcement=advisory
        },
      });
      expect(entries).toHaveLength(2);
      const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
      expect(byName.lint.enforcement).toBe('gating');
      expect(byName.deploy.enforcement).toBe('advisory');
    });
  });
});
