import { execa, type Options as ExecaOptions } from 'execa';
import type { InvokeOptions, InvokeResult, LLMProvider } from './llm-provider.js';
import { enforceFreshSessionOptions } from './fresh-session.js';
import { validateSpawnPermit } from './spawn-permit.js';

export type PiSubprocessFactory = (
  file: string,
  args: readonly string[],
  options: ExecaOptions,
) => Promise<{
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: number | null;
}>;

/** One-shot Pi adapter. JSONL parsing and failure classification belong to later tasks. */
export class PiProvider implements LLMProvider {
  readonly supportsSessionResume = false;
  readonly lifecycleCapability = { synchronousSpawnPermit: true } as const;

  constructor(
    private readonly executable = 'pi',
    private readonly subprocessFactory: PiSubprocessFactory = execa,
  ) {}

  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    options = enforceFreshSessionOptions(options, 'pi');
    const permit = validateSpawnPermit(options.spawnPermit);
    if (!permit.permitted) {
      throw new Error(`Pi process spawn denied: ${permit.reason}`);
    }

    const result = await this.subprocessFactory(this.executable, ['-p', '--no-session', '--mode', 'json'], {
      reject: false,
      input: options.prompt,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: options.cwd,
    });
    const exitCode = result.exitCode ?? 1;
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    const output = stderr ? `${stdout}\n${stderr}`.trim() : stdout;

    return { success: exitCode === 0, output, exitCode };
  }
}
