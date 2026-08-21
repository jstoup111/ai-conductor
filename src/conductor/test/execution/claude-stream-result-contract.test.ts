import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';

const fixturePath = fileURLToPath(
  new URL('../fixtures/claude-stream-result-line.json', import.meta.url),
);

describe('Claude stream terminal result contract', () => {
  it('derives output and complete token usage from the streamed terminal result', async () => {
    const terminalResult = await readFile(fixturePath, 'utf8');
    const stdout = new PassThrough();
    const process = Object.assign(Promise.resolve({ stdout: terminalResult, stderr: '', exitCode: 0 }), {
      stdout,
      kill: vi.fn(),
    });
    const provider = new ClaudeProvider(undefined, () => process as any);

    const invocation = provider.invoke({ prompt: 'Do the thing', sessionId: 'session-123', resume: false });
    stdout.end(`${terminalResult}\n`);

    await expect(invocation).resolves.toMatchObject({
      success: true,
      output: 'Completed the requested work.',
      tokenUsage: {
        input: 1200,
        output: 180,
        cacheRead: 640,
        cacheCreation: 320,
        costUsd: 0.0184,
        numTurns: 3,
        durationMs: 1842,
      },
    });
  });
});
