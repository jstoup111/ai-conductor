import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const smokeCapability = 'credentialed:claude';

/**
 * Live probe outcome — 2026-08-21, Claude Code 2.1.238:
 * - `Task` tool_use: absent; the CLI emitted `Agent` instead.
 * - Matching `Task` tool_result: absent; the emitted `Agent` had a matching tool_result.
 * - Non-null `parent_tool_use_id`: observed on the child record.
 *
 * Child attribution is therefore observed for the current CLI contract. If a future probe lacks
 * parent attribution, Claude child observability must be recorded as unsupported rather than
 * inferring an active-child count.
 */
const observedChildToolName = 'Agent';

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
  it('records the observed child-tool call, its matching result, and a child message attribution', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'claude-subagent-stream-smoke-'));
    try {
      const result = await execa(
        'claude',
        [
          '-p',
          'Use the Agent tool exactly once to ask a subagent to reply with "subagent-ok". Wait for its result, then reply with "parent-ok". Do not use any other tools.',
          '--output-format',
          'stream-json',
          '--verbose',
        ],
        { cwd, reject: false, timeout: 240_000 },
      );
      const records = parseRecords(result.stdout);
      const childToolIds = records.flatMap(contentBlocks).flatMap((block) =>
        block.type === 'tool_use' && block.name === observedChildToolName && typeof block.id === 'string' ? [block.id] : [],
      );
      const hasMatchingResult = records
        .flatMap(contentBlocks)
        .some((block) => block.type === 'tool_result'
          && typeof block.tool_use_id === 'string'
          && childToolIds.includes(block.tool_use_id));
      const hasChildMessage = records.some((record) =>
        typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id.length > 0,
      );

      expect({
        childToolUse: childToolIds.length > 0,
        matchingToolResult: hasMatchingResult,
        childMessage: hasChildMessage,
      }).toEqual({ childToolUse: true, matchingToolResult: true, childMessage: true });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 300_000);
});

void smokeCapability;
