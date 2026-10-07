import { describe, expect, it } from 'vitest';

import {
  claudeLaunchObservedCommandReach,
  claudeReadOnlyReviewPolicyArgs,
} from '../../src/execution/claude-read-only-review-policy.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';

const inertPrefix = ['--session-id', '00000000-0000-4000-8000-000000000000'];
const inertSuffix = ['--model', 'opus', '--print', '--output-format', 'stream-json', '--verbose'];

function withPolicy(policy: readonly string[]): string[] {
  return [...inertPrefix, ...policy, ...inertSuffix];
}

function replaceValue(flag: string, value: string): string[] {
  const policy = [...claudeReadOnlyReviewPolicyArgs()];
  policy[policy.indexOf(flag) + 1] = value;
  return withPolicy(policy);
}

describe('claude read-only review observed-command reach', () => {
  it('finds no observed command reachable from the shipped read-only review policy', () => {
    expect(claudeLaunchObservedCommandReach(withPolicy(claudeReadOnlyReviewPolicyArgs()))).toBe('none');
  });

  it('derives the provider verdict from the real launch args, including self-host args', () => {
    const provider = new ClaudeProvider();
    expect(provider.readOnlyReviewObservedCommandReach({ systemPrompt: 'review', model: 'opus' })).toBe('none');
    expect(provider.readOnlyReviewObservedCommandReach({
      selfHost: { executable: '/isolated/claude', env: {}, args: ['--settings', '{}'], teardown: async () => {} },
    })).toBe('possible');
  });

  it.each([
    ['an allowed gh prefix', replaceValue('--allowedTools', 'Bash(git show:*),Bash(gh:*)')],
    ['an allowed conduct prefix', replaceValue('--allowedTools', 'Bash(conduct:*)')],
    ['unrestricted Bash allowed', replaceValue('--allowedTools', 'Bash')],
    ['a wildcard Bash rule', replaceValue('--allowedTools', 'Bash(*)')],
    ['a write tool', replaceValue('--tools', 'Read,Grep,Glob,Bash,Write')],
    ['an edit tool', replaceValue('--tools', 'Read,Edit')],
    ['an MCP tool rule', replaceValue('--allowedTools', 'mcp__github__create_pr')],
    ['a missing gh deny rule', replaceValue('--disallowedTools', 'Bash(ai-conductor:*),Bash(conduct:*),Bash(conduct-ts:*)')],
    ['no restricted mode', withPolicy(claudeReadOnlyReviewPolicyArgs().filter((arg) => arg !== '--restricted'))],
    ['MCP servers not stripped', withPolicy(claudeReadOnlyReviewPolicyArgs().filter((arg) => arg !== '--strict-mcp-config'))],
    ['an extra MCP config', [...withPolicy(claudeReadOnlyReviewPolicyArgs()), '--mcp-config', '{}']],
    ['a permission bypass', [...withPolicy(claudeReadOnlyReviewPolicyArgs()), '--dangerously-skip-permissions']],
    ['a permission mode', [...withPolicy(claudeReadOnlyReviewPolicyArgs()), '--permission-mode', 'acceptEdits']],
    ['an added directory', [...withPolicy(claudeReadOnlyReviewPolicyArgs()), '--add-dir', '/elsewhere']],
    ['a trailing flag without a value', [...withPolicy(claudeReadOnlyReviewPolicyArgs()), '--model']],
  ])('fails closed for %s', (_name, args) => {
    expect(claudeLaunchObservedCommandReach(args)).toBe('possible');
  });

  it('fails closed when no explicit tool set is given', () => {
    const policy = claudeReadOnlyReviewPolicyArgs();
    const toolsAt = policy.indexOf('--tools');
    expect(claudeLaunchObservedCommandReach(withPolicy([...policy.slice(0, toolsAt), ...policy.slice(toolsAt + 2)])))
      .toBe('possible');
  });
});
