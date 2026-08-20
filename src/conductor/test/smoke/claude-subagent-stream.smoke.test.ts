import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const smokeCapability = 'credentialed:claude';

function claudeBinaryAvailable(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function parseRecords(stdout: string): Array<Record<string, unknown>> {
  return stdout.split('\n').flatMap((line) => {
    try {
      const record: unknown = JSON.parse(line);
      return typeof record === 'object' && record !== null ? [record as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

function contentBlocks(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = record.message;
  if (typeof message !== 'object' || message === null) return [];
  const content = (message as Record<string, unknown>).content;
  return Array.isArray(content)
    ? content.filter((block): block is Record<string, unknown> => typeof block === 'object' && block !== null)
    : [];
}

const shouldRun = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN) && claudeBinaryAvailable();

describe.skipIf(!shouldRun)('smoke/Claude subagent stream attribution', () => {
  it('records a Task call, its matching result, and a child message attribution', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'claude-subagent-stream-smoke-'));
    try {
      const result = await execa(
        'claude',
        [
          '-p',
          'Use the Task tool exactly once to ask a subagent to reply with "subagent-ok". Wait for its result, then reply with "parent-ok". Do not use any other tools.',
          '--output-format',
          'stream-json',
          '--verbose',
        ],
        { cwd, reject: false, timeout: 240_000 },
      );
      const records = parseRecords(result.stdout);
      const taskIds = records.flatMap(contentBlocks).flatMap((block) =>
        block.type === 'tool_use' && block.name === 'Task' && typeof block.id === 'string' ? [block.id] : [],
      );
      const hasMatchingResult = records
        .flatMap(contentBlocks)
        .some((block) => block.type === 'tool_result'
          && typeof block.tool_use_id === 'string'
          && taskIds.includes(block.tool_use_id));
      const hasChildMessage = records.some((record) =>
        typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id.length > 0,
      );

      expect({
        taskToolUse: taskIds.length > 0,
        matchingToolResult: hasMatchingResult,
        childMessage: hasChildMessage,
      }).toEqual({ taskToolUse: true, matchingToolResult: true, childMessage: true });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 300_000);
});

void smokeCapability;
