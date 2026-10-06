import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Pi has no native subagent facility, so a writable dispatch that must
 * delegate (the pipeline skill's orchestrator) loads the operator-installed
 * `pi-subagents` extension. Its foreground child is an in-process session of
 * the same model and cwd, and its usage rides the `toolResult` message that
 * `parsePiJsonl` already sums.
 */
export const PI_SUBAGENTS_PACKAGE = 'pi-subagents';

/** The extension reads its settings only from the agent dir; print mode needs these. */
export const PI_SUBAGENTS_EXTENSION_CONFIG = {
  // A synchronous call keeps the child inside the parent's dispatch lifecycle.
  asyncByDefault: false,
  // `auto` hides `subagent` behind an enable step that waits for a next user
  // prompt, which never arrives in `-p` mode.
  toolActivation: 'eager',
  maxSubagentDepth: 1,
} as const;

/** `pi install npm:pi-subagents` places the package under the operator agent dir. */
export function piSubagentsPackageDir(operatorAgentDir: string): string {
  return join(operatorAgentDir, 'npm', 'node_modules', PI_SUBAGENTS_PACKAGE);
}

export function piSubagentsArgs(packageDir: string): string[] {
  return ['-e', packageDir, '--exclude-tools', 'subagents_enable'];
}

/**
 * Seed an engine-owned isolated agent dir. Never called for the operator's own
 * agent dir: that configuration belongs to the operator.
 */
export async function seedPiSubagentsHome(agentDir: string, thinking: string | undefined): Promise<{ tempRoot: string }> {
  const configDir = join(agentDir, 'extensions', 'subagent');
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, 'config.json'), `${JSON.stringify(PI_SUBAGENTS_EXTENSION_CONFIG)}\n`);
  await writeFile(join(agentDir, 'settings.json'), `${JSON.stringify({
    subagents: {
      // The builtin delegate inherits the parent model; thinking is not inherited.
      agentOverrides: { delegate: { model: 'inherit' } },
      ...(thinking === undefined ? {} : { defaultThinking: thinking }),
    },
  })}\n`);
  const tempRoot = join(agentDir, 'subagents-tmp');
  await mkdir(tempRoot, { recursive: true });
  return { tempRoot };
}
