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

  function writeValidSkill(stepDir: string): void {
    fs.mkdirSync(stepDir, { recursive: true });
    fs.writeFileSync(
      path.join(stepDir, 'SKILL.md'),
      '---\nname: stories\ndescription: Custom stories\nenforcement: gating\nphase: DECIDE\n---\n\n# Stories\n',
    );
  }

  describe('Task 13: project-local override happy path', () => {
    it('resolveSkill() returns project override path when configured', () => {
      writeValidSkill(path.join(tmpDir, '.harness', 'skills', 'stories'));

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
});
