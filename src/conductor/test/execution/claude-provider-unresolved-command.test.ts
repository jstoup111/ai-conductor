import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseJsonResult } from '../../src/execution/claude-provider.js';
import { provisionProviderHome } from '../../src/engine/self-host/provider-home.js';

const worktreeRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const configuredCustomSteps = [
  'maintain-documentation',
  'release-disposition',
] as const;
const unresolvedEnvelopePath = fileURLToPath(
  new URL('../fixtures/claude-envelopes/unresolved-command.json', import.meta.url),
);
const successfulEnvelopePath = fileURLToPath(
  new URL('../fixtures/claude-envelopes/successful-command.json', import.meta.url),
);

describe('Claude custom-step command resolution evidence (#1311)', () => {
  it('pins the observed zero-turn unresolved-command envelope beside an ordinary success', async () => {
    const [unresolvedRaw, successfulRaw] = await Promise.all([
      readFile(unresolvedEnvelopePath, 'utf8'),
      readFile(successfulEnvelopePath, 'utf8'),
    ]);
    const unresolved = JSON.parse(unresolvedRaw) as Record<string, unknown>;
    const successful = JSON.parse(successfulRaw) as Record<string, unknown>;

    expect(unresolved).toEqual({
      subtype: 'success',
      is_error: false,
      num_turns: 0,
      result: 'Unknown command: /pipeline',
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    expect(parseJsonResult(unresolvedRaw)).toEqual({
      output: 'Unknown command: /pipeline',
      tokenUsage: { input: 0, output: 0, costUsd: 0, numTurns: 0 },
    });
    expect(successful).toMatchObject({
      subtype: 'success',
      is_error: false,
      num_turns: expect.any(Number),
    });
    expect(parseJsonResult(successfulRaw).tokenUsage).toMatchObject({
      input: expect.any(Number),
      output: expect.any(Number),
    });
  });

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
