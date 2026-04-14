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

  describe('Task 13: project-local override happy path', () => {
    it('resolveSkill() returns project override path when configured', () => {
      writeSkillFile(path.join(tmpDir, '.harness', 'skills', 'stories'));

      const config: HarnessConfig = {
        skills: {
          overrides: {
            stories: '.harness/skills/stories/SKILL.md',
          },
        },
      };

      const result = resolveSkill('stories', config, tmpDir);

      expect(result.path).toBe(path.join(tmpDir, '.harness/skills/stories/SKILL.md'));
      expect(result.isOverride).toBe(true);
    });

    it('resolveSkill() returns default harness skill path when no override', () => {
      const config: HarnessConfig = {};

      const result = resolveSkill('stories', config, tmpDir);

      expect(result.path).toBe('skills/stories/SKILL.md');
      expect(result.isOverride).toBe(false);
    });

    it('resolveSkill() returns default path when overrides exist but not for this step', () => {
      const config: HarnessConfig = {
        skills: {
          overrides: {
            retro: '.harness/skills/retro/SKILL.md',
          },
        },
      };

      // retro override configured but we ask for stories (no override)
      const result = resolveSkill('stories', config, tmpDir);

      expect(result.path).toBe('skills/stories/SKILL.md');
      expect(result.isOverride).toBe(false);
    });
  });

  describe('Task 14: validate override file exists and has valid frontmatter', () => {
    it('resolveSkill() throws when override path does not exist', () => {
      const config: HarnessConfig = {
        skills: {
          overrides: {
            stories: 'nonexistent/SKILL.md',
          },
        },
      };

      expect(() => resolveSkill('stories', config, tmpDir)).toThrow(
        /override.*not found|does not exist/i,
      );
    });

    it('resolveSkill() throws when override has invalid frontmatter (missing required fields)', () => {
      const overridePath = path.join(tmpDir, '.harness', 'skills', 'stories');
      fs.mkdirSync(overridePath, { recursive: true });
      const skillFile = path.join(overridePath, 'SKILL.md');
      fs.writeFileSync(
        skillFile,
        `---\nname: stories\ndescription: Custom stories\n---\n\n# Stories\n`,
      );

      const config: HarnessConfig = {
        skills: {
          overrides: {
            stories: '.harness/skills/stories/SKILL.md',
          },
        },
      };

      expect(() => resolveSkill('stories', config, tmpDir)).toThrow(
        /missing required.*enforcement|missing required.*phase/i,
      );
    });

    it('resolveSkill() succeeds when override has valid frontmatter', () => {
      const overridePath = path.join(tmpDir, '.harness', 'skills', 'stories');
      fs.mkdirSync(overridePath, { recursive: true });
      const skillFile = path.join(overridePath, 'SKILL.md');
      fs.writeFileSync(
        skillFile,
        `---\nname: stories\ndescription: Custom stories\nenforcement: gating\nphase: DECIDE\n---\n\n# Stories\n`,
      );

      const config: HarnessConfig = {
        skills: {
          overrides: {
            stories: '.harness/skills/stories/SKILL.md',
          },
        },
      };

      const result = resolveSkill('stories', config, tmpDir);
      expect(result.path).toBe(path.join(tmpDir, '.harness/skills/stories/SKILL.md'));
      expect(result.isOverride).toBe(true);
    });
  });

  describe('Task 15: enforcement locked for gating steps', () => {
    it('resolveSkill() ignores enforcement override for gating step', () => {
      // stories is a gating step — override tries to downgrade to advisory
      writeSkillFile(path.join(tmpDir, '.harness', 'skills', 'stories'), {
        name: 'stories',
        enforcement: 'advisory',
        phase: 'DECIDE',
      });

      const config: HarnessConfig = {
        skills: {
          overrides: {
            stories: '.harness/skills/stories/SKILL.md',
          },
        },
      };

      const result = resolveSkill('stories', config, tmpDir);
      // enforcement stays gating (the harness default), not advisory
      expect(result.enforcement).toBe('gating');
      expect(result.isOverride).toBe(true);
    });

    it('resolveSkill() accepts enforcement override for non-gating step', () => {
      // retro is advisory by default — override upgrades to gating
      writeSkillFile(path.join(tmpDir, '.harness', 'skills', 'retro'), {
        name: 'retro',
        enforcement: 'gating',
        phase: 'SHIP',
      });

      const config: HarnessConfig = {
        skills: {
          overrides: {
            retro: '.harness/skills/retro/SKILL.md',
          },
        },
      };

      const result = resolveSkill('retro', config, tmpDir);
      // enforcement comes from the override file
      expect(result.enforcement).toBe('gating');
      expect(result.isOverride).toBe(true);
    });
  });
});
