// Covers: task:4
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { resolveProviderExecutable } from '../../src/execution/provider-catalog.js';

const originalExecutable = process.env.CLAUDE_EXECUTABLE;

afterEach(() => {
  if (originalExecutable === undefined) delete process.env.CLAUDE_EXECUTABLE;
  else process.env.CLAUDE_EXECUTABLE = originalExecutable;
});

describe('ClaudeProvider executable resolution', () => {
  it('spawns the descriptor override when CLAUDE_EXECUTABLE is set', async () => {
    process.env.CLAUDE_EXECUTABLE = '/opt/claude/bin/claude';
    const launches: string[] = [];
    const provider = new ClaudeProvider(
      undefined,
      (executable) => {
        launches.push(executable);
        return Promise.resolve({ stdout: 'done', stderr: '', exitCode: 0, failed: false }) as never;
      },
      resolveProviderExecutable('claude'),
    );

    await provider.invoke({ prompt: 'hello', sessionId: 'task-4', resume: false, interactive: true });

    expect(launches).toEqual(['/opt/claude/bin/claude']);
  });
});
