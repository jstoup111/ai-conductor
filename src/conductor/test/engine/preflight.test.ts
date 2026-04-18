import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureClaudeSettings, buildSettingsJson } from '../../src/engine/preflight.js';

describe('preflight', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'preflight-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('ensureClaudeSettings', () => {
    it('creates .claude/settings.json when the file is missing', async () => {
      await ensureClaudeSettings(dir);

      const path = join(dir, '.claude', 'settings.json');
      await access(path);
      const contents = await readFile(path, 'utf-8');
      const parsed = JSON.parse(contents);

      expect(parsed.$schema).toBe('https://json.schemastore.org/claude-code-settings.json');
      expect(Array.isArray(parsed.permissions.allow)).toBe(true);
    });

    it('scopes the allow rules to the project root', async () => {
      await ensureClaudeSettings(dir);

      const path = join(dir, '.claude', 'settings.json');
      const parsed = JSON.parse(await readFile(path, 'utf-8'));
      const scope = dir.slice(1); // strip leading slash

      // Project file-op rules first, path-scoped.
      expect(parsed.permissions.allow.slice(0, 3)).toEqual([
        `Read(//${scope}/**)`,
        `Edit(//${scope}/**)`,
        `Write(//${scope}/**)`,
      ]);
    });

    it('includes baseline Bash allows for harness tooling', async () => {
      await ensureClaudeSettings(dir);

      const path = join(dir, '.claude', 'settings.json');
      const parsed = JSON.parse(await readFile(path, 'utf-8'));

      // These are the tools skills invoke routinely; their presence means
      // the first `gh pr create`, `git log`, `rtk read`, `npm install`, etc
      // doesn't fire a permission prompt.
      const expected = [
        'Bash(git:*)',
        'Bash(gh:*)',
        'Bash(rtk:*)',
        'Bash(npm:*)',
        'Bash(npx:*)',
        'Bash(node:*)',
        'Bash(mkdir:*)',
        'Bash(touch:*)',
        'Bash(chmod:*)',
        'Bash(ln:*)',
        'Bash(glow:*)',
      ];
      for (const rule of expected) {
        expect(parsed.permissions.allow).toContain(rule);
      }
    });

    it('does NOT include stack-specific tools (those belong to bootstrap)', async () => {
      await ensureClaudeSettings(dir);

      const path = join(dir, '.claude', 'settings.json');
      const parsed = JSON.parse(await readFile(path, 'utf-8'));

      // Ruby/Rails, Python, Rust, Go tooling is project-dependent — projects
      // that don't use these shouldn't carry dead allow rules. Bootstrap
      // adds them per detected stack.
      const forbidden = [
        'Bash(bundle:*)',
        'Bash(rails:*)',
        'Bash(rake:*)',
        'Bash(pytest:*)',
        'Bash(pip:*)',
        'Bash(cargo:*)',
        'Bash(go:*)',
      ];
      for (const rule of forbidden) {
        expect(parsed.permissions.allow).not.toContain(rule);
      }
    });

    it('creates the .claude/ directory if it does not exist', async () => {
      // Before: no .claude/
      await expect(access(join(dir, '.claude'))).rejects.toBeDefined();

      await ensureClaudeSettings(dir);

      await access(join(dir, '.claude'));
    });

    it('is idempotent — does not overwrite an existing settings.json', async () => {
      const existing = {
        $schema: 'https://example.com/custom.json',
        permissions: { allow: ['Read(/etc/**)'] },
        marker: 'user-customization',
      };
      await mkdir(join(dir, '.claude'), { recursive: true });
      const path = join(dir, '.claude', 'settings.json');
      await writeFile(path, JSON.stringify(existing, null, 2));

      await ensureClaudeSettings(dir);

      const after = JSON.parse(await readFile(path, 'utf-8'));
      expect(after).toEqual(existing);
      expect(after.marker).toBe('user-customization');
    });

    it('is safe to call repeatedly — no errors, no content drift', async () => {
      await ensureClaudeSettings(dir);
      const first = await readFile(join(dir, '.claude', 'settings.json'), 'utf-8');

      await ensureClaudeSettings(dir);
      await ensureClaudeSettings(dir);

      const last = await readFile(join(dir, '.claude', 'settings.json'), 'utf-8');
      expect(last).toBe(first);
    });
  });

  describe('buildSettingsJson', () => {
    it('strips the leading slash from the project root in the rule pattern', () => {
      const json = buildSettingsJson('/tmp/harness-test');
      const parsed = JSON.parse(json);
      expect(parsed.permissions.allow).toContain('Write(//tmp/harness-test/**)');
    });

    it('handles a project root without a leading slash (edge case)', () => {
      const json = buildSettingsJson('relative/path');
      const parsed = JSON.parse(json);
      expect(parsed.permissions.allow).toContain('Write(//relative/path/**)');
    });

    it('emits a trailing newline so editors/diff tools are happy', () => {
      const json = buildSettingsJson('/tmp/foo');
      expect(json.endsWith('\n')).toBe(true);
    });
  });
});
