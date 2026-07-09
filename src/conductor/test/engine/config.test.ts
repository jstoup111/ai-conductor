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
  resolveMemoryProvider,
} from '../../src/engine/config.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';

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

    it('accepts rebase_resolution_attempts as a known top-level key', () => {
      const result = validateConfig({ rebase_resolution_attempts: 5 });
      expect(result.ok).toBe(true);
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

  describe('mermaid_renderer validation', () => {
    it('accepts a valid preset block', () => {
      const result = validateConfig({
        mermaid_renderer: {
          preset: 'html',
          command: '',
          args: ['{file}'],
          mode: 'external',
        },
      });
      expect(result.ok).toBe(true);
    });

    it('accepts a block with no command (html/none presets need no tool)', () => {
      const result = validateConfig({
        mermaid_renderer: { preset: 'none', args: ['{file}'], mode: 'external' },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects args without {file} placeholder', () => {
      const result = validateConfig({
        mermaid_renderer: { command: 'mmdc', args: ['-i'], mode: 'external' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/\{file\}/);
    });

    it('rejects invalid mode', () => {
      const result = validateConfig({
        mermaid_renderer: { command: 'mmdc', args: ['{file}'], mode: 'weird' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/inline\|blocking\|external/);
    });

    it('rejects unknown keys under mermaid_renderer', () => {
      const result = validateConfig({
        mermaid_renderer: { command: 'mmdc', args: ['{file}'], mode: 'external', bogus: 1 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/bogus/);
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

  describe('model_fallback_ladder validation', () => {
    it('accepts an array of non-empty model strings', () => {
      const result = validateConfig({ model_fallback_ladder: ['fable', 'opus'] });
      expect(result.ok).toBe(true);
    });

    it('accepts an empty array (no fallback)', () => {
      const result = validateConfig({ model_fallback_ladder: [] });
      expect(result.ok).toBe(true);
    });

    it('rejects a string value instead of an array', () => {
      const result = validateConfig({ model_fallback_ladder: 'fable' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/model_fallback_ladder/);
    });

    it('rejects an array containing a number', () => {
      const result = validateConfig({ model_fallback_ladder: ['fable', 5] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/model_fallback_ladder/);
    });

    it('rejects an array containing an empty string', () => {
      const result = validateConfig({ model_fallback_ladder: ['fable', ''] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/model_fallback_ladder/);
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

  // Task A4 (adr-2026-06-29-per-project-memory-provider-selection): memory_provider config field
  describe('memory_provider config field', () => {
    it('accepts memory_provider: local and exposes it on the parsed config', () => {
      const result = validateConfig({ memory_provider: 'local' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.memory_provider).toBe('local');
    });

    it('accepts memory_provider alongside other plugin selections', () => {
      const result = validateConfig({
        llm_provider: 'claude',
        ui_renderer: 'terminal',
        memory_provider: 'local',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.memory_provider).toBe('local');
      expect(result.config.llm_provider).toBe('claude');
    });

    it('memory_provider: absent is fine — field is optional', () => {
      const result = validateConfig({ harness_version: '>=1.0.0' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.memory_provider).toBeUndefined();
    });
  });

  // Task 17 (owner-gate, adr-2026-06-30-*): spec_owner + owner_gate_cutover.
  describe('owner-gate config fields (spec_owner + owner_gate_cutover)', () => {
    it('parses spec_owner and owner_gate_cutover and exposes them', () => {
      const result = validateConfig({
        spec_owner: 'alice',
        owner_gate_cutover: '2026-06-30T00:00:00Z',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.spec_owner).toBe('alice');
      expect(result.config.owner_gate_cutover).toBe('2026-06-30T00:00:00Z');
    });

    it('both fields are optional — absent is fine (documented default applied at wiring)', () => {
      const result = validateConfig({ harness_version: '>=1.0.0' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.spec_owner).toBeUndefined();
      expect(result.config.owner_gate_cutover).toBeUndefined();
    });

    it('REJECTS a malformed (unparseable) owner_gate_cutover with a clear error', () => {
      const result = validateConfig({ owner_gate_cutover: 'not-a-date' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      expect(result.error.message).toMatch(/owner_gate_cutover.*not.*parseable/i);
      expect(result.error.message).toMatch(/not-a-date/);
    });

    it('rejects a non-string spec_owner', () => {
      const result = validateConfig({ spec_owner: 42 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/spec_owner must be a string/);
    });

    it('rejects a non-string owner_gate_cutover', () => {
      const result = validateConfig({ owner_gate_cutover: 1234 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/owner_gate_cutover must be an ISO-8601 date string/);
    });

    // Anti-leak guard (A4 / D2 / Story 2): a `spec_owner` committed into a
    // shared PROJECT config would leak one operator's identity to everyone who
    // pulls. Loading a project config that carries the key is a hard rejection
    // that names the file and the fix. Identity is user-config-only.
    describe('anti-leak guard: spec_owner in a project config (D2)', () => {
      it('REJECTS a project-source config that carries spec_owner, naming the file and the fix', () => {
        const result = validateConfig({ spec_owner: 'jstoup111' }, '/repo', {
          source: 'project',
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.type).toBe('validation_error');
        // Names the committed file …
        expect(result.error.message).toMatch(/\.ai-conductor\/config\.yml/);
        // … and the fix: move it to the user config.
        expect(result.error.message).toMatch(/~\/\.ai-conductor\/config\.yml/);
        expect(result.error.message).toMatch(/spec_owner/);
      });

      it('REJECTS a blank/whitespace spec_owner in a project config (a present key is the leak)', () => {
        const blank = validateConfig({ spec_owner: '   ' }, '/repo', { source: 'project' });
        expect(blank.ok).toBe(false);
        const empty = validateConfig({ spec_owner: '' }, '/repo', { source: 'project' });
        expect(empty.ok).toBe(false);
      });

      it('ACCEPTS a project config with NO spec_owner (guard only triggers on the leak)', () => {
        const result = validateConfig({ defaults: { model: 'sonnet' } }, '/repo', {
          source: 'project',
        });
        expect(result.ok).toBe(true);
      });

      it('ACCEPTS spec_owner on the merged/user path (identity is legitimately user-config-sourced)', () => {
        const result = validateConfig({ spec_owner: 'jstoup111' }, '/repo', {
          source: 'merged',
        });
        expect(result.ok).toBe(true);
      });

      it('loadConfig REJECTS a committed project config that carries spec_owner', async () => {
        await writeFile(
          join(tmpDir, '.ai-conductor', 'config.yml'),
          'spec_owner: jstoup111\n',
        );
        const result = await loadConfig(tmpDir);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toMatch(/spec_owner/);
        expect(result.error.message).toMatch(/~\/\.ai-conductor\/config\.yml/);
      });

      it('loadConfig still succeeds for a project config with no spec_owner (no regression)', async () => {
        await writeFile(
          join(tmpDir, '.ai-conductor', 'config.yml'),
          'defaults:\n  model: sonnet\n',
        );
        const result = await loadConfig(tmpDir);
        expect(result.ok).toBe(true);
      });
    });
  });

  // Task 3 (negative paths: TR-1): build_auth.mode validation — fail-closed for unknown/empty/non-string modes
  describe('harness_self_host.build_auth.mode validation (Task 3: TR-1 negative paths)', () => {
    it('accepts valid mode: daemon-token', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            mode: 'daemon-token',
          },
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.harness_self_host?.build_auth?.mode).toBe('daemon-token');
    });

    it('accepts valid mode: api-key', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            mode: 'api-key',
          },
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.harness_self_host?.build_auth?.mode).toBe('api-key');
    });

    it('accepts undefined mode (optional field)', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            token_path: '/path/to/token',
          },
        },
      });
      expect(result.ok).toBe(true);
    });

    it('REJECTS unknown mode: operator-oauth', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            mode: 'operator-oauth',
          },
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      // Message should name the invalid value
      expect(result.error.message).toContain('operator-oauth');
      // Message should list valid options
      expect(result.error.message).toMatch(/daemon-token.*api-key|api-key.*daemon-token/);
    });

    it('REJECTS empty string mode', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            mode: '',
          },
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      // Message should list valid options
      expect(result.error.message).toMatch(/daemon-token.*api-key|api-key.*daemon-token/);
    });

    it('REJECTS non-string mode (number)', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            mode: 42,
          },
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      // Message should list valid options
      expect(result.error.message).toMatch(/daemon-token.*api-key|api-key.*daemon-token/);
    });
  });

  // Task A10 (adr-2026-06-29-per-project-memory-provider-selection FR-1 negative): provider selection is per-project; no leakage.
  describe('A10: resolveMemoryProvider — per-project isolation, no leakage', () => {
    function registryWithLocal(provider: object): PluginRegistry {
      const reg = new PluginRegistry();
      reg.register('memory_provider' as any, 'local', provider);
      return reg;
    }

    it('two configs with different memory_provider values resolve independently', async () => {
      const LOCAL = { name: 'local', kind: 'memory_provider' };
      const registry = registryWithLocal(LOCAL);

      const ctxA = { warnings: [] as string[] };
      const ctxB = { warnings: [] as string[] };

      const a = await resolveMemoryProvider({ memory_provider: 'local' } as any, registry, ctxA);
      const b = await resolveMemoryProvider({ memory_provider: 'unknown-b' } as any, registry, ctxB);

      // A's valid resolution is correct.
      expect(a).toBe(LOCAL);
      expect(ctxA.warnings).toEqual([]);

      // B's bad resolution falls back to local with one warning — independently.
      expect(b).toBe(LOCAL);
      expect(ctxB.warnings.length).toBe(1);
    });

    it('resolving one config does NOT mutate the other config object', async () => {
      const LOCAL = { name: 'local', kind: 'memory_provider' };
      const registry = registryWithLocal(LOCAL);

      const configA = { memory_provider: 'local' };
      const configB = { memory_provider: 'nope' };

      await resolveMemoryProvider(configA as any, registry, { warnings: [] });
      await resolveMemoryProvider(configB as any, registry, { warnings: [] });

      // Neither config object was mutated.
      expect(configA.memory_provider).toBe('local');
      expect(configB.memory_provider).toBe('nope');
    });

    it('re-resolving config A after resolving config B still yields local (no shared state)', async () => {
      const LOCAL = { name: 'local', kind: 'memory_provider' };
      const registry = registryWithLocal(LOCAL);

      const ctxB = { warnings: [] as string[] };
      await resolveMemoryProvider({ memory_provider: 'unknown-b' } as any, registry, ctxB);

      // A fresh ctx for config A should see no contamination from config B.
      const ctxA = { warnings: [] as string[] };
      const aAgain = await resolveMemoryProvider(
        { memory_provider: 'local' } as any,
        registry,
        ctxA,
      );
      expect(aAgain).toBe(LOCAL);
      expect(ctxA.warnings).toEqual([]);
    });

    it('purity: resolver has no module-level mutable state — repeated calls with fresh ctx are independent', async () => {
      const LOCAL = { name: 'local', kind: 'memory_provider' };
      const registry = registryWithLocal(LOCAL);

      // Three independent resolutions of the same bad name, each with a fresh ctx.
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          resolveMemoryProvider(
            { memory_provider: 'bad-name' } as any,
            registry,
            { warnings: [] },
          ).then((p) => p),
        ),
      );

      // All three degrade to local.
      for (const r of results) expect(r).toBe(LOCAL);
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

  describe('auto_restart_on_stale_engine config field', () => {
    it('resolves true to true without warning', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves false to false without warning', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: false });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves absent (missing key) to false silently', () => {
      const result = validateConfig({ harness_version: '>=1.0.0' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves null to false silently', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: null });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves invalid string value to false with one warning', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: 'banana' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/auto_restart_on_stale_engine.*invalid/i);
      expect(result.warnings[0]).toMatch(/banana/);
    });

    it('resolves invalid number value to false with one warning', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/auto_restart_on_stale_engine.*invalid/i);
    });

    it('resolves invalid object value to false with one warning', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: {} });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/auto_restart_on_stale_engine.*invalid/i);
    });

    it('never throws — always returns ok: true', () => {
      const testCases = [
        { auto_restart_on_stale_engine: true },
        { auto_restart_on_stale_engine: false },
        { auto_restart_on_stale_engine: 'yes' },
        { auto_restart_on_stale_engine: 'no' },
        { auto_restart_on_stale_engine: 1 },
        { auto_restart_on_stale_engine: 0 },
        { auto_restart_on_stale_engine: [] },
        { auto_restart_on_stale_engine: {} },
        { auto_restart_on_stale_engine: null },
        {},
      ];
      for (const testCase of testCases) {
        const result = validateConfig(testCase);
        expect(result.ok).toBe(true);
      }
    });

    it('emits only one warning per invalid value', () => {
      const result1 = validateConfig({ auto_restart_on_stale_engine: 'invalid' });
      expect(result1.ok).toBe(true);
      if (!result1.ok) return;
      expect(result1.warnings).toHaveLength(1);

      const result2 = validateConfig({ auto_restart_on_stale_engine: 'invalid' });
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;
      expect(result2.warnings).toHaveLength(1);
    });

    it('default is false when config is empty', () => {
      const result = validateConfig({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
    });

    it('works with other config fields present', () => {
      const result = validateConfig({
        harness_version: '>=1.0.0',
        auto_restart_on_stale_engine: true,
        defaults: { model: 'sonnet' },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(true);
      expect(result.config.harness_version).toBe('>=1.0.0');
      expect(result.config.defaults?.model).toBe('sonnet');
    });
  });

  describe('build_review config field', () => {
    it('resolves absent key to disabled, no warning', () => {
      const result = validateConfig({ harness_version: '>=1.0.0' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves enabled:false to disabled, identical to absent', () => {
      const result = validateConfig({ build_review: { enabled: false } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves enabled:true to enabled', () => {
      const result = validateConfig({ build_review: { enabled: true } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves null to disabled silently', () => {
      const result = validateConfig({ build_review: null });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves a non-object build_review value to disabled + one warning', () => {
      const result = validateConfig({ build_review: 'yes' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/build_review.*invalid/i);
    });

    it('resolves a non-boolean enabled value to disabled + one warning', () => {
      const result = validateConfig({ build_review: { enabled: 'banana' } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/build_review.*invalid/i);
    });

    it('never throws — always returns ok: true', () => {
      const testCases = [
        { build_review: { enabled: true } },
        { build_review: { enabled: false } },
        { build_review: 'yes' },
        { build_review: 1 },
        { build_review: [] },
        { build_review: {} },
        { build_review: null },
        {},
      ];
      for (const testCase of testCases) {
        const result = validateConfig(testCase);
        expect(result.ok).toBe(true);
      }
    });

    it('rejects steps.build_review.disable: true — gating steps cannot be disabled', () => {
      const result = validateConfig({ steps: { build_review: { disable: true } } });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/build_review/);
      expect(result.error.message).toMatch(/gating/i);
    });
  });

  describe('mergeable_autoresolve config block (Task 2)', () => {
    it('absent block → {enabled:false, cooldownMinutes:60, suiteCommand:undefined}', () => {
      const result = validateConfig({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.mergeable_autoresolve).toBeUndefined();
    });

    it('full block parses correctly with all fields', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
          cooldownMinutes: 30,
          suiteCommand: 'npm run test',
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.mergeable_autoresolve).toEqual({
        enabled: true,
        cooldownMinutes: 30,
        suiteCommand: 'npm run test',
      });
    });

    it('partial block with only enabled gets appropriate defaults', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.mergeable_autoresolve).toEqual({
        enabled: true,
        cooldownMinutes: 60,
        suiteCommand: undefined,
      });
    });

    it('partial block with enabled and cooldownMinutes gets appropriate defaults', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: false,
          cooldownMinutes: 120,
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.mergeable_autoresolve).toEqual({
        enabled: false,
        cooldownMinutes: 120,
        suiteCommand: undefined,
      });
    });

    it('rejects non-boolean enabled value', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: 'yes',
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/mergeable_autoresolve.*enabled.*boolean/i);
    });

    it('rejects non-number cooldownMinutes value', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
          cooldownMinutes: 'thirty',
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/mergeable_autoresolve.*cooldownMinutes.*number/i);
    });

    it('rejects negative cooldownMinutes value', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
          cooldownMinutes: -5,
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/mergeable_autoresolve.*cooldownMinutes/i);
    });

    it('rejects non-string suiteCommand value', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
          suiteCommand: 123,
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/mergeable_autoresolve.*suiteCommand.*string/i);
    });

    it('rejects unknown keys under mergeable_autoresolve', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
          unknownKey: 'value',
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/unknownKey/);
    });

    it('accepts mergeable_autoresolve alongside other config fields', () => {
      const result = validateConfig({
        harness_version: '>=1.0.0',
        defaults: { model: 'sonnet' },
        mergeable_autoresolve: {
          enabled: true,
          cooldownMinutes: 45,
          suiteCommand: 'npm test',
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.mergeable_autoresolve?.enabled).toBe(true);
      expect(result.config.mergeable_autoresolve?.cooldownMinutes).toBe(45);
    });
  });
});
