/**
 * Git configuration that defines engine replay semantics independent of an
 * operator's local preferences.  Keep these out of argv: callers record and
 * compare the git command arguments as replay evidence.
 */
export const ENGINE_DIFF_RENAME_LIMIT = 1000;

export const PINNED_ENGINE_GIT_CONFIG = {
  'rebase.updateRefs': 'false',
  'rebase.rebaseMerges': 'false',
  'rebase.autoSquash': 'false',
  'merge.renames': 'true',
  'merge.directoryRenames': 'conflict',
  'diff.renameLimit': String(ENGINE_DIFF_RENAME_LIMIT),
} as const;

/**
 * Append engine pins to Git's environment-backed config without disturbing
 * entries injected earlier by credentials or the caller.
 */
export function withPinnedGitConfig(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const existingCount = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
  const offset = Number.isSafeInteger(existingCount) && existingCount >= 0 ? existingCount : 0;
  const result: NodeJS.ProcessEnv = { ...env };
  const entries = Object.entries(PINNED_ENGINE_GIT_CONFIG);

  result.GIT_CONFIG_COUNT = String(offset + entries.length);
  for (const [index, [key, value]] of entries.entries()) {
    result[`GIT_CONFIG_KEY_${offset + index}`] = key;
    result[`GIT_CONFIG_VALUE_${offset + index}`] = value;
  }
  return result;
}

const PINNED_ENGINE_GIT_SUBCOMMANDS = new Set([
  'rebase',
  'merge',
  'merge-tree',
  'cherry-pick',
  'commit-tree',
]);

/** True for the git operations whose replay semantics are engine-defined. */
export function isPinnedEngineGitCommand(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-c' || arg === '-C' || arg === '--config-env' || arg === '--git-dir' || arg === '--work-tree' || arg === '--namespace') {
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    return PINNED_ENGINE_GIT_SUBCOMMANDS.has(arg);
  }
  return false;
}
