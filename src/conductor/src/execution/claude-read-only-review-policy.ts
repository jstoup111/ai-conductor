/**
 * Claude's native read-only review launch policy, and the mechanical test of
 * whether a Claude launch can reach a command the managed session observes.
 *
 * adr-2026-10-01-daemon-session-command-contracts D6 (amended for #3022):
 * a session needs a per-dispatch observation destination only when it can
 * invoke an observed command. Observation records are written by the `gh`
 * observer wrapper and by the conductor entry guard (the canonical launcher
 * and its compatibility aliases); a launch that can run none of them can
 * produce no record. The verdict below is computed from the real argv, never from the
 * provider name, and fails closed on anything it does not recognise.
 */

/** Read-only git subcommands a review may run through Claude's Bash tool. */
const READ_ONLY_GIT_SUBCOMMANDS = [
  'show', 'diff', 'log', 'ls-tree', 'ls-files', 'cat-file', 'rev-parse', 'blame', 'grep',
] as const;

/** Commands whose execution can write a managed-session observation record. */
export const OBSERVED_COMMANDS = ['gh', 'ai-conductor', 'conduct', 'conduct-ts'] as const;

const READ_ONLY_REVIEW_TOOLS = 'Read,Grep,Glob,Bash';
const READ_ONLY_REVIEW_ALLOWED_TOOLS = READ_ONLY_GIT_SUBCOMMANDS
  .map((subcommand) => `Bash(git ${subcommand}:*)`)
  .join(',');
/**
 * Deny rules win over every allow, including Claude's built-in auto-approved
 * read-only commands (which include `gh pr view` and similar). Without them a
 * review could still run `gh` even though no allow rule names it.
 */
const READ_ONLY_REVIEW_DISALLOWED_TOOLS = OBSERVED_COMMANDS
  .map((command) => `Bash(${command}:*)`)
  .join(',');

/** The exact policy flags `ClaudeProvider` appends for a read-only review. */
export function claudeReadOnlyReviewPolicyArgs(): readonly string[] {
  return [
    '--restricted',
    '--tools', READ_ONLY_REVIEW_TOOLS,
    '--allowedTools', READ_ONLY_REVIEW_ALLOWED_TOOLS,
    '--disallowedTools', READ_ONLY_REVIEW_DISALLOWED_TOOLS,
    '--strict-mcp-config',
  ];
}

/** Flags that carry no tool, permission, settings, or MCP authority. */
const INERT_VALUE_FLAGS = new Set([
  '--session-id', '--name', '--append-system-prompt', '--model', '--output-format', '--json-schema',
]);
const INERT_BARE_FLAGS = new Set(['--print', '--verbose']);
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const READ_ONLY_GIT_RULE = new RegExp(`^Bash\\(git (?:${READ_ONLY_GIT_SUBCOMMANDS.join('|')}):\\*\\)$`);

function listValue(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/**
 * Whether a Claude launch argv can invoke an observed command. Only `'none'`
 * exempts the session from the observation-destination proof; every
 * unrecognised flag, tool, rule, or missing guard answers `'possible'`.
 */
export function claudeLaunchObservedCommandReach(args: readonly string[]): 'none' | 'possible' {
  let restricted = false;
  let strictMcp = false;
  let tools: string[] | undefined;
  let allowed: string[] = [];
  let denied: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--restricted') { restricted = true; continue; }
    if (arg === '--strict-mcp-config') { strictMcp = true; continue; }
    if (INERT_BARE_FLAGS.has(arg)) continue;
    const isList = arg === '--tools' || arg === '--allowedTools' || arg === '--disallowedTools';
    if (!isList && !INERT_VALUE_FLAGS.has(arg)) return 'possible';
    const value = args[index + 1];
    if (value === undefined) return 'possible';
    index += 1;
    if (arg === '--tools') {
      if (tools !== undefined) return 'possible';
      tools = listValue(value);
    } else if (arg === '--allowedTools') {
      allowed = [...allowed, ...listValue(value)];
    } else if (arg === '--disallowedTools') {
      denied = [...denied, ...listValue(value)];
    }
  }
  // --restricted drops settings-file permissions and hooks; --strict-mcp-config
  // drops MCP servers. An explicit tool set keeps write and agent tools absent.
  if (!restricted || !strictMcp || tools === undefined) return 'possible';
  for (const tool of tools) {
    if (READ_ONLY_TOOLS.has(tool)) continue;
    if (tool !== 'Bash') return 'possible';
    if (OBSERVED_COMMANDS.some((command) => !denied.includes(`Bash(${command}:*)`))) return 'possible';
  }
  for (const rule of allowed) {
    if (!READ_ONLY_TOOLS.has(rule) && !READ_ONLY_GIT_RULE.test(rule)) return 'possible';
  }
  return 'none';
}
