import { describe, it, expect } from 'vitest';
import type { HarnessConfig } from '../../src/types/config.js';
import { resolveSkill } from '../../src/engine/skill-resolver.js';

describe('engine/skill-resolver', () => {
  describe('Task 13: project-local override happy path', () => {
    it('resolveSkill() returns project override path when configured', () => {
      const config: HarnessConfig = {
        skills: {
          overrides: {
            stories: '.harness/skills/stories/SKILL.md',
          },
        },
      };

      const result = resolveSkill('stories', config, '/project');

      expect(result.path).toBe('/project/.harness/skills/stories/SKILL.md');
      expect(result.isOverride).toBe(true);
    });

    it('resolveSkill() returns default harness skill path when no override', () => {
      const config: HarnessConfig = {};

      const result = resolveSkill('stories', config, '/project');

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

      const result = resolveSkill('stories', config, '/project');

      expect(result.path).toBe('skills/stories/SKILL.md');
      expect(result.isOverride).toBe(false);
    });
  });
});
