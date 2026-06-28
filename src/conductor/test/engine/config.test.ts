import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  validateConfig,
  disabledStepNames,
  customStepEntries,
  mergeConfigs,
} from '../../src/engine/config.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'config-test-'));
    await mkdir(join(tmpDir, '.ai-conductor'), { recursive: true });
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
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), badYaml);

      const result = await loadConfig(tmpDir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('parse_error');
      expect(result.error.message).toMatch(/line \d+/i);
    });

    it('accepts config when harness version satisfies constraint', async () => {
      const configYaml = `harness_version: ">=1.0.0"\n`;
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');
      expect(result.ok).toBe(true);
    });

    it('rejects config when version too low', async () => {
      const configYaml = `harness_version: ">=2.0.0"\n`;
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('version_mismatch');
      expect(result.error.message).toContain('1.0.0');
      expect(result.error.message).toContain('>=2.0.0');
    });

    it('parses valid .ai-conductor/config.yml (new flat schema)', async () => {
      // Note: we write skill paths here pointing at files we don't create, so
      // the validator's skill-file-exists check would fail if projectRoot is
      // passed. Use a plain override (model/disable) which needs no file.
      const configYaml = `
harness_version: ">=1.0.0"
defaults:
  model: sonnet
  effort: medium
phases:
  UNDERSTAND:
    effort: low
steps:
  memory:
    model: haiku
  architecture_diagram:
    disable: true
complexity:
  default_tier: M
`;
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.harness_version).toBe('>=1.0.0');
      expect(result.config.defaults?.model).toBe('sonnet');
      expect(result.config.defaults?.effort).toBe('medium');
      expect(result.config.phases?.UNDERSTAND?.effort).toBe('low');
      expect(result.config.steps?.memory?.model).toBe('haiku');
      expect(result.config.steps?.architecture_diagram?.disable).toBe(true);
      expect(result.config.complexity?.default_tier).toBe('M');
      expect(result.warnings).toEqual([]);
    });
  });

  describe('validateConfig', () => {
    it('rejects steps.<name> if not an object', () => {
      const result = validateConfig({
        steps: { memory: 'haiku' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('steps.memory');
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
        steps: { memory: { effort: 'exhaustive' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/low\|medium\|high\|xhigh\|max/);
    });

    it('rejects invalid max_retries type', () => {
      const result = validateConfig({
        steps: { memory: { max_retries: 'three' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/number/i);
    });

    it('rejects unknown top-level keys (fail-fast)', () => {
      const result = validateConfig({
        harness_version: '>=1.0.0',
        unknown_key: 'value',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('unknown_key');
    });

    it('rejects unknown step-level keys (fail-fast)', () => {
      const result = validateConfig({
        steps: { memory: { model: 'haiku', bogus_key: 1 } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('bogus_key');
    });

    it('rejects invalid phase name', () => {
      const result = validateConfig({
        phases: { NONEXISTENT: { effort: 'medium' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('NONEXISTENT');
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

    it('rejects built-in step setting `after` (fail-fast)', () => {
      const result = validateConfig({
        steps: { memory: { after: 'worktree' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('after');
      expect(result.error.message).toContain('memory');
    });

    it('rejects built-in step setting `enforcement` (fail-fast)', () => {
      const result = validateConfig({
        steps: { memory: { enforcement: 'gating' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('enforcement');
    });

    it('accepts chained custom steps (after: <sibling-custom>)', async () => {
      await mkdir(join(tmpDir, 'skills', 'lint'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', 'lint', 'SKILL.md'), '---\nname: lint\n---\n');
      await mkdir(join(tmpDir, 'skills', 'format'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', 'format', 'SKILL.md'), '---\nname: format\n---\n');

      const result = validateConfig(
        {
          steps: {
            lint: {
              after: 'build',
              skill: 'skills/lint/SKILL.md',
              enforcement: 'advisory',
            },
            format: {
              after: 'lint',
              skill: 'skills/format/SKILL.md',
              enforcement: 'advisory',
            },
          },
        },
        tmpDir,
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('markdown_viewer validation', () => {
    it('accepts a valid preset block', () => {
      const result = validateConfig({
        markdown_viewer: {
          preset: 'glow',
          command: 'glow',
          args: ['-p', '-w', '80', '{file}'],
          mode: 'inline',
        },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects args without {file} placeholder', () => {
      const result = validateConfig({
        markdown_viewer: { command: 'glow', args: ['-p', '-w', '80'], mode: 'inline' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/\{file\}/);
    });

    it('rejects invalid mode', () => {
      const result = validateConfig({
        markdown_viewer: { command: 'glow', args: ['{file}'], mode: 'weird' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/inline\|blocking\|external/);
    });

    it('rejects unknown keys under markdown_viewer', () => {
      const result = validateConfig({
        markdown_viewer: { command: 'glow', args: ['{file}'], mode: 'inline', bogus: 1 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/bogus/);
    });

    it('rejects non-string args entries', () => {
      const result = validateConfig({
        markdown_viewer: { command: 'glow', args: ['-w', 80, '{file}'], mode: 'inline' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/array of strings/);
    });
  });

  describe('conductor block validation', () => {
    it('accepts tagged/main update_channel', () => {
      expect(validateConfig({ conductor: { update_channel: 'tagged' } }).ok).toBe(true);
      expect(validateConfig({ conductor: { update_channel: 'main' } }).ok).toBe(true);
    });

    it('rejects other update_channel values', () => {
      const result = validateConfig({ conductor: { update_channel: 'nightly' } });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/tagged/);
    });

    it('rejects non-boolean auto_check', () => {
      const result = validateConfig({ conductor: { auto_check: 'yes' } });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/boolean/);
    });
  });

  describe('acceptance_spec_globs validation', () => {
    it('accepts an array of glob strings', () => {
      const result = validateConfig({
        acceptance_spec_globs: ['*/spec/**/*', 'api/spec/**/*'],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects a non-array value', () => {
      const result = validateConfig({ acceptance_spec_globs: 'spec/**/*' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/array/);
    });

    it('rejects an array with a non-string entry', () => {
      const result = validateConfig({ acceptance_spec_globs: ['ok', 42] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/strings/);
    });

    it('lets a project array replace a user array via mergeConfigs', () => {
      const merged = mergeConfigs(
        { acceptance_spec_globs: ['tests/**/*'] },
        { acceptance_spec_globs: ['*/spec/**/*'] },
      );
      expect(merged.acceptance_spec_globs).toEqual(['*/spec/**/*']);
    });
  });

  describe('mergeConfigs', () => {
    it('project scalars replace user scalars', () => {
      const merged = mergeConfigs(
        { defaults: { model: 'sonnet' } },
        { defaults: { model: 'opus' } },
      );
      expect(merged.defaults?.model).toBe('opus');
    });

    it('project objects merge with user objects key-by-key', () => {
      const merged = mergeConfigs(
        { markdown_viewer: { command: 'glow', args: ['{file}'], mode: 'inline', preset: 'glow' } },
        { markdown_viewer: { mode: 'blocking' } as unknown as never },
      );
      expect(merged.markdown_viewer?.command).toBe('glow');
      expect(merged.markdown_viewer?.mode).toBe('blocking');
    });

    it('project arrays replace user arrays (no concat)', () => {
      const merged = mergeConfigs(
        { markdown_viewer: { command: 'glow', args: ['-p', '{file}'], mode: 'inline' } },
        {
          markdown_viewer: {
            command: 'code',
            args: ['--wait', '{file}'],
            mode: 'blocking',
          },
        },
      );
      expect(merged.markdown_viewer?.args).toEqual(['--wait', '{file}']);
    });

    it('user-only keys pass through untouched', () => {
      const merged = mergeConfigs(
        { conductor: { update_channel: 'main', current_version: '1.0.0' } },
        {},
      );
      expect(merged.conductor?.update_channel).toBe('main');
      expect(merged.conductor?.current_version).toBe('1.0.0');
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
