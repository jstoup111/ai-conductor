import { access, constants } from 'fs/promises';
import type { HarnessConfig } from '../types/config.js';

export interface HookRunner {
  runHook(scriptPath: string): Promise<{ success: boolean; output: string }>;
}

export interface HookResult {
  success: boolean;
  output: string;
  hookFailed?: 'before' | 'after';
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveHookPath(scriptPath: string): Promise<{ resolved: string; exists: boolean }> {
  const exists = await fileExists(scriptPath);
  if (!exists) {
    return { resolved: scriptPath, exists: false };
  }

  const executable = await isExecutable(scriptPath);
  if (!executable) {
    return { resolved: `bash ${scriptPath}`, exists: true };
  }

  return { resolved: scriptPath, exists: true };
}

export async function runWithHooks(
  stepName: string,
  config: HarnessConfig,
  projectRoot: string,
  skillRunner: () => Promise<{ success: boolean; output: string }>,
  hookRunner: HookRunner,
): Promise<HookResult> {
  // New schema: hooks live at config.steps.<name>.hooks
  const hooks = config.steps?.[stepName]?.hooks;

  // No hooks configured — just run the skill
  if (!hooks) {
    const result = await skillRunner();
    return { success: result.success, output: result.output };
  }

  // Before hook
  if (hooks.before) {
    const { resolved, exists } = await resolveHookPath(hooks.before);
    if (!exists) {
      return {
        success: false,
        output: `Before hook not found: ${hooks.before}`,
        hookFailed: 'before',
      };
    }

    const beforeResult = await hookRunner.runHook(resolved);
    if (!beforeResult.success) {
      return {
        success: false,
        output: beforeResult.output,
        hookFailed: 'before',
      };
    }
  }

  // Run skill
  const skillResult = await skillRunner();

  // After hook
  if (hooks.after) {
    const { resolved, exists } = await resolveHookPath(hooks.after);
    if (!exists) {
      return {
        success: false,
        output: `After hook not found: ${hooks.after}`,
        hookFailed: 'after',
      };
    }

    const afterResult = await hookRunner.runHook(resolved);
    if (!afterResult.success) {
      return {
        success: false,
        output: afterResult.output,
        hookFailed: 'after',
      };
    }
  }

  return { success: skillResult.success, output: skillResult.output };
}
