import { execa, type Options as ExecaOptions, type Result } from 'execa';

export async function runCommand(
  cmd: string,
  args: string[],
  options?: ExecaOptions,
): Promise<Result> {
  return execa(cmd, args, { ...options, reject: false });
}
