import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PI_FAILURE_SIGNATURES, PI_QUOTA_VOCABULARY_RE, parsePiJsonl, PiProvider } from '../../src/execution/pi-provider.js';
import { dispatchGitGuard } from '../fixtures/dispatch-git-guard.js';

const fixture = (name: string) => readFile(new URL(`../fixtures/pi/${name}`, import.meta.url), 'utf8');
const captures = [
  'pi-1.0.0-e1-no-api-key.stderr.txt', 'pi-1.0.0-e2-invalid-key-deepseek.jsonl',
  'pi-1.0.0-e3-invalid-key-openrouter.jsonl', 'pi-1.0.0-e4-invalid-key-anthropic.jsonl',
  'pi-1.0.0-e5-oauth-refresh-failed.jsonl', 'pi-1.0.0-e6-rate-limit.jsonl',
  'pi-1.0.0-e7-usage-exhausted.jsonl', 'pi-1.0.0-e8-rate-limit-anthropic.jsonl',
  'pi-1.0.0-e9-server-error.jsonl',
];

describe('Pi 1.0.0 failure captures', () => {
  it('keeps every capture and the anchored, multiline signature table', async () => {
    const texts = await Promise.all(captures.map(fixture));
    expect(texts).toHaveLength(9);
    const classified = [
      ...texts.map((text, index) => index === 0 ? text : parsePiJsonl(text).terminalAssistantErrorMessage ?? ''),
      parsePiJsonl(await readFile(new URL('../fixtures/pi-error-stop-stream.jsonl', import.meta.url), 'utf8')).terminalAssistantErrorMessage ?? '',
      'Authentication failed for "anthropic". Credentials may have expired or network is unavailable.',
    ];
    for (const signature of PI_FAILURE_SIGNATURES) {
      expect(classified.some((text) => signature.pattern.test(text))).toBe(true);
      expect(signature.pattern.flags).toContain('m');
      expect(signature.pattern.flags).not.toContain('i');
      expect(signature.pattern.source.startsWith('^')).toBe(true);
    }
    expect(classified.some((text) => PI_QUOTA_VOCABULARY_RE.test(text))).toBe(true);
  });

  it('replays committed streams only through its injected subprocess', async () => {
    const stdout = await fixture('pi-1.0.0-e6-rate-limit.jsonl');
    const spawn = vi.fn(async () => ({ stdout, stderr: '', exitCode: 0 }));
    const provider = new PiProvider(dispatchGitGuard, 'pi', spawn as never, {
      stat: async () => ({ isFile: () => true, isDirectory: () => false }), access: async () => {},
      env: {}, homeDir: () => '/home/test', cwd: () => '/workspace',
    });
    await expect(provider.invoke({ prompt: 'x', sessionId: 's', resume: false })).resolves.toMatchObject({ rateLimited: true });
    expect(spawn).toHaveBeenCalledOnce();
  });
});
