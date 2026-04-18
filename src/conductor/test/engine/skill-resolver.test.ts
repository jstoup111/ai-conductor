import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HarnessConfig } from '../../src/types/config.js';
import { resolveSkill } from '../../src/engine/skill-resolver.js';

describe('engine/skill-resolver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-resolver-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSkillFile(
    stepDir: string,
    opts: { name?: string; enforcement?: string; phase?: string } = {},
  ): void {
    const { name = 'stories', enforcement = 'gating', phase = 'DECIDE' } = opts;
    fs.mkdirSync(stepDir, { recursive: true });
    fs.writeFileSync(
      path.join(stepDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Custom ${name}\nenforcement: ${enforcement}\nphase: ${phase}\n---\n\n# ${name}\n`,
    );
  }

  describe('project-local override happy path', () => {
    it('returns project override path when configured via steps.<name>.skill', () => {
      writeSkillFile(path.join(tmpDir, '.ai-conductor', 'skills', 'stories'));

      const config: HarnessConfig = {
        steps: {
          stories: { skill: '.ai-conductor/skills/stories/SKILL.md' },
        },
      };

      const result = resolveSkill('stories', config, tmpDir);

      expect(result.path).toBe(path.join(tmpDir, '.ai-conductor/skills/stories/SKILL.md'));
      expect(result.isOverride).toBe(true);
    });

    it('returns default harness skill path when no override', () => {
      const config: HarnessConfig = {};

      const result = resolveSkill('stories', config, tmpDir);

      expect(result.path).toBe('skills/stories/SKILL.md');
      expect(result.isOverride).toBe(false);
    });

    it('returns default path when overrides exist but not for this step', () => {
      const config: HarnessConfig = {
        steps: {
          retro: { skill: '.ai-conductor/skills/retro/SKILL.md' },
        },
      };

      const result = resolveSkill('stories', config, tmpDir);

      expect(result.path).toBe('skills/stories/SKILL.md');
      expect(result.isOverride).toBe(false);
    });
  });

  describe('override file validation', () => {
    it('throws when override path does not exist', () => {
      const config: HarnessConfig = {
        steps: { stories: { skill: 'nonexistent/SKILL.md' } },
      };

      expect(() => resolveSkill('stories', config, tmpDir)).toThrow(
        /override.*not found|does not exist/i,
      );
    });

    it('throws when override has invalid frontmatter (missing required fields)', () => {
      const overridePath = path.join(tmpDir, '.ai-conductor', 'skills', 'stories');
      fs.mkdirSync(overridePath, { recursive: true });
      const skillFile = path.join(overridePath, 'SKILL.md');
      fs.writeFileSync(
        skillFile,
        `---\nname: stories\ndescription: Custom stories\n---\n\n# Stories\n`,
      );

      const config: HarnessConfig = {
        steps: { stories: { skill: '.ai-conductor/skills/stories/SKILL.md' } },
      };

      expect(() => resolveSkill('stories', config, tmpDir)).toThrow(
        /missing required.*enforcement|missing required.*phase/i,
      );
    });

    it('succeeds when override has valid frontmatter', () => {
      const overridePath = path.join(tmpDir, '.ai-conductor', 'skills', 'stories');
      fs.mkdirSync(overridePath, { recursive: true });
      const skillFile = path.join(overridePath, 'SKILL.md');
      fs.writeFileSync(
        skillFile,
        `---\nname: stories\ndescription: Custom stories\nenforcement: gating\nphase: DECIDE\n---\n\n# Stories\n`,
      );

      const config: HarnessConfig = {
        steps: { stories: { skill: '.ai-conductor/skills/stories/SKILL.md' } },
      };

      const result = resolveSkill('stories', config, tmpDir);
      expect(result.path).toBe(path.join(tmpDir, '.ai-conductor/skills/stories/SKILL.md'));
      expect(result.isOverride).toBe(true);
    });
  });

  describe('enforcement locking for gating steps', () => {
    it('ignores enforcement override for gating step', () => {
      writeSkillFile(path.join(tmpDir, '.ai-conductor', 'skills', 'stories'), {
        name: 'stories',
        enforcement: 'advisory',
        phase: 'DECIDE',
      });

      const config: HarnessConfig = {
        steps: { stories: { skill: '.ai-conductor/skills/stories/SKILL.md' } },
      };

      const result = resolveSkill('stories', config, tmpDir);
      expect(result.enforcement).toBe('gating');
      expect(result.isOverride).toBe(true);
    });

    it('accepts enforcement override for non-gating step', () => {
      writeSkillFile(path.join(tmpDir, '.ai-conductor', 'skills', 'retro'), {
        name: 'retro',
        enforcement: 'gating',
        phase: 'SHIP',
      });

      const config: HarnessConfig = {
        steps: { retro: { skill: '.ai-conductor/skills/retro/SKILL.md' } },
      };

      const result = resolveSkill('retro', config, tmpDir);
      expect(result.enforcement).toBe('gating');
      expect(result.isOverride).toBe(true);
    });
  });
});
