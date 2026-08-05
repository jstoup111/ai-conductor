import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { provisionProviderHome } from '../../src/engine/self-host/provider-home.js';

const worktreeRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const configuredCustomSteps = [
  'maintain-documentation',
  'release-disposition',
] as const;

describe('Claude custom-step command resolution evidence (#1311)', () => {
  it('records that the provisioned Claude home cannot contain this repo’s config-declared custom steps', async () => {
    // This is deliberately filesystem-only evidence, not a live Claude claim:
    // credentialed CLI confirmation remains gated on CLAUDE_CODE_OAUTH_TOKEN.
    // The live smoke provisions this exact home shape before dispatch.
    const baseDir = await mkdtemp(join(tmpdir(), 'claude-custom-step-resolution-'));
    const config = await readFile(join(worktreeRoot, '.ai-conductor', 'config.yml'), 'utf8');
    const home = await provisionProviderHome({
      provider: { id: 'claude' },
      worktreeRoot,
      baseDir,
    });

    try {
      expect(home.childEnv().CLAUDE_CONFIG_DIR).toBe(home.homeDir);

      for (const step of configuredCustomSteps) {
        expect(config).toContain(`  ${step}:`);
        expect(config).toContain(`skill: .agents/skills/${step}/SKILL.md`);
        // These are the configured `.agents/skills` sources, not entries in
        // the copied `skills/` catalog Claude receives in its isolated home.
        await expect(
          access(join(worktreeRoot, '.agents', 'skills', step, 'SKILL.md')),
        ).resolves.toBeUndefined();
        await expect(access(join(home.homeDir, 'skills', step, 'SKILL.md'))).rejects.toThrow();
      }
    } finally {
      await home.teardown();
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
