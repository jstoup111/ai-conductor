// Covers: task:2
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGithubBotCredential, readGithubBotToken } from '../../src/engine/github-bot-credential.js';
import { loadMergedConfig } from '../../src/engine/config.js';

const originalHome = process.env.HOME;

describe('github bot credential', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'github-bot-credential-'));
    await mkdir(join(root, 'home', '.ai-conductor'), { recursive: true });
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'), 'harness_version: ">=1.0.0"\n');
    process.env.HOME = join(root, 'home');
  });
  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    await rm(root, { recursive: true, force: true });
  });

  it('resolves a configured user token_file with home expansion and trims readable tokens', async () => {
    const tokenFile = join(root, 'home', 'bot-token');
    await writeFile(tokenFile, ' token-value\n');
    await writeFile(join(root, 'home', '.ai-conductor', 'config.yml'), 'github_bot:\n  token_file: ~/bot-token\n');
    const merged = await loadMergedConfig(root);
    expect(merged.ok, JSON.stringify(merged)).toBe(true);
    if (!merged.ok) return;
    expect(resolveGithubBotCredential(merged.config)).toEqual({ kind: 'configured', tokenFile });
    await expect(readGithubBotToken(tokenFile)).resolves.toEqual({ kind: 'token', token: 'token-value' });
    await expect(readGithubBotToken(join(root, 'missing'))).resolves.toEqual({ kind: 'unavailable' });
  });

  it('loads merged config without github_bot and resolves unconfigured', async () => {
    await writeFile(join(root, 'home', '.ai-conductor', 'config.yml'), 'spec_owner: alice\n');
    const merged = await loadMergedConfig(root);
    expect(merged.ok, JSON.stringify(merged)).toBe(true);
    if (!merged.ok) return;
    expect(resolveGithubBotCredential(merged.config)).toEqual({ kind: 'unconfigured' });
  });
});
