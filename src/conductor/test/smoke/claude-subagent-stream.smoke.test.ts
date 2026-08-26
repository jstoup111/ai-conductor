import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const smokeCapability = 'credentialed:claude';

/**
 * Live probe outcome — 2026-08-21, Claude Code 2.1.238:
 * - `Task` tool_use and matching tool_result: absent; the CLI emitted `Agent` and its matching tool_result instead.
 * - Non-null `parent_tool_use_id`: observed on the child record.
 *
 * The matching `Agent` lifecycle is the active Claude child-work contract. The observed result and
 * parent id prove the CLI can report an active-child count for this probe.
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
  it('records the Agent attribution used for Claude child observability', async () => {
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
      const toolUses = records.flatMap(contentBlocks).filter((block) =>
        block.type === 'tool_use' && typeof block.name === 'string' && typeof block.id === 'string',
      );
      const taskToolIds = toolUses
        .filter((block) => block.name === 'Task')
        .map((block) => block.id as string);
      const agentToolIds = toolUses
        .filter((block) => block.name === observedChildToolName)
        .map((block) => block.id as string);
      const hasMatchingAgentResult = records
        .flatMap(contentBlocks)
        .some((block) => block.type === 'tool_result'
          && typeof block.tool_use_id === 'string'
          && agentToolIds.includes(block.tool_use_id));
      const hasParentAttribution = records.some((record) =>
        typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id.length > 0,
      );

      expect({
        taskToolIds,
        agentToolNames: toolUses.filter((block) => block.name === observedChildToolName).map((block) => block.name),
        matchingAgentResult: hasMatchingAgentResult,
        parentAttribution: hasParentAttribution,
      }).toEqual({
        taskToolIds: [],
        agentToolNames: [observedChildToolName],
        matchingAgentResult: true,
        parentAttribution: true,
      });

      const childObservation = agentToolIds.length > 0
        ? { childObservability: 'observed' as const, activeChildren: agentToolIds.length }
        : { childObservability: 'unsupported' as const };
      expect(childObservation).toEqual({ childObservability: 'observed', activeChildren: 1 });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 300_000);
});

void smokeCapability;
