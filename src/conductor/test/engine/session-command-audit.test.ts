import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditSessionCommandSource,
  auditManagedSessionInstructionSource,
  discoverSessionCommandSources,
  discoverShippedSessionCommandSources,
} from '../../src/engine/session-command-audit.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'session-command-audit-'));
  directories.push(root);
  await mkdir(join(root, 'src', 'engine'), { recursive: true });
  await mkdir(join(root, 'skills', 'new-skill'), { recursive: true });
  return root;
}

describe('session command instruction discovery', () => {
  it('finds every newly introduced engine instruction without registering it', async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, 'src', 'engine', 'conductor.ts'), [
      '// ai-conductor:session-command-context=managed',
      "export const instruction = 'Run ai-conductor daemon status';",
      '// /ai-conductor:session-command-context',
    ].join('\n'));
    await writeFile(join(root, 'src', 'engine', 'config.ts'), "export const cliUsage = 'ai-conductor config init';\n");

    expect(discoverShippedSessionCommandSources(root).flatMap(auditManagedSessionInstructionSource)).toEqual([
      expect.objectContaining({ file: 'engine/conductor.ts', subcommand: 'daemon', context: 'managed' }),
      expect.objectContaining({ file: 'engine/config.ts', subcommand: 'config', reason: 'unclassified session-command context in engine instruction' }),
    ]);
  });

  it('discovers new engine and shipped-skill instructions without an occurrence inventory', async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, 'src', 'engine', 'new-prompt.ts'), "export const prompt = 'Run ai-conductor daemon status';\n");
    await writeFile(join(root, 'skills', 'new-skill', 'SKILL.md'), '```bash\nai-conductor daemon status\n```\n');

    const sources = discoverSessionCommandSources(root);

    expect(sources.map((source) => source.file)).toEqual([
      'engine/new-prompt.ts',
      'skills/new-skill/SKILL.md',
    ]);
    expect(sources.flatMap((source) => auditSessionCommandSource(source))).toEqual([
      expect.objectContaining({ file: 'engine/new-prompt.ts', line: 1, subcommand: 'daemon', context: 'managed' }),
      expect.objectContaining({ file: 'skills/new-skill/SKILL.md', line: 2, subcommand: 'daemon', context: 'managed' }),
    ]);
  });

  it('classifies bounded operator-only and prohibition regions without managed findings', () => {
    const source = [
      '<!-- ai-conductor:session-command-context=operator-only -->',
      '```bash',
      'ai-conductor daemon status',
      '```',
      '<!-- /ai-conductor:session-command-context -->',
      '<!-- ai-conductor:session-command-context=prohibition -->',
      'Never run `ai-conductor config set key value` from a managed session.',
      '<!-- /ai-conductor:session-command-context -->',
    ].join('\n');

    expect(auditSessionCommandSource({ file: 'skills/example/SKILL.md', source, family: 'skill' })).toEqual([
      expect.objectContaining({ line: 3, subcommand: 'daemon', context: 'operator-only' }),
      expect.objectContaining({ line: 7, subcommand: 'config', context: 'prohibition' }),
    ]);
  });

  it('excludes historical documentation and fails missing, malformed, stale, and ambiguous region declarations at their source', async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, '.docs', 'decisions'), { recursive: true });
    await writeFile(join(root, '.docs', 'decisions', 'historical.md'), '```bash\nai-conductor daemon park old\n```\n');
    expect(discoverSessionCommandSources(root)).not.toContainEqual(expect.objectContaining({ file: '.docs/decisions/historical.md' }));

    for (const source of [
      '```bash\nai-conductor daemon status\n```',
      '<!-- ai-conductor:session-command-context=interactive -->\nai-conductor daemon status',
      '<!-- /ai-conductor:session-command-context -->\nai-conductor daemon status',
      '<!-- ai-conductor:session-command-context=operator-only -->\n<!-- ai-conductor:session-command-context=prohibition -->\nai-conductor daemon status',
    ]) {
      expect(auditSessionCommandSource({ file: 'unknown.md', source, family: 'unknown' })).toEqual([
        expect.objectContaining({ file: 'unknown.md', line: expect.any(Number), reason: expect.stringMatching(/context/i) }),
      ]);
    }
  });

  it('finds blocked commands assembled by retry and remediation prompt constants', () => {
    const source = [
      "const retryPrompt = 'Retry with ai-conductor ' + 'daemon park feature';",
      "const remediationPrompt = `Remediate with ai-conductor ${'config'} set owner`;",
    ].join('\n');

    expect(auditSessionCommandSource({ file: 'engine/retry.ts', source, family: 'engine' })).toEqual([
      expect.objectContaining({ line: 1, column: 33, subcommand: 'daemon', reason: expect.stringMatching(/blocked subcommand: daemon/i) }),
      expect.objectContaining({ line: 2, column: 43, subcommand: 'config', reason: expect.stringMatching(/blocked subcommand: config/i) }),
    ]);
  });

  it('does not classify the .ai-conductor configuration directory as a command', () => {
    expect(auditSessionCommandSource({
      file: 'engine/config.ts',
      family: 'engine',
      source: "const location = '~/.ai-conductor/config.yml';",
    })).toEqual([]);
  });

  it('fails closed when a managed command construction cannot be resolved', () => {
    const source = [
      "const retrySubcommand = process.env.RETRY_SUBCOMMAND;",
      "const retryPrompt = 'Retry with ai-conductor ' + retrySubcommand;",
      "const remediationPrompt = `Remediate with ai-conductor ${retrySubcommand}`;",
    ].join('\n');

    expect(auditSessionCommandSource({ file: 'engine/remediation.ts', source, family: 'engine' })).toEqual([
      expect.objectContaining({ line: 2, column: 33, subcommand: 'unknown', reason: expect.stringMatching(/unresolved.command/i) }),
      expect.objectContaining({ line: 3, column: 43, subcommand: 'unknown', reason: expect.stringMatching(/unresolved.command/i) }),
    ]);
  });
});
